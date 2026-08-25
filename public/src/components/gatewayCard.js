import { esc, norm, logoHtml, monoOf } from './util.js';
import { workspace, getFreeModels, getModels, getModelSource, isFetching } from '../core/state.js';
import { Storage } from '../core/storage.js';
import { pick, openProviderIntelligence } from '../ui/app.js';

const DS_LABEL = {
  verified: 'Verified', observed: 'Observed', curated: 'Curated', stale: 'Stale',
  unavailable: 'Unavailable', deprecated: 'Deprecated', unknown: 'Unknown',
};
function dsDotClass(ds) { return 'ds-' + (ds || 'unknown'); }

// Gateway card component — builds the DOM for a single provider card. Extracted
// verbatim from the original app.js createGatewayCard; it now reads model/state
// through the workspace + selectors and emits the same inline handlers (resolved
// as global functions at click time). No markup or behaviour changed.
export function createGatewayCard(provider) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = provider.id;
  card.style.setProperty('--card-accent', provider.accent);
  card.onclick = () => pick(provider.id);

  const key = Storage.getKey(provider.id);
  const model = Storage.getModel(provider.id);
  const FORMAT_META = {
    anthropic: { label: 'Anthropic', color: '#d98a5b' },
    openai: { label: 'OpenAI', color: '#10a37f' },
    gemini: { label: 'Gemini', color: '#4285f4' },
  };
  const fmtMeta = FORMAT_META[provider.format] || { label: provider.format, color: provider.accent };
  const ccBadge = provider.claudeCode
    ? '<span class="badge cc">Claude Code</span>'
    : '<span class="badge browse">Browse · API</span>';
  const CLIENT_META = {
    Anthropic: { label: 'Anthropic', color: '#d98a5b' },
    OpenAI: { label: 'OpenAI', color: '#10a37f' },
    Gemini: { label: 'Gemini', color: '#4285f4' },
  };
  const clients = provider.id === 'openrouter' || provider.id === 'custom'
    ? ['Anthropic', 'OpenAI']
    : (provider.format === 'anthropic' ? ['Anthropic'] : provider.format === 'openai' ? ['OpenAI'] : ['Gemini']);
  const hasKey = !!key;

  const freeModels = getFreeModels(provider.id);
  const allModels = getModels(provider.id);
  const hasLiveModels = allModels.length > 0;
  const modelCount = freeModels.length;
  const totalCount = allModels.length;
  const needsKey = !provider.publicModels && !provider.hasCustomUrl && !key;
  const fetching = isFetching(provider.id);
  const source = getModelSource(provider.id);
  const showPaid = Storage.getPaid(provider.id);
  const listModels = showPaid ? allModels : freeModels;
  const freeIds = new Set(freeModels.map(m => m.id));

  const modelDisplay = (!needsKey && model) ? model : '';

  const isCustom = !!provider.hasCustomUrl;
  const statusClass = isCustom ? (model ? 'live' : 'pending') : (hasLiveModels ? 'live' : 'pending');

  // Honest loading-state text so users know whether models are live, cached, or
  // a fallback catalogue — never silently fail.
  let statusText;
  if (isCustom) {
    statusText = model ? esc(model) : 'custom endpoint';
  } else if (fetching) {
    statusText = 'Fetching models…';
  } else if (hasLiveModels) {
    const tag = source === 'static' ? 'fallback catalogue' : 'live list';
    statusText = `${modelCount} free · ${totalCount} total · ${tag}`;
  } else if (needsKey) {
    statusText = 'needs API key';
  } else {
    statusText = 'cached list';
  }

  card.innerHTML = `
    <div class="card-top">
      <div class="card-ico">${logoHtml(provider)}</div>
      <div class="card-id">
        <div class="card-name">
          ${provider.name}
          <span class="configured-badge" id="keybadge-${provider.id}" style="${hasKey ? '' : 'display:none'}">configured</span>
          ${workspace.appliedProviderId === provider.id ? '<span class="applied-badge">active</span>' : ''}
        </div>
        <div class="card-sub">${provider.sub}</div>
      </div>
      <div class="card-status">
        <span class="status-indicator ${statusClass}"></span>
        <span class="sync-time">${statusText}</span>
      </div>
    </div>

    <div class="badges">
      ${clients.map(c => `<span class="badge client" style="border-color:${CLIENT_META[c].color}33;background:${CLIENT_META[c].color}1a;color:${CLIENT_META[c].color}"><span class="fmt-dot" style="background:${CLIENT_META[c].color}"></span>${CLIENT_META[c].label}</span>`).join('')}
      ${ccBadge}
      <span class="badge cnt">${isCustom ? 'custom model' : modelCount + ' free · ' + totalCount + ' total'}</span>
    </div>

    <div class="card-desc">${provider.desc}</div>

    ${provider.hasCustomUrl ? '' : `
    <div class="model-now">
      <span class="mn-label">Current Model</span>
      <span class="mn-val" title="${esc(modelDisplay)}">${esc(modelDisplay)}</span>
    </div>

    <div class="inp-row model-head" onclick="event.stopPropagation()">
      <label class="inp-label">Model</label>
      <label class="paid-toggle" title="Show paid models in the list">
        <input type="checkbox" ${showPaid ? 'checked' : ''} onchange="togglePaid('${provider.id}', this.checked)">
        <span class="paid-track"></span>
        <span class="paid-text">Paid</span>
      </label>
    </div>`}
    ${provider.hasCustomUrl ? `
    <div class="inp-row" onclick="event.stopPropagation()">
      <input class="inp base-url-${provider.id}" type="text" value="${esc(workspace.customUrl)}" placeholder="Gateway base URL (e.g. https://your-gateway.com/v1/)" oninput="setCustomUrl(this.value)">
      <select class="fmt-sel" onchange="setFmt(this.value)">
        <option value="anthropic" ${workspace.customFormat === 'anthropic' ? 'selected' : ''}>Anthropic</option>
        <option value="openai" ${workspace.customFormat === 'openai' ? 'selected' : ''}>OpenAI</option>
      </select>
    </div>
    <div class="inp-row" onclick="event.stopPropagation()" style="margin-top:8px">
      <input class="inp api-key-${provider.id}" type="password" placeholder="Enter API key…" value="${esc(key)}" oninput="setKey('${provider.id}', this.value)">
    </div>
    <div class="inp-row" onclick="event.stopPropagation()" style="margin-top:8px">
      <input class="inp model-${provider.id}" type="text" value="${esc(workspace.customModel)}" placeholder="Model ID (e.g. claude-sonnet-4-5)" oninput="setCustomModel(this.value)">
    </div>
    ` : `
    <div class="inp-row" onclick="event.stopPropagation()">
      <input class="inp api-key-${provider.id}" type="password" placeholder="${provider.publicModels ? 'API key (optional)…' : 'Enter API key…'}"
             value="${esc(key)}" oninput="setKey('${provider.id}', this.value)">
      ${provider.signup ? `<a class="getkey" href="${provider.signup}" target="_blank" onclick="event.stopPropagation()" title="Get a free key">get key →</a>` : ''}
    </div>

    <div class="inp-row" onclick="event.stopPropagation()" style="margin-top: 8px;">
      <div class="model-select-wrapper">
        ${hasLiveModels
          ? `<select class="inp model-${provider.id}" onchange="chooseModel('${provider.id}', this.value)">
              ${listModels.map(m => `<option value="${esc(m.id)}" ${model === m.id ? 'selected' : ''}>${esc(m.name || m.id)}${freeIds.has(m.id) ? '  ·free' : ''}</option>`).join('')}
            </select>`
          : `<input class="inp model-${provider.id}" type="text" value="${esc(model)}" placeholder="Enter model ID (e.g. ${provider.format === 'openai' ? 'gpt-4o' : 'claude-sonnet-4'})" oninput="setModel('${provider.id}', this.value)">`}
        <button class="btn-refresh refresh-${provider.id}" onclick="event.stopPropagation(); refreshProviderModels('${provider.id}')" title="Refresh models from provider" aria-label="Refresh models">
          <svg class="refresh-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
      </div>
    </div>
    `}
    <div class="inp-row" onclick="event.stopPropagation()" style="margin-top: 8px;">
      <button type="button" class="btn btn-test test-btn-${provider.id}" onclick="event.stopPropagation(); testConnection('${provider.id}', ${provider.hasCustomUrl ? `document.querySelector('.base-url-${provider.id}').value || '${norm(provider.baseUrl)}'` : `'${norm(provider.baseUrl)}'`})">Test Connection</button>
      <button type="button" class="btn btn-go" onclick="event.stopPropagation(); handleApply(event, '${provider.id}')">Apply Config</button>
    </div>
  `;

  // Overlay provider-discovery intelligence (v1.4.0) — honest only.
  const intel = workspace.providerIntel[provider.id];
  if (intel) {
    const ds = intel.status?.discoveryStatus;
    const changeN = workspace.providerChangeCounts[provider.id] || 0;
    const last = intel.source?.lastCheckedAt ? relTimeLocal(intel.source.lastCheckedAt) : 'not checked';
    const changeBadge = changeN ? `<span class="badge pi-change" title="Recent discovery changes">${changeN}</span>` : '';
    const row = document.createElement('div');
    row.className = 'gw-intel';
    row.innerHTML = `<span class="pi-dot ${dsDotClass(ds)}" title="${esc(DS_LABEL[ds] || ds)}"></span>` +
      `<span class="gw-intel-status">${esc(DS_LABEL[ds] || ds || 'unknown')}</span>` +
      changeBadge +
      `<span class="gw-intel-checked">· ${esc(last)}</span>` +
      `<button class="btn btn2 sm pi-details" data-id="${esc(provider.id)}" type="button" title="Provider intelligence">Intel</button>`;
    card.appendChild(row);
    const det = row.querySelector('.pi-details');
    if (det) det.addEventListener('click', (e) => { e.stopPropagation(); openProviderIntelligence(provider.id); });
  }

  return card;
}

function relTimeLocal(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
