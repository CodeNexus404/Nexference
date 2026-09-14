// Fallback settings UI — the "Fallback (auto-switch)" panel appended to the
// Settings page, plus the live status chip on the Configuration workspace page.
// Panels render from the same fallbackStore the monitor reads, so what you see
// here is always the current plan/state.

import { CLIENTS, getClient } from '../clients/registry.js';
import { getProvider } from '../providers/registry.js';
import { Storage } from '../core/storage.js';
import { notify } from '../core/notifications.js';
import { workspace } from '../core/state.js';
import { esc } from '../components/util.js';
import { fallbackStore } from '../config/fallbackStore.js';
import { probeTier, fallbackChipLabel } from '../config/fallbackMonitor.js';

const FB_CLIENTS = CLIENTS.filter((c) => Array.isArray(c.connectionTypes) && c.connectionTypes.includes('cloud'));
let selClient = (workspace.applied && workspace.applied.client) || 'claude-code';

function providerName(id) {
  return id ? (getProvider(id)?.name || id) : '—';
}

// ── Settings page panel ──
export function renderFallbackPanel() {
  const grid = document.querySelector('#page-settings .settings-grid');
  if (!grid) return;
  let panel = document.getElementById('fallbackPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'panel fallback-panel';
    panel.id = 'fallbackPanel';
    grid.appendChild(panel);
  }

  const master = fallbackStore.isMasterEnabled();
  const plan = fallbackStore.getPlan(selClient);

  panel.innerHTML = `
    <div class="panel-h">
      <h3>Fallback (auto-switch)</h3>
      <span id="fbMasterBadge" class="badge ${master ? 'configured' : ''}">${master ? 'Enabled' : 'Off'}</span>
    </div>
    <p class="muted">If a client's provider or model stops working, Nexference can switch to a backup automatically while this dashboard is open. A safety backup is created before every switch, and switches can be turned off at any time.</p>

    <div class="fb-row fb-master">
      <label class="paid-toggle">
        <input type="checkbox" id="fbMaster" ${master ? 'checked' : ''} onchange="fbSetMaster(this.checked)">
        <span class="paid-track"></span>
      </label>
      <div class="fb-master-txt"><b>Fallback monitoring</b><span class="muted">Master switch — applies to every client plan.</span></div>
    </div>

    ${plan ? `
    <div class="fb-row">
      <span class="fb-lbl">Client</span>
      <div class="fb-client-chips" id="fbClientChips">${fbClientChipsHTML()}</div>
    </div>
    <div id="fbDetail">${detailHTML(plan, master)}</div>` : `
    <div class="fb-empty">
      <p class="muted">No fallback plan exists for <b>${esc(getClient(selClient)?.name || selClient)}</b> yet.
        Enable fallbacks for it, or define a backup now.</p>
      <button class="btn btn-go" onclick="fbEnableForClient()">Enable fallback for ${esc(getClient(selClient)?.name || selClient)}</button>
    </div>`}
    <p class="muted fb-note">Tip: open a client's fallback and press <b>Configure…</b> — the wizard runs in tier mode, reusing your provider & model pickers, and only saves the fallback (nothing is applied).</p>`;
}

function fbClientChipsHTML() {
  return FB_CLIENTS.map((c) => `
    <button type="button" class="chip fb-client-chip ${c.id === selClient ? 'on' : ''}" onclick="fbSelectClient('${esc(c.id)}')">${esc(c.name)}</button>`).join('');
}

function detailHTML(plan, master) {
  const active = fallbackChipLabel(selClient);
  const lastSwitch = plan.state.lastSwitchAt ? new Date(plan.state.lastSwitchAt).toLocaleString() : null;
  const primaryProvider = plan.primary.provider;
  const primaryModel = plan.primary.model;
  return `
    <div class="fb-detail">
      <div class="fb-status">
        <span class="badge fb-chip ${active.cls}">${esc(active.text)}</span>
        ${plan.state.degraded ? '<span class="fb-degraded-note">All fallbacks failed — switched back to primary and monitoring paused until it recovers.</span>' : ''}
        ${lastSwitch ? `<span class="muted">Last switch: ${esc(lastSwitch)}</span>` : '<span class="muted">No switches yet</span>'}
      </div>

      <div class="fb-primary-box">
        <div class="fb-tier-head"><b>Primary</b><span class="muted">main provider + model</span></div>
        <div class="fb-tier-meta">
          ${(primaryProvider || primaryModel)
            ? `<span><b>${esc(providerName(primaryProvider))}</b>${primaryModel ? ` · <b class="mono">${esc(primaryModel)}</b>` : ''}</span>`
            : `<span class="muted">Not captured yet — configure the main config first, then save a fallback, or capture from the current applied config.</span>`}
          <span class="fb-tier-acts">
            <button class="btn btn2" onclick="fbCapturePrimary()">${primaryProvider ? 'Recapture from current config' : 'Capture current config'}</button>
          </span>
        </div>
      </div>

      <div class="fb-knobs">
        <label>Fail threshold <input class="inp inp-sm" id="fbThreshold" type="number" min="1" max="5" value="${plan.knobs.failThreshold}" onchange="fbUpdateKnobs()"></label>
        <label>Cooldown (min) <input class="inp inp-sm" id="fbCooldown" type="number" min="1" max="60" value="${plan.knobs.cooldownMin}" onchange="fbUpdateKnobs()"></label>
        <label class="paid-toggle fb-auto">auto-revert <input type="checkbox" id="fbAutoRevert" ${plan.knobs.autoRevert ? 'checked' : ''} onchange="fbUpdateKnobs()"><span class="paid-track"></span></label>
      </div>

      ${plan.tiers.map((t, i) => tierHTML(i + 1, t)).join('')}

      <div class="fb-acts">
        <button class="btn btn2 danger" onclick="fbClearPlan()">Disable fallback for ${esc(getClient(selClient)?.name || selClient)}</button>
      </div>
    </div>`;
}

function tierHTML(idx, t) {
  const configured = !!(t.provider && t.model);
  const hasKey = t.provider ? !!Storage.getKey(t.provider) : false;
  const needsKey = configured && t.provider && !hasKey && !getProvider(t.provider)?.publicModels;
  return `
    <div class="fb-tier-card">
      <div class="fb-tier-head">
        <label class="paid-toggle">
          <input type="checkbox" ${t.enabled ? 'checked' : ''} onchange="fbToggleTier(${idx}, this.checked)">
          <span class="paid-track"></span>
        </label>
        <b>Fallback ${idx}</b>
        <span class="fb-tier-test-out ${configured && t.enabled ? '' : 'hidden'}" id="fbTestOut${idx}"></span>
        <span class="fb-tier-acts">
          <button class="btn btn2" onclick="fbConfigureTier(${idx})">Configure…</button>
          <button class="btn btn2" onclick="fbTestTier(${idx})" ${configured && t.enabled ? '' : 'disabled'}>Test now</button>
        </span>
      </div>
      <div class="fb-tier-meta">
        ${configured
          ? `<span><b>${esc(providerName(t.provider))}</b> · <b class="mono">${esc(t.model)}</b>${t.enabled ? '' : ' <span class="muted">(disabled)</span>'}</span>`
          : '<span class="muted">Not configured yet.</span>'}
        ${needsKey ? '<span class="badge needs">no key stored</span>' : ''}
      </div>
    </div>`;
}

// ── Actions (exposed as globals from main.js) ──
export function fbSetMaster(v) {
  fallbackStore.setMasterEnabled(v);
  notify.toast(v ? 'Fallback monitoring enabled' : 'Fallback monitoring disabled', v ? 'success' : 'info');
  renderFallbackPanel();
  refreshFallbackChip();
}

export function fbSelectClient(id) {
  selClient = id;
  renderFallbackPanel();
}

export function fbEnableForClient() {
  const snapshot = (workspace.applied && workspace.applied.client === selClient)
    ? { provider: workspace.applied.provider, model: workspace.applied.model }
    : {};
  fallbackStore.ensurePlan(selClient, snapshot);
  notify.toast('Fallback enabled — configure tier 1 and 2 below.', 'success');
  renderFallbackPanel();
}

export function fbToggleTier(idx, v) {
  fallbackStore.setTierEnabled(selClient, idx, v);
  if (v && !fallbackStore.isMasterEnabled()) fallbackStore.setMasterEnabled(true);
  renderFallbackPanel();
}

export function fbConfigureTier(idx) {
  if (window.openWorkflow) window.openWorkflow({ mode: 'fallback-tier', initialClient: selClient, tierIndex: idx });
}

export async function fbTestTier(idx) {
  const out = document.getElementById(`fbTestOut${idx}`);
  if (out) { out.className = 'fb-tier-test-out'; out.textContent = 'Testing…'; }
  const t0 = Date.now();
  const res = await probeTier(selClient, idx);
  const ms = ((Date.now() - t0) / 1000).toFixed(1);
  if (!out) return;
  out.className = `fb-tier-test-out ${res.ok ? 'ok' : 'err'}`;
  out.textContent = res.ok ? `✓ OK · ${ms}s` : `✗ ${(res.raw || res.reason || 'failed').slice(0, 60)}`;
  if (!res.ok) notify.toast(`Fallback ${idx} test failed — ${(res.raw || res.reason || '').slice(0, 100)}`, 'warning');
}

export function fbUpdateKnobs() {
  const threshold = Number(document.getElementById('fbThreshold')?.value);
  const cooldown = Number(document.getElementById('fbCooldown')?.value);
  const autoRevert = !!document.getElementById('fbAutoRevert')?.checked;
  fallbackStore.updateKnobs(selClient, { failThreshold: threshold, cooldownMin: cooldown, autoRevert });
  notify.toast('Fallback settings updated', 'success');
}

export function fbCapturePrimary() {
  const applied = (workspace.applied && workspace.applied.client === selClient)
    ? workspace.applied
    : Storage.getApplied && Storage.getApplied().client === selClient ? Storage.getApplied() : null;
  if (!applied || !applied.provider || !applied.model) {
    notify.toast('Configure and apply the main config for this client first (opens the wizard).', 'warning');
    if (window.openWorkflow) window.openWorkflow({ initialClient: selClient });
    return;
  }
  fallbackStore.ensurePlan(selClient, {});
  fallbackStore.setPrimary(selClient, applied.provider, applied.model);
  notify.toast(`Primary captured: ${providerName(applied.provider)} · ${applied.model}`, 'success');
  renderFallbackPanel();
}

export function fbClearPlan() {
  const c = getClient(selClient);
  if (!window.confirm(`Disable fallbacks for ${c?.name || selClient}? The current config stays untouched.`)) return;
  fallbackStore.clearPlan(selClient);
  notify.toast(`Fallback removed for ${c?.name || selClient}`, 'info');
  renderFallbackPanel();
}

// ── Configuration-page status chip ──
export function refreshFallbackChip() {
  const el = document.getElementById('cfgFallbackChip');
  if (!el) return;
  const plan = fallbackStore.getPlan('claude-code');
  const active = fallbackStore.isMasterEnabled() && plan && plan.enabled
    ? fallbackChipLabel('claude-code')
    : null;
  if (!active) { el.hidden = true; el.className = 'badge fb-chip'; el.textContent = ''; return; }
  el.hidden = false;
  el.className = `badge fb-chip ${active.cls}`;
  el.textContent = active.text;
}