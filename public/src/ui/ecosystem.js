// Ecosystem Discovery (v2.1.0) — simplified discovery experience.
// Shows discovered providers, sources, and adoption workflow.
import { esc } from '../components/util.js';
import { router } from '../core/router.js';
import { notify } from '../core/notifications.js';
import { openModal } from '../components/modal.js';
import { workspace } from '../core/state.js';

let ecoCache = { all: [], sources: [], summary: {} };
let ecoFilter = 'all';
let ecoSearch = '';

function formatCtx(n) {
  if (!n) return '';
  if (n >= 1e6) return (Math.round((n / 1e6) * 10) / 10) + 'M';
  if (n >= 1e3) return (Math.round((n / 1e3) * 10) / 10) + 'K';
  return String(n);
}

function statCard(label, value, sub = '') {
  return `<div class="stat eco-stat"><b>${esc(String(value ?? 0))}</b><span>${esc(label)}</span>${sub ? `<div class="stat-sub muted">${esc(sub)}</div>` : ''}</div>`;
}
function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
function badge(text, kind = '') { return `<span class="badge ${kind}">${esc(String(text))}</span>`; }
function timeLabel(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'never';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ecoLogoHtml(p) {
  if (p.logo) {
    const src = '/api/ecosystem/logo?url=' + encodeURIComponent(p.logo);
    return `<img class="eco-logo" src="${src}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'" />
      <span class="eco-logo-fallback" style="display:none">${esc(initials(p.name))}</span>`;
  }
  return `<span class="eco-logo-fallback">${esc(initials(p.name))}</span>`;
}

function registryBadge(state) {
  const map = { discovered: 'badge-info', review: 'badge-warn', adopted: 'badge-ok', ignored: 'badge-muted' };
  return badge(state, map[state] || 'badge-muted');
}

async function fetchEcosystem() {
  const [p, s, sum] = await Promise.all([
    fetch('/api/ecosystem/providers').then((r) => r.json()).catch(() => ({ providers: [] })),
    fetch('/api/ecosystem/sources').then((r) => r.json()).catch(() => ({ sources: [] })),
    fetch('/api/ecosystem/summary').then((r) => r.json()).catch(() => ({})),
  ]);
  ecoCache = { all: p.providers || [], sources: s.sources || [], summary: sum };
  return ecoCache;
}

function filteredProviders() {
  let list = ecoCache.all;
  if (ecoFilter !== 'all') list = list.filter((p) => (p.registryState || 'discovered') === ecoFilter);
  if (ecoSearch) {
    const q = ecoSearch.toLowerCase().trim();
    list = list.filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.normalizedName || '').toLowerCase().includes(q) ||
      (p.website || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.sources || []).some((s) => (s.sourceName || '').toLowerCase().includes(q)) ||
      (p.models || []).some((m) => (m.name || m.modelId || '').toLowerCase().includes(q))
    );
  }
  return list;
}

function providerCard(p) {
  const isNew = p.discoveredAt && (Date.now() - new Date(p.discoveredAt).getTime()) < 7 * 86400000;
  const models = p.models || [];
  const modelCount = models.length;
  const modelChips = models.slice(0, 3).map((m) => `<span class="chip chip-sm">${esc(m.name || m.modelId)}</span>`).join(' ');
  const sourceNames = (p.sources || []).map((s) => s.sourceName).filter(Boolean).join(', ');
  return `<div class="card eco-card" data-id="${esc(p.id)}" role="button" tabindex="0">
    <div class="eco-card-head">
      <div class="eco-logo-wrap">${ecoLogoHtml(p)}</div>
      <div class="eco-card-meta"><b>${esc(p.name)}</b><span class="muted">${esc(sourceNames)}</span></div>
    </div>
    <div class="eco-card-badges">
      ${registryBadge(p.registryState || 'discovered')}
      ${badge(p.category || 'unknown', 'badge-muted')}
      ${modelCount ? badge(`${modelCount} model${modelCount === 1 ? '' : 's'}`, 'badge-ok') : badge('no models', 'badge-warn')}
      ${isNew ? badge('NEW', 'badge-ok') : ''}
    </div>
    <div class="eco-card-desc muted">${esc((p.description || '').slice(0, 120))}</div>
    ${modelCount ? `<div class="eco-card-models">${modelChips}${modelCount > 3 ? `<span class="chip chip-sm muted">+${modelCount - 3} more</span>` : ''}</div>` : ''}
    <div class="eco-card-foot muted">seen ${timeLabel(p.lastSeenAt)} · ${esc((p.sources || []).length)} source(s)${p.modelsFetchedAt ? ` · models fetched ${timeLabel(p.modelsFetchedAt)}` : ''}</div>
    <div class="eco-card-actions">
      <button class="btn btn-sm" onclick="event.stopPropagation();window.openEcosystemProvider('${esc(p.id)}')">Details</button>
      <button class="btn btn-sm" onclick="event.stopPropagation();window.ecosystemAction('validate','${esc(p.id)}')">Validate</button>
      ${p.registryState !== 'adopted' ? `<button class="btn btn-sm btn-go" onclick="event.stopPropagation();window.ecosystemAction('adopt','${esc(p.id)}')">Adopt</button>` : ''}
      ${p.registryState === 'adopted' ? `<button class="btn btn-sm" onclick="event.stopPropagation();window.openAdoptedProvider('${esc(p.dynamicId)}')">Open</button>` : ''}
      ${p.registryState === 'ignored' ? `<button class="btn btn-sm" onclick="event.stopPropagation();window.ecosystemAction('restore','${esc(p.id)}')">Restore</button>` : `<button class="btn btn-sm" onclick="event.stopPropagation();window.ecosystemAction('ignore','${esc(p.id)}')">Ignore</button>`}
    </div>
  </div>`;
}

async function openEcosystemProvider(id) {
  let p;
  try {
    const r = await fetch('/api/ecosystem/providers/' + encodeURIComponent(id));
    if (!r.ok) { notify.toast('Provider not found', 'error'); return; }
    p = (await r.json()).provider;
  } catch { notify.toast('Failed to load provider', 'error'); return; }

  const val = p.validation || {};
  const VAL_DEFS = [
    { label: 'Identity', v: val.identity, ok: ['confirmed', 'likely'], bad: ['unlikely'] },
    { label: 'Website', v: val.websiteReachable, ok: [true], bad: [false] },
    { label: 'API docs', v: val.apiDocumented, ok: [true], bad: [false] },
    { label: 'Endpoint', v: val.endpointPubliclyKnown, ok: [true], bad: [false] },
    { label: 'Models', v: val.modelsObserved, ok: [true], bad: [false] },
    { label: 'Configurable', v: val.configurable, ok: [true], bad: [false] },
  ];
  const valRow = ({ label, v, ok, bad }) => {
    const st = ok.includes(v) ? 'ok' : bad.includes(v) ? 'bad' : 'unk';
    const ic = st === 'ok' ? '✓' : st === 'bad' ? '✕' : '·';
    const text = v == null ? 'unknown' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
    return `<div class="eco-val-item eco-val-${st}" title="${esc(label)}: ${esc(text)}"><span class="eco-val-ic">${ic}</span><span>${esc(label)}</span></div>`;
  };

  const models = p.models || [];
  const totalModels = models.length;
  const MODEL_LIMIT = 40;
  const modelChips = models.slice(0, MODEL_LIMIT).map((m) => `<span class="chip chip-sm" title="${esc(m.name || m.modelId)}">${esc(m.name || m.modelId)}</span>`).join('');
  const canFetch = (p.sources || []).some((s) => ['openrouter', 'huggingface', 'litellm'].includes(s.sourceId));
  const hasLinks = p.website || p.documentationUrl;

  openModal({
    title: p.name,
    subtitle: (p.category || 'unknown') + ' · ' + (p.registryState || 'discovered'),
    size: 'wide',
    bodyHTML: `
      <div class="eco-detail">
        ${p.dynamicId ? `<div class="eco-reg-added">Added to Provider Registry · <a href="#" onclick="event.preventDefault();window.openAdoptedProvider('${esc(p.dynamicId)}')">Open in Cloud Providers →</a></div>` : ''}
        <div class="eco-detail-head">
          <div class="eco-logo-wrap lg">${ecoLogoHtml(p)}</div>
          <div>
            <div class="eco-detail-name">${esc(p.name)}</div>
            <div class="muted">${esc(p.description || '')}</div>
            <div class="eco-detail-links">
              ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">Website</a>` : ''}
              ${p.documentationUrl ? `<a href="${esc(p.documentationUrl)}" target="_blank" rel="noopener noreferrer">Docs</a>` : ''}
              ${hasLinks ? '<span class="muted">·</span>' : ''}
              <span class="muted">${(p.sources || []).map((s) => esc(s.sourceName)).filter(Boolean).join(', ') || 'no source metadata'}</span>
            </div>
            <div class="eco-detail-badges">${registryBadge(p.registryState || 'discovered')}${badge(p.accessType || 'unknown', 'badge-muted')}${p.modelsFetchedAt ? badge('models ' + timeLabel(p.modelsFetchedAt), 'badge-ok') : ''}</div>
          </div>
        </div>
        <div class="eco-cols">
          <div>
            <h3>Validation <span class="muted">· ${val.lastValidatedAt ? 'checked ' + timeLabel(val.lastValidatedAt) : 'not yet checked'}</span></h3>
            <div class="eco-val">${VAL_DEFS.map(valRow).join('')}</div>
            <h3>Models <span class="muted">(${totalModels}${p.modelsFetchedAt ? ` · fetched ${timeLabel(p.modelsFetchedAt)}` : ' · discovered'})</span></h3>
            ${totalModels ? `<div class="eco-models">
              ${modelChips}
            </div>
            ${totalModels > MODEL_LIMIT ? `<div class="muted eco-mmore">+${totalModels - MODEL_LIMIT} more models — click “Fetch full model list” to see all.</div>` : ''}`
            : '<div class="muted">No models observed from discovery. Fetch them from the source API.</div>'}
            ${canFetch ? `
            <div class="eco-foot-row">
              <button class="btn btn-sm btn-go" id="ecoFetchModels" onclick="window.ecoFetchModels('${esc(id)}')">
                ${totalModels ? 'Fetch full model list' : 'Fetch models'}
              </button>
            </div>` : ''}
          </div>
          <div>
            <h3>Sources</h3>
            <div class="eco-src-list">
              ${(p.sources || []).map((s) => `<div>${badge(s.sourceId, 'badge-muted')} <span class="muted">${esc(s.trustLevel || '')} · ${esc(s.sourceName || '')}</span></div>`).join('') || '<div class="muted">No source metadata.</div>'}
            </div>
            ${p.endpoints && p.endpoints.length ? `<h3>Endpoints</h3><div class="eco-src-list">${p.endpoints.map((e) => `<div class="muted">${esc(e.type || '')}: <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.url)}</a></div>`).join('')}</div>` : ''}
            ${p.repository ? `<h3>Repository</h3><div class="eco-src-list"><div><a href="${esc(p.repository)}" target="_blank" rel="noopener noreferrer">${esc(p.repository)}</a></div></div>` : ''}
          </div>
        </div>
      </div>`,
  });
}

export async function renderEcosystem() {
  const root = document.getElementById('page-ecosystem');
  if (!root) return;
  root.innerHTML = `
    <div class="page-head">
      <h1>Ecosystem Discovery</h1>
      <p>AI providers discovered from trusted sources. Adopt providers to add them to your workspace.</p>
    </div>
    <div class="ic-toolbar">
      <div class="seg eco-filter" id="ecoFilter">
        ${['all', 'discovered', 'review', 'adopted', 'ignored'].map((f) => `<button class="seg-btn ${f === ecoFilter ? 'active' : ''}" data-f="${f}" onclick="ecosystemSetFilter('${f}')">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
      </div>
      <button class="btn btn-go" id="ecoDiscover" onclick="ecosystemDiscover()">Refresh Sources</button>
    </div>
    <div id="ecoBody" class="ic-body"><div class="ic-loading muted">Loading ecosystem…</div></div>`;
  await renderEcoBody(root);
}

async function renderEcoBody(root) {
  const body = root.querySelector('#ecoBody');
  if (!body) return;
  try { await fetchEcosystem(); } catch (e) { body.innerHTML = `<div class="ic-empty"><span>Could not load ecosystem. ${esc(String(e.message || e))}</span></div>`; return; }
  const sum = ecoCache.summary || {};
  const overview = `<div class="ic-overview">
    ${statCard('Curated', sum.curatedProviders || 0)}
    ${statCard('Discovered', sum.discoveredProviders || 0)}
    ${statCard('New', sum.newlyDiscovered || 0, 'last 7 days')}
    ${statCard('Needs review', sum.needsReview || 0)}
  </div>`;

  const sources = `<section class="ic-section">
    <h2 class="ic-h2">Discovery Sources</h2>
    <div class="eco-sources">
      ${ecoCache.sources.length ? ecoCache.sources.map((s) => `
        <div class="card eco-source ${s.status === 'failed' ? 'eco-src-bad' : ''}">
          <div class="eco-src-head"><b>${esc(s.name)}</b>${s.stale ? badge('stale', 'badge-warn') : ''}</div>
          <div class="eco-src-meta muted">${esc(s.type)} · trust: ${esc(s.trustLevel)}</div>
          <div class="eco-src-foot">
            ${badge(s.status, s.status === 'ok' ? 'badge-ok' : s.status === 'failed' ? 'badge-warn' : 'badge-muted')}
            <span class="muted">${s.candidatesFound || 0} found</span>
            <span class="muted">${timeLabel(s.lastRefresh)}</span>
          </div>
          ${s.failureReason ? `<div class="eco-src-err muted">${esc(s.failureReason)}</div>` : ''}
        </div>`).join('') : '<div class="muted">No sources configured.</div>'}
    </div>
  </section>`;

  body.innerHTML = overview + sources + gridHtml();
}

function gridHtml() {
  const list = filteredProviders();
  return `<section class="ic-section" id="ecoGridSection">
    <div class="eco-grid-head">
      <h2 class="ic-h2">Discovered Providers <span class="muted" id="ecoGridCount">(${list.length})</span></h2>
      <div class="eco-search-wrap">
        <input type="search" class="eco-search" id="ecoSearch" placeholder="Search providers or models…" value="${esc(ecoSearch)}" oninput="ecosystemSearch(this.value)">
      </div>
    </div>
    <div id="ecoGridList">${gridListHtml()}</div>
  </section>`;
}

function gridListHtml() {
  const list = filteredProviders();
  return list.length
    ? `<div class="ic-grid">${list.map(providerCard).join('')}</div>`
    : `<div class="ic-empty"><span>No providers match. ${ecoSearch ? 'Try a different search.' : 'Refresh sources to discover.'}</span></div>`;
}

function renderEcoGrid() {
  const root = document.getElementById('page-ecosystem');
  if (!root) return;
  const countEl = root.querySelector('#ecoGridCount');
  if (countEl) countEl.textContent = `(${filteredProviders().length})`;
  const listEl = root.querySelector('#ecoGridList');
  if (listEl) listEl.innerHTML = gridListHtml();
}

window.ecosystemSetFilter = (f) => {
  ecoFilter = f;
  document.querySelectorAll('#ecoFilter .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.f === f));
  const root = document.getElementById('page-ecosystem');
  if (root) renderEcoBody(root);
};
let ecoSearchTimer = null;
window.ecosystemSearch = (q) => {
  ecoSearch = q;
  clearTimeout(ecoSearchTimer);
  ecoSearchTimer = setTimeout(renderEcoGrid, 120);
};
window.ecoFetchModels = async (id) => {
  const btn = document.getElementById('ecoFetchModels');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching models…'; }
  try {
    const r = await fetch(`/api/ecosystem/providers/${encodeURIComponent(id)}/fetch-models`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) { notify.toast(d.error || 'Failed to fetch models', 'error'); return; }
    notify.toast(`Fetched ${d.modelCount} models from ${d.enrichedFrom || 'source'}`, 'success');
    // Adopted providers: mirror the fresh model list into the Cloud Providers grid.
    try {
      const dynRes = await fetch('/api/providers?origin=ecosystem').then(r => r.json()).catch(() => null);
      if (dynRes && Array.isArray(dynRes.providers)) {
        workspace.dynamicProviders = dynRes.providers;
        if (document.body.dataset.page === 'cloud-providers' && window.renderCloudProviders) window.renderCloudProviders();
      }
    } catch { /* non-fatal */ }
  } catch (e) { notify.toast('Failed to fetch models: ' + (e.message || e), 'error'); }
  if (window.openEcosystemProvider) window.openEcosystemProvider(id);
  const root = document.getElementById('page-ecosystem'); if (root) await renderEcoBody(root);
  if (btn) { btn.disabled = false; btn.textContent = 'Fetch models'; }
};
window.ecosystemDiscover = async () => {
  const btn = document.getElementById('ecoDiscover');
  if (btn) { btn.disabled = true; btn.textContent = 'Discovering…'; }
  try {
    const r = await fetch('/api/ecosystem/discover', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) notify.toast(`Discovery complete — ${d.newlyDiscovered} new`, 'success');
    else notify.toast(d.message || 'Discovery failed', 'error');
  } catch (e) { notify.toast('Discovery failed: ' + (e.message || e), 'error'); }
  const root = document.getElementById('page-ecosystem');
  if (root) await renderEcoBody(root);
  if (btn) { btn.disabled = false; btn.textContent = 'Refresh Sources'; }
};
window.ecosystemAction = async (token, id) => {
  const map = { adopt: ['adopt', 'Adopted'], ignore: ['ignore', 'Ignored'], restore: ['restore', 'Restored'], validate: ['validate', 'Validated'] };
  const m = map[token];
  if (!m) return;
  try {
    const r = await fetch(`/api/ecosystem/providers/${encodeURIComponent(id)}/${m[0]}`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { notify.toast(d.error || 'Action failed', 'error'); return; }
    if (token === 'adopt' && d.adoption) {
      notify.toast(d.adoption.success ? `Adopted ${d.provider?.name || id}` : `${d.adoption.reason || 'Adoption skipped'}`, d.adoption.success ? 'success' : 'warning');
    } else {
      notify.toast(`${m[1]} ${d.provider?.name || id}`, 'success');
    }
    await openEcosystemProvider(id);
    const root = document.getElementById('page-ecosystem'); if (root) await renderEcoBody(root);
    if (token === 'adopt' && d.adoption?.success) {
      // Mirror the freshly adopted provider into the Cloud Providers index so its
      // card is present the moment the user opens it (no stale workspace cache).
      try {
        const dynRes = await fetch('/api/providers?origin=ecosystem').then((r) => r.json()).catch(() => null);
        if (dynRes && Array.isArray(dynRes.providers)) workspace.dynamicProviders = dynRes.providers;
      } catch { /* non-fatal */ }
      if (window.refreshCloudProviders) window.refreshCloudProviders();
    }
  } catch (e) { notify.toast('Action failed: ' + (e.message || e), 'error'); }
};
window.openEcosystemProvider = (id) => openEcosystemProvider(id);

// Open an adopted provider straight from the Ecosystem page. Jump to the Cloud
// Providers page, switch to the Adopted filter, refresh the provider index so the
// adopted card is present, and open its FULL configuration dialog — the same
// modal custom provider cards use (editable base URL, API key, model picker with
// paid toggle/search, test connection, apply to Claude Code / copyable config,
// provider integration, edit, delete).
window.openAdoptedProvider = async (dynamicId) => {
  if (!dynamicId) { notify.toast('No adopted record for this provider', 'warning'); return; }
  router.navigate('cloud-providers');
  try {
    const res = await fetch('/api/providers?origin=ecosystem').then((r) => r.json()).catch(() => ({ providers: null }));
    if (Array.isArray(res.providers)) {
      workspace.dynamicProviders = res.providers;
      if (window.renderCloudProviders) window.renderCloudProviders({ registryFilter: 'adopted' });
    }
  } catch { /* best-effort: the dialog still opens below */ }
  if (window.openCustomProvider) window.openCustomProvider(dynamicId);
  else notify.toast('Provider dialog unavailable', 'error');
};
