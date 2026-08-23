import { workspace, getFreeModels, getModels, getAllModels, getModelSource, isFetching } from '../core/state.js';
import { Storage } from '../core/storage.js';
import { notify } from '../core/notifications.js';
import { theme } from '../core/theme.js';
import { router } from '../core/router.js';
import { PROVIDERS, getProvider, providerTags } from '../providers/registry.js';
import { configEngine } from '../config/engine.js';
import { CopyableRuntime, LocalSettingsRuntime } from '../config/runtimeAdapter.js';
import { CLIENTS, getClient, isClientSupported } from '../config/clientAdapter.js';
import { resolveSelection } from '../compatibility/capabilityResolver.js';
import { levelBadge, compatNoteList, connectionLabel } from '../compatibility/ui.js';
import { checkClientProvider } from '../compatibility/clientProviderCompatibility.js';
import { checkClientRuntime } from '../compatibility/clientRuntimeCompatibility.js';
import { RUNTIMES, getRuntime } from '../runtimes/registry.js';
import { esc, norm, maskKey, highlightJSON, logoHtml, clientLogoHtml } from '../components/util.js';
import { createGatewayCard } from '../components/gatewayCard.js';
import { openProviderConfig } from '../components/providerConfig.js';
import { toggleCommandPalette } from '../components/commandPalette.js';
import { openModal } from '../components/modal.js';
import { credentialsStore } from '../config/credentialsStore.js';
import { recordActivity, getActivities } from '../core/activityStore.js';
import { openWorkflow, hasUsableDraft, discardDraft } from '../config/workflow.js';
import { renderModelLibrary } from '../components/modelLibrary.js';
import { modelService } from '../models/modelService.js';
import { renderModelPicker } from '../components/modelPicker.js';
import { playgroundService } from '../playground/playgroundService.js';
import { historyStore } from '../playground/historyStore.js';
import { miniMarkdown } from '../playground/markdown.js';

// ═══════════════════════════════════════════════════════════════
//  UI action layer — the orchestration functions that were previously private
//  helpers at the top of app.js. They now go through the modular managers
//  (workspace state, storage, notifications) and the Configuration Engine +
//  Runtime Adapters. Behaviour is preserved exactly.
// ═══════════════════════════════════════════════════════════════

export async function fetchCachedModels() {
  try {
    const res = await fetch('/api/cached-models');
    const data = await res.json();
    workspace.liveModels = data.providers || {};
    return true;
  } catch (err) {
    console.warn('Failed to fetch cached models:', err);
    return false;
  }
}

export async function refreshAllModels() {
  const btn = document.getElementById('refreshAllBtn');
  btn.classList.add('spinning');
  btn.disabled = true;

  try {
    const res = await fetch('/api/refresh-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    await fetchCachedModels();
    renderGateways();
    notify.toast('Models refreshed from all providers', 'success');
    notify.log('Refreshed all providers', 't-ok');
  } catch (err) {
    notify.toast('Failed to refresh models', 'error');
    notify.log('Refresh failed', 't-err');
  } finally {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
}

export function replaceCard(providerId) {
  const old = document.querySelector(`.card[data-id="${providerId}"]`);
  if (!old) return;
  const provider = getProvider(providerId);
  if (!provider) return;
  const idx = PROVIDERS.indexOf(provider);
  const nc = createGatewayCard(provider);
  nc.style.animation = 'none';
  if (workspace.selectedProviderId === providerId) nc.classList.add('on');
  if (workspace.appliedProviderId === providerId) nc.classList.add('applied');
  old.replaceWith(nc);
}

export async function fetchProviderSilent(providerId) {
  if (workspace._fetching.has(providerId)) return;
  workspace._fetching.add(providerId);
  const provider = getProvider(providerId);
  if (!provider) { workspace._fetching.delete(providerId); return; }
  const key = Storage.getKey(providerId) || '';
  try {
    const res = await fetch('/api/refresh-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const reason = (data.error || `HTTP ${res.status}`).toString().slice(0, 90);
      if (/unauthorized client detected|unauthorized_client_error/i.test(reason)) {
        notify.log(`Models · ${provider.name}: WAF blocks app-side fetch (works in Claude Code). Using fallback list.`, 't-ok');
      } else {
        notify.log(`Models not loaded · ${provider.name}: ${reason}`, 't-err');
      }
    }
    await fetchCachedModels();
    replaceCard(providerId);
  } catch (err) {
    notify.log(`Models fetch error · ${provider.name}: ${err.message}`, 't-err');
  } finally { workspace._fetching.delete(providerId); }
}

export async function refreshProviderModels(providerId) {
  const provider = getProvider(providerId);
  if (!provider) return;

  const btn = document.querySelector(`.refresh-${providerId}`);
  if (btn) {
    btn.classList.add('spinning');
    btn.disabled = true;
  }

  const key = Storage.getKey(providerId) || '';

  try {
    const res = await fetch('/api/refresh-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, key }),
    });
    const data = await res.json();
    await fetchCachedModels();
    replaceCard(providerId);
    if (data.ok) {
      notify.toast(`Refreshed ${provider.name}`, 'success');
      notify.log(`Refreshed ${provider.name} — ${data.count ?? 0} models`, 't-ok');
    } else {
      notify.toast(`No models for ${provider.name}${data.error ? ': ' + data.error.slice(0, 80) : ''}`, 'warning');
    }
  } catch (err) {
    notify.toast(`Failed to refresh ${provider.name}`, 'error');
  } finally {
    if (btn) {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
  }
}

export async function testConnection(providerId, baseUrl) {
  const provider = getProvider(providerId);
  const apiKeyInput = document.querySelector(`.api-key-${providerId}`);
  const apiKey = apiKeyInput?.value;

  if (!apiKey) {
    notify.toast('Please enter an API key', 'error');
    return;
  }

  const urlToTest = providerId === 'custom'
    ? document.querySelector(`.base-url-${providerId}`).value
    : baseUrl;

  const format = providerId === 'custom' ? workspace.customFormat : (provider?.format || 'anthropic');
  const modelEl = document.querySelector(`.model-${providerId}`);
  const model = modelEl?.value || '';

  const btn = document.querySelector(`.test-btn-${providerId}`);
  if (btn) { btn.disabled = true; btn.classList.add('spinning'); }

  try {
    const qs = new URLSearchParams({ url: urlToTest, key: apiKey || '', format });
    if (model) qs.set('model', model);
    const res = await fetch(`/api/test?${qs.toString()}`);
    const result = await res.json();

    if (result.status && result.status >= 200 && result.status < 300) {
      notify.toast('Connection successful!', 'success');
      notify.log(`Test OK · ${provider.name}`, 't-ok');
    } else {
      const raw = (result.body || result.error || 'Unknown error').toString();
      // Agent Router (and similar) run a WAF that only accepts Claude Code-shaped
      // clients, so app-side probes are rejected. The saved config is still valid
      // for Claude Code itself, so surface a clear note instead of a scary failure.
      if (/unauthorized client detected|unauthorized_client_error/i.test(raw)) {
        notify.toast(`${provider.name}: WAF allows only Claude Code — Apply & use in Claude Code`, 'info');
        notify.log(`Test note · ${provider.name}: provider WAF blocks app-side probes; the saved config works in Claude Code.`, 't-ok');
      } else {
        const msg = raw.slice(0, 160);
        notify.toast(`Failed: ${msg}`, 'error');
        notify.log(`Test failed · ${provider.name}: ${msg}`, 't-err');
      }
    }
  } catch (error) {
    notify.toast(`Error: ${error.message}`, 'error');
    notify.log(`Test error · ${provider.name}: ${error.message}`, 't-err');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
  }
}

export async function handleApply(event, providerId) {
  event.preventDefault();

  const provider = getProvider(providerId);
  const apiKey = document.querySelector(`.api-key-${providerId}`).value;
  const model = document.querySelector(`.model-${providerId}`).value;

  if (!apiKey) {
    notify.toast('Please enter an API key', 'error');
    return;
  }

  if (!model) {
    notify.toast('Please select a model', 'error');
    return;
  }

  let baseUrl = getProvider(providerId).baseUrl;
  if (providerId === 'custom') {
    baseUrl = document.querySelector(`.base-url-${providerId}`).value;
    if (!baseUrl) {
      notify.toast('Please enter a base URL', 'error');
      return;
    }
  }

  const newConfig = configEngine.buildClaudeSettings(provider, baseUrl, model, apiKey);

  // OpenAI/Gemini providers: Claude Code can't consume these configs, so show
  // them as copyable text for the user's own client instead of writing them
  // into Claude Code's settings.json.
  if (newConfig.env.OPENAI_BASE_URL || newConfig.env.GOOGLE_API_KEY) {
    CopyableRuntime.show(newConfig, provider.name);
    notify.log(`Prepared config · ${provider.name} · model ${model}`, 't-ok');
    return;
  }

  try {
    const ok = await LocalSettingsRuntime.write(newConfig);
    if (ok) {
      workspace.appliedProviderId = providerId;
      notify.toast(`Applied ${getProvider(providerId).name} to Claude Code!`, 'success');
      notify.log(`Applied ${getProvider(providerId).name} · model ${model}`, 't-ok');
      await loadConfig();
      renderGateways();
    }
  } catch (error) {
    notify.toast(`Error: ${error.message}`, 'error');
  }
}

export function closeConfigModal() {
  document.getElementById('configModal').hidden = true;
}

export function copyConfigText() {
  const text = document.getElementById('configText').textContent;
  const done = () => notify.toast('Config copied to clipboard', 'success');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); }
  catch { notify.toast('Copy failed — select the text manually', 'error'); }
  ta.remove();
}

export function openConfigFolder() {
  fetch('/api/open-folder')
    .then(r => r.json())
    .then(d => {
      if (d.ok) notify.toast('Opening config folder…', 'info');
      else notify.toast('Could not open folder: ' + (d.error || ''), 'error');
    })
    .catch(() => {});
}

export function togglePaid(id, show) {
  Storage.setPaid(id, show ? '1' : '0');
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  const select = card.querySelector('select.model-' + id);
  if (!select) return;
  const list = show ? getModels(id) : getFreeModels(id);
  const sel = Storage.getModel(id) || '';
  const freeIds = new Set(getFreeModels(id).map(m => m.id));
  select.innerHTML = list.length
    ? list.map(m => `<option value="${esc(m.id)}" ${sel === m.id ? 'selected' : ''}>${esc(m.name || m.id)}${freeIds.has(m.id) ? '  ·free' : ''}</option>`).join('')
    : `<option value="" disabled>Add API key to load models…</option>`;
}

export function pick(id) {
  const cards = document.querySelectorAll('.card');
  cards.forEach(c => c.classList.remove('on'));
  const selectedCard = document.querySelector(`.card[data-id="${id}"]`);
  if (selectedCard) selectedCard.classList.add('on');
  workspace.selectedProviderId = id;
  const provider = getProvider(id);
  const liveText = document.getElementById('liveText');
  if (liveText && provider) liveText.textContent = `${provider.name} selected`;
}

export function setKey(id, val) {
  Storage.setKey(id, val);
  const badge = document.getElementById(`keybadge-${id}`);
  if (badge) badge.style.display = val ? '' : 'none';
  const provider = getProvider(id);
  // Auto-fetch this card's models once a key is entered (and none are loaded yet)
  if (val && provider && !provider.hasCustomUrl && getFreeModels(id).length === 0) {
    clearTimeout(workspace._keyFetchTimers[id]);
    workspace._keyFetchTimers[id] = setTimeout(() => fetchProviderSilent(id), 700);
  }
}

export function chooseModel(id, modelId) {
  Storage.setModel(id, modelId);
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) {
    const mnVal = card.querySelector('.mn-val');
    if (mnVal) { mnVal.textContent = modelId || '—'; mnVal.title = modelId; }
  }
}

export function setModel(id, val) {
  Storage.setModel(id, val);
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) {
    const mnVal = card.querySelector('.mn-val');
    if (mnVal) { mnVal.textContent = val || '—'; mnVal.title = val; }
  }
}

export function setFmt(val) {
  workspace.customFormat = val;
  Storage.setCustomFormat(val);
}

export function setCustomUrl(val) {
  workspace.customUrl = val;
}

export function setCustomModel(val) {
  workspace.customModel = val;
}

export function filterGatewaysDebounced(val) {
  workspace.filterText = val.toLowerCase();
  clearTimeout(window.filterTimeout);
  window.filterTimeout = setTimeout(() => {
    renderGateways();
  }, 100);
}

export function renderGateways() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  grid.innerHTML = '';

  let gatewayCount = 0;
  let freeModelCount = 0;
  let configuredCount = 0;

  PROVIDERS.forEach((provider, idx) => {
    const key = Storage.getKey(provider.id) || '';
    const freeModels = getFreeModels(provider.id);

    if (workspace.filterText && !provider.name.toLowerCase().includes(workspace.filterText) && !provider.sub.toLowerCase().includes(workspace.filterText)) {
      return;
    }

    gatewayCount++;
    freeModelCount += freeModels.length;
    if (key) configuredCount++;

    const card = createGatewayCard(provider);
    card.style.setProperty('--i', idx);
    if (workspace.selectedProviderId === provider.id) card.classList.add('on');
    if (workspace.appliedProviderId === provider.id) card.classList.add('applied');
    grid.appendChild(card);

    // Auto-fetch models per card when the server hasn't cached them yet
    if (freeModels.length === 0 && (provider.publicModels || key)) {
      fetchProviderSilent(provider.id);
    }
  });

  document.getElementById('statGw').textContent = gatewayCount;
  document.getElementById('statFree').textContent = freeModelCount;
  document.getElementById('statConfigured').textContent = configuredCount;
}

export { highlightJSON };

export async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const { config, path } = await res.json();
    const pathEl = document.getElementById('pathText');
    if (path && pathEl) pathEl.textContent = path;
    const jsonEl = document.getElementById('jsonOut');
    if (config && jsonEl) {
      const jsonStr = JSON.stringify(config, null, 2);
      jsonEl.innerHTML = highlightJSON(jsonStr);
    }
    // Detect which provider this config points at → persistent "active" state
    const base = config?.env?.ANTHROPIC_BASE_URL || '';
    const match = PROVIDERS.find(p => norm(p.baseUrl) === norm(base));
    workspace.appliedProviderId = match ? match.id : null;
    const liveText = document.getElementById('liveText');
    if (liveText) {
      if (match) {
        liveText.textContent = `${match.name} active`;
        document.getElementById('liveChip')?.classList.add('live');
      } else if (base) {
        liveText.textContent = `Custom: ${base}`;
        document.getElementById('liveChip')?.classList.add('live');
      } else {
        liveText.textContent = 'No gateway selected';
      }
    }
  } catch (err) {
    console.warn('Failed to load config:', err);
  }
}

export function clearTerm() {
  document.getElementById('termOut').innerHTML = '';
}

// Re-poll the server model cache while its background startup fetch is still
// running, so cards that were empty on first paint fill in automatically.
export async function pollForModels(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await new Promise(r => setTimeout(r, 2500));
    const before = modelSignature();
    await fetchCachedModels();
    if (modelSignature() !== before) {
      renderGateways();
    }
  }
}

export function modelSignature() {
  return PROVIDERS.map(p => (getFreeModels(p.id) || []).length).join(',');
}

export function copyJSON() {
  const jsonOut = document.getElementById('jsonOut');
  const text = jsonOut.textContent;
  navigator.clipboard.writeText(text).then(() => {
    notify.toast('Config copied to clipboard', 'success');
  }).catch(() => {
    notify.toast('Failed to copy', 'error');
  });
}

// ═══════════════════════════════════════════════════════════════
//  v0.2.0 page renderers + Configuration workflow
// ═══════════════════════════════════════════════════════════════

const cfg = { client: 'claude-code', provider: null, model: null, includePaid: false };
let lastConfig = null;

function setCrumb(name) {
  const c = document.getElementById('crumb');
  if (c) c.innerHTML = '';
}

export function renderWorkspace() {
  updateCrumb('Workspace');
  const section = document.getElementById('page-workspace');
  if (!section) return;

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  section.innerHTML = `
    <div class="page-head reveal-f">
      <div>
        <h1>${greet}</h1>
        <p>Nexference reads your environment — installed clients, local runtimes, models and hardware — and shows what you can safely configure.</p>
      </div>
      <button class="btn btn2" id="wsRefresh" onclick="refreshWorkspace()">Refresh environment</button>
    </div>
    <div id="wsBody" class="ws-grid">
      <div class="skeleton-row" style="grid-column:1/-1">
        <div class="skeleton sk-card"></div><div class="skeleton sk-card"></div>
        <div class="skeleton sk-card"></div><div class="skeleton sk-card"></div>
      </div>
    </div>
    <div id="wsRecent" class="ws-recent" hidden></div>`;

  fetchEnvironment();
  updateShellStatus();
}

// Fetch the unified environment and render the workspace from it.
export async function refreshWorkspace() {
  const btn = document.getElementById('wsRefresh');
  if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
  try {
    await fetchEnvironment(true);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
  }
}

async function fetchEnvironment(force) {
  const body = document.getElementById('wsBody');
  if (!body) return;
  try {
    const res = await fetch('/api/environment' + (force ? '/refresh' : ''));
    const env = await res.json();
    renderWorkspaceFromEnv(env);
    loadRecentExecutions();
  } catch {
    body.innerHTML = '<div class="panel"><div class="muted">Could not load environment state.</div></div>';
  }
}

// Workspace "Recent Executions" — a live read of the v0.9.0 run history
// (server-backed, secret-free). No content bodies are shown here.
async function loadRecentExecutions() {
  const host = document.getElementById('wsRecent');
  if (!host) return;
  const relTime = (iso) => {
    const d = new Date(iso); if (isNaN(d)) return '';
    const s = (Date.now() - d) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return d.toLocaleDateString();
  };
  try {
    const res = await fetch('/api/executions');
    const { executions } = await res.json();
    if (!executions || !executions.length) {
      host.hidden = false;
      host.innerHTML = `<div class="empty-state">
        <div class="empty-ico">◷</div>
        <h3>No workspace activity yet</h3>
        <p>Executions you run in the Playground will appear here.</p>
        <button class="btn btn2" onclick="navigate('playground')">Open Playground</button>
      </div>`;
      return;
    }
    host.hidden = false;
    const today = [], earlier = [];
    executions.forEach((e) => {
      const d = e.createdAt ? new Date(e.createdAt) : null;
      (d && d.toDateString() === new Date().toDateString() ? today : earlier).push(e);
    });
    const group = (title, list) => list.length ? `
      <div class="ws-recent-group">
        <div class="ws-recent-group-h">${title}</div>
        ${list.slice(0, 5).map((e) => `
          <div class="ws-recent-item">
            <span class="dot ${e.success ? 'ok' : 'bad'}"></span>
            <div class="ws-recent-main">
              <b>${esc(e.model || '—')}</b>
              <span class="ws-recent-sub">${esc(e.source === 'local' ? 'local · ' + (e.runtimeId || '') : 'cloud · ' + (e.providerId || ''))}</span>
            </div>
            <span class="ws-recent-time">${relTime(e.createdAt)}</span>
          </div>`).join('')}
      </div>` : '';
    host.innerHTML = `
      <div class="ws-recent-head">
        <h3>Recent Activity</h3>
        <button class="btn ghost sm" onclick="openExecutionHistory()">View all</button>
      </div>
      ${group('Today', today)}${group('Earlier', earlier)}`;
  } catch {
    host.hidden = true;
  }
}

function renderWorkspaceFromEnv(env) {
  const body = document.getElementById('wsBody');
  if (!body) return;
  const health = env.health || {};
  const cfg = env.configuration || {};
  const hw = (env.hardware && env.hardware.capabilities) || {};
  const models = env.models || [];
  const runtimes = env.runtimes || [];
  const clients = env.clients || [];

  const runningRt = runtimes.filter((r) => r.running);
  const installedClients = clients.filter((c) => c.installed);
  const providersConfigured = PROVIDERS.filter((p) => Storage.getKey(p.id)).length;

  const applied = workspace.applied;
  const activeId = (applied && applied.provider) || workspace.appliedProviderId || workspace.activeProvider;
  const activeProvider = activeId ? getProvider(activeId) : null;
  const activeModel = (applied && applied.model) || (activeId ? Storage.getModel(activeId) : '');
  const activeRuntime = (applied && applied.runtime) ? getRuntime(applied.runtime) : null;
  const client = getClient(applied ? applied.client : 'claude-code');
  const connType = applied ? (applied.connectionType || 'cloud') : 'cloud';

  const cfgValid = !!cfg.file?.valid;
  const cfgModel = cfg.file?.model || activeModel || null;
  const cfgSource = cfg.file?.baseUrl ? 'cloud' : 'unknown';

  // ── Recommendations: only data-derived ──
  const recs = [];
  if (cfgValid && cfgModel) recs.push(`Configuration is valid (${esc(client.name)} · ${esc(cfgModel)}).`);
  else if (cfgValid) recs.push('Configuration file is valid but no model is set — pick a model in the wizard.');
  else recs.push('No valid configuration detected yet — run the Configuration Workspace to set one up.');
  const ollama = runtimes.find((r) => r.id === 'ollama');
  if (ollama && ollama.running) recs.push('Ollama is running — you can use local models.');
  else if (ollama && ollama.error) recs.push('Ollama is installed but not currently reachable — start it to use local models.');
  else if (!runningRt.length) recs.push('No local runtime is running — cloud providers are the simplest path.');
  (hw.recommendations || []).forEach((r) => recs.push(r));
  (hw.warnings || []).forEach((w) => recs.push(w));

  // ── Contextual health headline + action (data-derived only) ──
  const healthStatus = health.status || 'unknown';
  const healthHeadline = ({
    healthy: 'Your workspace is ready for Claude Code.',
    attention: 'Configuration is needed before you can use Claude Code.',
    'config-required': 'Configuration is needed before you can use Claude Code.',
    partial: 'Some capabilities are unavailable — review them below.',
    offline: 'Your environment appears to be offline.',
    critical: 'Critical issues are blocking a working setup.',
    unknown: 'Workspace state is still being determined.'
  })[healthStatus] || 'Review your workspace state below.';
  let healthAction = '';
  if (!cfgValid) healthAction = '<div class="ws-health-action"><button class="btn btn-go sm" onclick="openWorkflow()">Configure…</button></div>';
  else if (healthStatus !== 'healthy') healthAction = '<div class="ws-health-action"><button class="btn ghost sm" onclick="openHealthModal()">Review details</button></div>';

  body.innerHTML = `
    <div class="ws-hero">
      <div class="ws-kpi reveal-f" style="--d:.04s"><span class="kpi-ico">⌘</span><b>${installedClients.length}</b><span>Clients</span><small>installed &amp; detected</small></div>
      <div class="ws-kpi reveal-f" style="--d:.08s"><span class="kpi-ico">☁</span><b>${providersConfigured}</b><span>Providers</span><small>API keys configured</small></div>
      <div class="ws-kpi reveal-f" style="--d:.12s"><span class="kpi-ico">⚙</span><b>${runningRt.length}</b><span>Runtimes</span><small>running locally</small></div>
      <div class="ws-kpi reveal-f" style="--d:.16s"><span class="kpi-ico">◈</span><b>${models.length}</b><span>Models</span><small>available on device</small></div>
    </div>

    <div class="panel ws-quick reveal" style="--d:.07s">
      <span class="ws-eyebrow">Quick Actions</span>
      <div class="qa-grid">
        <button class="qa-card" onclick="openWorkflow()">
          <span class="qa-ico">⚙</span>
          <span class="qa-text"><b>Configure Client</b><small>Open the guided configuration workspace</small></span>
        </button>
        <button class="qa-card" onclick="navigate('models')">
          <span class="qa-ico">◈</span>
          <span class="qa-text"><b>Explore Models</b><small>Browse the cloud and local catalogue</small></span>
        </button>
        <button class="qa-card" onclick="navigate('playground')">
          <span class="qa-ico">▶</span>
          <span class="qa-text"><b>Test Playground</b><small>Run a model and inspect metrics</small></span>
        </button>
        <button class="qa-card" onclick="navigate('localai')">
          <span class="qa-ico">▦</span>
          <span class="qa-text"><b>Local Runtime</b><small>Manage Ollama / LM Studio</small></span>
        </button>
      </div>
    </div>

    <div class="panel ws-health ${health.status || 'neutral'} reveal" style="--d:.05s">
      <div class="ws-health-head">
        <div>
          <span class="ws-eyebrow">Environment Health</span>
          <span class="badge ${health.status === 'healthy' ? 'configured' : health.status === 'critical' ? 'unsupported' : 'browse'}">${esc(health.status || 'unknown')}</span>
        </div>
        <button class="btn ghost sm" onclick="openHealthModal()" style="margin-left:auto">Details</button>
      </div>
      <p class="ws-health-headline">${esc(healthHeadline)}</p>
      <p class="ws-health-summary">${esc(health.summary || 'Status unknown.')}</p>
      ${healthAction}
      <div class="health-factors">
        ${(health.factors || []).map((f) => `<div class="health-factor ${f.ok ? 'ok' : 'bad'}"><span class="hf-dot"></span><div><b>${esc(f.label)}</b><span class="muted">${esc(f.detail || '')}</span></div></div>`).join('')}
      </div>
    </div>

    <div class="panel ws-config reveal" style="--d:.10s">
      <div class="ws-config-head">
        <span class="ws-eyebrow">Current Workspace</span>
        <span class="badge ${cfgValid ? 'configured' : 'needs'}">${cfgValid ? 'Valid' : 'Attention'}</span>
      </div>
      <div class="ws-chain">
        <div class="chain-node clickable" role="button" tabindex="0" title="Open Clients" aria-label="Open Clients page" onclick="navigate('clients')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"><span class="chain-label">Client</span><b>${esc(client.name)}</b></div>
        <span class="chain-arrow" aria-hidden="true">→</span>
        <div class="chain-node clickable" role="button" tabindex="0" title="Open Configuration" aria-label="Open Configuration" onclick="navigate('configuration')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"><span class="chain-label">AI Source</span><b>${esc(connectionLabel(applied ? connType : cfgSource))}</b></div>
        <span class="chain-arrow" aria-hidden="true">→</span>
        <div class="chain-node clickable" role="button" tabindex="0" title="Open ${esc(activeProvider ? 'Providers' : (activeRuntime ? 'Local AI' : 'Providers'))}" aria-label="Open ${esc(activeProvider ? 'Providers' : (activeRuntime ? 'Local AI' : 'Providers'))}" onclick="navigate('${activeProvider ? 'cloud-providers' : (activeRuntime ? 'localai' : 'cloud-providers')}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"><span class="chain-label">Provider / Runtime</span><b>${esc(activeProvider ? activeProvider.name : (activeRuntime ? activeRuntime.name : (cfgSource === 'cloud' ? 'detected' : '—')))}</b></div>
        <span class="chain-arrow" aria-hidden="true">→</span>
        <div class="chain-node clickable" role="button" tabindex="0" title="Open Model Library" aria-label="Open Model Library" onclick="navigate('models')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"><span class="chain-label">Model</span><b class="mono">${esc(cfgModel || '—')}</b></div>
      </div>
      <div class="ws-config-path muted">Config: <span class="mono">${esc(client.configPath || '~/.claude/settings.json')}</span></div>
      <div class="ws-actions-row">
        <button class="btn btn-go" onclick="openWorkflow()">Configure…</button>
        <button class="btn btn2" onclick="navigate('configuration')">Configuration</button>
      </div>
    </div>

    <div class="panel ws-summary reveal" style="--d:.15s">
      <h3>Environment Overview</h3>
      <div class="stat-row"><div class="stat"><b>${installedClients.length}</b><span>clients detected</span></div><div class="stat"><b>${providersConfigured}</b><span>providers configured</span></div></div>
      <div class="stat-row"><div class="stat"><b>${runningRt.length}</b><span>runtimes running</span></div><div class="stat"><b>${models.length}</b><span>local models</span></div></div>
    </div>

    <div class="panel ws-next reveal" style="--d:.20s">
      <h3>Recommendations</h3>
      <div class="ws-next-body">${recs.map((r) => `<div class="ws-next-item">${esc(r)}</div>`).join('')}</div>
    </div>

    <div class="panel ws-models reveal" id="wsModelIntel" style="--d:.25s">
      <h3>Model Intelligence</h3>
      <div class="muted">Loading model catalogue…</div>
    </div>

    <div class="panel ws-profiles reveal" style="--d:.30s">
      <h3>Profiles</h3>
      <p class="muted">Saved configuration selections — never store secrets.</p>
      <div id="wsProfiles" class="ws-profile-list"></div>
      <button class="btn btn2" onclick="navigate('settings')">Manage profiles</button>
    </div>

    <div class="panel ws-activity reveal" style="--d:.35s">
      <div class="panel-h"><h3>Activity</h3><button class="term-clear" onclick="clearTerm()" title="Clear log"><span>clear</span></button></div>
      <div class="term"><div class="term-body" id="termOut"></div></div>
    </div>`;

  // Profiles (references only, no secrets)
  const wsProfiles = document.getElementById('wsProfiles');
  if (wsProfiles) {
    const profiles = Storage.listProfiles();
    wsProfiles.innerHTML = profiles.length
      ? profiles.map((p) => {
          const full = Storage.getProfile(p.id) || {};
          const prov = full.provider ? (getProvider(full.provider)?.name || full.provider) : '—';
          return `<div class="profile-row"><div><b>${esc(p.name)}</b> <span class="muted">${esc(prov)} · ${esc(full.model || '?')}</span></div><button class="btn btn2" onclick="applyProfile('${p.id}')">Use</button></div>`;
        }).join('')
      : '<div class="muted">No profiles yet — save one from Settings.</div>';
  }

  fillWsModelIntel();
}

// ── Workspace Health modal (v1.0.0) ───────────────────────────────
// Uses the dedicated, honest /api/health report (categories + score). No
// secrets are surfaced. Partial failures are shown explicitly, never hidden
// behind a green overall status.
const HEALTH_BADGE = {
  healthy: 'configured', attention: 'browse', 'config-required': 'needs',
  partial: 'browse', offline: 'unsupported', unknown: 'browse',
};

export async function openHealthModal() {
  const { openModal } = await import('../components/modal.js');
  openModal({
    title: 'Workspace Health',
    subtitle: 'Honest status across configuration, clients, runtimes, providers and execution.',
    size: 'wide',
    bodyHTML: '<div id="healthModalBody"><div class="muted">Loading workspace health…</div></div>',
    onMount: async () => {
      try {
        const res = await fetch('/api/health');
        const h = await res.json();
        const body = document.getElementById('healthModalBody');
        if (!body) return;
        const cats = Object.entries(h.categories || {}).map(([name, c]) => `
          <div class="health-cat">
            <div class="health-cat-head">
              <span class="badge ${HEALTH_BADGE[c.state] || 'browse'}">${esc(c.state)}</span>
              <b>${esc(name)}</b>
            </div>
            <p class="muted">${esc(c.summary || '')}</p>
            <ul class="health-items">
              ${(c.items || []).map((it) => `<li class="${it.ok ? 'ok' : 'bad'}"><span class="hf-dot"></span><div><b>${esc(it.label)}</b><span class="muted">${esc(it.detail || '')}</span></div></li>`).join('')}
            </ul>
          </div>`).join('');
        const issues = (h.issues || []).length
          ? `<div class="health-issues"><h4>Issues</h4>${h.issues.map((i) => `<div class="ws-next-item">${esc(i.message)}</div>`).join('')}</div>` : '';
        const recs = (h.recommendations || []).length
          ? `<div class="health-issues"><h4>Recommendations</h4>${h.recommendations.map((r) => `<div class="ws-next-item">${esc(r)}</div>`).join('')}</div>` : '';
        body.innerHTML = `
          <div class="health-overall">
            <div class="health-score ${h.overall}"><b>${h.score}</b><span>/100</span></div>
            <div><span class="badge ${HEALTH_BADGE[h.overall] || 'browse'} big">${esc(h.overall)}</span>
            <p class="muted">Generated ${esc(new Date(h.generatedAt).toLocaleTimeString())}</p></div>
          </div>
          <div class="health-cats">${cats}</div>
          ${issues}${recs}`;
      } catch {
        const body = document.getElementById('healthModalBody');
        if (body) body.innerHTML = '<div class="muted">Unable to load workspace health. Check the server connection.</div>';
      }
    },
  });
}

// ── Activity modal (v1.0.0) ───────────────────────────────────────
// Unified feed: server-side events (/api/activity) merged with the existing
// client-side activity store. Fully secret-free.
export async function openActivityModal() {
  const { openModal } = await import('../components/modal.js');
  const { getActivities } = await import('../core/activityStore.js');
  openModal({
    title: 'Activity',
    subtitle: 'Recent important workspace events — configuration, backups, runtimes, executions.',
    size: 'wide',
    bodyHTML: '<div id="activityModalBody"><div class="muted">Loading activity…</div></div>',
    onMount: async () => {
      try {
        const [serverRes, local] = await Promise.all([
          fetch('/api/activity').then((r) => r.json()).catch(() => ({ activities: [] })),
          Promise.resolve(getActivities()),
        ]);
        const merged = [
          ...(serverRes.activities || []).map((a) => ({ ...a, origin: 'server' })),
          ...local.map((a) => ({ ...a, origin: 'client', category: a.kind, summary: a.message, timestamp: a.at, status: a.kind === 'info' ? 'info' : (a.kind === 'apply' || a.kind === 'restore' ? 'success' : a.kind === 'delete' ? 'warning' : 'info') })),
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 40);

        const body = document.getElementById('activityModalBody');
        if (!body) return;
        if (!merged.length) { body.innerHTML = '<div class="muted">No activity recorded yet.</div>'; return; }
        const icon = { success: '✓', warning: '⚠', error: '✕', info: '•' };
        body.innerHTML = `<div class="activity-list">${merged.map((a) => `
          <div class="activity-row activity-${esc(a.status)}">
            <span class="act-ico">${icon[a.status] || '•'}</span>
            <div class="act-msg">
              <div>${esc(a.summary)}</div>
              <div class="muted" style="font-size:11px">${esc(a.category || 'event')} · ${esc(new Date(a.timestamp).toLocaleString())}</div>
            </div>
          </div>`).join('')}</div>`;
      } catch {
        const body = document.getElementById('activityModalBody');
        if (body) body.innerHTML = '<div class="muted">Unable to load activity.</div>';
      }
    },
  });
}

async function fillWsModelIntel() {
  const host = document.getElementById('wsModelIntel');
  if (!host) return;
  try {
    const [stats, recs] = await Promise.all([modelService.getStats(), modelService.getRecommended()]);
    const recent = modelService.getRecent();
    host.innerHTML = `
      <h3>Model Intelligence</h3>
      <div class="ml-stats">
        <span class="ml-chip"><b>${stats.cloudTotal}</b> cloud</span>
        <span class="ml-chip"><b>${stats.cloudFree}</b> free</span>
        <span class="ml-chip"><b>${stats.cloudPaid}</b> paid</span>
        <span class="ml-chip"><b>${stats.localTotal}</b> local</span>
      </div>
      ${recs.length ? `<div class="ws-next-body" style="margin-top:8px">${recs.slice(0, 4).map((r) => `<div class="ws-next-item">★ <b class="mono">${esc(r.name || r.id)}</b> <span class="muted">${esc(r.providerName)}</span> — ${esc(r.recommendationReason || 'recommended')}</div>`).join('')}</div>` : ''}
      ${recent.length ? `<div class="ml-recent" style="margin-top:10px">${recent.slice(0, 5).map((m) => `<button class="chipx" onclick="useModel('${esc(m.providerId)}','${esc(m.id)}')">${esc(m.name || m.id)}</button>`).join('')}</div>` : ''}
      <div style="margin-top:10px"><button class="btn btn2" onclick="navigate('models')">Open Model Library</button></div>`;
  } catch {
    host.innerHTML = '<div class="muted">Model catalogue unavailable.</div>';
  }
}

export function renderProviders() {
  setCrumb('Providers');
  renderGateways();
}

// ─────────────────────────────────────────────────────────────
//  v0.5.0 Configuration Workspace
//
//  A single place to read the live ~/.claude/settings.json, preview the diff a
//  new config would make, back up / restore, and watch for external changes.
//  Apply itself is performed through the guided wizard (openWorkflow), whose
//  final step shows the CURRENT → NEW diff and writes via the atomic, verified
//  server endpoint.
// ─────────────────────────────────────────────────────────────

let _configES = null;
let _ownWriteAt = 0;       // suppress "external change" right after our own writes
let _extDismissedAt = 0;   // let the user dismiss the external-change banner
let _activityBound = false;

let _cfgTab = 'config';

export function setCfgTab(t) {
  _cfgTab = t;
  renderConfiguration();
}

export function renderConfiguration() {
  updateCrumb('Configuration Workspace');
  const host = document.getElementById('page-configuration');
  if (!host) return;
  host.innerHTML = `
    <div class="page-head">
      <h1>Configuration Workspace</h1>
      <p>One place to read the live <code>~/.claude/settings.json</code>, manage reusable profiles, and explore client/provider/runtime compatibility.</p>
    </div>
    <div class="cfg-tabs">
      <button class="cfg-tab ${_cfgTab === 'config' ? 'on' : ''}" onclick="setCfgTab('config')">Configuration</button>
      <button class="cfg-tab ${_cfgTab === 'profiles' ? 'on' : ''}" onclick="setCfgTab('profiles')">Profiles</button>
      <button class="cfg-tab ${_cfgTab === 'compatibility' ? 'on' : ''}" onclick="setCfgTab('compatibility')">Compatibility</button>
    </div>
    <div id="cfgSubview"></div>`;

  const sub = host.querySelector('#cfgSubview');
  if (_cfgTab === 'config') renderCfgSubConfig(sub);
  else if (_cfgTab === 'profiles') renderCfgSubProfiles(sub);
  else if (_cfgTab === 'compatibility') renderCompatibility(sub);
}

function renderCfgSubConfig(host) {
  host.innerHTML = `
    <div id="draftBanner" class="draft-banner" hidden></div>
    <div id="extChangeBanner" class="ext-banner" hidden>
      <span class="ext-ico">⟳</span>
      <div class="ext-txt">The configuration file changed outside Nexference <span id="extWhen" class="muted"></span>.
        <button class="btn btn2" onclick="refreshConfigStatus()">Reload</button>
        <button class="btn btn2" onclick="dismissExternalChange()">Dismiss</button></div>
    </div>
    <div class="cfg-ws-grid">
      <div class="panel cfg-current" id="cfgCurrentCard">
        <div class="panel-h"><h3>Current Configuration</h3><span id="cfgStateBadge" class="badge"></span></div>
        <div class="cfg-current-body" id="cfgCurrentBody"><div class="muted">Loading…</div></div>
        <div class="cfg-current-actions">
          <button class="btn btn-go" onclick="openWorkflow()">Configure…</button>
          <button class="btn btn2" onclick="viewCurrentConfig()">View JSON</button>
          <button class="btn btn2" onclick="openConfigFolder()">Open folder</button>
        </div>
      </div>
      <div class="panel cfg-backups" id="cfgBackupsPanel">
        <div class="panel-h"><h3>Backups</h3><span class="muted" id="cfgBackupCount"></span></div>
        <div class="backup-list" id="backupListCfg"></div>
      </div>
      <div class="panel cfg-activity" id="cfgActivityPanel">
        <div class="panel-h"><h3>Activity</h3></div>
        <div class="activity-list" id="activityListCfg"></div>
      </div>
    </div>`;
  renderDraftBanner(host);
  refreshConfigStatus();
  loadBackups();
  loadActivityCfg();
  startConfigEvents();
}

function renderCfgSubProfiles(host) {
  host.innerHTML = `
    <div class="panel">
      <h3>Configuration Profiles</h3>
      <p class="muted">Reusable selections — a client, connection, provider/runtime and model. References only; they never store secrets. Rename, duplicate, or export/import them as portable JSON.</p>
      <div id="cfgProfileList" class="profile-list"></div>
      <div class="profile-new">
        <input id="cfgProfileName" class="inp" placeholder="Profile name (e.g. Work / Local / OSS)" />
        <button class="btn btn-go" onclick="saveCurrentAsProfileFromCfg()">Save current as profile</button>
        <button class="btn btn2" onclick="exportAllProfiles()">Export all</button>
        <label class="btn btn2">Import<input type="file" accept="application/json,.json" hidden onchange="importProfileFile(event)"></label>
      </div>
    </div>`;
  const list = host.querySelector('#cfgProfileList');
  const profiles = Storage.listProfiles();
  if (!profiles.length) { list.innerHTML = '<div class="muted">No profiles yet.</div>'; return; }
  list.innerHTML = profiles.map(p => {
    const full = Storage.getProfile(p.id) || {};
    const clientName = full.client ? getClient(full.client).name : 'Claude Code';
    const target = full.runtime ? (getRuntime(full.runtime)?.name || full.runtime) : (full.provider ? (getProvider(full.provider)?.name || full.provider) : '—');
    const conn = full.connectionType ? connectionLabel(full.connectionType) : 'Cloud';
    return `<div class="profile-row">
      <div><b>${esc(p.name)}</b><span class="muted"> ${esc(clientName)} · ${esc(conn)} · ${esc(target)} · ${esc(full.model || '?')}</span></div>
      <div class="profile-acts">
        <button class="btn btn2" onclick="applyProfile('${p.id}')">Use</button>
        <button class="btn btn2" onclick="renameProfilePrompt('${p.id}')">Rename</button>
        <button class="btn btn2" onclick="duplicateProfile('${p.id}')">Duplicate</button>
        <button class="btn btn2" onclick="exportProfile('${p.id}')">Export</button>
        <button class="btn btn2 danger" onclick="deleteProfile('${p.id}')">Delete</button>
      </div></div>`;
  }).join('');
}

export function saveCurrentAsProfileFromCfg() {
  const name = (document.getElementById('cfgProfileName')?.value || '').trim();
  if (!name) { notify.toast('Enter a profile name', 'warning'); return; }
  const a = workspace.applied || {};
  const client = a.client || workspace.activeClient || 'claude-code';
  const connectionType = a.connectionType || 'cloud';
  const provider = a.provider || workspace.appliedProviderId || workspace.activeProvider || cfg.provider;
  const runtime = a.runtime || workspace.activeRuntime || null;
  const model = a.model || (provider ? Storage.getModel(provider) : cfg.model);
  if (!provider && !runtime) { notify.toast('Configure a provider or runtime first', 'warning'); return; }
  Storage.saveProfile({ id: 'p_' + Date.now().toString(36), name, client, connectionType, sourceType: connectionType, provider, runtime, model });
  notify.toast(`Saved profile “${name}”`, 'success');
  const inp = document.getElementById('cfgProfileName'); if (inp) inp.value = '';
  renderCfgSubProfiles(document.getElementById('cfgSubview'));
}

// ── Compatibility Explorer (v0.6.0) ──
// A full client × provider / runtime matrix, computed honestly from the same
// client-provider / client-runtime compatibility rules the wizard uses.
export function renderCompatibility(host) {
  if (host.id !== 'cfgSubview') host = document.getElementById('cfgSubview');
  if (!host) return;
  const cell = (ok, level) => `<span class="badge ${ok ? level : 'unsupported'}">${ok ? capShort(level) : '—'}</span>`;
  const clientRows = CLIENTS.map((c) => {
    const provCells = PROVIDERS.map((p) => {
      const r = checkClientProvider(c.id, p.id);
      return `<td title="${esc(p.name)}">${cell(r.compatible, r.level)}</td>`;
    }).join('');
    const rtCells = RUNTIMES.map((rt) => {
      const r = checkClientRuntime(c.id, rt.id);
      return `<td title="${esc(rt.name)}">${cell(r.compatible, r.level)}</td>`;
    }).join('');
    return `<tr><th class="cm-cell">${esc(c.name)}</th>${provCells}${rtCells}</tr>`;
  }).join('');

  host.innerHTML = `
    <div class="panel">
      <h3>Compatibility Matrix</h3>
      <p class="muted">Which clients can consume which providers (☁) and local runtimes (◉). Levels:
        <span class="badge verified">verified</span>
        <span class="badge supported">supported</span>
        <span class="badge experimental">experimental</span>
        <span class="badge unsupported">unsupported</span>. Manual levels are connection-compatible but not auto-applied.</p>
      <div class="compat-scroll">
        <table class="compat-table">
          <thead><tr><th>Client \\ Target</th>${PROVIDERS.map((p) => `<th title="${esc(p.name)}">☁ ${esc(p.name.split(' ')[0])}</th>`).join('')}${RUNTIMES.map((rt) => `<th title="${esc(rt.name)}">◉ ${esc(rt.name.split(' ')[0])}</th>`).join('')}</tr></thead>
          <tbody>${clientRows}</tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:12px">Detail view:</p>
      <div id="compatDetail"></div>
    </div>`;

  // Interactive detail: click a target header to inspect every client against it.
  const detail = host.querySelector('#compatDetail');
  const headers = host.querySelectorAll('.compat-table thead th');
  headers.forEach((h, i) => {
    if (i === 0) return;
    const isRuntime = i > PROVIDERS.length;
    const idx = isRuntime ? i - 1 - PROVIDERS.length : i - 1;
    const target = isRuntime ? RUNTIMES[idx] : PROVIDERS[idx];
    h.style.cursor = 'pointer';
    h.addEventListener('click', () => {
      const rows = CLIENTS.map((c) => {
        const r = isRuntime ? checkClientRuntime(c.id, target.id) : checkClientProvider(c.id, target.id);
        return `<div class="profile-row"><div><b>${esc(c.name)}</b> <span class="muted">${esc(r.level)}</span></div><div>${compatNoteList(r).replace(/^<ul>|<\/ul>$/g, '')}</div></div>`;
      }).join('');
      detail.innerHTML = `<div class="compat-detail-box"><h4>${esc(target.name)}</h4>${rows}</div>`;
    });
  });
}

function capShort(level) {
  return ({ verified: '✓ verified', supported: '✓ supported', experimental: '⚠ experimental', manual: 'manual', unsupported: '—' })[level] || level;
}

export function openCompatibilityExplorer() {
  _cfgTab = 'compatibility';
  if (window.navigate) window.navigate('configuration');
}

function renderDraftBanner(host) {
  const b = host.querySelector('#draftBanner');
  if (!b) return;
  if (hasUsableDraft()) {
    b.hidden = false;
    b.innerHTML = `<span class="ext-ico">✎</span>
      <div class="ext-txt">You have an unsaved configuration ready.
        <button class="btn btn-go" onclick="openWorkflow()">Resume setup</button>
        <button class="btn btn2" onclick="discardDraftAndRefresh()">Discard</button></div>`;
  } else {
    b.hidden = true;
  }
}

export function discardDraftAndRefresh() {
  discardDraft();
  renderConfiguration();
}

export async function refreshConfigStatus() {
  const body = document.getElementById('cfgCurrentBody');
  const badgeEl = document.getElementById('cfgStateBadge');
  const banner = document.getElementById('extChangeBanner');
  if (!body) return;
  try {
    const res = await fetch('/api/config/status');
    const s = await res.json();
    const f = s.file || {};
    if (!f.exists) {
      body.innerHTML = `<div class="kv"><span>Status</span><b>No settings.json yet</b></div><p class="muted">Run Configure to generate one — a backup is created automatically on every write.</p>`;
      if (badgeEl) { badgeEl.className = 'badge needs'; badgeEl.textContent = 'Not configured'; }
    } else {
      const when = f.lastModified ? new Date(f.lastModified).toLocaleString() : '—';
      body.innerHTML = `
        <div class="kv"><span>Client</span><b>Claude Code</b></div>
        <div class="kv"><span>Provider / base URL</span><b class="mono">${esc(f.baseUrl || '—')}</b></div>
        <div class="kv"><span>Model</span><b class="mono">${esc(f.model || '—')}</b></div>
        <div class="kv"><span>Valid</span><b>${f.valid ? 'Yes' : 'No — malformed'}</b></div>
        <div class="kv"><span>Last modified</span><b>${esc(when)}</b></div>
        <div class="kv"><span>Path</span><b class="mono">~/.claude/settings.json</b></div>`;
      const configured = f.valid && !!f.model;
      if (badgeEl) { badgeEl.className = 'badge ' + (configured ? 'configured' : 'needs'); badgeEl.textContent = configured ? 'Configured' : 'Incomplete'; }
    }
    if (banner) {
      if (s.externalChange && new Date(s.externalChange.at).getTime() > _extDismissedAt) {
        const w = document.getElementById('extWhen');
        if (w) w.textContent = `(${new Date(s.externalChange.at).toLocaleString()})`;
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    }
    // Keep the backups count fresh.
    const cnt = document.getElementById('cfgBackupCount');
    if (cnt && s.backups) cnt.textContent = s.backups.length ? `${s.backups.length} saved` : '';
    loadBackups();
  } catch {
    body.innerHTML = '<div class="muted">Could not load configuration status.</div>';
  }
}

export function dismissExternalChange() {
  _extDismissedAt = Date.now();
  const banner = document.getElementById('extChangeBanner');
  if (banner) banner.hidden = true;
}

export async function viewCurrentConfig() {
  try {
    const res = await fetch('/api/config');
    const { config } = await res.json();
    const masked = maskConfigForView(config);
    openModal({
      title: 'Current settings.json',
      subtitle: '~/.claude/settings.json · API key masked',
      size: 'wide',
      bodyHTML: `<pre class="code config-code">${highlightJSON(JSON.stringify(masked, null, 2))}</pre>`,
    });
  } catch { notify.toast('Could not load config', 'error'); }
}

function maskConfigForView(config) {
  if (!config || typeof config !== 'object') return config;
  const c = JSON.parse(JSON.stringify(config));
  if (c.apiKeyHelper) c.apiKeyHelper = "echo '•••••••• (hidden)'";
  if (c.env) {
    for (const k of Object.keys(c.env)) {
      if (/key|token|secret|helper/i.test(k)) c.env[k] = '•••••••• (hidden)';
    }
  }
  return c;
}

// Shared backup list renderer — fills every known backup container.
export async function loadBackups() {
  const hosts = ['backupListCfg', 'backupList']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!hosts.length) return;
  try {
    const res = await fetch('/api/backups');
    const { backups } = await res.json();
    const cnt = document.getElementById('cfgBackupCount');
    if (cnt) cnt.textContent = backups && backups.length ? `${backups.length} saved` : '';
    if (!backups || !backups.length) {
      hosts.forEach((h) => { h.innerHTML = '<div class="muted">No backups yet — they’re created automatically when you apply a configuration.</div>'; });
      return;
    }
    const html = backups.slice(0, 12).map((b) => `
      <div class="backup-row">
        <span class="backup-name mono">${esc(b.name)}</span>
        <span class="backup-time muted">${esc(b.mtime ? new Date(b.mtime).toLocaleString() : '')}</span>
        <span class="backup-acts">
          <button class="btn btn2" onclick="openBackupView('${esc(b.id)}')">View</button>
          <button class="btn btn2" onclick="restoreBackupAction('${esc(b.id)}')">Restore</button>
          <button class="btn btn2 danger" onclick="deleteBackupAction('${esc(b.id)}')">Delete</button>
        </span>
      </div>`).join('');
    hosts.forEach((h) => { h.innerHTML = html; });
  } catch {
    hosts.forEach((h) => { h.innerHTML = '<div class="muted">Could not load backups.</div>'; });
  }
}

export async function openBackupView(id) {
  try {
    const res = await fetch(`/api/backups/${encodeURIComponent(id)}/content`);
    const { config } = await res.json();
    const masked = maskConfigForView(config);
    openModal({
      title: `Backup ${esc(id)}`,
      subtitle: 'API key masked',
      size: 'wide',
      bodyHTML: `<pre class="code config-code">${highlightJSON(JSON.stringify(masked, null, 2))}</pre>`,
    });
  } catch { notify.toast('Could not load backup', 'error'); }
}

export async function restoreBackupAction(id) {
  if (!confirm('Restore this backup? The current configuration will be backed up first (reversible).')) return;
  try {
    const res = await fetch(`/api/backups/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || 'restore failed');
    _ownWriteAt = Date.now();
    recordActivity('restore', `Restored backup ${id}`);
    notify.toast('Backup restored', 'success');
    notify.log(`Restored backup ${id} (safety backup saved)`, 't-ok');
    refreshConfigStatus();
    loadBackups();
  } catch (err) {
    notify.toast(`Restore failed: ${err.message}`, 'error');
  }
}

export async function deleteBackupAction(id) {
  if (!confirm('Delete this backup permanently?')) return;
  try {
    const res = await fetch(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || 'delete failed');
    recordActivity('delete', `Deleted backup ${id}`);
    notify.toast('Backup deleted', 'info');
    loadBackups();
  } catch (err) {
    notify.toast(`Delete failed: ${err.message}`, 'error');
  }
}

export function loadActivityCfg() {
  const host = document.getElementById('activityListCfg');
  if (!host) return;
  const acts = getActivities();
  if (!acts.length) { host.innerHTML = '<div class="muted">No activity yet. Apply a config or restore a backup to see history.</div>'; return; }
  host.innerHTML = acts.slice(0, 20).map((a) => `
    <div class="activity-row activity-${esc(a.kind)}">
      <span class="act-ico">${activityIcon(a.kind)}</span>
      <span class="act-msg">${esc(a.message)}</span>
      <span class="act-time muted">${esc(relTime(a.at))}</span>
    </div>`).join('');
}

function activityIcon(kind) {
  return ({
    apply: '✓', restore: '↺', backup: '💾', delete: '🗑', test: '⚡', external: '⟳', info: 'ℹ',
  })[kind] || '•';
}

function relTime(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function startConfigEvents() {
  if (_configES) return;
  if (typeof EventSource === 'undefined') return;
  try {
    _configES = new EventSource('/api/config/events');
    _configES.onmessage = (e) => {
      try {
        const change = JSON.parse(e.data);
        // Ignore changes we caused ourselves (apply / restore).
        if (Date.now() - _ownWriteAt < 2000) return;
        const banner = document.getElementById('extChangeBanner');
        if (banner) {
          const w = document.getElementById('extWhen');
          if (w) w.textContent = `(${new Date(change.at).toLocaleString()})`;
          banner.hidden = false;
        }
        recordActivity('external', 'Configuration changed outside Nexference');
        refreshConfigStatus();
        loadBackups();
      } catch { /* ignore */ }
    };
  } catch { /* EventSource unsupported */ }
}

// Keep the activity feed live on the Configuration page.
if (!_activityBound) {
  _activityBound = true;
  document.addEventListener('nx-activity', () => {
    if (document.body.dataset.page === 'configuration') loadActivityCfg();
  });
}

// ── Legacy single-page config handlers (delegated to the wizard) ──
export function cfgSelectClient() { openWorkflow(); }
export function cfgSelectProvider() { openWorkflow(); }
export function cfgSelectModel() { /* handled in wizard */ }
export function cfgTogglePaid() { openWorkflow(); }
export function cfgGenerate() { openWorkflow(); }
export async function cfgApply() { openWorkflow(); }

let deviceTimer = null;

// Benchmark modal — runs a fixed prompt against a local model and shows the
// honest metrics returned by the backend (no fabrication on the client).
function openBenchmarkModal(rt) {
  const models = (rt.models || []).filter(Boolean);
  if (!models.length) { notify.toast('No models available to benchmark', 'warning'); return; }
  const fmt = (ms) => (ms == null ? '—' : (ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : Math.round(ms) + 'ms'));
  const body = `<div class="bench">
    <p class="muted">Runs a fixed prompt against a model on <b>${esc(rt.name)}</b> and measures real throughput. No secrets involved.</p>
    <div class="pg-field"><label>Model</label><select id="benchModel" class="inp">${models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select></div>
    <div class="pg-field"><label>Prompt (optional)</label><textarea id="benchPrompt" class="inp" rows="3" placeholder="Leave blank to use the default benchmark prompt…"></textarea></div>
    <div id="benchResult" class="bench-result" hidden></div>
  </div>`;
  openModal({
    title: `Benchmark · ${rt.name}`, size: 'wide', bodyHTML: body,
    onMount: (b) => {
      const modelSel = b.querySelector('#benchModel');
      const promptEl = b.querySelector('#benchPrompt');
      const resEl = b.querySelector('#benchResult');
      const runBtn = document.createElement('button');
      runBtn.className = 'btn btn-go'; runBtn.textContent = 'Run benchmark';
      runBtn.style.marginTop = '12px';
      b.querySelector('.bench').appendChild(runBtn);
      runBtn.addEventListener('click', async () => {
        const model = modelSel.value;
        if (!model) { notify.toast('No model selected', 'warning'); return; }
        const prompt = promptEl.value.trim() || BENCH_PROMPT;
        runBtn.disabled = true; runBtn.textContent = 'Benchmarking…';
        resEl.hidden = false;
        resEl.innerHTML = `<div class="pg-metrics-grid"><div class="pg-metric"><span>Elapsed</span><b id="benchDur">0ms</b></div><div class="pg-metric"><span>Speed</span><b id="benchSpd">measuring…</b></div></div>`;
        execStream(
          { source: 'local', runtimeId: rt.id, model, systemPrompt: '', prompt, messages: [{ role: 'user', content: prompt }], parameters: { temperature: 0.7, maxTokens: 320, topP: 1 }, stream: true },
          {
            onLive: ({ elapsedMs, speed }) => {
              const d = document.getElementById('benchDur');
              const s = document.getElementById('benchSpd');
              if (d) d.textContent = elapsedMs >= 1000 ? (elapsedMs / 1000).toFixed(2) + 's' : Math.round(elapsedMs) + 'ms';
              if (s) s.textContent = speed > 0 ? speed.toFixed(1) + ' tok/s (live)' : 'measuring…';
            },
            onDone: ({ metrics }) => {
              const m = metrics || {};
              const rows = [];
              if (m.totalDurationMs != null) rows.push(['Duration', fmt(m.totalDurationMs)]);
              if (m.timeToFirstTokenMs != null) rows.push(['Time to first token', fmt(m.timeToFirstTokenMs)]);
              if (m.inputTokens != null) rows.push(['Input tokens', m.inputTokens]);
              if (m.outputTokens != null) rows.push(['Output tokens', m.outputTokens]);
              if (m.tokensPerSecond != null) rows.push(['Speed', m.tokensPerSecond.toFixed(1) + ' tok/s']);
              resEl.innerHTML = `<div class="pg-metrics-grid">${rows.map((rr) => `<div class="pg-metric"><span>${esc(rr[0])}</span><b>${esc(String(rr[1]))}</b></div>`).join('')}</div>`;
              runBtn.disabled = false; runBtn.textContent = 'Run benchmark';
            },
            onError: (validation, execFailed, msg) => {
              resEl.innerHTML = `<div class="err">${esc((validation && (validation.reasons || []).join(' ')) || msg || 'Benchmark failed')}</div>`;
              runBtn.disabled = false; runBtn.textContent = 'Run benchmark';
            },
          }
        );
      });
    },
  });
}

// Shared execution runner with a real-time ticker. While the source streams,
// it reports live elapsed duration + an estimated throughput (chars/4 tokens)
// so the UI shows changing numbers until the final, exact metrics arrive.
// Returns { executable, executionId?, es, timer }.
async function execStream(req, cb = {}) {
  const { onToken, onLive, onDone, onError } = cb;
  const v = await playgroundService.validate(req);
  if (!v.executable) { onError && onError(v, false); return { executable: false, validation: v }; }
  const created = await playgroundService.create(req);
  if (!created.executable || !created.executionId) { onError && onError(created.validation, true); return created; }
  pgExecId = created.executionId;
  const start = Date.now();
  let buffer = '';
  pgLiveTimer = setInterval(() => {
    const el = Date.now() - start;
    const toks = Math.max(0, Math.round(buffer.length / 4));
    const speed = el > 0 ? toks / (el / 1000) : 0;
    onLive && onLive({ elapsedMs: el, tokens: toks, speed });
  }, 150);
  const es = playgroundService.stream(pgExecId, (ev) => {
    if (ev.type === 'token') { buffer += ev.data.delta || ''; onToken && onToken(buffer); }
    else if (ev.type === 'complete') {
      if (pgLiveTimer) { clearInterval(pgLiveTimer); pgLiveTimer = null; }
      try { es.close(); } catch { /* ignore */ }
      pgES = null; pgExecId = null;
      onDone && onDone({ content: buffer, metrics: ev.data.metrics, usage: ev.data.usage });
    } else if (ev.type === 'error') {
      if (pgLiveTimer) { clearInterval(pgLiveTimer); pgLiveTimer = null; }
      try { es.close(); } catch { /* ignore */ }
      pgES = null; pgExecId = null;
      onError && onError(null, true, ev.data.message);
    }
  });
  pgES = es;
  return { executable: true, executionId: pgExecId, es, timer: pgLiveTimer };
}

export async function renderLocalAI() {
  setCrumb('Local AI');
  const grid = document.getElementById('rtGrid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="lai">
      <section class="lai-hero">
        <div class="lai-hero-id">
          <span class="lai-hero-badge"><span class="dot"></span>Live</span>
          <div class="lai-hero-host mono" id="devHost">—</div>
          <div class="lai-hero-sub" id="devSysSub">—</div>
        </div>
        <div class="lai-kpis">
          <div class="lai-kpi">
            <div class="lai-kpi-top"><span>CPU</span><b class="mono" id="devCpu">—</b></div>
            <div class="meter"><span class="meter-fill" id="devCpuBar"></span></div>
            <div class="lai-kpi-sub" id="devCpuSub">—</div>
          </div>
          <div class="lai-kpi">
            <div class="lai-kpi-top"><span>Memory</span><b class="mono" id="devMem">—</b></div>
            <div class="meter"><span class="meter-fill" id="devMemBar"></span></div>
            <div class="lai-kpi-sub" id="devMemSub">—</div>
          </div>
          <div class="lai-kpi">
            <div class="lai-kpi-top"><span>GPU</span><b class="mono" id="devGpu">—</b></div>
            <div class="lai-kpi-sub" id="devGpuSub">—</div>
          </div>
          <div class="lai-kpi">
            <div class="lai-kpi-top"><span>System</span><b class="mono" id="devSys">—</b></div>
            <div class="lai-kpi-sub" id="devSysSub2">—</div>
          </div>
        </div>
      </section>
      <div class="lai-runs-head">
        <h3>Runtime services</h3>
        <span class="muted" id="rtCount">—</span>
      </div>
      <div id="rtList" class="rt-grid"><div class="muted">Detecting local runtimes…</div></div>
    </div>`;

  const rtList = grid.querySelector('#rtList');

  function rtHue(id) {
    let h = 0;
    for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }

  async function loadRuntimes() {
    try {
      const res = await fetch('/api/local-runtimes');
      const { runtimes } = await res.json();
      rtList.innerHTML = runtimes.map(rt => {
        const planned = !!rt.planned;
        const running = !!rt.running;
        const detected = !!rt.detected;
        const status = planned ? 'planned' : (running ? 'running' : (detected ? 'detected' : 'offline'));
        const badge = planned ? 'Coming soon' : (running ? `${rt.modelCount} models` : (rt.modelCount ? `${rt.modelCount} installed` : (detected ? 'Detected' : 'Offline')));
        const stateText = planned ? 'Planned' : (running ? 'Running' : (detected ? 'Detected' : 'Offline'));
        const initial = (rt.name || '?').trim().charAt(0).toUpperCase();
        const logoHTML = `<span class="rt-logo-monogram">${esc(initial)}</span>` + (rt.logo
          ? `<img class="rt-logo-img" src="${esc(rt.logo)}" alt="${esc(rt.name)} logo" loading="lazy" onerror="this.closest('.rt-logo').classList.remove('has-img');this.remove()">`
          : '');
        const modelsHTML = rt.models && rt.models.length
          ? `<div class="rt-models">${rt.models.slice(0, 8).map(m => `<span class="chipx">${esc(m)}</span>`).join('')}${rt.models.length > 8 ? `<span class="chipx">+${rt.models.length - 8}</span>` : ''}</div>`
          : '';
        return `<div class="panel rt-card ${running ? 'live' : ''} ${status}">
          <div class="rt-card-top">
            <div class="rt-logo ${rt.logo ? 'has-img' : ''}" style="--rt:hsl(${rtHue(rt.id)} 68% 58%)">${logoHTML}</div>
            <div class="rt-title"><b>${esc(rt.name)}</b><span class="rt-meta">Local runtime</span></div>
            <span class="badge ${status}">${esc(badge)}</span>
            ${!running && rt.supportsStart ? (rt.installed === false ? `<span class="rt-note-sm" title="Install the app to enable auto-start">Not installed</span>` : `<button class="btn btn-ghost sm rt-start" data-start="${esc(rt.id)}" title="Start ${esc(rt.name)}">Start</button>`) : ''}
            ${running && rt.models && rt.models.length ? `<button class="btn btn-ghost sm rt-bench" data-bench="${esc(rt.id)}" title="Benchmark a model on ${esc(rt.name)}">Benchmark</button>` : ''}
          </div>
          <div class="rt-desc">${esc(rt.note || '')}</div>
          ${modelsHTML}
          <div class="rt-foot">
            <div class="rt-foot-item"><span>State</span><b>${esc(stateText)}</b></div>
            <div class="rt-foot-item"><span>Models</span><b>${running ? rt.modelCount : '—'}</b></div>
          </div>
        </div>`;
      }).join('');
      rtList.querySelectorAll('.rt-start').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const id = btn.dataset.start;
          // Trigger the allowlisted start command (safe; no arbitrary shell).
          try {
            const r = await (await fetch(`/api/local-runtimes/${id}/start`, { method: 'POST' })).json();
            if (!r.supported) { notify.toast(r.message || 'Auto-start not supported.', 'info'); setTimeout(() => loadRuntimes(), 600); return; }
            if (!r.ok) { notify.toast(r.message || 'Could not start runtime.', 'warning'); setTimeout(() => loadRuntimes(), 600); return; }
          } catch { /* keep waiting; we poll status below */ }
          // Live wait: count up elapsed time and poll until the service is
          // reachable, so the user sees real-time progress, not a frozen button.
          const t0 = Date.now();
          btn.disabled = true;
          const tick = setInterval(() => { btn.textContent = 'Starting… ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'; }, 150);
          let settled = false;
          const finish = (msg, kind) => {
            if (settled) return; settled = true;
            clearInterval(tick);
            notify.toast(msg, kind);
            setTimeout(() => loadRuntimes(), 700);
          };
          const poll = setInterval(async () => {
            try {
              const { runtimes: rs } = await (await fetch('/api/local-runtimes')).json();
              const rtNow = (rs || []).find((r) => r.id === id);
              if (rtNow && rtNow.running) { finish(`${rtNow.name} is running.`, 'success'); return; }
            } catch { /* keep polling */ }
            if (Date.now() - t0 > 25000) finish('Still starting — check the runtime manually.', 'warning');
          }, 700);
        });
      });
      rtList.querySelectorAll('.rt-bench').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const id = btn.dataset.bench;
          const rtObj = runtimes.find((r) => r.id === id);
          if (rtObj) openBenchmarkModal(rtObj);
        });
      });
      const cnt = grid.querySelector('#rtCount'); if (cnt) cnt.textContent = `${runtimes.length} runtimes`;
    } catch {
      rtList.innerHTML = '<div class="muted">Failed to detect local runtimes.</div>';
    }
  }

  function fmtUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function set(id, v) { const el = grid.querySelector('#' + id); if (el) el.textContent = v; }

  async function loadDevice() {
    try {
      const info = await (await fetch('/api/hardware/device')).json();
      const cpu = info.cpu || {};
      const mem = info.memory || {};
      const gpu = info.gpu || {};
      set('devHost', info.hostname || '—');
      set('devCpu', cpu.cores ? `${cpu.cores} cores` : '—');
      set('devCpuSub', `${esc(cpu.model || 'unknown')}${cpu.usagePct != null ? ` · ${cpu.usagePct}% used` : ''}`);
      set('devMem', `${mem.usedGB != null ? mem.usedGB : '—'} / ${mem.totalGB != null ? mem.totalGB : '—'} GB`);
      set('devMemSub', `${mem.usedPct != null ? mem.usedPct + '% used' : ''}${mem.freeGB != null ? ` · ${mem.freeGB} GB free` : ''}`);
      set('devGpu', gpu.name || (gpu.available === false ? 'Not detected' : '—'));
      set('devGpuSub', gpu.note || '');
      set('devSysSub', `${esc(info.arch || '')} · up ${fmtUptime(info.uptimeSec || 0)} · Node ${esc(info.process?.node || '')}`);
      set('devSys', `Node ${esc(info.process?.node || '—')}`);
      set('devSysSub2', esc(info.system || `${info.platform || ''} ${info.release || ''}`));
      const cpuBar = grid.querySelector('#devCpuBar'); if (cpuBar) cpuBar.style.width = (cpu.usagePct != null ? cpu.usagePct : 0) + '%';
      const memBar = grid.querySelector('#devMemBar'); if (memBar) memBar.style.width = (mem.usedPct != null ? mem.usedPct : 0) + '%';
    } catch { /* keep last good values */ }
  }

  if (deviceTimer) clearInterval(deviceTimer);
  await loadDevice();
  await loadRuntimes();
  deviceTimer = setInterval(loadDevice, 3000);
}

export function renderClients() {
  setCrumb('Clients');
  const grid = document.getElementById('clientGrid');
  if (!grid) return;
  grid.innerHTML = CLIENTS.map(c => {
    const supportLabel = c.support === 'verified' ? 'Verified' : c.support === 'manual' ? 'Manual setup' : 'Coming soon';
    const conns = (c.connectionTypes || []).map(t => `<span class="chipx">${esc(connectionLabel(t))}</span>`).join('') || '<span class="muted">—</span>';
    const configured = workspace.applied && workspace.applied.client === c.id;
    const disabled = c.support === 'unsupported' ? 'disabled' : '';
    return `
    <div class="panel client-card ${c.support !== 'unsupported' ? 'live' : ''} ${configured ? 'sel' : ''}">
      <div class="client-top">
        <div class="client-logo" style="--cm:${esc(c.color || '#5b8def')}">${clientLogoHtml(c)}</div>
        <div class="client-id">
          <b>${esc(c.name)}</b>
          <span class="badge ${c.support}">${esc(supportLabel)}</span>
        </div>
      </div>
      <div class="client-sub">${esc(c.note || '')}</div>
      <div class="client-meta">
        <div class="kv"><span>Config</span><b class="mono">${esc(c.configPath || '—')}</b></div>
        <div class="kv"><span>Connections</span><b>${conns}</b></div>
      </div>
      <div class="client-acts">
        <button class="btn btn-go" onclick="openWorkflow({ initialClient: '${c.id}' })" ${disabled}>Configure</button>
      </div>
    </div>`;
  }).join('');
}

export function renderSettings() {
  updateCrumb('Settings');
  // Theme segmented control
  const seg = document.getElementById('themeSeg');
  if (seg) {
    seg.innerHTML = ['dark', 'light', 'system'].map(t => `<button class="seg-btn ${theme.current() === t ? 'on' : ''}" onclick="setTheme('${t}')">${t[0].toUpperCase() + t.slice(1)}</button>`).join('');
  }
  renderProfiles();
  loadBackups();
}

export function setTheme(t) {
  theme.set(t);
  renderSettings();
  notify.toast(`Theme: ${t}`, 'info');
}

export function renderProfiles() {
  const list = document.getElementById('profileList');
  if (!list) return;
  const profiles = Storage.listProfiles();
  if (!profiles.length) { list.innerHTML = '<div class="muted">No profiles yet — save one from the Configuration page or the wizard.</div>'; return; }
  list.innerHTML = profiles.map(p => {
    const full = Storage.getProfile(p.id) || {};
    const clientName = full.client ? getClient(full.client).name : 'Claude Code';
    const target = full.runtime ? (getRuntime(full.runtime)?.name || full.runtime) : (full.provider ? (getProvider(full.provider)?.name || full.provider) : '—');
    const conn = full.connectionType ? connectionLabel(full.connectionType) : 'Cloud';
    return `<div class="profile-row">
      <div><b>${esc(p.name)}</b><span class="muted"> ${esc(clientName)} · ${esc(conn)} · ${esc(target)} · ${esc(full.model || '?')}</span></div>
      <div class="profile-acts">
        <button class="btn btn2" onclick="applyProfile('${p.id}')">Use</button>
        <button class="btn btn2" onclick="renameProfilePrompt('${p.id}')">Rename</button>
        <button class="btn btn2" onclick="duplicateProfile('${p.id}')">Duplicate</button>
        <button class="btn btn2" onclick="exportProfile('${p.id}')">Export</button>
        <button class="btn btn2 danger" onclick="deleteProfile('${p.id}')">Delete</button>
      </div></div>`;
  }).join('') +
  `<div class="profile-row profile-row-import">
     <div class="muted">Import profiles from a JSON export:</div>
     <div class="profile-acts">
       <button class="btn btn2" onclick="exportAllProfiles()">Export all</button>
       <label class="btn btn2">Import<input type="file" accept="application/json,.json" hidden onchange="importProfileFile(event)"></label>
     </div>
   </div>`;
}

export function renameProfilePrompt(id) {
  const cur = Storage.getProfile(id);
  const name = prompt('Rename profile', cur?.name || '');
  if (!name || !name.trim()) return;
  Storage.renameProfile(id, name.trim());
  notify.toast('Profile renamed', 'success');
  renderProfiles();
  if (document.body.dataset.page === 'configuration') renderConfiguration();
}

export function duplicateProfile(id) {
  Storage.duplicateProfile(id);
  notify.toast('Profile duplicated', 'success');
  renderProfiles();
  if (document.body.dataset.page === 'configuration') renderConfiguration();
}

export function exportProfile(id) {
  const obj = Storage.exportProfile(id);
  if (!obj) return;
  downloadJSON(obj, `nexference-profile-${id}.json`);
  notify.toast('Profile exported', 'success');
}

export function exportAllProfiles() {
  const obj = Storage.exportAllProfiles();
  downloadJSON(obj, 'nexference-profiles.json');
  notify.toast('All profiles exported', 'success');
}

export function importProfileFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.profiles)) {
        data.profiles.forEach((p) => Storage.importProfile(p));
        notify.toast(`Imported ${data.profiles.length} profiles`, 'success');
      } else {
        Storage.importProfile(data);
        notify.toast('Profile imported', 'success');
      }
      renderProfiles();
      if (document.body.dataset.page === 'configuration') renderConfiguration();
    } catch {
      notify.toast('Invalid profile file', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function createProfile() {
  const name = (document.getElementById('profileName')?.value || '').trim();
  if (!name) { notify.toast('Enter a profile name', 'warning'); return; }
  const a = workspace.applied || {};
  const client = a.client || workspace.activeClient || 'claude-code';
  const connectionType = a.connectionType || 'cloud';
  const provider = a.provider || workspace.appliedProviderId || workspace.activeProvider || cfg.provider;
  const runtime = a.runtime || workspace.activeRuntime || null;
  const model = a.model || (provider ? Storage.getModel(provider) : cfg.model);
  if (!provider && !runtime) { notify.toast('Configure a provider or runtime first', 'warning'); return; }
  const id = 'p_' + Date.now().toString(36);
  // References only — never secrets.
  Storage.saveProfile({ id, name, client, connectionType, sourceType: connectionType, provider, runtime, model });
  notify.toast(`Saved profile “${name}”`, 'success');
  const inp = document.getElementById('profileName'); if (inp) inp.value = '';
  renderProfiles();
}

export function applyProfile(id) {
  const p = Storage.getProfile(id);
  if (!p) return;
  workspace.activeClient = p.client || 'claude-code';
  workspace.activeProvider = p.provider || null;
  workspace.activeRuntime = p.runtime || null;
  if (p.provider && p.model) Storage.setModel(p.provider, p.model);
  notify.toast(`Activated profile “${p.name}”`, 'success');
  // Invoke the relevant client adapter through the workflow (preselected).
  openWorkflow({
    initialClient: p.client,
    initialConnectionType: p.connectionType,
    initialProvider: p.provider,
    initialRuntime: p.runtime,
  });
}

export function deleteProfile(id) {
  Storage.deleteProfile(id);
  renderProfiles();
}

export function workspaceQuickTest() {
  const id = workspace.appliedProviderId || workspace.activeProvider || cfg.provider;
  if (!id) { notify.toast('Select a provider first', 'warning'); return; }
  const p = getProvider(id);
  const key = Storage.getKey(id);
  if (!key) { notify.toast('Enter an API key on the Providers page first', 'error'); return; }
  testConnection(id, p.baseUrl);
}

export function toggleSidebar() {
  const collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
  Storage.setSidebar(collapsed ? 'collapsed' : 'expanded');
  notify.toast(collapsed ? 'Sidebar collapsed' : 'Sidebar expanded', 'info');
}

// ═══════════════════════════════════════════════════
//  v0.3.0 page renderers + shell status
// ═════════════════════════════════════════════════

// Dynamic, context-aware breadcrumb (e.g. "Cloud Providers / OpenRouter").
export function updateCrumb(pageTitle, sub) {
  const c = document.getElementById('crumb');
  if (!c) return;
  // The current-page (.crumb-cur) text is intentionally not shown — the sidebar
  // already reflects the active page, and the top bar stays focused on search.
  // The command-palette search trigger is unaffected.
  c.innerHTML = '';
}

// Top-bar configuration status — reflects the real applied state.
export function updateShellStatus() {
  const el = document.getElementById('cfgStatus');
  if (!el) return;
  const applied = workspace.applied;
  let state = 'needs';
  let label = 'Needs setup';
  if (applied && applied.status === 'configured') {
    if (workspace.unsaved) { state = 'unsaved'; label = 'Unsaved changes'; }
    else { state = 'ok'; label = 'Configured'; }
  } else if (applied && applied.status === 'copyable') {
    state = 'copy'; label = 'Copyable config';
  }
  el.className = `cfg-status ${state}`;
  el.innerHTML = `<span class="dot"></span><span class="cfg-status-label">${esc(label)}</span>`;
}

export function cycleTheme() {
  const order = ['dark', 'light', 'system'];
  const cur = theme.current();
  const next = order[(order.indexOf(cur) + 1) % order.length];
  setTheme(next);
}

// ── Cloud Providers explorer ──
export function renderCloudProviders() {
  updateCrumb('Cloud Providers');
  const grid = document.getElementById('cpGrid');
  const filtersEl = document.getElementById('cpFilters');
  if (!grid || !filtersEl) return;

  const cats = [
    { id: 'all', label: 'All' },
    { id: 'popular', label: 'Popular' },
    { id: 'free', label: 'Free' },
    { id: 'anthropic', label: 'Anthropic Compatible' },
    { id: 'openai', label: 'OpenAI Compatible' },
    { id: 'google', label: 'Google' },
  ];
  let activeCat = 'all';
  let q = '';

  const passes = (p) => {
    const tags = providerTags(p.id);
    if (activeCat !== 'all' && !tags.includes(activeCat)) return false;
    if (q) {
      const ql = q.toLowerCase();
      if (!(p.name.toLowerCase().includes(ql) || p.sub.toLowerCase().includes(ql))) return false;
    }
    return true;
  };

  const drawFilters = () => {
    filtersEl.innerHTML = cats.map(c => `<button class="chip-filter ${activeCat === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.label)}</button>`).join('');
    filtersEl.querySelectorAll('.chip-filter').forEach(b => b.addEventListener('click', () => {
      activeCat = b.dataset.cat; drawFilters(); drawGrid();
    }));
  };

  const drawGrid = () => {
    // Anthropic is the first-party API, not a third-party cloud gateway — keep it
    // out of the Cloud Providers explorer (it still appears under Providers / compatibility).
    const list = PROVIDERS.filter(p => p.id !== 'anthropic' && passes(p));
    if (!list.length) { grid.innerHTML = '<div class="muted">No providers match.</div>'; return; }
    grid.innerHTML = list.map(p => {
      const key = Storage.getKey(p.id);
      const free = getFreeModels(p.id).length;
      const total = getModels(p.id).length;
      const compat = p.id === 'openrouter' ? 'Anthropic (proxy)' : (p.claudeCode ? 'Anthropic' : 'OpenAI');
      return `<div class="panel provider-card cp-card" data-id="${p.id}" role="button" tabindex="0">
        <div class="pc-logo-sm">${logoHtml(p)}</div>
        <div class="provider-meta"><b>${esc(p.name)}</b><span class="provider-compat">${esc(compat)}</span></div>
        <div class="pc-card-foot">
          <span class="badge cnt">${total ? (free + ' free · ' + total + ' total') : 'models…'}</span>
          ${key ? '<span class="badge cc">configured</span>' : ''}
        </div>
      </div>`;
    }).join('');
    grid.querySelectorAll('.provider-card').forEach(c => {
      const open = () => openProviderConfig(c.dataset.id);
      c.addEventListener('click', open);
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  };

  const search = document.getElementById('cpSearch');
  if (search) search.addEventListener('input', (e) => { q = e.target.value; drawGrid(); });
  drawFilters();
  drawGrid();
}

// ── Models explorer (v0.8.0 — Model Intelligence) ──
export function renderModels() {
  updateCrumb('Models');
  const host = document.getElementById('modelList');
  if (!host) return;
  renderModelLibrary(host);
}

export function useModel(providerId, modelId) {
  Storage.setModel(providerId, modelId);
  workspace.activeProvider = providerId;
  workspace.activeModel = modelId;
  modelService.addRecent({ providerId, id: modelId, name: modelId, providerName: getProvider(providerId)?.name || providerId });
  notify.toast(`Selected ${modelId} (${getProvider(providerId)?.name || providerId})`, 'success');
}

let pgExecId = null;
let pgES = null;
let pgLiveTimer = null;
const pgSupported = { cloud: new Set(), local: new Set() };
const BENCH_PROMPT = 'Explain how a transformer language model works. Cover self-attention, positional encoding, feed-forward layers, and the training objective. Be thorough and precise.';

// Module-scoped so the Workspace "View all" button works even before the
// Playground page has been rendered.
async function openExecutionHistory() {
  const execs = await historyStore.listExecutions();
  const body = `<div class="pg-hist">${execs.length ? execs.map((e) => `
    <div class="pg-hist-item">
      <div class="pg-hist-top"><b>${esc(e.model || '—')}</b><span class="badge ${e.success ? 'ok' : 'bad'}">${esc(e.status || '')}</span></div>
      <div class="pg-hist-meta">${esc((e.source === 'local' ? 'local · ' + (e.runtimeId || '') : 'cloud · ' + (e.providerId || '')))} · ${e.createdAt ? new Date(e.createdAt).toLocaleString() : ''}</div>
      <div class="pg-hist-prev">${esc((e.promptPreview || '').slice(0, 140))}</div>
    </div>`).join('') : '<div class="muted">No executions yet.</div>'}</div>`;
  openModal({ title: 'Execution history', size: 'wide', bodyHTML: body });
}
// Exposed globally so inline onclick handlers (Workspace "View all", Playground History) resolve it.
window.openExecutionHistory = openExecutionHistory;

export async function renderPlayground() {
  updateCrumb('Playground');
  const section = document.getElementById('page-playground');
  if (!section) return;

  // Tear down any in-flight run from a previous mount.
  if (pgLiveTimer) { clearInterval(pgLiveTimer); pgLiveTimer = null; }
  if (pgES && pgES.abort) { try { pgES.abort(); } catch { /* ignore */ } }
  pgES = null; pgExecId = null;

  const draft = historyStore.loadDraft() || {};
  const state = {
    source: draft.source || null,
    providerId: draft.providerId || (PROVIDERS[0] && PROVIDERS[0].id),
    runtimeId: draft.runtimeId || 'ollama',
    model: draft.model || '',
    systemPrompt: draft.systemPrompt || '',
    prompt: draft.prompt || '',
    parameters: draft.parameters || { temperature: 0.7, maxTokens: 1024, topP: 1 },
  };

  // ── Capabilities (cloud providers + local runtimes) ──
  let providerOptions = '', runtimeOptions = '', localRunning = false;
  try {
    const caps = await playgroundService.capabilities();
    const cloud = (caps.cloud || []).filter((c) => c.supportsExecution);
    const local = (caps.local || []).filter((c) => c.supportsExecution);
    localRunning = local.some((r) => r.running);
    providerOptions = cloud.length
      ? cloud.map((c) => `<option value="${esc(c.id)}">${esc(c.name || c.id)}</option>`).join('')
      : PROVIDERS.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join('');
    runtimeOptions = local.length
      ? local.map((r) => `<option value="${esc(r.id)}">${esc(r.name || r.id)}</option>`).join('')
      : '<option value="ollama">Ollama</option>';
  } catch {
    providerOptions = PROVIDERS.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join('');
    runtimeOptions = '<option value="ollama">Ollama</option>';
  }
  if (!state.source) state.source = localRunning ? 'local' : 'cloud';

  const fmtMs = (ms) => (ms == null ? '—' : ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : Math.round(ms) + 'ms');

  section.innerHTML = `
    <div class="page-head reveal-f">
      <div>
        <h1>Playground</h1>
        <p>Validate, then stream real completions from cloud providers and local runtimes — honestly, with live compatibility and metrics.</p>
      </div>
      <div class="pg-head-actions">
        <button class="btn ghost sm" id="pgHistory" type="button">History</button>
        <button class="btn ghost sm" id="pgClear" type="button">Clear</button>
      </div>
    </div>

    <div class="pg">
      <div class="panel pg-config lift reveal" style="--d:.05s">
        <div class="seg">
          <button class="seg-btn" data-src="cloud" type="button">Cloud</button>
          <button class="seg-btn" data-src="local" type="button">Local</button>
        </div>

        <div class="pg-field" id="pgProviderField">
          <label>Provider</label>
          <select id="pgProvider" class="inp">${providerOptions}</select>
          <div id="pgModelPicker"></div>
        </div>

        <div class="pg-field" id="pgRuntimeField" hidden>
          <label>Runtime</label>
          <select id="pgRuntime" class="inp">${runtimeOptions}</select>
          <div id="pgLocalModels"></div>
        </div>

        <div class="pg-field">
          <label>Model</label>
          <input id="pgModel" class="inp" placeholder="model id (e.g. claude-3-5-sonnet)" />
        </div>

        <div class="pg-field">
          <label>System prompt <span class="muted">(optional)</span></label>
          <textarea id="pgSystem" class="inp" rows="3" placeholder="Optional system instructions…"></textarea>
        </div>

        <div class="pg-params">
          <label>Parameters</label>
          <div class="pg-param"><span>Temperature <b id="pgTempVal"></b></span><input type="range" id="pgTemp" min="0" max="2" step="0.1" /></div>
          <div class="pg-param"><span>Max tokens <b id="pgMaxVal"></b></span><input type="range" id="pgMax" min="1" max="8192" step="1" /></div>
          <div class="pg-param"><span>Top P <b id="pgTopVal"></b></span><input type="range" id="pgTop" min="0" max="1" step="0.05" /></div>
          <button class="btn ghost sm" id="pgResetParams" type="button">Reset</button>
        </div>

        <div class="pg-status" id="pgStatus"><div class="muted">Checking compatibility…</div></div>
      </div>

      <div class="panel pg-out lift reveal" style="--d:.12s">
        <div class="pg-out-head">
          <span>Output</span>
          <div class="pg-out-acts">
            <button class="btn ghost sm" id="pgCopy" type="button" hidden>Copy</button>
            <button class="btn ghost sm" id="pgRetry" type="button" hidden>Retry</button>
            <button class="btn ghost sm" id="pgUseConfig" type="button" hidden>Use in Config</button>
            <button class="btn ghost sm" id="pgSaveProfile" type="button" hidden>Save as Profile</button>
            <button class="btn ghost sm" id="pgCompare" type="button" hidden>Compare</button>
          </div>
        </div>
        <div class="pg-metrics" id="pgMetrics" hidden></div>
        <div class="pg-content muted" id="pgContent">Run a prompt to see output.</div>
        <div class="pg-prompt">
          <textarea id="pgPrompt" class="inp" rows="3" placeholder="Enter a prompt… (⌘/Ctrl+Enter to run)"></textarea>
          <div class="pg-prompt-actions">
            <button class="btn" id="pgStop" type="button" hidden>Stop</button>
            <button class="btn btn-go" id="pgSend" type="button">Run</button>
          </div>
        </div>
      </div>
    </div>`;

  const $ = (id) => section.querySelector('#' + id);
  const sourceSeg = section.querySelectorAll('.seg-btn');
  const providerField = $('pgProviderField');
  const runtimeField = $('pgRuntimeField');
  const providerSel = $('pgProvider');
  const runtimeSel = $('pgRuntime');
  const modelInput = $('pgModel');
  const modelPickerHost = $('pgModelPicker');
  const localModelsHost = $('pgLocalModels');
  const systemInput = $('pgSystem');
  const promptInput = $('pgPrompt');
  const temp = $('pgTemp'), maxT = $('pgMax'), topP = $('pgTop');
  const statusEl = $('pgStatus');
  const contentEl = $('pgContent');
  const metricsEl = $('pgMetrics');
  const runBtn = $('pgSend'), stopBtn = $('pgStop');
  const copyBtn = $('pgCopy'), retryBtn = $('pgRetry'), useCfgBtn = $('pgUseConfig'),
        saveProfBtn = $('pgSaveProfile'), compareBtn = $('pgCompare');

  function persist() { historyStore.saveDraft(state); }

  function setSelect(sel, val, fallback) {
    const ok = Array.from(sel.options).some((o) => o.value === val);
    sel.value = ok ? val : fallback;
  }
  setSelect(providerSel, state.providerId, providerSel.options[0] && providerSel.options[0].value);
  setSelect(runtimeSel, state.runtimeId, runtimeSel.options[0] && runtimeSel.options[0].value);

  function buildReq() {
    const req = {
      source: state.source,
      model: state.model || '',
      systemPrompt: systemInput.value,
      prompt: promptInput.value,
      parameters: { ...state.parameters },
      stream: true,
    };
    if (state.source === 'cloud') {
      req.providerId = providerSel.value;
      req.key = Storage.getKey(providerSel.value) || '';
    } else {
      req.runtimeId = runtimeSel.value;
    }
    return req;
  }

  // ── Live compatibility check ──
  let valTimer = null;
  function scheduleValidate() { clearTimeout(valTimer); valTimer = setTimeout(updateStatus, 350); }
  async function updateStatus() {
    const req = buildReq();
    statusEl.className = 'pg-status';
    statusEl.innerHTML = '<div class="muted">Checking…</div>';
    try {
      const v = await playgroundService.validate(req);
      statusEl.className = 'pg-status lv-' + (v.level || 'unsupported');
      const items = [];
      (v.reasons || []).forEach((r) => items.push(`<li class="ok">${esc(r)}</li>`));
      (v.warnings || []).forEach((r) => items.push(`<li class="warn">${esc(r)}</li>`));
      (v.limitations || []).forEach((r) => items.push(`<li class="lim">${esc(r)}</li>`));
      (v.requiredConfiguration || []).forEach((r) => items.push(`<li class="need">${esc(r)}</li>`));
      const head = `<div class="pg-status-head"><b>Compatibility</b> · score <span class="pg-score">${v.score ?? 0}</span> · <span class="pg-level">${esc(v.level)}</span></div>`;
      statusEl.innerHTML = head + (items.length ? `<ul class="pg-check">${items.join('')}</ul>` : '');
      return v;
    } catch (e) {
      statusEl.innerHTML = `<div class="muted">Validation error: ${esc(e.message)}</div>`;
      return null;
    }
  }

  function renderMetrics(m, usage) {
    if (!m && !usage) return;
    const rows = [];
    if (m && m.totalDurationMs != null) rows.push(['Duration', fmtMs(m.totalDurationMs)]);
    if (m && m.timeToFirstTokenMs != null) rows.push(['Time to first token', fmtMs(m.timeToFirstTokenMs)]);
    if (m && m.inputTokens != null) rows.push(['Input tokens', m.inputTokens]);
    if (m && m.outputTokens != null) rows.push(['Output tokens', m.outputTokens]);
    if (m && m.tokensPerSecond != null) rows.push(['Speed', m.tokensPerSecond.toFixed(1) + ' tok/s']);
    if (usage && usage.latencyMs != null && !(m && m.providerReportedLatencyMs != null)) rows.push(['Provider latency', fmtMs(usage.latencyMs)]);
    metricsEl.hidden = false;
    metricsEl.innerHTML = `<div class="pg-metrics-head">Metrics</div><div class="pg-metrics-grid">${rows.map((r) => `<div class="pg-metric"><span>${esc(r[0])}</span><b>${esc(String(r[1]))}</b></div>`).join('')}</div>`;
  }

  function updateLive(start, len) {
    const el = Date.now() - start;
    const spd = el > 0 ? Math.round((len / 4) / (el / 1000)) : 0;
    const d = document.getElementById('pgLiveDur'), s = document.getElementById('pgLiveSpd');
    if (d) d.textContent = el >= 1000 ? (el / 1000).toFixed(2) + 's' : Math.round(el) + 'ms';
    if (s) s.textContent = spd > 0 ? spd.toFixed(1) + ' tok/s (live)' : 'measuring…';
  }

  // ── Source selection (cloud / local) ──
  function setSource(src) {
    state.source = src;
    sourceSeg.forEach((b) => b.classList.toggle('active', b.dataset.src === src));
    const cloud = src === 'cloud';
    providerField.hidden = !cloud;
    runtimeField.hidden = cloud;
    if (cloud) mountCloudPicker(); else loadLocalModels();
    scheduleValidate();
  }
  sourceSeg.forEach((b) => b.addEventListener('click', () => setSource(b.dataset.src)));

  function mountCloudPicker() {
    modelPickerHost.innerHTML = '';
    localModelsHost.innerHTML = '';
    if (!providerSel.value) return;
    renderModelPicker(modelPickerHost, providerSel.value, {
      includePaid: true, showPaidToggle: false, current: modelInput.value,
      onSelect: (id) => { modelInput.value = id; state.model = id; persist(); scheduleValidate(); },
    });
  }

  async function loadLocalModels() {
    modelPickerHost.innerHTML = '';
    localModelsHost.innerHTML = '<div class="muted">Detecting installed models…</div>';
    try {
      const { runtimes } = await fetch('/api/local-runtimes').then((r) => r.json());
      const rt = (runtimes || []).find((r) => r.id === runtimeSel.value);
      const models = rt && rt.models ? rt.models : [];
      if (!models.length) {
        localModelsHost.innerHTML = '<div class="muted">No models detected for this runtime.</div>';
        return;
      }
      const hint = rt && rt.needsServer
        ? `<div class="mp-hint">${esc(rt.name || 'This runtime')}'s Local Server is offline — start it in the ${esc(rt.name || 'app')} app (and load a model) to run these. They're listed from your device.</div>`
        : '';
      localModelsHost.innerHTML = hint + '<div class="mp-list">' + models.map((m) =>
        `<button type="button" class="mp-item" data-m="${esc(m)}"><span class="mp-name">${esc(m)}</span></button>`).join('') + '</div>';
      localModelsHost.querySelectorAll('.mp-item').forEach((b) => b.addEventListener('click', () => {
        modelInput.value = b.dataset.m; state.model = b.dataset.m; persist(); scheduleValidate();
      }));
      if (!state.model && models[0]) { modelInput.value = models[0]; state.model = models[0]; persist(); }
    } catch {
      localModelsHost.innerHTML = '<div class="muted">Could not detect local models.</div>';
    }
  }

  // ── Streaming (fetch + ReadableStream reader) ──
  async function streamExecution(id) {
    const ctrl = new AbortController();
    pgES = ctrl;
    const res = await fetch('/api/executions/' + encodeURIComponent(id) + '/stream', { signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error('Stream failed to open');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', full = '';
    const start = Date.now();
    pgLiveTimer = setInterval(() => updateLive(start, full.length), 200);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (!data) continue;
          let ev; try { ev = JSON.parse(data); } catch { continue; }
          if (ev.type === 'token') {
            full += (ev.data && ev.data.delta) || '';
            contentEl.textContent = full;
          } else if (ev.type === 'complete') {
            clearInterval(pgLiveTimer); pgLiveTimer = null; pgES = null;
            contentEl.className = 'pg-content';
            contentEl.innerHTML = miniMarkdown((ev.data && ev.data.content) || '');
            renderMetrics(ev.data && ev.data.metrics, ev.data && ev.data.usage);
            finishRun(true);
            return;
          } else if (ev.type === 'error') {
            clearInterval(pgLiveTimer); pgLiveTimer = null; pgES = null;
            contentEl.className = 'pg-content err';
            contentEl.textContent = (ev.data && ev.data.message) || 'Execution failed.';
            finishRun(false);
            return;
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        clearInterval(pgLiveTimer); pgLiveTimer = null; pgES = null;
        contentEl.className = 'pg-content err';
        contentEl.textContent = e.message || 'Stream interrupted.';
        finishRun(false);
      }
    }
  }

  async function run() {
    const prompt = promptInput.value.trim();
    if (!prompt) { notify.toast('Enter a prompt first', 'warning'); return; }
    try { localStorage.setItem('nx_pg_active', '1'); } catch { /* ignore */ }
    persist();
    const req = buildReq();
    runBtn.disabled = true; runBtn.classList.add('spinning');
    stopBtn.hidden = false;
    contentEl.className = 'pg-content streaming'; contentEl.textContent = '';
    metricsEl.hidden = false;
    metricsEl.innerHTML = `<div class="pg-metrics-head"><span class="pg-live-dot"></span>Live</div><div class="pg-metrics-grid"><div class="pg-metric"><span>Elapsed</span><b id="pgLiveDur">0ms</b></div><div class="pg-metric"><span>Speed</span><b id="pgLiveSpd">measuring…</b></div></div>`;
    [copyBtn, retryBtn, useCfgBtn, saveProfBtn, compareBtn].forEach((b) => (b.hidden = true));
    try {
      const v = await playgroundService.validate(req);
      if (!v || !v.executable) {
        contentEl.className = 'pg-content err';
        contentEl.textContent = [...(v && v.requiredConfiguration || []), ...(v && v.reasons || [])].filter(Boolean).join(' ') || 'This configuration is not executable.';
        finishRun(false);
        return;
      }
      const created = await playgroundService.create(req);
      if (!created.executable || !created.executionId) {
        contentEl.className = 'pg-content err';
        contentEl.textContent = (created.validation && (created.validation.reasons || []).join(' ')) || 'Execution could not be started.';
        finishRun(false);
        return;
      }
      pgExecId = created.executionId;
      await streamExecution(pgExecId);
    } catch (e) {
      contentEl.className = 'pg-content err';
      contentEl.textContent = e.message || 'Execution failed.';
      finishRun(false);
    }
  }

  function stop() {
    try { localStorage.removeItem('nx_pg_active'); } catch { /* ignore */ }
    if (pgLiveTimer) { clearInterval(pgLiveTimer); pgLiveTimer = null; }
    if (pgExecId) playgroundService.cancel(pgExecId).catch(() => {});
    if (pgES && pgES.abort) { try { pgES.abort(); } catch { /* ignore */ } pgES = null; }
    contentEl.className = 'pg-content';
    stopBtn.hidden = true; runBtn.disabled = false; runBtn.classList.remove('spinning');
  }

  function finishRun(success) {
    try { localStorage.removeItem('nx_pg_active'); } catch { /* ignore */ }
    if (pgLiveTimer) { clearInterval(pgLiveTimer); pgLiveTimer = null; }
    if (pgES && pgES.abort) { try { pgES.abort(); } catch { /* ignore */ } pgES = null; }
    stopBtn.hidden = true; runBtn.disabled = false; runBtn.classList.remove('spinning');
    [copyBtn, retryBtn, useCfgBtn, saveProfBtn, compareBtn].forEach((b) => (b.hidden = false));
    if (success) notify.toast('Execution complete', 'success');
  }

  function clearPlayground() {
    historyStore.clearDraft();
    pgExecId = null;
    if (pgES && pgES.abort) { try { pgES.abort(); } catch { /* ignore */ } pgES = null; }
    if (pgLiveTimer) { clearInterval(pgLiveTimer); pgLiveTimer = null; }
    notify.toast('Playground cleared', 'info');
    router.navigate('playground');
  }

  // ── Wiring ──
  runBtn.addEventListener('click', run);
  stopBtn.addEventListener('click', stop);
  promptInput.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
  $('pgHistory').addEventListener('click', openExecutionHistory);
  $('pgClear').addEventListener('click', clearPlayground);

  copyBtn.addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText(contentEl.textContent)
      .then(() => notify.toast('Copied', 'success')).catch(() => {});
  });
  retryBtn.addEventListener('click', run);
  useCfgBtn.addEventListener('click', () => {
    openWorkflow({
      initialClient: 'claude-code',
      initialConnectionType: state.source === 'local' ? 'local' : 'cloud',
      initialProvider: state.source === 'cloud' ? providerSel.value : null,
      initialRuntime: state.source === 'local' ? runtimeSel.value : null,
      initialModel: state.model || null,
    });
  });
  saveProfBtn.addEventListener('click', () => {
    const name = window.prompt('Profile name');
    if (!name) return;
    Storage.saveProfile({
      id: 'p_' + Date.now().toString(36), name, client: 'claude-code',
      connectionType: state.source === 'local' ? 'local' : 'cloud',
      sourceType: state.source === 'local' ? 'local' : 'cloud',
      provider: state.source === 'cloud' ? providerSel.value : null,
      runtime: state.source === 'local' ? runtimeSel.value : null,
      model: state.model || null,
    });
    notify.toast(`Saved profile “${name}”`, 'success');
  });
  compareBtn.addEventListener('click', openCompareModal);

  function openCompareModal() {
    const targets = [{ source: state.source, providerId: state.source === 'cloud' ? providerSel.value : null, runtimeId: state.source === 'local' ? runtimeSel.value : null, model: state.model }];
    const body = `<div class="pg-cmp">
      <p class="muted">Compare the same prompt across multiple models. Add targets, then run.</p>
      <div id="cmpList" class="pg-cmp-list"></div>
      <button class="btn ghost sm" id="cmpAdd" type="button">+ Add model</button>
      <div id="cmpAddForm" class="pg-cmp-add" hidden>
        <select id="cmpSrc"><option value="cloud">Cloud</option><option value="local">Local</option></select>
        <select id="cmpProv">${providerOptions}</select>
        <select id="cmpRt">${runtimeOptions}</select>
        <input id="cmpModel" class="inp" placeholder="model id" />
        <button class="btn ghost sm" id="cmpAddOk" type="button">Add</button>
      </div>
      <div id="cmpResults" class="pg-cmp-results" hidden></div>
    </div>`;
    openModal({
      title: 'Compare models', size: 'wide', bodyHTML: body,
      onMount: (b) => {
        const listEl = b.querySelector('#cmpList');
        const draw = () => {
          listEl.innerHTML = targets.map((t, i) =>
            `<div class="pg-cmp-target"><b>#${i + 1}</b> ${esc(t.source === 'cloud' ? (t.providerId + ' / ' + (t.model || '?')) : (t.runtimeId + ' / ' + (t.model || '?')))}${targets.length > 1 ? ` <button class="btn ghost sm" data-i="${i}" type="button">remove</button>` : ''}</div>`).join('') || '<div class="muted">No targets.</div>';
          listEl.querySelectorAll('button[data-i]').forEach((x) => x.addEventListener('click', () => { targets.splice(+x.dataset.i, 1); draw(); }));
        };
        draw();
        const provSel = b.querySelector('#cmpProv');
        b.querySelector('#cmpAdd').addEventListener('click', () => { b.querySelector('#cmpAddForm').hidden = false; });
        b.querySelector('#cmpAddOk').addEventListener('click', () => {
          const src = b.querySelector('#cmpSrc').value;
          const model = b.querySelector('#cmpModel').value.trim();
          if (!model) { notify.toast('Enter a model id', 'warning'); return; }
          if (src === 'cloud') {
            targets.push({ source: 'cloud', providerId: b.querySelector('#cmpProv').value, model });
          } else {
            targets.push({ source: 'local', runtimeId: b.querySelector('#cmpRt').value, model });
          }
          b.querySelector('#cmpModel').value = ''; b.querySelector('#cmpAddForm').hidden = true; draw();
        });
        const resHost = b.querySelector('#cmpResults');
        const runBtn2 = document.createElement('button');
        runBtn2.className = 'btn btn-go'; runBtn2.type = 'button'; runBtn2.textContent = 'Run comparison';
        runBtn2.style.marginTop = '12px';
        b.querySelector('.pg-cmp').appendChild(runBtn2);
        runBtn2.addEventListener('click', async () => {
          if (!promptInput.value.trim()) { notify.toast('Enter a prompt in the playground first', 'warning'); return; }
          runBtn2.disabled = true; runBtn2.textContent = 'Comparing…';
          resHost.hidden = false; resHost.innerHTML = '<div class="muted">Running comparison…</div>';
          try {
            const out = await playgroundService.compare({
              prompt: promptInput.value, systemPrompt: state.systemPrompt,
              parameters: state.parameters,
              modelRefs: targets.map((t) => ({
                source: t.source, providerId: t.providerId, runtimeId: t.runtimeId, model: t.model,
                key: t.source === 'cloud' ? (Storage.getKey(t.providerId) || '') : undefined,
              })),
            });
            const execs = out.executions || [];
            resHost.innerHTML = '<div class="pg-cmp-grid"></div>';
            const grid = resHost.querySelector('.pg-cmp-grid');
            execs.forEach((ex, i) => {
              const col = document.createElement('div'); col.className = 'pg-cmp-col';
              col.innerHTML = `<div class="pg-cmp-col-head">#${i + 1} · ${esc(ex.ref && ex.ref.model || '')}</div><div class="pg-cmp-col-body muted">Queued…</div>`;
              grid.appendChild(col);
              if (!ex.executionId) { col.querySelector('.pg-cmp-col-body').textContent = (ex.validation && ex.validation.reasons && ex.validation.reasons[0]) || 'Not executable'; return; }
              pollUntilDone(ex.executionId, col);
            });
          } catch (e) { resHost.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
          finally { runBtn2.disabled = false; runBtn2.textContent = 'Run comparison'; }
        });
      },
    });
  }

  function pollUntilDone(id, col) {
    const bodyEl = col.querySelector('.pg-cmp-col-body');
    const tick = async () => {
      try {
        const rec = await playgroundService.get(id);
        if (rec && (rec.status === 'complete' || rec.status === 'error' || rec.status === 'cancelled')) {
          if (rec.status === 'complete') {
            bodyEl.className = 'pg-cmp-col-body';
            bodyEl.innerHTML = miniMarkdown(rec.content || '');
            if (rec.metrics) bodyEl.insertAdjacentHTML('beforeend', `<div class="pg-cmp-metrics">${fmtMs(rec.metrics.totalDurationMs || 0)} · ${rec.metrics.outputTokens != null ? rec.metrics.outputTokens : '?'} out · ${rec.metrics.tokensPerSecond ? rec.metrics.tokensPerSecond.toFixed(1) + ' tok/s' : '—'}</div>`);
          } else { bodyEl.className = 'pg-cmp-col-body err'; bodyEl.textContent = rec.error || 'Failed'; }
          return;
        }
        setTimeout(tick, 700);
      } catch { setTimeout(tick, 1000); }
    };
    tick();
  }

  // ── Inputs / params ──
  modelInput.addEventListener('input', () => { state.model = modelInput.value.trim(); persist(); scheduleValidate(); });
  providerSel.addEventListener('change', () => { state.providerId = providerSel.value; if (state.source === 'cloud') mountCloudPicker(); persist(); scheduleValidate(); });
  runtimeSel.addEventListener('change', () => { state.runtimeId = runtimeSel.value; if (state.source === 'local') loadLocalModels(); persist(); scheduleValidate(); });
  systemInput.addEventListener('input', () => { state.systemPrompt = systemInput.value; persist(); });
  promptInput.addEventListener('input', () => { state.prompt = promptInput.value; persist(); });

  function syncParamLabels() {
    $('pgTempVal').textContent = (+temp.value).toFixed(1);
    $('pgMaxVal').textContent = maxT.value;
    $('pgTopVal').textContent = (+topP.value).toFixed(2);
  }
  function readParams() { state.parameters = { temperature: +temp.value, maxTokens: +maxT.value, topP: +topP.value }; persist(); }
  [temp, maxT, topP].forEach((el) => el.addEventListener('input', () => { syncParamLabels(); readParams(); }));
  $('pgResetParams').addEventListener('click', () => { temp.value = 0.7; maxT.value = 1024; topP.value = 1; syncParamLabels(); readParams(); });

  // Seed values
  modelInput.value = state.model || '';
  systemInput.value = state.systemPrompt || '';
  promptInput.value = state.prompt || '';
  temp.value = state.parameters.temperature; maxT.value = state.parameters.maxTokens; topP.value = state.parameters.topP;
  syncParamLabels();
  setSource(state.source);
  updateStatus();
}

