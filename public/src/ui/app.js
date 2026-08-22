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
    <div class="page-head">
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
    </div>`;

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
  } catch {
    body.innerHTML = '<div class="panel"><div class="muted">Could not load environment state.</div></div>';
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

  body.innerHTML = `
    <div class="panel ws-health ${health.status || 'neutral'}">
      <div class="ws-health-head">
        <span class="ws-eyebrow">Environment Health</span>
        <span class="badge ${health.status === 'healthy' ? 'configured' : health.status === 'critical' ? 'unsupported' : 'browse'}">${esc(health.status || 'unknown')}</span>
      </div>
      <p class="ws-health-summary">${esc(health.summary || 'Status unknown.')}</p>
      <div class="health-factors">
        ${(health.factors || []).map((f) => `<div class="health-factor ${f.ok ? 'ok' : 'bad'}"><span class="hf-dot"></span><div><b>${esc(f.label)}</b><span class="muted">${esc(f.detail || '')}</span></div></div>`).join('')}
      </div>
    </div>

    <div class="panel ws-config">
      <div class="ws-config-head">
        <span class="ws-eyebrow">Current Workspace</span>
        <span class="badge ${cfgValid ? 'configured' : 'needs'}">${cfgValid ? 'Valid' : 'Attention'}</span>
      </div>
      <div class="ws-config-body">
        <div class="kv"><span>Active Client</span><b>${esc(client.name)}</b></div>
        <div class="kv"><span>AI Source</span><b>${esc(connectionLabel(applied ? connType : cfgSource))}</b></div>
        <div class="kv"><span>Provider / Runtime</span><b>${esc(activeProvider ? activeProvider.name : (activeRuntime ? activeRuntime.name : (cfgSource === 'cloud' ? 'detected' : '—')))}</b></div>
        <div class="kv"><span>Model</span><b class="mono">${esc(cfgModel || '—')}</b></div>
        <div class="kv"><span>Config path</span><b class="mono">${esc(client.configPath || '~/.claude/settings.json')}</b></div>
      </div>
      <div class="ws-actions-row">
        <button class="btn btn-go" onclick="openWorkflow()">Configure…</button>
        <button class="btn btn2" onclick="navigate('configuration')">Configuration</button>
      </div>
    </div>

    <div class="panel ws-summary">
      <h3>Environment Overview</h3>
      <div class="stat-row"><div class="stat"><b>${installedClients.length}</b><span>clients detected</span></div><div class="stat"><b>${providersConfigured}</b><span>providers configured</span></div></div>
      <div class="stat-row"><div class="stat"><b>${runningRt.length}</b><span>runtimes running</span></div><div class="stat"><b>${models.length}</b><span>local models</span></div></div>
    </div>

    <div class="panel ws-next">
      <h3>Recommendations</h3>
      <div class="ws-next-body">${recs.map((r) => `<div class="ws-next-item">${esc(r)}</div>`).join('')}</div>
    </div>

    <div class="panel ws-models" id="wsModelIntel">
      <h3>Model Intelligence</h3>
      <div class="muted">Loading model catalogue…</div>
    </div>

    <div class="panel ws-profiles">
      <h3>Profiles</h3>
      <p class="muted">Saved configuration selections — never store secrets.</p>
      <div id="wsProfiles" class="ws-profile-list"></div>
      <button class="btn btn2" onclick="navigate('settings')">Manage profiles</button>
    </div>

    <div class="panel ws-activity">
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

export async function renderLocalAI() {
  setCrumb('Local AI');
  const grid = document.getElementById('rtGrid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="panel device-panel" id="devicePanel">
      <div class="device-head">
        <h3>Device</h3>
        <span class="badge live" id="devLive">live</span>
      </div>
      <div class="device-grid">
        <div class="device-metric">
          <div class="dm-label">CPU</div>
          <div class="dm-val mono" id="devCpu">—</div>
          <div class="dm-sub" id="devCpuSub">—</div>
          <div class="meter"><span class="meter-fill" id="devCpuBar"></span></div>
        </div>
        <div class="device-metric">
          <div class="dm-label">Memory</div>
          <div class="dm-val mono" id="devMem">—</div>
          <div class="dm-sub" id="devMemSub">—</div>
          <div class="meter"><span class="meter-fill" id="devMemBar"></span></div>
        </div>
        <div class="device-metric">
          <div class="dm-label">GPU</div>
          <div class="dm-val mono" id="devGpu">—</div>
          <div class="dm-sub" id="devGpuSub">—</div>
        </div>
        <div class="device-metric">
          <div class="dm-label">System</div>
          <div class="dm-val mono" id="devSys">—</div>
          <div class="dm-sub" id="devSysSub">—</div>
        </div>
      </div>
    </div>
    <div class="rt-section-h">Local runtimes</div>
    <div id="rtList"><div class="muted">Detecting local runtimes…</div></div>`;

  const rtList = grid.querySelector('#rtList');

  async function loadRuntimes() {
    try {
      const res = await fetch('/api/local-runtimes');
      const { runtimes } = await res.json();
      rtList.innerHTML = runtimes.map(rt => {
        const status = rt.planned ? 'planned' : (rt.running ? 'running' : (rt.detected ? 'detected' : 'offline'));
        const badge = rt.planned ? 'Coming soon' : (rt.running ? `${rt.modelCount} models` : 'Not running');
        return `<div class="panel rt-card ${rt.running ? 'live' : ''}">
          <div class="rt-top"><b>${esc(rt.name)}</b><span class="badge ${status}">${esc(badge)}</span></div>
          <div class="rt-sub">${esc(rt.note || '')}</div>
          ${rt.running && rt.models && rt.models.length ? `<div class="rt-models">${rt.models.slice(0, 6).map(m => `<span class="chipx">${esc(m)}</span>`).join('')}${rt.models.length > 6 ? `<span class="chipx">+${rt.models.length - 6}</span>` : ''}</div>` : ''}
        </div>`;
      }).join('');
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
      set('devCpu', cpu.cores ? `${cpu.cores} cores` : '—');
      set('devCpuSub', `${esc(cpu.model || 'unknown')}${cpu.usagePct != null ? ` · ${cpu.usagePct}% used` : ''}`);
      set('devMem', `${mem.usedGB != null ? mem.usedGB : '—'} / ${mem.totalGB != null ? mem.totalGB : '—'} GB`);
      set('devMemSub', `${mem.usedPct != null ? mem.usedPct + '% used' : ''}${mem.freeGB != null ? ` · ${mem.freeGB} GB free` : ''}`);
      set('devGpu', gpu.name || (gpu.available === false ? 'Not detected' : '—'));
      set('devGpuSub', gpu.note || '');
      set('devSys', `${esc(info.hostname || '')} · ${esc(info.platform || '')}`);
      set('devSysSub', `${esc(info.arch || '')} · up ${fmtUptime(info.uptimeSec || 0)} · Node ${esc(info.process?.node || '')}`);
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
  notify.toast(`Selected ${modelId} (${getProvider(providerId).name})`, 'success');
}

export function renderPlayground() {
  updateCrumb('Playground');
}

