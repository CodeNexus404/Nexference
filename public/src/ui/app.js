import { workspace, getFreeModels, getModels, getAllModels } from '../core/state.js';
import { Storage } from '../core/storage.js';
import { notify } from '../core/notifications.js';
import { PROVIDERS, getProvider } from '../providers/registry.js';
import { configEngine } from '../config/engine.js';
import { CopyableRuntime, LocalSettingsRuntime } from '../config/runtimeAdapter.js';
import { esc, norm } from '../components/util.js';
import { createGatewayCard } from '../components/gatewayCard.js';

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

export function highlightJSON(json) {
  return json
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = 'b';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) cls = 'k';
        else cls = 's';
      } else if (/true|false/.test(match)) cls = 'b';
      else if (/null/.test(match)) cls = 'b';
      else if (!isNaN(match)) cls = 's';
      return `<span class="${cls}">${match}</span>`;
    });
}

export async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const { config, path } = await res.json();
    if (path) document.getElementById('pathText').textContent = path;
    if (config) {
      const jsonStr = JSON.stringify(config, null, 2);
      document.getElementById('jsonOut').innerHTML = highlightJSON(jsonStr);

      // Detect which provider this config points at → persistent "active" glow
      const base = config.env?.ANTHROPIC_BASE_URL || '';
      const match = PROVIDERS.find(p => norm(p.baseUrl) === norm(base));
      workspace.appliedProviderId = match ? match.id : null;
      const liveText = document.getElementById('liveText');
      if (liveText) {
        if (match) {
          liveText.textContent = `${match.name} active`;
          document.getElementById('liveChip').classList.add('live');
        } else if (base) {
          liveText.textContent = `Custom: ${base}`;
          document.getElementById('liveChip').classList.add('live');
        } else {
          liveText.textContent = 'No gateway selected';
        }
      }
    } else {
      const liveText = document.getElementById('liveText');
      if (liveText) liveText.textContent = 'No gateway selected';
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
