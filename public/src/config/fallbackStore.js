// Fallback store — per-client auto-switch plans (provider + model tiers) and the
// monitor's runtime state. Plans store references only (provider id + model), so
// no secrets are ever persisted here; API keys continue to live in gw_key_<id>.
//
// Shape (per client):
//   { v, enabled, primary: {provider, model}, tiers: [{enabled, provider, model}, …],
//     knobs: {failThreshold, cooldownMin, autoRevert}, state: {activeTier, failStreak, lastSwitchAt, degraded} }

const MASTER = 'nx_fallback_enabled';
const PKEY = (clientId) => `nx_fallback_${clientId}`;
// A plan starts with two tiers (the familiar Primary + Fallback 1/2 shape) and can
// be extended up to MAX_TIERS. It was a hard constant, so a plan could never hold
// more than two standbys however many the user wanted.
const DEFAULT_TIERS = 2;
const MAX_TIERS = 5;

const emptyTier = () => ({ enabled: false, provider: null, model: null });

function freshPlan() {
  return {
    v: 1,
    enabled: false,
    primary: { provider: null, model: null },
      tiers: Array.from({ length: DEFAULT_TIERS }, emptyTier),
    knobs: { failThreshold: 2, cooldownMin: 5, autoRevert: true },
    state: { activeTier: 0, failStreak: 0, lastSwitchAt: 0, degraded: false, lastAction: null },
  };
}

function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function normalize(raw) {
  const p = freshPlan();
  if (!raw || typeof raw !== 'object') return p;
  p.enabled = !!raw.enabled;
  if (raw.primary && typeof raw.primary === 'object') {
    p.primary.provider = raw.primary.provider || null;
    p.primary.model = raw.primary.model || null;
  }
    // Keep however many tiers were saved, up to MAX_TIERS. Truncating to a fixed
    // length here would silently delete a user's 3rd/4th tier on every page load.
    const tiers = Array.isArray(raw.tiers) ? raw.tiers.slice(0, MAX_TIERS) : [];
    p.tiers = Array.from({ length: Math.max(DEFAULT_TIERS, tiers.length) }, (_, i) => {
      const t = tiers[i] || {};
      return { enabled: !!t.enabled, provider: t.provider || null, model: t.model || null };
    });
  if (raw.knobs && typeof raw.knobs === 'object') {
    p.knobs.failThreshold = clampInt(raw.knobs.failThreshold, 1, 5, 2);
    p.knobs.cooldownMin = clampInt(raw.knobs.cooldownMin, 1, 60, 5);
    p.knobs.autoRevert = raw.knobs.autoRevert !== false;
  }
  if (raw.state && typeof raw.state === 'object') {
      p.state.activeTier = clampInt(raw.state.activeTier, 0, MAX_TIERS, 0);
    p.state.failStreak = clampInt(raw.state.failStreak, 0, 100, 0);
      // Consecutive healthy PRIMARY passes required before reverting. Guards the
      // revert against a single lucky probe, which is what ping-ponged a plan
      // between primary and fallback on alternating ticks.
      p.state.healthyStreak = clampInt(raw.state.healthyStreak, 0, 100, 0);
    p.state.lastSwitchAt = Number(raw.state.lastSwitchAt) || 0;
    p.state.degraded = !!raw.state.degraded;
    p.state.lastAction = raw.state.lastAction || null;
  }
  return p;
}

function read(clientId) {
  try {
    const raw = localStorage.getItem(PKEY(clientId));
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function write(clientId, plan) {
  try { localStorage.setItem(PKEY(clientId), JSON.stringify(plan)); } catch { /* ignore quota errors */ }
}

export const fallbackStore = {
  isMasterEnabled() {
    return localStorage.getItem(MASTER) === '1';
  },
  setMasterEnabled(v) {
    localStorage.setItem(MASTER, v ? '1' : '0');
  },

  getPlan(clientId) {
    return clientId ? read(clientId) : null;
  },
  hasPlan(clientId) {
    return !!this.getPlan(clientId);
  },
  listPlans() {
    const ids = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.indexOf('nx_fallback_') === 0) ids.push(k.slice('nx_fallback_'.length));
    }
    return ids;
  },
  // Creates (or returns) an enabled plan. `snapshot` optionally seeds the
  // primary target from the currently-applied selection (references only).
  ensurePlan(clientId, snapshot = {}) {
    const plan = this.getPlan(clientId) || freshPlan();
    plan.enabled = true;
    if (snapshot.provider && snapshot.model && plan.primary.provider !== snapshot.provider) {
      plan.primary = { provider: snapshot.provider, model: snapshot.model };
    }
    write(clientId, plan);
    return plan;
  },
  setPlanEnabled(clientId, v) {
    const plan = this.getPlan(clientId) || freshPlan();
    plan.enabled = !!v;
    write(clientId, plan);
  },
    setPrimary(clientId, provider, model) {
      const plan = this.getPlan(clientId) || freshPlan();
      plan.primary = { provider, model };
      write(clientId, plan);
    },
    // Keep the plan's primary in step with the configuration the user actually
    // applied. `plan.primary` was originally a one-time snapshot taken when the
    // plan was created, so re-configuring the client left it pointing at the OLD
    // provider: the fallback settings panel showed a stale primary, and the
    // monitor's "revert to primary" would undo the user's new configuration.
    //
    // This is deliberately NOT called by the monitor when it auto-switches to a
    // tier — the whole point of `primary` is to remember where to come back to.
    // Only a real, user-initiated apply calls it.
    //
    // Returns true when the stored primary actually moved.
    syncPrimaryFromApplied(clientId, applied) {
      const plan = this.getPlan(clientId);
      if (!plan || !plan.enabled) return false;
      if (!applied || !applied.provider || !applied.model) return false;
      if (applied.client && applied.client !== clientId) return false;
      // Guard at the store, not just at the call sites: while a switch is in effect
      // the applied record holds the TIER the monitor moved to, not the primary. Letting
      // a sync through here would overwrite the primary with a fallback tier and destroy
      // the "revert to primary" target — the one thing the plan must remember.
      if ((plan.state?.activeTier || 0) !== 0) return false;
      const cur = plan.primary || {};
      if (cur.provider === applied.provider && cur.model === applied.model) return false;
      plan.primary = { provider: applied.provider, model: applied.model };
      // A new primary is a fresh baseline: the plan is no longer switched away
      // from it, and any degraded/failing state belonged to the previous target.
      plan.state = {
        ...plan.state,
        activeTier: 0,
        failStreak: 0,
        lastSwitchAt: 0,
        degraded: false,
        lastAction: { at: Date.now(), kind: 'primary-sync', label: `Primary set to ${applied.provider}` },
      };
      write(clientId, plan);
      return true;
    },

    setTier(clientId, index, { provider, model }) {
      const plan = this.getPlan(clientId) || freshPlan();
      const i = index - 1;
      if (i < 0 || i >= MAX_TIERS) return;
      // Writing beyond the current length grows the plan rather than being dropped,
      // so saving a 4th tier cannot silently fail.
      while (plan.tiers.length <= i) plan.tiers.push(emptyTier());
      plan.tiers[i] = { enabled: true, provider, model };
      write(clientId, plan);
    },
    setTierEnabled(clientId, index, v) {
      const plan = this.getPlan(clientId) || freshPlan();
      const i = index - 1;
      if (i < 0 || i >= MAX_TIERS) return;
      if (!plan.tiers[i]) return;
      plan.tiers[i].enabled = !!v;
      write(clientId, plan);
    },
    // Grow the plan by one empty tier. Returns the new tier count, or null when the
    // plan is already at MAX_TIERS. The new tier starts disabled with no provider so
    // an added slot is never probed or switched to until the user fills it in.
    addTier(clientId) {
      const plan = this.getPlan(clientId);
      if (!plan || !plan.enabled) return null;
      if (plan.tiers.length >= MAX_TIERS) return null;
      plan.tiers.push(emptyTier());
      write(clientId, plan);
      return plan.tiers.length;
    },
    // Drop the last tier. Refuses while the plan is currently switched to a tier at
    // or beyond the one being removed, otherwise the monitor would be left pointing at
    // a target that no longer exists.
    removeTier(clientId) {
      const plan = this.getPlan(clientId);
      if (!plan || !plan.enabled) return null;
      if (plan.tiers.length <= DEFAULT_TIERS) return null;
      const lastIdx = plan.tiers.length - 1;
      if ((plan.state?.activeTier || 0) > lastIdx) return null;
      plan.tiers.splice(lastIdx, 1);
      write(clientId, plan);
      return plan.tiers.length;
    },
    maxTiers: MAX_TIERS,
    defaultTiers: DEFAULT_TIERS,
  updateKnobs(clientId, { failThreshold, cooldownMin, autoRevert }) {
    const plan = this.getPlan(clientId) || freshPlan();
    plan.knobs.failThreshold = clampInt(failThreshold, 1, 5, plan.knobs.failThreshold);
    plan.knobs.cooldownMin = clampInt(cooldownMin, 1, 60, plan.knobs.cooldownMin);
    if (typeof autoRevert === 'boolean') plan.knobs.autoRevert = autoRevert;
    write(clientId, plan);
  },

  getState(clientId) {
    const plan = this.getPlan(clientId);
    return plan ? plan.state : freshPlan().state;
  },
  setState(clientId, patch) {
    const plan = this.getPlan(clientId) || freshPlan();
    plan.state = { ...plan.state, ...patch };
    write(clientId, plan);
  },
  clearPlan(clientId) {
    try { localStorage.removeItem(PKEY(clientId)); } catch { /* ignore */ }
  },
};