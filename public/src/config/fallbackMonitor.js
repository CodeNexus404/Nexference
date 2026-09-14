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

  const { config, instructions } = configForSelection({ client: clientId, connectionType: 'cloud', provider: t.provider, model: t.model });
  if (!config) {
    notify.log(`Fallback skip: no writeable config for ${t.provider} · ${t.model}.`, 't-err');
    return false;
  }

  const ok = await LocalSettingsRuntime.write(config, clientId);
  if (!ok) return false;

  const provider = getProvider(t.provider);
  const label = `${provider?.name || t.provider} · ${t.model}`;
  const clientName = getClient(clientId)?.name || clientId;
  const now = new Date().toISOString();
  fallbackStore.setState(clientId, {
    activeTier: idx,
    failStreak: 0,
    lastSwitchAt: Date.now(),
    degraded: false,
    lastAction: { at: now, kind: idx === 0 ? 'revert' : `switch-${t.kind}`, label },
  });
  recordActivity('fallback', `Auto-${idx === 0 ? 'reverted' : 'switched'} ${clientName} → ${label}`);
  notify.log(`Fallback: ${clientName} → ${label}`, idx === 0 ? 't-ok' : 't-warn');
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
      let cur = st.activeTier;
      if (cur >= targets.length) cur = 0;

      const res = await probeTarget(targets[cur]);
      const cooldownPassed = !st.lastSwitchAt || (Date.now() - st.lastSwitchAt) >= plan.knobs.cooldownMin * 60000;

      if (res.ok) {
        fallbackStore.setState(clientId, { failStreak: 0 });
        // Auto-revert: healthy active tier, but we're on a fallback — check the
        // primary and go back when it is reachable again.
        const st2 = fallbackStore.getState(clientId);
        const needsRevert = plan.knobs.autoRevert && st2.activeTier !== 0 && cur === st2.activeTier && targets[0];
        if (needsRevert) {
          const p0ok = (await probeTarget(targets[0])).ok;
          if (p0ok) await switchTo(clientId, targets, 0);
        }
      } else {
        const fail = (st.failStreak || 0) + 1;
        fallbackStore.setState(clientId, { failStreak: fail });
        if (fail >= plan.knobs.failThreshold) {
          if (!cooldownPassed) continue;
          const next = cur + 1;
          if (next < targets.length) {
            await switchTo(clientId, targets, next);
          } else if (targets[0]) {
            // All fallbacks exhausted → revert to primary, mark degraded.
            await switchTo(clientId, targets, 0);
            fallbackStore.setState(clientId, { degraded: true });
          }
        }
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

export function stopFallbackMonitor() {
  if (timer) { clearInterval(timer); timer = null; }
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