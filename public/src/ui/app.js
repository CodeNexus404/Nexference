import { workspace, getFreeModels, getModels, getAllModels, getModelSource, isFetching, fetchMonitorInsight, refreshMonitoring, fetchBenchmarkProfiles, fetchBenchmarks, runBenchmark } from '../core/state.js';
import { Storage } from '../core/storage.js';
import { notify } from '../core/notifications.js';
import { theme } from '../core/theme.js';
import { router } from '../core/router.js';
import { PROVIDERS, getProvider, providerTags, allProviders, setProviderExtras } from '../providers/registry.js';
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
import { adoptedToCustomShape } from '../providers/adoptedProvider.js';
import { customProviderCard, initCustomProviderActions, openAddCustomProviderWizard, refreshDynamicIndex } from './customProvider.js';
import { integrationCoverageHTML } from './providerIntegrations.js';
import { getExecutionCoverage } from '../providers/integrationService.js';
import { openProviderConfig } from '../components/providerConfig.js';
import { toggleCommandPalette } from '../components/commandPalette.js';
import { openModal, confirmModal } from '../components/modal.js';
import { credentialsStore } from '../config/credentialsStore.js';
import { recordActivity, getActivities } from '../core/activityStore.js';
import { openWorkflow, hasUsableDraft, discardDraft } from '../config/workflow.js';
import { renderModelLibrary } from '../components/modelLibrary.js';
import { renderFallbackPanel, refreshFallbackChip } from './fallbackUI.js';
import { modelService } from '../models/modelService.js';
import { renderModelPicker } from '../components/modelPicker.js';
import { playgroundService } from '../playground/playgroundService.js';
import { historyStore } from '../playground/historyStore.js';
import { miniMarkdown } from '../playground/markdown.js';

// Robust free/paid classification for model lists. Pricing may be numeric or a
// numeric string ("0") depending on the discovery source (OpenRouter/HF/LiteLLM),
// and some providers expose accessType instead of prices. A free-tier marker in
// the id/name (free/claude-opus-4.6, free:gpt-4o, free-gpt4, gpt-4o:free, "Free
// GPT-4") also counts — gateways like APInex / Inference Dahl flag free models
// by name, with no pricing.
const FREE_NAME_RE = /(^|[:._\-\s/])free(?=$|[:._\-\s/])/i;
function isFreeModelEntry(m) {
  const p = m?.pricing;
  const isZero = (v) => v !== null && v !== undefined && v !== '' && Number(v) === 0;
  if (isZero(p?.input) || isZero(p?.output)) return true;
  if (m?.accessType === 'free') return true;
  if (typeof m?.id === 'string' && FREE_NAME_RE.test(m.id)) return true;
  return typeof m?.name === 'string' && FREE_NAME_RE.test(m.name);
}


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
    // The server's cached-models endpoint only covers curated + dynamic
    // providers — NOT user-created custom (cst:) providers. So we must MERGE
    // into the existing liveModels rather than replace the whole object,
    // otherwise custom-provider models (already fetched into liveModels) get
    // wiped away the next time this runs, e.g. blanking the custom provider's
    // model picker the instant the user toggles free/paid.
    const server = data.providers || {};
    const merged = { ...(workspace.liveModels || {}) };
    for (const [k, v] of Object.entries(server)) {
      // Custom (cst:) providers: the server seeds these from the stored
      // record. Never clobber a client-fetched (fresher or user-triggered)
      // entry — only seed when the client has nothing yet, so the card badge
      // stays consistent with the last refresh instead of flashing "0 free".
      if (k.startsWith('cst:') && merged[k]?.models?.length) continue;
      merged[k] = v;
    }
    workspace.liveModels = merged;
    return true;
  } catch (err) {
    console.warn('Failed to fetch cached models:', err);
    return false;
  }
}

// Refresh the non-curated provider index (adopted dyn:* + custom cst:*).
// Registers UI-safe descriptors so `getProvider()`/model pickers resolve them
// exactly like curated providers. Called at boot and every time the playground
// mounts, so the provider dropdown always reflects dashboard changes
// (custom-provider add/edit/delete, ecosystem adoptions).
export async function refreshProviderIndex() {
  try {
    const [dyn, cst] = await Promise.all([
      fetch('/api/providers?origin=ecosystem').then((r) => r.json()).catch(() => ({ providers: [] })),
      fetch('/api/custom-providers').then((r) => r.json()).catch(() => ({ providers: [] })),
    ]);
    const dynamic = Array.isArray(dyn.providers) ? dyn.providers : [];
    const custom = Array.isArray(cst.providers) ? cst.providers : [];
    workspace.dynamicProviders = dynamic;
    workspace.customProviders = custom;
    setProviderExtras(allProviders({ dynamic, custom }));
    return true;
  } catch (err) {
    console.warn('Failed to refresh provider index:', err);
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
  const old = document.querySelector(`.card[data-id="${providerId}"], .cp-card[data-id="${providerId}"], .custom-provider-card[data-id="${providerId}"]`);
  if (!old) return;
  let provider = getProvider(providerId);
  if (!provider && providerId.startsWith('cst:')) {
    // Custom provider — build the shape createGatewayCard expects
    provider = {
      id: providerId,
      name: providerId,
      sub: 'Custom',
      accent: '#6366f1',
      format: 'openai',
      claudeCode: false,
      hasCustomUrl: true,
      publicModels: false,
      baseUrl: '',
      signup: null,
      desc: 'Custom provider',
    };
    try {
      const cached = workspace.liveModels[providerId];
      if (cached?.source?.fetchedAt) provider.sub = 'custom provider';
    } catch { /* ignore */ }
  }
  if (!provider) return;
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
      if (/unauthorized client detected|unauthorized_client_error|Missing or malformed API key|authentication_error/i.test(reason)) {
        notify.log(`Models · ${provider.name}: API requires approved client/key (works in Claude Code). Using fallback list.`, 't-ok');
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

// Silent model fetch for custom providers (official API with transient key →
// keyless pricing API → website scrape)
export async function fetchCustomProviderModelsSilent(providerId) {
  if (workspace._fetching.has(providerId)) return;
  workspace._fetching.add(providerId);
  try {
    const key = Storage.getKey(providerId) || '';
    const qs = key ? `?key=${encodeURIComponent(key)}` : '';
    const result = await fetch(`/api/custom-providers/${encodeURIComponent(providerId)}/fetch-models${qs}`).then(r => r.json()).catch(() => ({ ok: false, models: [] }));
    if (result?.ok && result.models?.length) {
      const fetchedModels = result.models.map(m => ({ ...m, source: 'fetched' }));
      workspace.liveModels[providerId] = {
        models: fetchedModels,
        freeModels: fetchedModels.filter(isFreeModelEntry),
        source: { type: 'custom-api', fetchedAt: new Date().toISOString() },
      };
    }
  } catch { /* silent */ } finally { workspace._fetching.delete(providerId); }
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

  const isCustomOld = providerId === 'custom';
  const isCustomNew = providerId.startsWith('cst:');
  const urlToTest = isCustomOld
    ? document.querySelector(`.base-url-${providerId}`).value
    : baseUrl;

  const format = isCustomOld ? workspace.customFormat : isCustomNew ? (provider?.format || 'openai') : (provider?.format || 'anthropic');
  const modelEl = document.querySelector(`.model-${providerId}`);
  const model = modelEl?.value || '';
  const name = provider?.name || providerId;

  const btn = document.querySelector(`.test-btn-${providerId}`) || document.querySelector('[data-act="test"]');
  if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (btn) btn.textContent = `Testing… ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  }, 100);
  const finish = (label) => {
    clearInterval(timer);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('spinning');
      btn.textContent = `${label} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`;
    }
  };

  try {
    const qs = new URLSearchParams({ url: urlToTest, key: apiKey || '', format });
    if (model) qs.set('model', model);
    const res = await fetch(`/api/test?${qs.toString()}`);
    const result = await res.json();

    if (result.status && result.status >= 200 && result.status < 300) {
      notify.toast('Connection successful!', 'success');
      notify.log(`Test OK · ${name}`, 't-ok');
      finish('Connection OK');
    } else {
      const raw = (result.body || result.error || 'Unknown error').toString();
      if (/unauthorized client detected|unauthorized_client_error|Missing or malformed API key|authentication_error|wrong_api_key/i.test(raw)) {
        notify.toast(`${name}: API requires valid key — check the key format`, 'info');
        notify.log(`Test note · ${name}: auth rejected (${raw.slice(0, 80)})`, 't-ok');
      } else if (/payment_required|payment required|402|billing|quota/i.test(raw)) {
        notify.toast(`${name}: key is valid but your account needs an active payment method to run models`, 'warning');
        notify.log(`Test note · ${name}: payment/billing required (${raw.slice(0, 90)})`, 't-ok');
      } else if (/model_not_found|model not found|does not exist|no access|forbidden|not.*access/i.test(raw)) {
        notify.toast(`${name}: model “${model || 'selected'}” isn't available on your account — refreshing the model list with your key`, 'warning');
        notify.log(`Test note · ${name}: model inaccessible (${raw.slice(0, 90)}), re-listing with key`, 't-ok');
        // The listed public models may differ from what the account can actually
        // use (e.g. Cerebras). Re-fetch the real list with the stored key.
        if (window.refreshProviderModels && !providerId.startsWith('cst:') && providerId !== 'custom') {
          try { refreshProviderModels(providerId); } catch { /* best-effort */ }
        }
      } else {
        const msg = raw.slice(0, 160);
        notify.toast(`Failed: ${msg}`, 'error');
        notify.log(`Test failed · ${name}: ${msg}`, 't-err');
      }
      finish('Failed');
    }
  } catch (error) {
    notify.toast(`Error: ${error.message}`, 'error');
    notify.log(`Test error · ${name}: ${error.message}`, 't-err');
    finish('Error');
  }
}

export async function handleApply(event, providerId) {
  event.preventDefault();

  let provider = getProvider(providerId);
  const isCustomNew = providerId.startsWith('cst:');
  if (!provider && isCustomNew) {
    try {
      const rec = await fetch(`/api/custom-providers/${encodeURIComponent(providerId)}`).then(r => r.json()).catch(() => null);
      const cp = rec?.provider;
      provider = { id: providerId, name: cp?.identity?.name || providerId, format: cp?.api?.format || 'openai', baseUrl: cp?.api?.baseUrl || '' };
    } catch {
      provider = { id: providerId, name: providerId, format: 'openai', baseUrl: '' };
    }
  }
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

  let baseUrl = provider.baseUrl || '';
  if (providerId === 'custom') {
    baseUrl = document.querySelector(`.base-url-${providerId}`).value;
    if (!baseUrl) {
      notify.toast('Please enter a base URL', 'error');
      return;
    }
  }

  const newConfig = configEngine.buildClaudeSettings(provider, baseUrl, model, apiKey);

  if (newConfig.env.OPENAI_BASE_URL || newConfig.env.GOOGLE_API_KEY) {
    CopyableRuntime.show(newConfig, provider.name);
    notify.log(`Prepared config · ${provider.name} · model ${model}`, 't-ok');
    return;
  }

  try {
    const ok = await LocalSettingsRuntime.write(newConfig);
    if (ok) {
      workspace.applied = {
        client: 'claude-code', connectionType: 'cloud', provider: providerId,
        runtime: null, model, appliedAt: new Date().toISOString(), status: 'configured',
      };
      workspace.appliedProviderId = providerId;
      workspace.activeProvider = providerId;
      workspace.activeModel = model;
      workspace.activeClient = 'claude-code';
      Storage.setApplied(workspace.applied);
      notify.toast(`Applied ${provider.name} to Claude Code!`, 'success');
      notify.log(`Applied ${provider.name} · model ${model}`, 't-ok');
      await loadConfig();
      renderGateways();
      syncAppliedHighlights();
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
  // Auto-fetch this card's models once a key is entered/changed. Re-fetching
  // with the real key lets the server pull genuine pricing for providers
  // (mistral/gemini/groq/nvidia/huggingface) whose keyless list shows no
  // pricing, so the paid/free tags reflect the true catalogue.
  if (val && provider && !provider.hasCustomUrl) {
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
  resetTestBtn(`${id}`);
}

export function setModel(id, val) {
  Storage.setModel(id, val);
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) {
    const mnVal = card.querySelector('.mn-val');
    if (mnVal) { mnVal.textContent = val || '—'; mnVal.title = val; }
  }
  resetTestBtn(`${id}`);
}

// A change of model invalidates a previous connection-test result — reset the
// test button label back to the base text (not while a test is in flight).
function resetTestBtn(id) {
  const btn = document.querySelector(`.test-btn-${id}`);
  if (!btn || btn.disabled) return;
  const prev = btn.textContent;
  if (prev.startsWith('Connection OK') || prev.startsWith('Failed (') || prev.startsWith('Error (')) {
    btn.textContent = 'Test Connection';
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

export async function renderGateways() {
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

  // Append custom providers with baseUrl as gateway cards
  try {
    const custRes = await fetch('/api/custom-providers').then(r => r.json()).catch(() => ({ providers: [] }));
    const customProviders = (custRes.providers || []).filter(p => p.lifecycle === 'active' && p.baseUrl);
    customProviders.forEach((cp, idx) => {
      const customCard = {
        id: cp.id,
        name: cp.name,
        sub: cp.baseUrl ? new URL(cp.baseUrl).hostname : 'Custom provider',
        accent: '#6366f1',
        format: cp.format || 'openai',
        claudeCode: cp.format === 'anthropic',
        hasCustomUrl: true,
        publicModels: false,
        baseUrl: cp.baseUrl,
        signup: null,
        desc: cp.desc || 'Custom provider',
        website: cp.website || null,
      };

      const key = Storage.getKey(cp.id) || '';
      const freeModels = getFreeModels(cp.id);

      if (workspace.filterText && !cp.name.toLowerCase().includes(workspace.filterText)) return;

      gatewayCount++;
      freeModelCount += freeModels.length;
      if (key) configuredCount++;

      const card = createGatewayCard(customCard);
      card.style.setProperty('--i', PROVIDERS.length + idx);
      card.classList.add('custom-gateway-card');
      if (workspace.selectedProviderId === cp.id) card.classList.add('on');
      if (workspace.appliedProviderId === cp.id) card.classList.add('applied');
      grid.appendChild(card);

      // Auto-fetch models for custom providers with baseUrl
      if (freeModels.length === 0) {
        fetchCustomProviderModelsSilent(cp.id);
      }
    });
  } catch { /* ignore */ }

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
    // Detect which provider this config points at → persistent "active" state.
    // Curated match first; custom providers are user-defined, so also resolve
    // their base URL against the config. buildConfig writes ANTHROPIC_BASE_URL
    // with a trailing `/v1/` stripped, so apply the same transform when
    // comparing (covers every custom card, present and future).
    const base = config?.env?.ANTHROPIC_BASE_URL || '';
    const normBase = norm(base);
    let match = PROVIDERS.find(p => norm(p.baseUrl) === normBase);
    if (!match && base) {
      // The generator writes ANTHROPIC_BASE_URL with a trailing `/v1/` or
      // `/v1beta/` stripped (see ccBase in config/clientAdapter.js), so a card
      // whose baseUrl keeps that segment never matched by strict equality.
      // Retry with the same transform on both sides — the exact match above
      // still wins first, so unchanged configs behave exactly as before.
      const cfgForm = (u) => (u || '').replace(/\/v1\/?$/, '/').replace(/\/v1beta\/?$/, '/');
      match = PROVIDERS.find(p => norm(cfgForm(p.baseUrl)) === norm(cfgForm(base))) || null;
    }
    if (!match && base) {
      try {
        const custRes = await fetch('/api/custom-providers').then(r => r.json()).catch(() => ({ providers: [] }));
        match = (custRes.providers || []).find(p => norm(cfgForm(p.baseUrl)) === normBase || norm(p.baseUrl) === normBase) || null;
      } catch {}
    }
    match = match || null;
    // The base-URL re-match above is authoritative (it mirrors the live
    // settings.json). But some valid configs can't round-trip through the URL
    // normalizer (bare-host custom endpoints, hand-normalized URLs, …), while
    // the persisted "applied" record already remembers which card last wrote
    // it. Prefer the verified match; if a base URL IS set but no card matched,
    // keep the persisted card so the glow survives refresh/restart on every
    // platform (macOS and Windows alike). If settings.json has no base URL at
    // all there is no active configuration — clear the glow.
    workspace.appliedProviderId = match ? match.id : (base ? (workspace.appliedProviderId || null) : null);
    // Remember the live gateway (if any) so the shell status can stay honest
    // even when the persisted "applied" record is missing or stale.
    workspace.liveConfigBase = base || null;
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

function getGreeting(hour) {
  if (hour < 5) return 'Good night';
  if (hour < 8) return 'Good early morning';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

export function renderWorkspace() {
  updateCrumb('Workspace');
  const section = document.getElementById('page-workspace');
  if (!section) return;

  const now = new Date();
  const hour = now.getHours();
  const greet = getGreeting(hour);

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
`;

  fetchEnvironment();
  updateShellStatus();
  fetchProviderIntel().then(() => fillWsProviderIntel()).catch(() => {});
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

  // Inline SVG icon set (consistent, currentColor-driven)
  const ICON = {
    client: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M4 4h16v16H4z'/><path d='m8 10 3 2-3 2'/><path d='M13 14h3'/></svg>",
    provider: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M17.5 18a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.4A4 4 0 0 0 6 18z'/></svg>",
    runtime: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><rect x='7' y='7' width='10' height='10' rx='1.5'/><path d='M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3'/></svg>",
    model: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M12 3 3 8l9 5 9-5z'/><path d='M3 13l9 5 9-5'/></svg>",
    source: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M9 15l6-6'/><path d='M11 6.5 12.5 5a3.5 3.5 0 0 1 5 5L16 11.5'/><path d='M13 17.5 11.5 19a3.5 3.5 0 0 1-5-5L8 12.5'/></svg>",
    config: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M4 6h11M19 6h1M4 18h1M9 18h11'/><circle cx='17' cy='6' r='2'/><circle cx='7' cy='18' r='2'/></svg>",
    play: "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M7 5l12 7-12 7z'/></svg>",
  };

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

// ── Status dot ──
  const dotMap = {
    healthy: ['dev-ok', 'Connected'],
    attention: ['dev-warn', 'Attention'],
    'config-required': ['dev-warn', 'Configuration needed'],
    partial: ['dev-warn', 'Partial'],
    offline: ['dev-err', 'Offline'],
    critical: ['dev-err', 'Error'],
    unknown: ['dev-idle', 'Detecting…'],
  };
  const [dotCls, dotLabel] = dotMap[healthStatus] || dotMap.unknown;
  const loadedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  body.innerHTML = `
    <div class="ws-hero">
      <div class="ws-kpi reveal-f" style="--d:.04s"><span class="kpi-ico">${ICON.client}</span><b>${installedClients.length}</b><span>Clients</span><small>installed &amp; detected</small></div>
      <div class="ws-kpi reveal-f" style="--d:.08s"><span class="kpi-ico">${ICON.provider}</span><b>${providersConfigured}</b><span>Providers</span><small>API keys configured</small></div>
      <div class="ws-kpi reveal-f" style="--d:.12s"><span class="kpi-ico">${ICON.runtime}</span><b>${runningRt.length}</b><span>Runtimes</span><small>running locally</small></div>
      <div class="ws-kpi reveal-f" style="--d:.16s"><span class="kpi-ico">${ICON.model}</span><b>${models.length}</b><span>Models</span><small>available on device</small></div>
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

    <div class="panel ws-quick reveal" style="--d:.07s">
      <span class="ws-eyebrow">Quick Actions</span>
      <div class="qa-grid">
        <button class="qa-card" onclick="openWorkflow()">
          <span class="qa-ico">${ICON.config}</span>
          <span class="qa-text"><b>Configure Client</b><small>Open the guided configuration workspace</small></span>
        </button>
        <button class="qa-card" onclick="navigate('models')">
          <span class="qa-ico">${ICON.model}</span>
          <span class="qa-text"><b>Explore Models</b><small>Browse the cloud and local catalogue</small></span>
        </button>
        <button class="qa-card" onclick="navigate('playground')">
          <span class="qa-ico">${ICON.play}</span>
          <span class="qa-text"><b>Test Playground</b><small>Run a model and inspect metrics</small></span>
        </button>
        <button class="qa-card" onclick="navigate('localai')">
          <span class="qa-ico">${ICON.runtime}</span>
          <span class="qa-text"><b>Local Runtime</b><small>Manage Ollama / LM Studio</small></span>
        </button>
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

    <div class="panel ws-config ws-full reveal" style="--d:.10s">
      <div class="ws-config-head">
        <span class="ws-eyebrow">Current Workspace</span>
        <span class="dev-status"><span class="dev-dot ${dotCls}"></span><span>${esc(dotLabel)}</span></span>
      </div>
      <div class="ws-chain">
        <div class="chain-node clickable" role="button" tabindex="0" title="Open Clients" aria-label="Open Clients page" onclick="navigate('clients')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"><span class="chain-ico">${ICON.client}</span><span class="chain-label">Client</span><b>${esc(client.name)}</b></div>
        <span class="chain-arrow" aria-hidden="true">→</span>
        <div class="chain-node clickable" role="button" tabindex="0" title="Open Configuration" aria-label="Open Configuration" onclick="navigate('configuration')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"><span class="chain-ico">${ICON.source}</span><span class="chain-label">AI Source</span><b>${esc(connectionLabel(applied ? connType : cfgSource))}</b></div>
        <span class="chain-arrow" aria-hidden="true">→</span>
        <div class="chain-node clickable" role="button" tabindex="0" title="Open ${esc(activeProvider ? 'Providers' : (activeRuntime ? 'Local AI' : 'Providers'))}" aria-label="Open ${esc(activeProvider ? 'Providers' : (activeRuntime ? 'Local AI' : 'Providers'))}" onclick="navigate('${activeProvider ? 'cloud-providers' : (activeRuntime ? 'localai' : 'cloud-providers')}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"><span class="chain-ico">${activeProvider ? ICON.provider : ICON.runtime}</span><span class="chain-label">Provider / Runtime</span><b>${esc(activeProvider ? activeProvider.name : (activeRuntime ? activeRuntime.name : (cfgSource === 'cloud' ? 'detected' : '—')))}</b></div>
        <span class="chain-arrow" aria-hidden="true">→</span>
        <div class="chain-node clickable" role="button" tabindex="0" title="Open Model Library" aria-label="Open Model Library" onclick="navigate('models')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"><span class="chain-ico">${ICON.model}</span><span class="chain-label">Model</span><b class="mono">${esc(cfgModel || '—')}</b></div>
      </div>
      <div class="ws-config-path muted">Config: <span class="mono">${esc(client.configPath || '~/.claude/settings.json')}</span></div>
      <div class="ws-config-asof">Loaded ${esc(loadedAt)}</div>
      <div class="ws-actions-row">
        <button class="btn btn-go" onclick="openWorkflow()">Configure…</button>
        <button class="btn btn2" onclick="navigate('configuration')">Configuration</button>
      </div>
    </div>

    <div class="panel ws-models reveal" id="wsModelIntel" style="--d:.25s">
      <h3>Model Intelligence</h3>
      <div class="muted">Loading model catalogue…</div>
    </div>

    <div class="panel ws-summary reveal" id="wsProviderIntel" style="--d:.27s">
      <h3>Provider Intelligence</h3>
      <div class="muted">Loading provider discovery…</div>
    </div>

    <div class="panel ws-summary reveal" id="wsIntegration" style="--d:.29s">
      <h3>Provider Integration</h3>
      <div class="muted">Loading integration coverage…</div>
    </div>

    <div class="panel ws-summary reveal" id="wsExecGateway" style="--d:.295s">
      <h3>Execution Gateway</h3>
      <div class="muted">Loading execution capabilities…</div>
    </div>

    <div class="panel ws-profiles ws-full reveal" style="--d:.30s">
      <h3>Profiles</h3>
      <p class="muted">Saved configuration selections — never store secrets.</p>
      <div id="wsProfiles" class="ws-profile-list"></div>
      <button class="btn btn2" onclick="navigate('settings')">Manage profiles</button>
    </div>

`;

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
  fillWsProviderIntel();
  fillWsIntegration();
  fillWsExecGateway();
}

function fillWsExecGateway() {
  const host = document.getElementById('wsExecGateway');
  if (!host) return;
  getExecutionCoverage().then((cov) => {
    if (!cov) return;
    host.innerHTML = `
      <h3>Execution Gateway</h3>
      <div class="ic-dq-grid">
        <div class="ic-dq-item"><span class="ic-dq-val"><span class="status-dot dot-green"></span> ${cov.executable || 0}</span><span class="ic-dq-label muted">Executable</span></div>
        <div class="ic-dq-item"><span class="ic-dq-val"><span class="status-dot dot-yellow"></span> ${cov.needsCredentials || 0}</span><span class="ic-dq-label muted">Needs Setup</span></div>
        <div class="ic-dq-item"><span class="ic-dq-val"><span class="status-dot dot-gray"></span> ${cov.metadataOnly || 0}</span><span class="ic-dq-label muted">Metadata Only</span></div>
        <div class="ic-dq-item"><span class="ic-dq-val"><span class="status-dot dot-blue"></span> ${cov.localExecutable || 0}</span><span class="ic-dq-label muted">Local Runtimes</span></div>
      </div>
      <div class="muted">${cov.executable} cloud + ${cov.localExecutable} local sources ready. ${cov.needsCredentials} need credentials.</div>
      <div class="ws-actions-row" style="margin-top:8px">
        <button class="btn btn2" onclick="navigate('playground')">Open Playground</button>
      </div>
    `;
  }).catch(() => {});
}

function fillWsIntegration() {
  const host = document.getElementById('wsIntegration');
  if (!host) return;
  // Inject coverage inside the aligned grid panel (keeping the panel card
  // frame) rather than replacing it with the standalone ic-section wrapper.
  integrationCoverageHTML().then((html) => {
    if (!html) return;
    const inner = html
      .replace(/^<section class="ic-section">\s*/, '')
      .replace(/<h2 class="ic-h2">[\s\S]*?<\/h2>\s*/, '')
      .replace(/<\/section>\s*$/, '');
    host.innerHTML = `<h3>Provider Integration</h3>${inner}`;
  }).catch(() => {});
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
        <div class="panel-h"><h3>Current Configuration</h3><span id="cfgStateBadge" class="badge"></span><span id="cfgFallbackChip" class="badge fb-chip" hidden></span></div>
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
  refreshFallbackChip();
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
  if (c.apiKeyHelper) {
    const m = /^(echo\s+)('?)(.*)\2$/.exec(c.apiKeyHelper);
    c.apiKeyHelper = m
      ? `${m[1]}${m[2]}•••••••• (hidden)${m[2]}`
      : '•••••••• (hidden)';
  }
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
let recPollTimer = null;

// Live-refresh bridge: every saved benchmark run dispatches 'nx-benchmark'
// (success or failure) so the Local AI results section repaints immediately
// without a page reload. renderLocalAI registers the reload callback below.
let _benchReload = null;
window.addEventListener('nx-benchmark', () => { if (_benchReload) _benchReload(); });

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
              if (m.ttftMs != null) rows.push(['Time to first token', fmt(m.ttftMs)]);
              if (m.inputTokens != null) rows.push(['Input tokens', m.inputTokens]);
              if (m.outputTokens != null) rows.push(['Output tokens', m.outputTokens]);
              if (m.tokensPerSecond != null) rows.push(['Speed', m.tokensPerSecond.toFixed(1) + ' tok/s']);
              resEl.innerHTML = `<div class="pg-metrics-grid">${rows.map((rr) => `<div class="pg-metric"><span>${esc(rr[0])}</span><b>${esc(String(rr[1]))}</b></div>`).join('')}</div>`;
              runBtn.disabled = false; runBtn.textContent = 'Run benchmark';
              // Persist the real measured result so it appears in the Local AI
              // "Benchmark Results" section. Never store anything fabricated.
              try {
                playgroundService.saveBenchmark({
                  runtimeId: rt.id, runtimeName: rt.name, model,
                  metrics: {
                    totalDurationMs: m.totalDurationMs ?? null,
                    ttftMs: m.ttftMs ?? null,
                    tokensPerSecond: m.tokensPerSecond ?? null,
                    inputTokens: m.inputTokens ?? null,
                    outputTokens: m.outputTokens ?? null,
                  },
                  createdAt: new Date().toISOString(),
                }).then(() => {
                  const saved = document.createElement('div');
                  saved.className = 'bench-saved';
                  saved.textContent = '✓ Saved to Benchmark Results (Local AI)';
                  resEl.appendChild(saved);
                  window.dispatchEvent(new CustomEvent('nx-benchmark'));
                }).catch(() => {});
              } catch { /* non-fatal */ }
            },
            onError: (validation, execFailed, msg) => {
              const reason = (validation && (validation.reasons || []).join(' ')) || msg || 'Benchmark failed';
              resEl.innerHTML = `<div class="bench-result-card bench-result-err">
                <div class="bench-result-err-ico">!</div>
                <div class="bench-result-err-body">
                  <b>Benchmark failed</b>
                  <span>${esc(reason)}</span>
                </div>
              </div>`;
              runBtn.disabled = false; runBtn.textContent = 'Run benchmark';
              // Persist the failed run (real, masked) so the Local AI results
              // graph can show it honestly instead of dropping it.
              try {
                playgroundService.saveBenchmark({
                  runtimeId: rt.id, runtimeName: rt.name, model,
                  success: false, error: reason, metrics: null,
                  createdAt: new Date().toISOString(),
                }).then(() => window.dispatchEvent(new CustomEvent('nx-benchmark'))).catch(() => {});
              } catch { /* non-fatal */ }
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
  const recModelsById = new Map();

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
      <div class="lai-runs-head">
        <h3>Recommended local models</h3>
        <span class="muted" id="recDevice">—</span>
      </div>
      <section class="panel lai-rec">
        <p class="muted">Suggested for your device — the star rating is an estimate from your RAM and GPU. Download from the provider to run locally, or remove models already on this device.</p>
        <div id="laiRecList" class="rec-grid"><div class="muted">Loading recommendations…</div></div>
      </section>
      <section class="panel lai-bench" id="laiBench">
        <div class="lai-bench-head">
          <div>
            <span class="ws-eyebrow">Benchmark Results</span>
            <p class="muted">Real throughput measured from benchmark runs on local models — never estimated.</p>
          </div>
          <button class="btn btn2 sm" id="benchClear" type="button">Clear</button>
        </div>
        <div id="benchCharts"><div class="muted">No benchmarks yet — run one from a runtime's Benchmark button.</div></div>
      </section>
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
        // Only show installed-model chips for a RUNNING runtime — before Start
        // the list is just what's on disk, which reads like stale/leaked data.
        const modelsHTML = running && rt.models && rt.models.length
          ? `<div class="rt-models">${rt.models.slice(0, 8).map(m => `<span class="chipx">${esc(m)}</span>`).join('')}${rt.models.length > 8 ? `<span class="chipx">+${rt.models.length - 8}</span>` : ''}</div>`
          : '';
        return `<div class="panel rt-card ${running ? 'live' : ''} ${status}">
          <div class="rt-card-top">
            <div class="rt-logo ${rt.logo ? 'has-img' : ''} rt-details" role="button" tabindex="0" data-details="${esc(rt.id)}" title="Runtime details" aria-label="Runtime details" style="--rt:hsl(${rtHue(rt.id)} 68% 58%)">${logoHTML}<span class="rt-info-i" aria-hidden="true">i</span></div>
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
      rtList.querySelectorAll('.rt-details').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const id = btn.dataset.details;
          const rt = runtimes.find((r) => r.id === id);
          if (rt) openRuntimeDetailsModal(rt);
        });
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
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

  async function loadBenchmarksUI() {
    const host = grid.querySelector('#benchCharts');
    if (!host) return;
    try {
      const benchmarks = await playgroundService.listBenchmarks();
      if (!benchmarks.length) { host.innerHTML = '<div class="muted">No benchmarks yet — run one from a runtime’s Benchmark button.</div>'; return; }
      const byModel = new Map();
      for (const b of benchmarks) {
        const key = b.model || 'unknown';
        if (!byModel.has(key)) byModel.set(key, { model: key, runtime: b.runtimeName || '', n: 0, okN: 0, spd: 0, ttft: 0, failN: 0, lastErr: null });
        const g = byModel.get(key);
        g.n++;
        const ok = b.success !== false && b.metrics?.tokensPerSecond != null;
        if (ok) { g.okN++; g.spd += b.metrics.tokensPerSecond; g.ttft += (b.metrics.ttftMs || 0); }
        else { g.failN++; if (b.error) g.lastErr = b.error; }
      }
      const rows = [...byModel.values()].map((g) => ({
        model: g.model, runtime: g.runtime, n: g.n, okN: g.okN, failN: g.failN, lastErr: g.lastErr,
        spd: g.okN ? +(g.spd / g.okN).toFixed(1) : null,
        ttft: g.okN ? Math.round(g.ttft / g.okN) : null,
      })).sort((a, b) => (b.spd || 0) - (a.spd || 0));
      const successRows = rows.filter((r) => r.spd != null);
      let html = '';
      if (successRows.length) {
        html += renderLineChart(successRows);
      } else {
        html += '<div class="muted">No successful benchmark metrics recorded yet.</div>';
      }
      const failedRows = rows.filter((r) => r.failN > 0);
      if (failedRows.length) {
        html += `<div class="bench-chart bench-failed">
          <div class="bench-chart-h">Failed runs</div>
          <div class="bar-chart">${failedRows.map((r) => `
            <div class="bar-row bar-row-err" title="${esc(r.lastErr || 'Failed')}">
              <span class="bar-label" title="${esc(r.model)}">${esc(r.model)}</span>
              <span class="bar-track"><span class="bar-fill bar-fill-err" style="width:16%"></span></span>
              <span class="bar-val err-val">${esc(r.failN + ' failed')}</span>
            </div>`).join('')}</div>
        </div>`;
      }
      host.innerHTML = html;
    } catch {
      host.innerHTML = '<div class="muted">Could not load benchmark results.</div>';
    }
  }

  function starsHTML(n) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += `<span class="rec-star ${i <= n ? 'on' : 'off'}">${i <= n ? '★' : '☆'}</span>`;
    return s;
  }

  async function loadRecommendations() {
    const host = grid.querySelector('#laiRecList');
    const devEl = grid.querySelector('#recDevice');
    if (!host) return;
    try {
      const data = await (await fetch('/api/local/models/recommendations')).json();
      const dev = data.device || {};
      if (devEl) devEl.textContent = `${dev.ramGB != null ? dev.ramGB + ' GB RAM' : '—'}${dev.gpuName ? ' · ' + dev.gpuName : ''} · ${dev.ramTier || ''} tier`;
      const models = data.models || [];
      if (!models.length) { host.innerHTML = '<div class="muted">No recommendations available.</div>'; return; }
      models.forEach((m) => recModelsById.set(m.runtime + '::' + m.id, m));
      host.innerHTML = models.map((m) => {
        const tags = (m.tags || []).map((t) => `<span class="chipx">${esc(t)}</span>`).join('');
        const actions = (m.installed
          ? `<span class="rec-installed">Installed ✓</span><button class="btn btn2 danger" type="button" onclick="deleteLocalModel('${esc(m.runtime)}','${esc(m.installedName || m.id)}')">Delete</button>`
          : `<button class="btn btn-go btn2" type="button" onclick="downloadLocalModel('${esc(m.runtime)}','${esc(m.id)}','${esc(m.downloadUrl)}')">Download</button>`)
          + `<button class="btn btn2" type="button" onclick="openLocalModelDetails('${esc(m.runtime)}','${esc(m.id)}')">Details</button>`;
        return `<div class="rec-card ${m.installed ? 'is-installed' : ''} ${m.rating >= 4 ? 'is-top' : ''}">
          <div class="rec-head">
            <div class="rec-title"><b><a href="${esc(m.downloadUrl)}" target="_blank" rel="noopener" title="Open ${esc(m.name)} on the provider site">${esc(m.name)}</a></b><span class="badge ${m.runtime}">${esc(m.runtime)}</span></div>
            <div class="rec-stars" title="${esc(m.reason || '')}">${starsHTML(m.rating)}<span class="rec-rating">${m.rating}.0</span></div>
          </div>
          <div class="rec-meta"><span>${esc(m.params || '—')}</span><span>${m.sizeGB} GB</span><span>min ${m.minRamGB} GB RAM</span></div>
          <p class="rec-desc">${esc(m.description || '')}</p>
          <div class="rec-tags">${tags}</div>
          <div class="rec-reason ${m.fits ? 'ok' : 'warn'}">${esc(m.reason || '')}</div>
          <div class="rec-actions">${actions}</div>
        </div>`;
      }).join('');
    } catch {
      if (host) host.innerHTML = '<div class="muted">Could not load recommendations.</div>';
    }
  }

  window.downloadLocalModel = async function (runtime, name, downloadUrl) {
    if (runtime !== 'ollama') { window.open(downloadUrl, '_blank', 'noopener'); return; }
    try {
      const r = await (await fetch(`/api/local/models/${encodeURIComponent(runtime)}/${encodeURIComponent(name)}/download`, { method: 'POST' })).json();
      if (r.accepted) {
        notify.toast(r.message || 'Pull started', 'success');
        if (recPollTimer) clearInterval(recPollTimer);
        let tries = 0;
        recPollTimer = setInterval(async () => {
          tries++;
          await loadRecommendations();
          if (tries > 25) { clearInterval(recPollTimer); recPollTimer = null; }
        }, 3000);
      } else if (r.downloadUrl) {
        window.open(r.downloadUrl, '_blank', 'noopener');
        notify.toast(r.message || 'Open the provider page to download', 'info');
      } else {
        notify.toast(r.error || 'Could not start download', 'warning');
      }
    } catch { notify.toast('Could not start download', 'error'); }
  };

  window.deleteLocalModel = async function (runtime, name) {
    const ok = await confirmModal({ title: 'Delete model from device?', message: `Remove "${name}" (${runtime}) from this device. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      const r = await (await fetch(`/api/local/models/${encodeURIComponent(runtime)}/${encodeURIComponent(name)}/delete`, { method: 'POST' })).json();
      if (r.deleted) notify.toast('Model deleted from device', 'success');
      else notify.toast(r.error || r.message || 'Could not delete model', 'warning');
    } catch { notify.toast('Could not delete model', 'error'); }
    await loadRecommendations();
  };

  // Details modal for a Local AI runtime ("provider") card.
  function openRuntimeDetailsModal(rt) {
    if (!rt) return;
    const planned = !!rt.planned;
    const running = !!rt.running;
    const status = planned ? 'planned' : (running ? 'running' : (rt.detected ? 'detected' : 'offline'));
    const models = (rt.models || []).filter(Boolean);
    const caps = rt.capabilities || {};
    const capMap = { local: 'Local', openAICompatible: 'OpenAI-compatible', anthropicCompatible: 'Anthropic-compatible', supportsModelDiscovery: 'Model discovery', supportsModelDownload: 'Model download', supportsChat: 'Chat' };
    const capList = Object.keys(capMap).filter((k) => caps[k]).map((k) => capMap[k]);
    const add = (l, v) => `<div class="kv"><span>${esc(l)}</span><b>${v}</b></div>`;
    const rows = [
      add('Type', 'Local runtime'),
      add('Status', `<span class="badge ${status}">${esc(status)}</span>`),
      add('Installed', rt.installed === false ? 'No' : (rt.installed ? 'Yes' : 'Unknown')),
      add('Running', running ? 'Yes' : 'No'),
      add('Detected', rt.detected ? 'Yes' : 'No'),
      add('Models on device', models.length ? String(models.length) : '0'),
    ].join('');
    const modelsHTML = models.length
      ? `<div class="rt-detail-models">${models.slice(0, 40).map((m) => `<span class="chipx">${esc(m)}</span>`).join('')}${models.length > 40 ? `<span class="chipx">+${models.length - 40}</span>` : ''}</div>`
      : '<div class="muted">No models detected on this device.</div>';
    const siteHTML = rt.site ? `<a class="btn btn2" href="${esc(rt.site)}" target="_blank" rel="noopener">Open ${esc(rt.name)} site ↗</a>` : '';
    const actions = [];
    if (!running && rt.supportsStart && rt.installed !== false) actions.push(`<button class="btn btn-go btn2" id="rtDetStart" type="button">Start runtime</button>`);
    if (running) actions.push(`<button class="btn btn-go btn2" id="rtDetBench" type="button">Benchmark</button>`);
    const body = `
      <div class="ml-detail">
        <div class="ml-detail-head"><h4 class="mono">${esc(rt.name)}</h4><span class="ml-id">${esc(rt.id)}</span></div>
        ${rows}
        ${capList.length ? `<h4 style="margin:14px 0 6px">Capabilities</h4><div class="ml-caps">${capList.map((c) => `<span class="ml-cap on">${esc(c)}</span>`).join('')}</div>` : ''}
        <h4 style="margin:14px 0 6px">Models installed on this device</h4>
        ${modelsHTML}
        ${rt.note ? `<div class="muted" style="margin-top:10px">${esc(rt.note)}</div>` : ''}
      </div>
      <div class="modal-actions">
        <button class="btn btn2" id="rtDetClose" type="button">Close</button>
        ${siteHTML}
        ${actions.join('')}
      </div>`;
    openModal({
      title: 'Runtime details',
      subtitle: `${esc(rt.name)} · local AI provider`,
      size: 'wide',
      bodyHTML: body,
      onMount: (body, ctrl) => {
        body.querySelector('#rtDetClose')?.addEventListener('click', () => ctrl.close());
        const startBtn = body.querySelector('#rtDetStart');
        if (startBtn) startBtn.addEventListener('click', () => { ctrl.close(); const b = grid.querySelector(`.rt-start[data-start="${rt.id}"]`); if (b) b.click(); });
        const benchBtn = body.querySelector('#rtDetBench');
        if (benchBtn) benchBtn.addEventListener('click', () => { ctrl.close(); const b = grid.querySelector(`.rt-bench[data-bench="${rt.id}"]`); if (b) b.click(); });
      },
    });
  }

  // Details modal for a recommended local model card.
  function openLocalModelDetails(m) {
    if (!m) return;
    const rows = [];
    const add = (l, v) => { if (v == null || v === '') return; rows.push(`<div class="kv"><span>${esc(l)}</span><b>${esc(String(v))}</b></div>`); };
    add('Runtime', m.runtime);
    add('Size', m.sizeGB != null ? `${m.sizeGB} GB` : null);
    add('Minimum RAM', m.minRamGB != null ? `${m.minRamGB} GB` : null);
    add('Parameters', m.params);
    add('Quantization', m.quant);
    add('Installed', m.installed ? 'Yes — on this device' : 'No');
    const body = `
      <div class="ml-detail">
        <div class="ml-detail-head"><h4 class="mono">${esc(m.name)}</h4><span class="ml-id">${esc(m.id)}</span></div>
        <div class="rec-stars" style="margin:2px 0 8px">${starsHTML(m.rating)}<span class="rec-rating">${m.rating}.0</span></div>
        <div class="ml-kv-grid">${rows.join('')}</div>
        <h4 style="margin:14px 0 6px">Why this rating</h4>
        <div class="rec-reason ${m.fits ? 'ok' : 'warn'}">${esc(m.reason || '')}</div>
        <h4 style="margin:14px 0 6px">About</h4>
        <p class="rec-desc" style="margin:0">${esc(m.description || '')}</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn2" id="lmClose" type="button">Close</button>
        <a class="btn btn2" href="${esc(m.downloadUrl)}" target="_blank" rel="noopener">Open provider page ↗</a>
        ${m.installed
          ? `<button class="btn btn2 danger" id="lmDel" type="button">Delete from device</button>`
          : `<button class="btn btn-go btn2" id="lmDl" type="button">Download</button>`}
      </div>`;
    openModal({
      title: 'Local model details',
      subtitle: `${esc(m.runtime)} · recommended for your device`,
      size: 'wide',
      bodyHTML: body,
      onMount: (body, ctrl) => {
        body.querySelector('#lmClose')?.addEventListener('click', () => ctrl.close());
        const dl = body.querySelector('#lmDl');
        if (dl) dl.addEventListener('click', () => { ctrl.close(); window.downloadLocalModel(m.runtime, m.id, m.downloadUrl); });
        const del = body.querySelector('#lmDel');
        if (del) del.addEventListener('click', () => { ctrl.close(); window.deleteLocalModel(m.runtime, m.installedName || m.id); });
      },
    });
  }

  window.openLocalModelDetails = (runtime, id) => {
    const m = recModelsById.get(runtime + '::' + id);
    if (m) openLocalModelDetails(m);
  };

  // Graph-like benchmark view: a single line graph with a categorical X axis
  // (models) and a dual Y axis — left = speed (tok/s), right = time-to-first-
  // token (ms). Two lines (solid = speed, dashed = TTFT) connect the per-model
  // averages; points carry the exact value in a tooltip. Pure SVG, no libs.
  function renderLineChart(rows) {
    const W = 660, H = 320;
    const m = { l: 52, r: 54, t: 30, b: 58 };
    const plotW = W - m.l - m.r;
    const plotH = H - m.t - m.b;
    const n = rows.length;
    const maxSpd = Math.max(...rows.map((r) => r.spd || 0), 1) * 1.12;
    const maxTtft = Math.max(...rows.map((r) => r.ttft || 0), 1) * 1.12;
    const xAt = (i) => (n === 1 ? m.l + plotW / 2 : m.l + (i * plotW) / (n - 1));
    const ySpd = (v) => m.t + plotH - (v / maxSpd) * plotH;
    const yTtft = (v) => m.t + plotH - (v / maxTtft) * plotH;
    const ticks = 4;
    let grid = '', yl = '', yr = '';
    for (let i = 0; i <= ticks; i++) {
      const y = m.t + plotH - (i / ticks) * plotH;
      grid += `<line x1="${m.l}" y1="${y.toFixed(1)}" x2="${m.l + plotW}" y2="${y.toFixed(1)}" class="lc-grid"/>`;
      yl += `<text x="${m.l - 9}" y="${(y + 4).toFixed(1)}" class="lc-yla" text-anchor="end">${Math.round((maxSpd * i) / ticks)}</text>`;
      yr += `<text x="${m.l + plotW + 9}" y="${(y + 4).toFixed(1)}" class="lc-yra" text-anchor="start">${Math.round((maxTtft * i) / ticks)}</text>`;
    }
    // Distinct per-model colour so each model's name + points are identifiable.
    // Kept off-purple to respect the graphite/azure design language.
    const PALETTE = ['#5b8def', '#f5a623', '#34d399', '#22d3ee', '#fb7185', '#a3e635', '#f97316', '#38bdf8'];
    let xl = '', spdPts = [], ttftPts = [], circ = '';
    rows.forEach((r, i) => {
      const col = PALETTE[i % PALETTE.length];
      const x = xAt(i);
      const label = r.model && r.model.length > 12 ? r.model.slice(0, 11) + '…' : (r.model || '?');
      xl += `<text x="${x.toFixed(1)}" y="${m.t + plotH + 20}" class="lc-xla" style="fill:${col}" text-anchor="middle">${esc(label)}</text>`;
      if (r.spd != null) {
        spdPts.push(`${x.toFixed(1)},${ySpd(r.spd).toFixed(1)}`);
        circ += `<circle cx="${x.toFixed(1)}" cy="${ySpd(r.spd).toFixed(1)}" r="4" style="fill:${col}" stroke="var(--surface)" stroke-width="1.2"><title>${esc(r.model)}: ${r.spd} tok/s</title></circle>`;
      }
      if (r.ttft != null) {
        ttftPts.push(`${x.toFixed(1)},${yTtft(r.ttft).toFixed(1)}`);
        circ += `<circle cx="${x.toFixed(1)}" cy="${yTtft(r.ttft).toFixed(1)}" r="4" style="fill:${col}" stroke="var(--surface)" stroke-width="1.2"><title>${esc(r.model)}: ${r.ttft} ms</title></circle>`;
      }
    });
    return `<div class="bench-linechart">
      <div class="bench-chart-h">Throughput &amp; latency by model</div>
      <svg viewBox="0 0 ${W} ${H}" class="lc-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Benchmark line graph: speed and time to first token per model">
        ${grid}
        <line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t + plotH}" class="lc-axis"/>
        <line x1="${m.l + plotW}" y1="${m.t}" x2="${m.l + plotW}" y2="${m.t + plotH}" class="lc-axis"/>
        <line x1="${m.l}" y1="${m.t + plotH}" x2="${m.l + plotW}" y2="${m.t + plotH}" class="lc-axis"/>
        ${yl}${yr}${xl}
        <text x="${m.l - 9}" y="${m.t - 14}" class="lc-axis-title" text-anchor="end">tok/s</text>
        <text x="${m.l + plotW + 9}" y="${m.t - 14}" class="lc-axis-title" text-anchor="start">ms</text>
        <text x="${m.l + plotW / 2}" y="${H - 10}" class="lc-axis-title" text-anchor="middle">Model</text>
        ${spdPts.length ? `<polyline points="${spdPts.join(' ')}" class="lc-line-spd"/>` : ''}
        ${ttftPts.length ? `<polyline points="${ttftPts.join(' ')}" class="lc-line-ttft"/>` : ''}
        ${circ}
      </svg>
      <div class="lc-legend">
        <span class="lc-key"><span class="lc-swatch lc-swatch-spd"></span>Speed (tok/s)</span>
        <span class="lc-key"><span class="lc-swatch lc-swatch-ttft"></span>Time to first token (ms)</span>
      </div>
    </div>`;
  }

  if (deviceTimer) clearInterval(deviceTimer);
  if (recPollTimer) { clearInterval(recPollTimer); recPollTimer = null; }
  _benchReload = loadBenchmarksUI;
  await loadDevice();
  await loadRuntimes();
  await loadBenchmarksUI();
  await loadRecommendations();
  const benchClear = grid.querySelector('#benchClear');
  if (benchClear && !benchClear.dataset.wired) {
    benchClear.dataset.wired = '1';
    benchClear.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Clear benchmark results?',
        message: 'This removes all saved benchmark results from this device.',
        confirmLabel: 'Clear', danger: true,
      });
      if (!ok) return;
      try { await playgroundService.clearBenchmarks(); notify.toast('Benchmarks cleared', 'success'); loadBenchmarksUI(); }
      catch { notify.toast('Could not clear benchmarks', 'error'); }
    });
  }
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

  // Provider Intelligence settings panel (v1.4.0) — manual refresh only.
  let piPanel = document.getElementById('piSettingsPanel');
  if (!piPanel) {
    const grid = document.querySelector('#page-settings .settings-grid');
    if (grid) {
      piPanel = document.createElement('div');
      piPanel.className = 'panel';
      piPanel.id = 'piSettingsPanel';
      grid.appendChild(piPanel);
    }
  }
  fillProviderIntelSettings();
  fetchProviderIntel().then(fillProviderIntelSettings).catch(() => {});
  renderFallbackPanel();
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
  // 'fallback' records are real applied configs too — the monitor physically
  // wrote settings.json before marking them. Treating them as configured keeps
  // the chip honest (no "Needs setup") when the fallback is later turned off.
  if (applied && (applied.status === 'configured' || applied.status === 'fallback')) {
    if (workspace.unsaved) { state = 'unsaved'; label = 'Unsaved changes'; }
    else { state = 'ok'; label = 'Configured'; }
  } else if (applied && applied.status === 'copyable') {
    state = 'copy'; label = 'Copyable config';
  } else if (workspace.liveConfigBase) {
    // settings.json already points at a gateway even though the persisted
    // applied record is missing/stale (fresh profile, cleared storage). That's
    // a real applied config — don't tell the user to set one up again.
    if (workspace.unsaved) { state = 'unsaved'; label = 'Unsaved changes'; }
    else { state = 'ok'; label = 'Configured'; }
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

// ── Provider Intelligence (v1.4.0) ───────────────────────────────────────
// Bridges the on-demand provider-discovery backend to the UI. Honest by
// construction: it only renders what the server already verified/curated; it
// never invents live/verified/free status.

const DS_LABEL = {
  verified: 'Verified', observed: 'Observed', curated: 'Curated', stale: 'Stale',
  unavailable: 'Unavailable', deprecated: 'Deprecated', unknown: 'Unknown',
};

function dsDotClass(ds) { return 'ds-' + (ds || 'unknown'); }

function dsLabel(ds) { return DS_LABEL[ds] || ds || 'unknown'; }

export async function fetchProviderIntel() {
  if (workspace._intelLoading) return true;
  workspace._intelLoading = true;
  try {
    const [pi, chg] = await Promise.all([
      fetch('/api/provider-intelligence').then((r) => r.json()).catch(() => ({ providers: [], summary: null })),
      fetch('/api/provider-changes/summary').then((r) => r.json()).catch(() => ({ byProvider: {} })),
    ]);
    workspace.providerIntel = Object.fromEntries((pi.providers || []).map((p) => [p.id, p]));
    workspace.providerIntelSummary = pi.summary || null;
    workspace.providerChangeCounts = (chg && chg.byProvider) || {};
    return true;
  } finally {
    workspace._intelLoading = false;
  }
}

// Update just one cloud-provider card in place (no full grid re-render).
function patchCloudCard(providerId) {
  const card = document.querySelector(`#cpGrid .provider-card[data-id="${providerId}"]`);
  if (!card) return;
  // Adopted (dyn:) / custom (cst:) cards aren't in the curated intel feed, so
  // resolve their freshest record from the client workspace and fall back to its
  // updatedAt for the "· checked" timestamp (like the curated intel lastChecked).
  const resolved = providerId.startsWith('dyn:')
    ? workspace.dynamicProviders?.find((d) => d.id === providerId)
    : (providerId.startsWith('cst:') ? workspace.customProviders?.find((c) => c.id === providerId) : null);
  const p = getProvider(providerId) || resolved;
  if (!p) return;
  const updatedAt = resolved?.updatedAt || resolved?.lastUpdated || p.updatedAt || p.createdAt;
  const intel = workspace.providerIntel[providerId];
  const ds = intel?.status?.discoveryStatus;
  const avail = intel?.status?.availability;
  // Custom (cst:) / adopted (dyn:) cards classify free models locally from the
  // loaded model list, so prefer those live counts over the intel feed (which a
  // stale legacy snapshot could freeze at 0 for name-marked free models). Curated
  // cards keep trusting server intel — their pricing shape differs (prompt/
  // completion vs input/output), so the local fallback only fills intel gaps.
  const isCustomLike = providerId.startsWith('cst:') || providerId.startsWith('dyn:');
  const localFree = getFreeModels(providerId).length;
  const localTotal = getModels(providerId).length;
  const totalModels = (isCustomLike && localTotal > 0) ? localTotal : (intel?.models?.total ?? localTotal);
  const freeModelsN = (isCustomLike && localTotal > 0) ? localFree : (intel?.models?.free ?? localFree);
  const srcBadge = intel
    ? `<span class="badge pi-src">${intel.source.type === 'official-api' ? 'verified' : 'curated'}</span>`
    : (resolved ? '<span class="badge pi-src">ecosystem</span>' : '');
  const lastChecked = intel?.source?.lastCheckedAt
    ? relTime(intel.source.lastCheckedAt)
    : (updatedAt ? relTime(updatedAt) : 'not checked');
  const changeN = workspace.providerChangeCounts[providerId] || 0;
  const changeBadge = changeN ? `<span class="badge pi-change" title="Recent discovery changes">${changeN} change${changeN > 1 ? 's' : ''}</span>` : '';
  const statusText = intel
    ? (avail === 'available' ? 'available' : (avail === 'unavailable' ? 'unavailable' : (ds === 'curated' ? 'known · curated' : 'unknown')))
    : (card.querySelector('.pi-status')?.textContent || 'Provider');
  const key = Storage.getKey(providerId);
  const applied = workspace.appliedProviderId === providerId;
  const dotHTML = intel && ds ? `<span class="pi-dot ${dsDotClass(ds)}" title="${esc(dsLabel(ds))}"></span>` : '';
  const dot = card.querySelector('.pc-head .pi-dot');
  if (dot) dot.outerHTML = dotHTML;
  else if (dotHTML) { const meta = card.querySelector('.pc-head .provider-meta'); if (meta) meta.insertAdjacentHTML('afterend', dotHTML); }
  card.classList.toggle('applied', applied);
  const foot = card.querySelector('.pc-card-foot');
  if (foot) foot.innerHTML = `<span class="badge cnt">${totalModels ? (freeModelsN + ' free · ' + totalModels + ' total') : 'models…'}</span>${srcBadge}${changeBadge}${applied ? '<span class="applied-badge">active</span>' : ''}${key ? '<span class="badge cc">configured</span>' : ''}`;
  const intelRow = card.querySelector('.pc-intel-row');
  if (intelRow) intelRow.innerHTML = `<span class="pi-status">${esc(statusText)}</span><span class="pi-checked">· ${esc(lastChecked)}</span>`;
}

// Sync the "active provider" highlight across every card already in the grid
// (curated, ecosystem, custom — including any added in future) without a full
// re-render. Called after applying a provider so the highlight moves instantly.
function syncAppliedHighlights() {
  const grid = document.getElementById('cpGrid');
  if (!grid) return;
  grid.querySelectorAll('.provider-card.cp-card, .provider-card.eco-cp-card').forEach((card) => {
    const isActive = workspace.appliedProviderId === card.dataset.id;
    card.classList.toggle('applied', isActive);
    const foot = card.querySelector('.pc-card-foot');
    if (!foot) return;
    const existing = foot.querySelector('.applied-badge');
    if (isActive && !existing) foot.insertAdjacentHTML('beforeend', '<span class="applied-badge">active</span>');
    else if (!isActive && existing) existing.remove();
  });
}
window.syncAppliedHighlights = syncAppliedHighlights;

export async function refreshProviderIntelligence(providerId) {
  const btn = providerId
    ? document.querySelector(`.pi-refresh[data-id="${providerId}"]`)
    : document.getElementById('piRefreshAll');
  if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
  try {
    const res = await fetch('/api/provider-intelligence/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(providerId ? { providerId } : {}),
    });
    const data = await res.json();
    await fetchProviderIntel();
    const page = document.body.dataset.page;
    if (page === 'cloud-providers') {
      if (providerId) patchCloudCard(providerId);
      else renderCloudProviders();
    } else if (page === 'workspace') { const el = document.getElementById('wsProviderIntel'); if (el) fillWsProviderIntel(); }
    else if (page === 'settings') { const el = document.getElementById('piSettingsPanel'); if (el) fillProviderIntelSettings(); }
    notify.toast(providerId ? `Refreshed ${getProvider(providerId)?.name || providerId} intelligence` : 'Provider intelligence refreshed', 'success');
    return data;
  } catch {
    notify.toast('Failed to refresh provider intelligence', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
  }
}

function monitorSectionHTML(insight) {
  if (!insight) return '<div class="muted">No monitoring data yet — run a manual refresh.</div>';
  const rel = insight.reliability || {};
  const snap = insight.latestSnapshot;
  const relBar = rel.state === 'measured'
    ? `<div class="rel-bar"><div class="rel-fill" style="width:${rel.percentage}%"></div></div><div class="muted">${rel.percentage}% reachable over ${rel.sampleSize} checks</div>`
    : `<div class="muted">Reliability: insufficient data (${rel.sampleSize || 0} check(s)). Run a manual refresh to measure.</div>`;
  const snapStats = snap
    ? `<div class="ml-kv-grid">
        <div class="kv"><span>Availability</span><b>${esc(snap.availability)}</b></div>
        <div class="kv"><span>Latency</span><b>${snap.latencyMs != null ? snap.latencyMs + ' ms' : '—'}</b></div>
        <div class="kv"><span>Connection</span><b>${esc(snap.checkResult?.connectionState || 'unknown')}</b></div>
        <div class="kv"><span>Models</span><b>${snap.modelCount}</b></div>
        <div class="kv"><span>Free</span><b>${snap.freeModelCount}</b></div>
        <div class="kv"><span>Paid</span><b>${snap.paidModelCount}</b></div>
      </div>`
    : '<div class="muted">No monitoring snapshot yet — run a manual refresh.</div>';
  const timeline = (insight.recentSnapshots || []).map((s) => {
    const dot = s.availability === 'available' ? 'verified' : (s.availability === 'unavailable' ? 'unavailable' : 'curated');
    const deltas = [s.addedModels?.length, s.removedModels?.length, s.changedModels?.length].filter((n) => n).length
      ? ` · ${s.addedModels?.length || 0} added, ${s.removedModels?.length || 0} removed, ${s.changedModels?.length || 0} changed`
      : '';
    return `<div class="tl-item"><span class="tl-dot ${dsDotClass(dot)}"></span>
      <div class="tl-body"><b>${esc(new Date(s.checkedAt).toLocaleString())}</b> — ${esc(s.availability)} · ${s.modelCount} models${s.latencyMs != null ? ' · ' + s.latencyMs + 'ms' : ''}${deltas}</div></div>`;
  }).join('') || '<div class="muted">No snapshots yet.</div>';
  return `${snapStats}<div class="ml-dsec" style="margin-top:8px"><h4 class="ml-dsec-h">Reliability</h4>${relBar}</div>
    <div class="ml-dsec" style="margin-top:8px"><h4 class="ml-dsec-h">History timeline</h4><div class="timeline">${timeline}</div></div>`;
}

function benchSectionHTML(profiles, results, providerId) {
  const profBtns = (profiles || []).map((pr) => `<button class="btn btn2 sm" type="button" onclick="runBenchmarkFor('${esc(providerId)}','${esc(pr.id)}')">▶ ${esc(pr.name)}</button>`).join(' ');
  const rows = (results || []).slice(0, 6).map((r) => `<div class="activity-row"><span class="act-ico">${r.ok ? '✓' : '•'}</span>
    <div class="act-msg"><div>${esc(r.profileId)} — ${esc(r.connectionState)}${r.latencyMs != null ? ' (' + r.latencyMs + 'ms)' : ''}</div>
    <div class="muted" style="font-size:11px">${esc(new Date(r.measuredAt).toLocaleString())} · ${esc(r.note || '')}</div></div></div>`).join('') || '<div class="muted">No benchmark runs yet.</div>';
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">${profBtns || '<span class="muted">No profiles.</span>'}</div><div class="activity-list">${rows}</div>`;
}

export async function runBenchmarkFor(providerId, profileId) {
  notify.toast(`Running benchmark: ${profileId}…`, 'info');
  const r = await runBenchmark(providerId, profileId).catch(() => null);
  if (r) notify.toast(`Benchmark ${profileId}: ${r.connectionState}${r.latencyMs != null ? ' (' + r.latencyMs + 'ms)' : ''}`, r.ok ? 'success' : 'info');
  else notify.toast('Benchmark failed to run', 'error');
  openProviderIntelligence(providerId);
}

export async function refreshProviderMonitoring(id) {
  notify.toast('Monitoring refresh…', 'info');
  await refreshMonitoring(id).catch(() => {});
  openProviderIntelligence(id);
}

export async function openProviderIntelligence(id) {
  const local = workspace.providerIntel[id];
  if (!local) { notify.toast('No intelligence for this provider yet — run a refresh', 'info'); return; }
  const [res, profilesRes] = await Promise.all([
    fetch(`/api/provider-intelligence/${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => ({ provider: local, changes: [] })),
    fetchBenchmarkProfiles().then(() => ({ profiles: workspace.benchmarkProfiles })).catch(() => ({ profiles: [] })),
  ]);
  const p = res.provider || local;
  const changes = res.changes || [];
  const insight = await fetchMonitorInsight(id).catch(() => null);
  await fetchBenchmarks(id).catch(() => {});
  const benchResults = (workspace.benchmarkResults || []).filter((r) => r.providerId === id);
  const st = p.status || {};
  const acc = p.access || {};
  const comp = p.compatibility || {};
  const src = p.source || {};
  const ts = p.timestamps || {};
  const models = p.models || {};
  const providerMeta = getProvider(p.id) || {};
  const website = p.id === 'custom' ? null : ((p.identity && p.identity.website) || (providerMeta.sub ? 'https://' + providerMeta.sub : null));

  const compatList = [
    comp.openaiCompatible && 'OpenAI-compatible',
    comp.anthropicCompatible && 'Anthropic-compatible',
    comp.geminiCompatible && 'Gemini-compatible',
  ].filter(Boolean).map((c) => `<span class="ml-cap on">${esc(c)}</span>`).join('') || '<span class="muted">no protocol data</span>';

  const changeRows = changes.length
    ? changes.slice(0, 12).map((c) => `<div class="activity-row activity-${esc(c.severity || 'info')}">
        <span class="act-ico">${c.type === 'models_added' || c.type === 'provider_discovered' ? '✓' : (c.severity === 'warning' ? '⚠' : '•')}</span>
        <div class="act-msg"><div>${esc(c.summary)}</div>
        <div class="muted" style="font-size:11px">${esc(new Date(c.detectedAt).toLocaleString())}</div></div>
      </div>`).join('')
    : '<div class="muted">No changes recorded yet.</div>';

  const bodyHTML = `
    <div class="ml-detail">
      <div class="ml-detail-head">
        <h3 class="ml-dh-name">${esc(p.identity?.name || p.id)}</h3>
        ${src.url ? `<a class="ml-id" href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.url)} ↗</a>` : ''}
      </div>
      <div class="pi-modal-status">
        <span class="pi-dot ${dsDotClass(st.discoveryStatus)}"></span>
        <b>${esc(dsLabel(st.discoveryStatus))}</b>
        <span class="badge">${esc(st.availability || 'unknown')}</span>
        ${st.sourceStatus ? `<span class="badge">${esc(st.sourceStatus)}</span>` : ''}
      </div>

      <section class="ml-dsec">
        <h4 class="ml-dsec-h">Source</h4>
        <div class="ml-kv-grid">
          <div class="kv"><span>Type</span><b>${esc(src.type || 'unknown')}</b></div>
          <div class="kv"><span>Confidence</span><b>${esc(src.confidence || 'unknown')}</b></div>
          <div class="kv"><span>Verified</span><b>${src.verifiedAt ? new Date(src.verifiedAt).toLocaleString() : '—'}</b></div>
          <div class="kv"><span>Last checked</span><b>${src.lastCheckedAt ? relTime(src.lastCheckedAt) : 'never'}</b></div>
        </div>
      </section>

      <section class="ml-dsec">
        <h4 class="ml-dsec-h">Access &amp; compatibility</h4>
        <div class="ml-kv-grid">
          <div class="kv"><span>Requires API key</span><b>${acc.requiresApiKey ? 'Yes' : 'No'}</b></div>
          <div class="kv"><span>Access type</span><b>${esc(acc.accessType || 'unknown')}</b></div>
          <div class="kv"><span>Free models</span><b>${models.free ?? '—'}</b></div>
          <div class="kv"><span>Paid models</span><b>${models.paid ?? '—'}</b></div>
        </div>
        <div class="ml-caps" style="margin-top:8px">${compatList}</div>
      </section>

      <section class="ml-dsec">
        <h4 class="ml-dsec-h">Model summary</h4>
        <div class="ml-kv-grid">
          <div class="kv"><span>Total known models</span><b>${models.total ?? '—'}</b></div>
          <div class="kv"><span>Free</span><b>${models.free ?? '—'}</b></div>
          <div class="kv"><span>Paid</span><b>${models.paid ?? '—'}</b></div>
          <div class="kv"><span>First seen</span><b>${ts.firstSeenAt ? relTime(ts.firstSeenAt) : '—'}</b></div>
        </div>
      </section>

      <section class="ml-dsec">
        <h4 class="ml-dsec-h">Monitoring <button class="btn btn2 sm" type="button" onclick="refreshProviderMonitoring('${esc(p.id)}')">↻ Monitor now</button></h4>
        ${monitorSectionHTML(insight)}
      </section>

      <section class="ml-dsec">
        <h4 class="ml-dsec-h">Benchmarks</h4>
        ${benchSectionHTML(profilesRes.profiles, benchResults, p.id)}
      </section>

      <section class="ml-dsec">
        <h4 class="ml-dsec-h">Recent changes</h4>
        <div class="activity-list">${changeRows}</div>
      </section>
    </div>
    <div class="modal-actions">
      <button class="btn btn2" type="button">Close</button>
      ${website ? `<button class="btn btn2 pi-visit" type="button">Visit website ↗</button>` : ''}
      <button class="btn btn-go" type="button" onclick="refreshProviderIntelligence('${esc(p.id)}')">↻ Re-check</button>
    </div>`;

  openModal({
    title: 'Provider intelligence',
    subtitle: `${esc(p.identity?.name || p.id)} · honest discovery + monitoring`,
    size: 'wide',
    bodyHTML,
    onMount: (body, ctrl) => {
      const closeBtn = body.querySelector('.modal-actions .btn2');
      if (closeBtn) closeBtn.addEventListener('click', () => ctrl.close());
      const visitBtn = body.querySelector('.pi-visit');
      if (visitBtn && website) visitBtn.addEventListener('click', () => window.open(website, '_blank', 'noopener'));
    },
  });
}

export async function openProviderChangesModal() {
  try {
    const res = await fetch('/api/provider-changes?limit=60').then((r) => r.json());
    const changes = res.changes || [];
    const rows = changes.length
      ? changes.map((c) => `<div class="activity-row activity-${esc(c.severity || 'info')}">
          <span class="act-ico">${c.severity === 'warning' ? '⚠' : '✓'}</span>
          <div class="act-msg"><div>${esc(c.summary)}</div>
          <div class="muted" style="font-size:11px">${esc(c.providerName || c.providerId)} · ${esc(new Date(c.detectedAt).toLocaleString())}</div></div>
        </div>`).join('')
      : '<div class="muted">No discovery changes recorded yet.</div>';
    openModal({
      title: 'Provider changes',
      subtitle: 'Discovery-driven changes across all providers — secret-free.',
      size: 'wide',
      bodyHTML: `<div class="activity-list">${rows}</div>`,
    });
  } catch {
    notify.toast('Could not load provider changes', 'error');
  }
}

// Workspace "Provider Intelligence" panel
function fillWsProviderIntel() {
  const host = document.getElementById('wsProviderIntel');
  if (!host) return;
  const s = workspace.providerIntelSummary;
  if (!s) { host.innerHTML = '<h3>Provider Intelligence</h3><div class="muted">Run a discovery refresh to populate provider intelligence.</div>'; return; }
  const dot = (ds) => `<span class="pi-dot ${dsDotClass(ds)}"></span>`;
  host.innerHTML = `
    <h3>Provider Intelligence</h3>
    <div class="ml-stats">
      <span class="ml-chip"><b>${s.available}</b> available</span>
      <span class="ml-chip"><b>${s.curated}</b> curated</span>
      <span class="ml-chip"><b>${s.stale}</b> stale</span>
      <span class="ml-chip"><b>${s.models?.total ?? 0}</b> models</span>
    </div>
    <div class="pi-ws-status">
      ${dot('verified')}<span>Verified: ${s.byStatus?.verified || 0}</span>
      ${dot('curated')}<span>Curated: ${s.byStatus?.curated || 0}</span>
      ${dot('stale')}<span>Stale: ${s.stale || 0}</span>
      ${dot('unavailable')}<span>Unavailable: ${s.unavailable || 0}</span>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn2 sm" onclick="refreshProviderIntelligence()">↻ Refresh discovery</button>
      <button class="btn btn2 sm" onclick="refreshProviderMonitoring()">↻ Monitor all</button>
      <button class="btn btn2 sm" onclick="openProviderChangesModal()">View changes</button>
    </div>`;
}

// Settings "Provider Intelligence" panel
function fillProviderIntelSettings() {
  const host = document.getElementById('piSettingsPanel');
  if (!host) return;
  const s = workspace.providerIntelSummary;
  host.innerHTML = `
    <h3>Provider Intelligence</h3>
    <p class="muted">On-demand discovery of provider availability, model counts and changes. Never auto-polls; always manual.</p>
    <div class="ml-stats">
      <span class="ml-chip"><b>${s ? s.available : 0}</b> available</span>
      <span class="ml-chip"><b>${s ? s.stale : 0}</b> stale</span>
      <span class="ml-chip"><b>${s ? (s.models?.total ?? 0) : 0}</b> models</span>
    </div>
    <div style="margin-top:10px"><button class="btn btn-go" onclick="refreshProviderIntelligence()">↻ Refresh provider intelligence</button></div>`;
}

// ── Cloud Providers explorer ──
export function renderCloudProviders({ registryFilter: initialRegFilter } = {}) {
  updateCrumb('Cloud Providers');
  const grid = document.getElementById('cpGrid');
  const filtersEl = document.getElementById('cpFilters');
  if (!grid || !filtersEl) return;

  const cats = [
    { id: 'all', label: 'All' },
    { id: 'popular', label: 'Popular' },
    { id: 'free', label: 'Free' },
    { id: 'anthropic', label: 'Anthropic' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'google', label: 'Google' },
  ];
  let activeCat = 'all';
  let q = '';
  let registryFilter = initialRegFilter || 'all';
  let ecoDiscovered = workspace.ecoDiscovered || [];
  let dynamicProviders = workspace.dynamicProviders || [];
  let customProviders = [];

  const customTags = (p) => {
    const fmt = (p.api?.format || p.format || '').toLowerCase();
    const tags = [];
    if (fmt === 'anthropic') tags.push('anthropic');
    else if (fmt === 'openai') tags.push('openai');
    else if (fmt === 'gemini') tags.push('google');
    if (p.modelSupport?.models?.some(isFreeModelEntry)) tags.push('free');
    return tags;
  };

  const customSearchMatch = (p, ql) => {
    if (!ql) return true;
    const lql = ql.toLowerCase();
    if ((p.name || '').toLowerCase().includes(lql)) return true;
    if ((p.identity?.name || '').toLowerCase().includes(lql)) return true;
    if ((p.identity?.description || '').toLowerCase().includes(lql)) return true;
    if ((p.api?.baseUrl || '').toLowerCase().includes(lql)) return true;
    if ((p.api?.format || '').toLowerCase().includes(lql)) return true;
    return false;
  };

  const curatedPasses = (p) => {
    const tags = providerTags(p.id);
    if (activeCat !== 'all' && !tags.includes(activeCat)) return false;
    if (q) {
      const ql = q.toLowerCase();
      if (!(p.name.toLowerCase().includes(ql) || (p.sub || '').toLowerCase().includes(ql))) return false;
    }
    return true;
  };

  const customPasses = (p) => {
    if (p.lifecycle !== 'active') return false;
    const tags = customTags(p);
    if (activeCat !== 'all' && !tags.includes(activeCat)) return false;
    if (q && !customSearchMatch(p, q)) return false;
    return true;
  };

  const ecoPasses = (e) => {
    if (activeCat === 'free' || activeCat === 'popular') return false;
    if (q) {
      const ql = q.toLowerCase();
      if (!(e.name || '').toLowerCase().includes(ql)) return false;
    }
    return true;
  };

  const drawFilters = () => {
    const registryOptions = [
      ['all', 'All'], ['curated', 'Curated'], ['adopted', 'Adopted'], ['custom', 'Custom'], ['discovered', 'Discovered'],
    ].map(([id, label]) => `<option value="${id}" ${registryFilter === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
    filtersEl.innerHTML =
      cats.map(c => `<button class="chip-filter ${activeCat === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.label)}</button>`).join('') +
      `<span class="cp-reg-sep"></span>` +
      `<div class="cp-reg-group"><span class="cp-reg-label">Registry:</span><select class="cp-reg-select" data-reg-select aria-label="Registry filter">${registryOptions}</select></div>` +
      `<button class="btn btn2 cp-refresh-all-btn" title="Refresh models for every provider card" data-act="refresh-all" aria-label="Refresh all provider models">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>
        </svg>
        <span class="cp-refresh-all-label">Refresh</span>
      </button>`;
    filtersEl.querySelectorAll('.chip-filter[data-cat]').forEach(b => b.addEventListener('click', () => {
      activeCat = b.dataset.cat; drawFilters(); drawGrid();
    }));
    filtersEl.querySelector('[data-reg-select]')?.addEventListener('change', (e) => {
      registryFilter = e.target.value; drawFilters(); drawGrid();
    });
    filtersEl.querySelector('[data-act="refresh-all"]')?.addEventListener('click', async () => {
      const btn = filtersEl.querySelector('[data-act="refresh-all"]');
      const setRefreshState = (refreshing) => {
        btn.disabled = refreshing;
        btn.classList.toggle('is-refreshing', refreshing);
        const lbl = btn.querySelector('.cp-refresh-all-label');
        if (lbl) {
          if (refreshing) { btn.dataset.label = btn.dataset.label || lbl.textContent; lbl.textContent = 'Refreshing…'; }
          else lbl.textContent = btn.dataset.label || 'Refresh';
        }
      };
      setRefreshState(true);
      let curatedTotal = 0, customTotal = 0, adoptedTotal = 0;
      notify.toast('Refreshing every provider card…', 'info');
      try {
        // 1) Curated providers: re-fetch live models from their own APIs/scrapes
        try {
          const res = await fetch('/api/refresh-models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const data = await res.json();
          for (const r of (data.results || [])) if (r?.ok) curatedTotal += (r.count || 0);
        } catch {}

        // 2) Discovered/adopted (ecosystem) providers: refresh their intelligence
        try {
          const res = await fetch('/api/provider-intelligence/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
          await res.json();
        } catch {}
        if (workspace.ecoDiscovered || workspace.dynamicProviders) {
          try {
            const [ecoRes, dynRes] = await Promise.all([
              fetch('/api/ecosystem/providers?registryState=discovered').then(r => r.json()).catch(() => ({ providers: workspace.ecoDiscovered || [] })),
              fetch('/api/providers?origin=ecosystem').then(r => r.json()).catch(() => ({ providers: workspace.dynamicProviders || [] })),
            ]);
            workspace.ecoDiscovered = ecoRes.providers || workspace.ecoDiscovered || [];
            workspace.dynamicProviders = dynRes.providers || workspace.dynamicProviders || [];
          } catch {}
        }

        // 3) Custom providers: re-fetch live models from their own base URLs
        try {
          const { listCustomProviders, fetchCustomProviderModels } = await import('../providers/customProviderService.js');
          const result = await listCustomProviders();
          const providers = result?.providers || [];
          let lc = 0;
          for (const cp of providers) {
            try {
              const r = await fetchCustomProviderModels(cp.id, Storage.getKey(cp.id));
              if (r?.ok && r.models?.length) {
                const fetchedModels = r.models.map(m => ({ ...m, source: 'fetched' }));
                workspace.liveModels[cp.id] = {
                  models: fetchedModels,
                  freeModels: fetchedModels.filter(isFreeModelEntry),
                  source: { type: 'custom-api', fetchedAt: new Date().toISOString() },
                };
                lc += r.models.length;
              }
            } catch {}
          }
          customTotal = lc;
          customProviders = providers.filter(p => p.lifecycle === 'active');
        } catch {}

        // 4) Adopted (dyn:) providers: re-import their discovery model lists so
        //    their cards refresh exactly like the custom loop above.
        let adoptedFailures = 0;
        try {
          const { fetchCustomProviderModels } = await import('../providers/customProviderService.js');
          const adopted = workspace.dynamicProviders?.filter(d => d?.status === 'active') || [];
          for (const dp of adopted) {
            try {
              const r = await fetchCustomProviderModels(dp.id, Storage.getKey(dp.id));
              if (r?.ok && r.models?.length) {
                const fetchedModels = r.models.map(m => ({ ...m, source: 'fetched' }));
                workspace.liveModels[dp.id] = {
                  models: fetchedModels,
                  freeModels: fetchedModels.filter(isFreeModelEntry),
                  source: { type: 'custom-api', fetchedAt: new Date().toISOString() },
                };
                adoptedTotal += r.models.length;
              } else if (!r?.ok) {
                adoptedFailures++;
              }
            } catch { adoptedFailures++; }
          }
          // The imports bumped each record's updatedAt — refresh the index and stamp
          // every adopted record to "just now" so ALL adopted cards show a fresh
          // "· checked" row regardless of server state (mirrors custom cards).
          await refreshDynamicIndex();
          const refreshStamp = new Date().toISOString();
          for (const d of (workspace.dynamicProviders || [])) {
            if (d?.id?.startsWith('dyn:')) d.lastUpdated = refreshStamp;
          }
          // drawGrid reads the local snapshot captured when this view mounted, so
          // re-point it at the freshly pulled index before the final re-render.
          dynamicProviders = workspace.dynamicProviders || dynamicProviders;
        } catch { adoptedFailures = Math.max(1, adoptedFailures); }
        if (adoptedFailures) {
          notify.toast(`${adoptedFailures} adopted provider(s) not re-imported — restart the backend server (run \`npm start\`) to enable adopted refresh`, 'warning');
        }

        // 5) Re-sync client-side cache + intelligence, then re-render all cards
        await fetchProviderIntel();
        await fetchCachedModels().catch(() => {});
        const counts = [curatedTotal, customTotal, adoptedTotal].filter(n => n > 0).join(' + ');
        notify.toast(`Refreshed every provider (${counts ? counts + ' models' : 'no live models found'})`, 'success');
        drawGrid();
      } catch (e) {
        notify.toast('Refresh failed: ' + e.message, 'error');
      }
      setRefreshState(false);
    });
  };

  const drawGrid = async () => {
    const ql = q.toLowerCase();
    let curatedCards = [];
    let ecoCards = [];
    let adoptedCards = [];
    let customCards = [];

    if (registryFilter === 'curated' || registryFilter === 'all') {
      curatedCards = PROVIDERS.filter(p => p.id !== 'anthropic' && curatedPasses(p));
    }

    // Adopted (dyn:) providers render EXACTLY like custom cards — same card
    // component, same full detail modal (base URL, API key, model picker, test,
    // apply/copy config, integration, edit, delete), same filter/search rules.
    if (registryFilter === 'adopted' || registryFilter === 'all') {
      adoptedCards = dynamicProviders
        .filter(dp => dp.status === 'active')
        .map(adoptedToCustomShape)
        .filter(p => customPasses(p));
    }
    if (registryFilter === 'discovered') {
      ecoCards = ecoDiscovered.filter(e => ecoPasses(e));
    }

    if (registryFilter === 'custom' || registryFilter === 'all') {
      customCards = customProviders.filter(p => customPasses(p));
    }

    if (!curatedCards.length && !ecoCards.length && !adoptedCards.length && !customCards.length) {
      grid.innerHTML = `<div class="cp-empty">
        <div class="cp-empty-icon">🔍</div>
        <div class="cp-empty-text">No providers match</div>
        <div class="cp-empty-sub muted">Try a different search term or filter combination.</div>
      </div>`;
      return;
    }

    const curatedHtml = curatedCards.map(p => {
      const key = Storage.getKey(p.id);
      const free = getFreeModels(p.id).length;
      const total = getModels(p.id).length;
      const compat = p.id === 'openrouter' ? 'Anthropic (proxy)' : (p.claudeCode ? 'Anthropic' : 'OpenAI');
      const intel = workspace.providerIntel[p.id];
      const ds = intel?.status?.discoveryStatus;
      const avail = intel?.status?.availability;
      const dot = ds ? `<span class="pi-dot ${dsDotClass(ds)}" title="${esc(dsLabel(ds))}"></span>` : '';
      const totalModels = intel?.models?.total ?? total;
      const freeModelsN = intel?.models?.free ?? free;
      const srcBadge = intel ? `<span class="badge pi-src">${intel.source.type === 'official-api' ? 'verified' : 'curated'}</span>` : '';
      const lastChecked = intel?.source?.lastCheckedAt ? relTime(intel.source.lastCheckedAt) : 'not checked';
      const applied = workspace.appliedProviderId === p.id;
      const appliedBadge = applied ? '<span class="applied-badge">active</span>' : '';
      const changeN = workspace.providerChangeCounts[p.id] || 0;
      const changeBadge = changeN ? `<span class="badge pi-change" title="Recent discovery changes">${changeN} change${changeN > 1 ? 's' : ''}</span>` : '';
      const statusText = avail === 'available' ? 'available' : (avail === 'unavailable' ? 'unavailable' : (ds === 'curated' ? 'known · curated' : 'unknown'));
      return `<div class="panel provider-card cp-card${applied ? ' applied' : ''}" data-id="${p.id}" role="button" tabindex="0">
        <div class="pc-head">
          <div class="pc-logo-sm">${logoHtml(p)}</div>
          <div class="provider-meta"><b>${esc(p.name)}</b><span class="provider-compat">${esc(compat)}</span></div>
          ${dot}
        </div>
        <div class="pc-card-foot">
          <span class="badge cnt">${totalModels ? (freeModelsN + ' free · ' + totalModels + ' total') : 'models…'}</span>
          ${srcBadge}${changeBadge}${appliedBadge}${key ? '<span class="badge cc">configured</span>' : ''}
        </div>
        <div class="pc-intel-row">
          <span class="pi-status">${esc(statusText)}</span>
          <span class="pi-checked">· ${esc(lastChecked)}</span>
        </div>
        <div class="pc-actions">
          <button class="btn btn2 sm pi-details" data-id="${p.id}" type="button">Details</button>
          <button class="btn btn2 sm pi-refresh" data-id="${p.id}" type="button" title="Re-check this provider">↻</button>
        </div>
      </div>`;
    }).join('');

    const ecoHtml = ecoCards.map(ecoCard).join('');
    const adoptedHtml = adoptedCards.map(customProviderCard).join('');
    const customHtml = customCards.map(customProviderCard).join('');

    grid.innerHTML = curatedHtml + ecoHtml + adoptedHtml + customHtml;

    grid.querySelectorAll('.cp-card').forEach(c => {
      const isCustom = c.dataset.origin === 'custom';
      const cid = c.dataset.id;
      const open = isCustom
        ? () => { if (window.openCustomProvider) window.openCustomProvider(cid); }
        : () => openProviderConfig(cid);
      c.addEventListener('click', open);
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      const det = c.querySelector('.pi-details');
      if (det) det.addEventListener('click', (e) => { e.stopPropagation(); openProviderIntelligence(cid); });
      const ref = c.querySelector('.pi-refresh');
      if (ref) ref.addEventListener('click', (e) => { e.stopPropagation(); refreshProviderIntelligence(cid); });
      const detailsBtn = c.querySelector('.cp-details-btn');
      if (detailsBtn) detailsBtn.addEventListener('click', (e) => { e.stopPropagation(); if (window.openCustomProvider) window.openCustomProvider(cid); });
      const refreshBtn = c.querySelector('.cp-refresh-btn');
      if (refreshBtn) refreshBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⟳';
        const refreshSponsored = async (nowIso) => {
          // Adopted (dyn:) cards always re-sync their index + stamp "just now".
          // Custom (cst:) cards rely on provider intel, whose lastCheckedAt the
          // server bumps on fetch-models.
          if (cid.startsWith('dyn:')) {
            await refreshDynamicIndex().catch(() => false);
            const rec = (workspace.dynamicProviders || []).find(d => d.id === cid);
            if (rec) rec.lastUpdated = nowIso;
            // Keep the view's snapshot in sync so later filter renders don't
            // revert the card to the pre-refresh timestamp.
            dynamicProviders = workspace.dynamicProviders || dynamicProviders;
          }
          await fetchProviderIntel().catch(() => {});
          patchCloudCard(cid);
        };
        try {
          const { fetchCustomProviderModels } = await import('../providers/customProviderService.js');
          const r = await fetchCustomProviderModels(cid, Storage.getKey(cid));
          const nowIso = new Date().toISOString();
          if (r?.ok) {
            const fetchedModels = (r.models && r.models.length ? r.models : []).map(m => ({ ...m, source: 'fetched' }));
            workspace.liveModels[cid] = {
              models: fetchedModels,
              freeModels: fetchedModels.filter(isFreeModelEntry),
              source: { type: 'custom-api', fetchedAt: nowIso },
            };
            const freeN = workspace.liveModels[cid].freeModels.length;
            const totalN = fetchedModels.length;
            const badge = c.querySelector('.badge.cnt');
            if (badge) badge.textContent = freeN + ' free · ' + totalN + ' total';
            // Re-sync the index + stamp the record, then patch the card in place.
            // The server also bumps updatedAt on each import, so a hard refresh
            // afterwards shows the same fresh "· checked" time.
            await refreshSponsored(nowIso);
            notify.toast(totalN ? `Refreshed ${totalN} models` : 'Model import complete', 'success');
          } else if (cid.startsWith('dyn:')) {
            // Old backend (no /fetch-models) or transient failure: degrade
            // gracefully — still move the card's "checked" time and re-sync what
            // we can, and tell the user exactly why re-import didn't run.
            await refreshSponsored(nowIso);
            notify.toast('Models not re-imported — restart the backend server (run `npm start`) to enable adopted-provider refresh', 'warning');
          } else {
            notify.toast('Refresh failed', 'error');
          }
        } catch (err) {
          if (cid.startsWith('dyn:')) {
            const nowIso = new Date().toISOString();
            await refreshSponsored(nowIso).catch(() => {});
            notify.toast('Refresh unavailable — restart the backend server (run `npm start`)', 'warning');
          } else {
            notify.toast('Refresh failed', 'error');
          }
        }
        refreshBtn.disabled = false;
        refreshBtn.textContent = '↻';
      });
    });
    grid.querySelectorAll('.eco-cp-card').forEach(c => {
      const id = c.dataset.id;
      const open = () => { if (id.startsWith('dyn:')) { if (window.openDynamicProvider) window.openDynamicProvider(id); } else if (id.startsWith('cst:')) { if (window.openCustomProvider) window.openCustomProvider(id); } else if (window.openEcosystemProvider) window.openEcosystemProvider(id); };
      c.addEventListener('click', open);
    });
  };

  function ecoCard(e) {
    const adopted = (e.registryState || 'discovered') === 'adopted';
    const cfg = e.validation && e.validation.configurable === true;
    const src = e.logo && e.logoSource && e.logoSource !== 'fallback'
      ? `/api/ecosystem/logo?url=${encodeURIComponent(e.logo)}` : '';
    const logo = src
      ? `<img class="pc-logo-sm" src="${src}" alt="" onerror="this.outerHTML='<div class=&quot;pc-logo-sm&quot;>' + ${JSON.stringify(ecoInitials(e.name))} + '</div>'" />`
      : `<div class="pc-logo-sm">${esc(ecoInitials(e.name))}</div>`;
    const stateBadge = adopted ? '<span class="badge ok">adopted</span>' : '<span class="badge">discovered</span>';
    const cfgBadge = cfg && adopted ? '<span class="badge cc">configurable</span>' : '';
    const appliedBadge = workspace.appliedProviderId === e.id ? '<span class="applied-badge">active</span>' : '';
    const appliedCls = workspace.appliedProviderId === e.id ? ' applied' : '';
    return `<div class="panel provider-card eco-cp-card${appliedCls}" data-id="${esc(e.id)}" role="button" tabindex="0">
      <div class="pc-head">
        <div class="pc-logo-sm">${logo}</div>
        <div class="provider-meta"><b>${esc(e.name)}</b><span class="provider-compat">${esc(e.category || 'unknown')}</span></div>
      </div>
      <div class="pc-card-foot">
        <span class="badge pi-src">ecosystem</span>${stateBadge}${cfgBadge}${appliedBadge}
      </div>
      <div class="pc-intel-row"><span class="pi-status">discovery only</span></div>
    </div>`;
  }
  function ecoInitials(name) {
    return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }

  const search = document.getElementById('cpSearch');
  if (search) {
    search.value = q;
    search.addEventListener('input', (e) => { q = e.target.value; drawGrid(); });
  }
  drawFilters();
  drawGrid();

  // Always re-sync intelligence on mount — providerIntel may be non-empty but
  // stale (e.g. populated before a custom provider was created), which would
  // otherwise leave new custom cards showing "· not checked".
  fetchProviderIntel().then(() => { if (document.body.dataset.page === 'cloud-providers') drawGrid(); }).catch(() => {});
  if (!workspace.ecoDiscovered) {
    fetch('/api/ecosystem/providers?registryState=discovered').then((r) => r.json()).then((d) => { workspace.ecoDiscovered = d.providers || []; if (document.body.dataset.page === 'cloud-providers') drawGrid(); }).catch(() => {});
  }
  // Always re-pull the adopted (dyn:) index on mount so newly adopted / edited /
  // deleted providers are reflected without a full page reload (matches the
  // custom-provider fetch just below).
  fetch('/api/providers?origin=ecosystem').then((r) => r.json()).then((d) => { workspace.dynamicProviders = d.providers || []; if (document.body.dataset.page === 'cloud-providers') drawGrid(); }).catch(() => {});

  fetch('/api/custom-providers').then(r => r.json()).then((d) => { customProviders = d.providers || []; drawGrid(); }).catch(() => {});

  window.refreshCloudProviders = renderCloudProviders;
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
  const state = { type: 'all' };
  openModal({
    title: 'Execution history', size: 'wide', bodyHTML: '<div class="muted pg-hist-loading">Loading…</div>',
    onMount: (body) => {
      const passes = (e) => {
        if (state.type === 'cloud') return e.source !== 'local';
        if (state.type === 'local') return e.source === 'local';
        if (state.type === 'failed') return e.status === 'failed' || e.success === false;
        if (state.type === 'success') return e.success === true;
        return true;
      };
      const rerender = () => {
        const list = execs.filter(passes);
        const chips = [['all', 'All'], ['cloud', 'Cloud'], ['local', 'Local'], ['success', 'Success'], ['failed', 'Failed']]
          .map(([k, label]) => `<button class="pg-hist-chip ${state.type === k ? 'on' : ''}" data-type="${k}">${label}</button>`).join('');
        const items = list.length ? list.map((e) => `
          <div class="pg-hist-item clickable" data-idx="${execs.indexOf(e)}">
            <div class="pg-hist-top"><b class="mono">${esc(e.model || '—')}</b><span class="badge ${e.success ? 'ok' : 'bad'}">${esc(e.status || '')}</span></div>
            <div class="pg-hist-meta">${esc((e.source === 'local' ? 'local · ' + (e.runtimeId || '') : 'cloud · ' + (e.providerId || '')))} · ${e.createdAt ? new Date(e.createdAt).toLocaleString() : ''}</div>
            <div class="pg-hist-prev">${esc((e.promptPreview || '').slice(0, 120))}</div>
          </div>`).join('') : '<div class="muted">No executions match this filter.</div>';
        body.innerHTML = `<div class="pg-hist-head">
            <div class="pg-hist-count">${execs.length} total · ${list.length} shown</div>
            <button class="btn btn2 sm" id="pgHistClear" type="button">Clear history</button>
          </div>
          <div class="pg-hist-filters">${chips}</div>
          <div class="pg-hist">${items}</div>`;
        body.querySelectorAll('.pg-hist-chip').forEach((c) => c.addEventListener('click', () => { state.type = c.dataset.type; rerender(); }));
        body.querySelectorAll('.pg-hist-item.clickable').forEach((el) => el.addEventListener('click', () => openExecutionDetail(execs[+el.dataset.idx])));
        const clr = body.querySelector('#pgHistClear');
        if (clr) clr.addEventListener('click', async () => {
          const ok = await confirmModal({
            title: 'Clear execution history?',
            message: 'This permanently removes all saved runs from this device. This cannot be undone.',
            confirmLabel: 'Clear', danger: true,
          });
          if (!ok) return;
          try {
            await playgroundService.clearHistory();
            notify.toast('Execution history cleared', 'success');
            const fresh = await historyStore.listExecutions();
            execs.length = 0; fresh.forEach((x) => execs.push(x));
            rerender();
          } catch { notify.toast('Could not clear history', 'error'); }
        });
      };
      rerender();
    },
  });
}

function openExecutionDetail(e) {
  if (!e) return;
  const out = e.contentPreview || '(no output captured)';
  const bodyHTML = `<div class="pg-det">
    <div class="kv"><span>Model</span><b class="mono">${esc(e.model || '—')}</b></div>
    <div class="kv"><span>Status</span><b><span class="badge ${e.success ? 'ok' : 'bad'}">${esc(e.status || '')}</span></b></div>
    <div class="kv"><span>Source</span><b>${esc(e.source === 'local' ? ('local · ' + (e.runtimeId || '')) : ('cloud · ' + (e.providerId || '')))}</b></div>
    <div class="kv"><span>When</span><b>${esc(e.createdAt ? new Date(e.createdAt).toLocaleString() : '—')}</b></div>
    ${e.metrics ? `<div class="kv"><span>Metrics</span><b class="mono">${esc(typeof e.metrics === 'string' ? e.metrics : JSON.stringify(e.metrics))}</b></div>` : ''}
    <h4 style="margin:14px 0 6px">Prompt</h4>
    <pre class="pg-pre">${esc(e.promptPreview || '(none)')}</pre>
    <h4 style="margin:14px 0 6px">Output</h4>
    <pre class="pg-pre">${esc(out)}</pre>
    ${e.error ? `<h4 style="margin:14px 0 6px">Error</h4><pre class="pg-pre err">${esc(e.error)}</pre>` : ''}
  </div>
  <div class="modal-actions"><button class="btn btn2" id="pgDetClose" type="button">Close</button></div>`;
  openModal({
    title: 'Run details', size: 'wide', bodyHTML,
    onMount: (b, ctrl) => { const c = b.querySelector('#pgDetClose'); if (c) c.addEventListener('click', () => ctrl.close()); },
  });
}
// Exposed globally so inline onclick handlers (Workspace "View all", Playground History) resolve it.
window.openExecutionHistory = openExecutionHistory;
// Exposed for inline onclick handlers (Provider Intelligence → monitor/benchmark) and the command palette.
window.openProviderIntelligence = openProviderIntelligence;
window.refreshProviderMonitoring = refreshProviderMonitoring;
window.runBenchmarkFor = runBenchmarkFor;

export async function renderPlayground() {
  updateCrumb('Playground');
  const section = document.getElementById('page-playground');
  if (!section) return;

  // Tear down any in-flight run from a previous mount.
  if (pgLiveTimer) { clearInterval(pgLiveTimer); pgLiveTimer = null; }
  if (pgES && pgES.abort) { try { pgES.abort(); } catch { /* ignore */ } }
  pgES = null; pgExecId = null;

  // Ensure the provider dropdown reflects dashboard changes (new custom
  // providers, ecosystem adoptions) — re-register the index every mount.
  await refreshProviderIndex();

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

