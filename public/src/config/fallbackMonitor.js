// Fallback monitor — reads the per-client fallback plans and, while the
// dashboard is open in a tab, quietly probes the active provider/model. On N
// consecutive failures it auto-switches to the next enabled tier by reusing the
// proven apply path (configForSelection → LocalSettingsRuntime.write, which
// backs up before writing). If every fallback fails it reverts to the primary
// and marks the client as degraded. With autoRevert enabled it keeps probing
// the primary and switches back the moment it is healthy again.
//
// Constraints honoured:
//   • Runs only while a tab is open (the dashboard/server being closed means no
//     detection and the last written config stays as-is).
//   • Never stores secrets — probes use the existing gw_key_<id> store and the
//     /api/test endpoint; plans hold references only.
//   • Pauses switching while an external change is pending (won't fight manual
//     edits).

import { workspace } from '../core/state.js';
import { Storage } from '../core/storage.js';
import { notify } from '../core/notifications.js';
import { recordActivity } from '../core/activityStore.js';
  import { getProvider } from '../providers/registry.js';
  import { getClient } from '../clients/registry.js';
  import { LocalSettingsRuntime } from './runtimeAdapter.js';
  import { configForSelection } from './workflow.js';
  import { fallbackStore } from './fallbackStore.js';
  import { claudeCodeCompatibility } from '../providers/registry.js';
  import { armLocalProxy } from '../localProxy.js';

// Consecutive healthy PRIMARY probes required before the monitor reverts. One is
// not enough: a single 200 on a provider that is flapping produces exactly the
// primary/fallback oscillation this is meant to prevent.
const RECOVERY_STREAK = 2;
const TICK_MS = 60000;
let timer = null;
let busy = false;

// Resolve the ordered switch targets for a client: [primary, …enabled tiers].
export function buildTargets(clientId) {
  const plan = fallbackStore.getPlan(clientId);
  if (!plan || !plan.enabled) return [];
  const applied = workspace.applied && workspace.applied.client === clientId
    ? workspace.applied
    : (Storage.getApplied() && Storage.getApplied().client === clientId ? Storage.getApplied() : null);
  let primary = plan.primary;
  // Prefer the LIVE applied configuration when the plan is sitting on its primary
  // (activeTier 0). The user may have reconfigured the client outside Nexference, and
  // the plan's snapshot can lag; reverting to that stale snapshot would silently undo
  // their change. While a switch is in effect (activeTier > 0) `workspace.applied`
  // holds the TIER we switched to, not the primary, so the stored plan is correct and
  // must win there — otherwise the "revert to primary" step would have nothing to
  // revert to.
  const st = plan.state || {};
  if (applied && applied.provider && applied.model && (st.activeTier || 0) === 0) {
    primary = { provider: applied.provider, model: applied.model };
  }
  if ((!primary.provider || !primary.model) && applied && applied.provider && applied.model) {
    primary = { provider: applied.provider, model: applied.model };
  }
  const targets = [];
  if (primary.provider && primary.model) targets.push({ kind: 'primary', provider: primary.provider, model: primary.model });
  plan.tiers.forEach((t, i) => {
    if (t.enabled && t.provider && t.model) targets.push({ kind: `t${i + 1}`, provider: t.provider, model: t.model });
  });
  return targets;
}

// Quiet health probe of a single target. Public so the Settings panel "Test now"
// buttons reuse the exact same check the monitor performs.
  export async function probeTarget(target) {
    const p = getProvider(target.provider);
    if (!p) return { ok: false, reason: 'unknown-provider', raw: 'Provider is not registered.' };
    const key = Storage.getKey(target.provider);
    if (!key && !p.publicModels) return { ok: false, reason: 'no-key', raw: 'No API key stored for this provider.' };
    // Proxy-routed tiers must be probed the same way they will be used, else a
    // healthy tier reads as failed purely because the probe hit the wrong URL.
    if (needsProxy(p)) return probeViaProxyUrl(p, target.model);
    const url = p.baseUrl || '';
  if (!url) return { ok: false, reason: 'no-url', raw: 'Provider has no base URL.' };
  const qs = new URLSearchParams({ url, key, format: p.format || 'anthropic' });
  qs.set('model', target.model || '');
  const startedAt = Date.now();
  try {
    const res = await fetch(`/api/test?${qs.toString()}`);
    const j = await res.json().catch(() => ({}));
    const ok = !!(j && j.status != null && j.status >= 200 && j.status < 300);
    if (ok) return { ok: true, ms: Date.now() - startedAt };
    return { ok: false, ms: Date.now() - startedAt, reason: 'provider', raw: String((j && (j.body || j.error)) || 'Unknown error').slice(0, 140) };
  } catch {
    return { ok: false, ms: Date.now() - startedAt, reason: 'network', raw: 'Could not reach the provider.' };
  }
}

  // Settings panel: probe a single saved tier (1 or 2) for a client.
  export async function probeTier(clientId, tierIndex) {
    const plan = fallbackStore.getPlan(clientId);
    const t = plan && plan.tiers && plan.tiers[tierIndex - 1];
    if (!t || !t.provider || !t.model) return { ok: false, raw: 'Tier is not configured yet.' };
    return probeTarget({ provider: t.provider, model: t.model });
  }

  // ── OpenAI-compatible tiers ────────────────────────────────────────
  // Claude Code reads ONLY ANTHROPIC_* variables. An OpenAI-shaped provider
  // yields OPENAI_BASE_URL / OPENAI_API_KEY, which Claude Code silently ignores —
  // so the old switch path wrote a config that looked successful and left Claude
  // Code pointed at the previous (or default) provider. The tier "switched" and
  // nothing happened, which is worse than a visible failure.
  //
  // The fix routes OpenAI-only tiers through the Nexference local proxy, which
  // speaks Anthropic on the loopback side and translates to OpenAI upstream —
  // the same arm path the provider cards already use. Anthropic-compatible
  // providers deliberately keep the ORIGINAL direct write: their config is
  // already correct, and changing it would churn a working setup for nothing.
  function needsProxy(provider) {
    const c = claudeCodeCompatibility(provider);
    return !!(c.proxy && !c.anthropic);
  }

  // Probe a provider the way the monitor will actually USE it. For a proxy-tier
  // that means probing the OpenAI-compatible base URL (Gemini's /v1beta/openai/,
  // not its native /v1beta), because probing the native endpoint with OpenAI
  // payloads always fails and would make a healthy tier look dead.
  async function probeViaProxyUrl(provider, model) {
    const c = claudeCodeCompatibility(provider);
    const base = c.proxyBaseUrl || provider.baseUrl || '';
    if (!base) return { ok: false, reason: 'no-url', raw: 'Provider has no base URL.' };
    const qs = new URLSearchParams({
      url: base, key: Storage.getKey(provider.id) || '', format: c.proxyFormat || 'openai',
    });
    if (model) qs.set('model', model);
    const startedAt = Date.now();
    try {
      const res = await fetch(`/api/test?${qs.toString()}`);
      const j = await res.json().catch(() => ({}));
      const ok = !!(j && j.status != null && j.status >= 200 && j.status < 300);
      if (ok) return { ok: true, ms: Date.now() - startedAt };
      return { ok: false, ms: Date.now() - startedAt, reason: 'provider', raw: String((j && (j.body || j.error)) || 'Unknown error').slice(0, 140) };
    } catch {
      return { ok: false, ms: Date.now() - startedAt, reason: 'network', raw: 'Could not reach the provider.' };
    }
  }

// Re-render the surfaces that visualise plan state. switchTo() does this itself, but
// a DEGRADE (or a recovery) can happen with no switch at all — the plan stays on the
// same provider and only the status changes. Without this the topology kept
// rendering "Armed" while the status chip said "Degraded", because nothing told the
// workspace to redraw.
function refreshPlanSurfaces() {
  try { if (window.renderWorkspace) window.renderWorkspace(); } catch { /* not mounted */ }
  try { if (window.updateShellStatus) window.updateShellStatus(); } catch { /* not mounted */ }
}

// Apply a switch to targets[idx] for a client. Returns true on success.
async function switchTo(clientId, targets, idx) {
  const t = targets[idx];
  if (!t) return false;
  const st = fallbackStore.getState(clientId);

  // External-change guard: never override an edit made outside Nexference.
  if (clientId === 'claude-code') {
    try {
      const s = await fetch('/api/config/status').then((r) => r.json()).catch(() => null);
      if (s && s.externalChange) {
        recordActivity('fallback', `Skip auto-switch for ${getClient(clientId).name} — configuration changed externally.`);
        return false;
      }
    } catch { /* probe anyway on status failure */ }
  }

    // Anthropic-compatible tiers keep the ORIGINAL direct write — their generated
    // config is already correct for Claude Code, so there is no reason to route
    // them through the proxy or churn a working settings.json.
    const provider0 = getProvider(t.provider);
    let ok;
    if (provider0 && needsProxy(provider0)) {
      // OpenAI-shaped tier → arm the loopback proxy instead of writing a config
      // Claude Code cannot read. armLocalProxy() rewrites settings.json to point
      // at 127.0.0.1:3000 and keeps the upstream key in server memory, so the
      // switch actually takes effect.
      const apiKey = Storage.getKey(t.provider) || '';
      if (!apiKey) {
        notify.log(`Fallback skip: no API key stored for ${t.provider}.`, 't-err');
        recordActivity('fallback', `Skip auto-switch to ${t.provider} — no API key stored.`);
        return false;
      }
      try {
        const r = await armLocalProxy({ providerId: t.provider, model: t.model, apiKey });
        ok = !!(r && r.armed);
        if (!ok) {
          const why = (r && (r.error || r.message)) || 'arm failed';
          notify.log(`Fallback arm failed for ${t.provider}: ${why}`, 't-err');
          recordActivity('fallback', `Arm failed for ${t.provider} — ${why}`);
          return false;
        }
      } catch (e) {
        notify.log(`Fallback arm error for ${t.provider}: ${e.message || e}`, 't-err');
        return false;
      }
    } else {
      const { config, instructions } = configForSelection({ client: clientId, connectionType: 'cloud', provider: t.provider, model: t.model });
      if (!config) {
        notify.log(`Fallback skip: no writeable config for ${t.provider} · ${t.model}.`, 't-err');
        return false;
      }
      ok = await LocalSettingsRuntime.write(config, clientId);
    }
    if (!ok) return false;

  const provider = getProvider(t.provider);
  const label = `${provider?.name || t.provider} · ${t.model}`;
  // Communicate what we switched FROM so the record reads as a transition
  // (e.g. "Auto-switched … → Agent Router · m-1 (from FreeModel · m-p)").
  const prev = targets[st.activeTier];
  const prevLabel = prev ? `${getProvider(prev.provider)?.name || prev.provider} · ${prev.model}` : null;
  const transition = prevLabel ? `${label} (from ${prevLabel})` : label;
  const clientName = getClient(clientId)?.name || clientId;
  const now = new Date().toISOString();
  fallbackStore.setState(clientId, {
    activeTier: idx,
    failStreak: 0,
    healthyStreak: 0,
    lastSwitchAt: Date.now(),
    degraded: false,
    lastAction: { at: now, kind: idx === 0 ? 'revert' : `switch-${t.kind}`, label: transition },
  });
  recordActivity('fallback', `Auto-${idx === 0 ? 'reverted' : 'switched'} ${clientName} → ${transition}`);
  notify.log(`Fallback: ${clientName} → ${transition}`, idx === 0 ? 't-ok' : 't-warn');
  notify.toast(`Fallback: ${clientName} switched to ${label}`, idx === 0 ? 'info' : 'warning');

  // Reflect the switched config as the applied record (same client) so every
  // other surface (top bar, workspace card, later primary capture) stays honest.
  workspace.applied = { client: clientId, connectionType: 'cloud', provider: t.provider, runtime: null, model: t.model, appliedAt: now, status: 'fallback' };
  Storage.setApplied(workspace.applied);
  if (window.renderWorkspace) window.renderWorkspace();
  if (window.updateShellStatus) window.updateShellStatus();
  window.dispatchEvent(new CustomEvent('nx-fallback', { detail: { client: clientId, tier: idx, changed: true } }));
  return true;
}

// One monitoring pass over every enabled plan. No-op when the master switch is
// off. Exported so the smoke test (and debugging) can drive it directly.
// One monitoring pass over every enabled plan. No-op when the master switch is
// off. Exported so the smoke test (and debugging) can drive it directly.
//
// PRIMARY-FIRST RULE (the invariant this whole function exists to enforce):
//   Leaving the primary is only ever justified by the PRIMARY being down.
//     • On the primary      → it failing is the only reason to descend a tier.
//     • On a fallback, up   → revert to the primary, never sideways to another
//                             fallback, once the primary is confirmed healthy.
//     • On a fallback, down → check the primary first. If it is healthy there is
//                             nothing to fall back FOR, so return to it instead
//                             of burning the remaining chain.
// Every transition additionally requires failThreshold consecutive bad passes and
// a clear cooldown, so a plan cannot oscillate on a single unlucky probe.
export async function tickFallbackMonitor() {
  if (busy || !fallbackStore.isMasterEnabled()) return;
  busy = true;
  try {
    for (const clientId of fallbackStore.listPlans()) {
      const plan = fallbackStore.getPlan(clientId);
      if (!plan || !plan.enabled) continue;
      const targets = buildTargets(clientId);
      if (!targets.length) continue;

      const st = fallbackStore.getState(clientId);
      const cur = st.activeTier >= targets.length ? 0 : st.activeTier;
      const primary = targets[0];
      const onPrimary = cur === 0;

      // Only the ACTIVE target is probed. The primary is probed too, but only on
      // the branches that actually need to know about it — not speculatively
      // every tick, which is what doubled the request count while idle.
      // Degraded means every tier was already tried and the primary is still
      // down. Hold position and re-check the primary only — without this the plan
      // cycled primary -> fb1 -> fb2 -> primary forever, rewriting the config once
      // per tick while the user had nothing better to do than fix a key.
      if (st.degraded) {
        if (onPrimary && res.ok) {
          fallbackStore.setState(clientId, {
            failStreak: 0, healthyStreak: 0, degraded: false,
          });
          refreshPlanSurfaces();
        }
        continue;
      }

      const cooldownPassed = !st.lastSwitchAt
        || (Date.now() - st.lastSwitchAt) >= plan.knobs.cooldownMin * 60000;

      // ── On the primary ────────────────────────────────────────────
      // Its own health is the whole decision. Healthy means stay; failing
      // repeatedly means there is a reason to use a fallback.
      if (onPrimary) {
        if (res.ok) {
          const wasDegraded = st.degraded;
          fallbackStore.setState(clientId, {
            failStreak: 0, healthyStreak: 0, ...(wasDegraded ? { degraded: false } : {}),
          });
          if (wasDegraded) refreshPlanSurfaces();
          continue;
        }
        const down = (st.failStreak || 0) + 1;
        if (down < plan.knobs.failThreshold) {
          fallbackStore.setState(clientId, { failStreak: down });
          continue;
        }
        if (!cooldownPassed) continue;
        if (cur + 1 < targets.length) {
          await switchTo(clientId, targets, cur + 1);
        } else {
          // Every fallback is already in use and the primary is still down:
          // stay put and report degraded rather than churning the chain.
          fallbackStore.setState(clientId, { failStreak: 0, degraded: true });
          refreshPlanSurfaces();
        }
        continue;
      }

      // ── On a fallback tier ────────────────────────────────────────
      if (res.ok) {
        // The fallback works. Prefer the PRIMARY, but only once it has proven
        // healthy for RECOVERY_STREAK consecutive passes AND the cooldown has
        // elapsed. Reverting on the first ok probe is what made the plan bounce
        // between tiers on alternate ticks.
        if (!plan.knobs.autoRevert || !primary) {
          fallbackStore.setState(clientId, { failStreak: 0, healthyStreak: 0 });
          continue;
        }
        const st2 = fallbackStore.getState(clientId);
        const p0 = await probeTarget(primary);
        const healthyStreak = p0.ok ? (st2.healthyStreak || 0) + 1 : 0;
        fallbackStore.setState(clientId, { failStreak: 0, healthyStreak });
        if (p0.ok && healthyStreak >= RECOVERY_STREAK && cooldownPassed) {
          await switchTo(clientId, targets, 0);
        }
        continue;
      }

      // The active fallback failed. Before touching the chain, ask whether the
      // primary is fine — if it is, the correct move is to go back to it, not to
      // keep descending into another fallback for no reason.
      const fail = (st.failStreak || 0) + 1;
      if (fail < plan.knobs.failThreshold) {
        fallbackStore.setState(clientId, { failStreak: fail });
        continue;
      }
      if (!cooldownPassed) continue;

      const p0 = primary ? await probeTarget(primary) : { ok: false };
      if (p0.ok) {
        await switchTo(clientId, targets, 0);
      } else if (cur + 1 < targets.length) {
        // Primary is genuinely down too — this is the one case where descending
        // to the next tier is warranted.
        await switchTo(clientId, targets, cur + 1);
      } else {
        await switchTo(clientId, targets, 0);
        fallbackStore.setState(clientId, { degraded: true });
        // switchTo already rendered, but as the PRE-degrade state.
        refreshPlanSurfaces();
      }
    }
  } finally {
    busy = false;
  }
}

export function startFallbackMonitor() {
  if (timer) return;
  tickFallbackMonitor().catch(() => {});
  timer = setInterval(() => tickFallbackMonitor().catch(() => {}), TICK_MS);
}


// Status chip helper — label + badge class for a client's live state.
export function fallbackChipLabel(clientId) {
  const st = fallbackStore.getState(clientId);
  if (st.degraded) return { cls: 'degraded', text: 'Degraded' };
  if (st.activeTier === 0) return { cls: 'primary', text: 'Primary' };
  const plan = fallbackStore.getPlan(clientId);
  const tier = plan && plan.tiers[st.activeTier - 1];
  return { cls: `f${st.activeTier}`, text: tier ? `Fallback ${st.activeTier}` : 'Fallback' };
}