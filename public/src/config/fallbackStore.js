// Fallback store — per-client auto-switch plans (provider + model tiers) and the
// monitor's runtime state. Plans store references only (provider id + model), so
// no secrets are ever persisted here; API keys continue to live in gw_key_<id>.
//
// Shape (per client):
//   { v, enabled, primary: {provider, model}, tiers: [{enabled, provider, model}, …],
//     knobs: {failThreshold, cooldownMin, autoRevert}, state: {activeTier, failStreak, lastSwitchAt, degraded} }

const MASTER = 'nx_fallback_enabled';
const PKEY = (clientId) => `nx_fallback_${clientId}`;
const NUM_TIERS = 2;

function freshPlan() {
  return {
    v: 1,
    enabled: false,
    primary: { provider: null, model: null },
    tiers: Array.from({ length: NUM_TIERS }, () => ({ enabled: false, provider: null, model: null })),
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
  const tiers = Array.isArray(raw.tiers) ? raw.tiers : [];
  p.tiers = Array.from({ length: NUM_TIERS }, (_, i) => {
    const t = tiers[i] || {};
    return { enabled: !!t.enabled, provider: t.provider || null, model: t.model || null };
  });
  if (raw.knobs && typeof raw.knobs === 'object') {
    p.knobs.failThreshold = clampInt(raw.knobs.failThreshold, 1, 5, 2);
    p.knobs.cooldownMin = clampInt(raw.knobs.cooldownMin, 1, 60, 5);
    p.knobs.autoRevert = raw.knobs.autoRevert !== false;
  }
  if (raw.state && typeof raw.state === 'object') {
    p.state.activeTier = clampInt(raw.state.activeTier, 0, NUM_TIERS, 0);
    p.state.failStreak = clampInt(raw.state.failStreak, 0, 100, 0);
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
  setTier(clientId, index, { provider, model }) {
    const plan = this.getPlan(clientId) || freshPlan();
    const i = index - 1;
    if (i < 0 || i >= NUM_TIERS) return;
    plan.tiers[i] = { enabled: true, provider, model };
    write(clientId, plan);
  },
  setTierEnabled(clientId, index, v) {
    const plan = this.getPlan(clientId) || freshPlan();
    const i = index - 1;
    if (i < 0 || i >= NUM_TIERS) return;
    plan.tiers[i].enabled = !!v;
    write(clientId, plan);
  },
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