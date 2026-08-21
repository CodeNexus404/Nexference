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
import { RUNTIMES, getRuntime } from '../runtimes/registry.js';
import { esc, norm, maskKey, highlightJSON, logoHtml } from '../components/util.js';
import { createGatewayCard } from '../components/gatewayCard.js';
import { openProviderConfig } from '../components/providerConfig.js';
import { toggleCommandPalette } from '../components/commandPalette.js';
import { openModal } from '../components/modal.js';
import { credentialsStore } from '../config/credentialsStore.js';
import { recordActivity, getActivities } from '../core/activityStore.js';
import { openWorkflow, hasUsableDraft, discardDraft } from '../config/workflow.js';

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

  const applied = workspace.applied;
  const activeId = (applied && applied.provider) || workspace.appliedProviderId || workspace.activeProvider;
  const activeProvider = activeId ? getProvider(activeId) : null;
  const activeModel = (applied && applied.model) || (activeId ? Storage.getModel(activeId) : '');
  const client = getClient(applied ? applied.client : 'claude-code');
  const connType = applied ? (applied.connectionType || 'cloud') : 'cloud';
  const activeRuntime = (applied && applied.runtime) ? getRuntime(applied.runtime) : null;

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const statusLabel = applied ? (applied.status === 'configured' ? 'Configured' : applied.status) : 'Not configured';
  const statusCls = applied ? (applied.status === 'configured' ? 'live' : (applied.status === 'copyable' ? 'planned' : 'browse')) : 'browse';

  section.innerHTML = `
    <div class="page-head">
      <h1>${greet}</h1>
      <p>Your AI workspace is ready. Manage providers, local runtimes, models and client configurations from one place.</p>
    </div>
    <div class="ws-grid">
      <div class="panel ws-config">
        <div class="ws-config-head">
          <span class="ws-eyebrow">Current Configuration</span>
          <span class="badge ${statusCls}" id="wsConfigBadge">${esc(statusLabel)}</span>
        </div>
        <div class="ws-config-body">
          <div class="kv"><span>Active Client</span><b>${esc(client.name)}</b></div>
          <div class="kv"><span>Connection</span><b>${esc(connectionLabel(connType))}</b></div>
          <div class="kv"><span>Provider</span><b>${esc(activeProvider ? activeProvider.name : '—')}</b></div>
          <div class="kv"><span>Model</span><b class="mono">${esc(activeModel || '—')}</b></div>
          <div class="kv"><span>Local Runtime</span><b id="wsRuntime">${esc(activeRuntime ? activeRuntime.name : '—')}</b></div>
          <div class="kv"><span>Status</span><b id="wsStatus">${esc(statusLabel)}</b></div>
          <div class="kv"><span>Config path</span><b class="mono" id="pathText">${esc(client.configPath || '~/.claude/settings.json')}</b></div>
        </div>
        <div class="ws-actions-row">
          <button class="btn btn-go" onclick="openWorkflow()">View configuration</button>
          <button class="btn btn2" onclick="openWorkflow()">Change configuration</button>
        </div>
      </div>

      <div class="panel ws-quick">
        <h3>Quick actions</h3>
        <div class="qa-grid">
          <button class="qa" onclick="openWorkflow()"><b>Configure Claude Code</b><span>Guided client config</span></button>
          <button class="qa" onclick="navigate('cloud-providers')"><b>Add Cloud Provider</b><span>Browse &amp; connect</span></button>
          <button class="qa" onclick="navigate('models')"><b>Explore Models</b><span>Search the catalogue</span></button>
          <button class="qa" onclick="navigate('localai')"><b>Check Local AI</b><span>Detect Ollama &amp; runtimes</span></button>
          <button class="qa" onclick="navigate('playground')"><b>Open Playground</b><span>Try models</span></button>
        </div>
      </div>

      <div class="panel ws-summary">
        <h3>Provider summary</h3>
        <div class="stat-row"><div class="stat"><b id="wsCloudCount">0</b><span>cloud providers</span></div><div class="stat"><b id="wsCloudConf">0</b><span>configured</span></div></div>
        <div class="stat-row"><div class="stat"><b id="wsLocalCount">0</b><span>local runtimes</span></div><div class="stat"><b id="wsLocalRun">0</b><span>running</span></div></div>
      </div>

      <div class="panel ws-profiles">
        <h3>Profiles</h3>
        <p class="muted">Saved configuration selections — never store secrets.</p>
        <div id="wsProfiles" class="ws-profile-list"></div>
        <button class="btn btn2" onclick="navigate('settings')">Manage profiles</button>
      </div>

      <div class="panel ws-next">
        <h3>Recommended next</h3>
        <div id="wsNext" class="ws-next-body"></div>
      </div>

      <div class="panel ws-activity">
        <div class="panel-h"><h3>Activity</h3><button class="term-clear" onclick="clearTerm()" title="Clear log"><span>clear</span></button></div>
        <div class="term"><div class="term-body" id="termOut"></div></div>
      </div>
    </div>`;

  fetch('/api/local-runtimes').then(r => r.json()).then(d => {
    const list = d.runtimes || [];
    const ollama = list.find(r => r.id === 'ollama');
    const wsLocalRun = document.getElementById('wsLocalRun');
    const wsLocalCount = document.getElementById('wsLocalCount');
    if (wsLocalCount) wsLocalCount.textContent = list.length;
    if (wsLocalRun) wsLocalRun.textContent = ollama && ollama.running ? '1' : '0';
    const st = document.getElementById('wsStatus');
    if (st && ollama && ollama.running && activeProvider) {
      st.textContent = 'Active · Local AI: Ollama running';
    }
    const wsRuntime = document.getElementById('wsRuntime');
    if (wsRuntime) {
      if (activeRuntime && ollama) {
        wsRuntime.textContent = activeRuntime.name + (ollama.running ? ' · running' : ' · not running');
      } else if (activeRuntime) {
        wsRuntime.textContent = activeRuntime.name;
      }
    }
  }).catch(() => {});

  let configured = 0;
  PROVIDERS.forEach(p => { if (Storage.getKey(p.id)) configured++; });
  const cc = document.getElementById('wsCloudCount'); if (cc) cc.textContent = PROVIDERS.length;
  const cf = document.getElementById('wsCloudConf'); if (cf) cf.textContent = configured;

  // Profiles (references only, no secrets)
  const wsProfiles = document.getElementById('wsProfiles');
  if (wsProfiles) {
    const profiles = Storage.listProfiles();
    wsProfiles.innerHTML = profiles.length
      ? profiles.map(p => {
          const full = Storage.getProfile(p.id) || {};
          const prov = full.provider ? (getProvider(full.provider)?.name || full.provider) : '—';
          return `<div class="profile-row"><div><b>${esc(p.name)}</b> <span class="muted">${esc(prov)} · ${esc(full.model || '?')}</span></div><button class="btn btn2" onclick="applyProfile('${p.id}')">Use</button></div>`;
        }).join('')
      : '<div class="muted">No profiles yet — save one from Settings.</div>';
  }

  // Recommended next action (honest, state-derived)
  const wsNext = document.getElementById('wsNext');
  if (wsNext) {
    let next = 'Configure a client to get started.';
    if (applied && applied.status === 'configured') next = 'Configuration active — explore models or connect a local runtime.';
    else if (activeId) next = 'Review and apply your configuration to finish setup.';
    wsNext.innerHTML = `<div class="ws-next-item">${esc(next)}</div>`;
  }

  updateShellStatus();
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

export function renderConfiguration() {
  updateCrumb('Configuration');
  const host = document.getElementById('page-configuration');
  if (!host) return;
  host.innerHTML = `
    <div class="page-head">
      <h1>Configuration</h1>
      <p>Your live <code>~/.claude/settings.json</code> — read, preview, back up, and safely apply from one place.</p>
    </div>
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

export async function renderLocalAI() {
  setCrumb('Local AI');
  const grid = document.getElementById('rtGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="muted">Detecting local runtimes…</div>';
  try {
    const res = await fetch('/api/local-runtimes');
    const { runtimes } = await res.json();
    grid.innerHTML = runtimes.map(rt => {
      const status = rt.planned ? 'planned' : (rt.running ? 'running' : (rt.detected ? 'detected' : 'offline'));
      const badge = rt.planned ? 'Coming soon' : (rt.running ? `${rt.modelCount} models` : 'Not running');
      return `<div class="panel rt-card ${rt.running ? 'live' : ''}">
        <div class="rt-top"><b>${esc(rt.name)}</b><span class="badge ${status}">${esc(badge)}</span></div>
        <div class="rt-sub">${esc(rt.note || '')}</div>
        ${rt.running && rt.models && rt.models.length ? `<div class="rt-models">${rt.models.slice(0, 6).map(m => `<span class="chipx">${esc(m)}</span>`).join('')}${rt.models.length > 6 ? `<span class="chipx">+${rt.models.length - 6}</span>` : ''}</div>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    grid.innerHTML = '<div class="muted">Failed to detect local runtimes.</div>';
  }
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
        <div class="client-logo" style="--cm:${esc(c.color || '#5b8def')}">${esc(c.monogram || c.name.slice(0, 2))}</div>
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
        <button class="btn btn2" onclick="deleteProfile('${p.id}')">Delete</button>
      </div></div>`;
  }).join('');
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
  Storage.saveProfile({ id, name, client, connectionType, provider, runtime, model });
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
    const list = PROVIDERS.filter(passes);
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

// ── Models explorer ──
export function renderModels() {
  updateCrumb('Models');
  const host = document.getElementById('modelList');
  if (!host) return;
  let q = '';

  const draw = () => {
    const ql = q.toLowerCase();
    const rows = [];
    PROVIDERS.forEach(p => {
      getModels(p.id).forEach(m => {
        if (ql && !((m.id || '').toLowerCase().includes(ql) || (m.name || '').toLowerCase().includes(ql))) return;
        const free = getFreeModels(p.id).some(x => x.id === m.id);
        rows.push({ p, m, free });
      });
    });
    if (!rows.length) { host.innerHTML = '<div class="muted">No models loaded yet. Visit Cloud Providers to fetch catalogues.</div>'; return; }
    const shown = rows.slice(0, 400);
    host.innerHTML = `<div class="model-rows">` + shown.map(r => `
      <div class="model-row">
        <div class="mr-id"><b class="mono">${esc(r.m.id)}</b><span class="mr-name">${esc(r.m.name || '')}</span></div>
        <div class="mr-prov">${esc(r.p.name)}</div>
        ${r.free ? '<span class="badge free">free</span>' : '<span class="badge paid">paid</span>'}
        <button class="btn btn2 mr-btn" onclick="useModel('${esc(r.p.id)}','${esc(r.m.id)}')">Use</button>
      </div>`).join('') + `</div>` +
      (rows.length > shown.length ? `<div class="muted">Showing first ${shown.length} of ${rows.length} matches.</div>` : '');
  };

  const search = document.getElementById('modelSearch');
  if (search) search.addEventListener('input', (e) => { q = e.target.value; draw(); });
  draw();
}

export function useModel(providerId, modelId) {
  Storage.setModel(providerId, modelId);
  workspace.activeProvider = providerId;
  workspace.activeModel = modelId;
  notify.toast(`Selected ${modelId} (${getProvider(providerId).name})`, 'success');
}

export function renderPlayground() {
  updateCrumb('Playground');
}

