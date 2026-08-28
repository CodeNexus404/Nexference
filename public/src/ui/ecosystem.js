// Ecosystem Discovery UI (v1.7.0) — the new, separate discovery experience.
// Surfaces discovered providers with honest provenance: every fact links back to its
// source, logos resolve safely through the validated proxy, and adoption is explicit.
//
// It deliberately does NOT mix discovered providers into the configuration flow
// unless a provider is adopted AND validation supports it.
import { esc } from '../components/util.js';
import { router } from '../core/router.js';
import { notify } from '../core/notifications.js';
import { openModal, closeModal } from '../components/modal.js';
import { renderTimeline } from '../components/intelligenceTimeline.js';

// Local mirror of the server-side vocabulary (the browser bundle cannot import the
// server module). Kept in sync with src/server/providers/ecosystem/constants.js.
const CATEGORY_LABELS = {
  'direct-provider': 'Direct Provider', 'model-aggregator': 'Model Aggregator', 'inference-provider': 'Inference Provider',
  'api-gateway': 'API Gateway', 'proxy-service': 'Proxy Service', 'local-runtime': 'Local Runtime',
  'model-catalog': 'Model Catalog', 'community-project': 'Community Project', unknown: 'Unknown',
};
const REGISTRY_STATES = { discovered: 'discovered', review: 'review', adopted: 'adopted', ignored: 'ignored', duplicate: 'duplicate', deprecated: 'deprecated' };
const LOGO_SOURCE = { CURATED: 'curated', OFFICIAL: 'official', SOURCE_PROVIDED: 'source-provided', FAVICON: 'favicon', GITHUB: 'github', FALLBACK: 'fallback' };

let ecoCache = { all: [], sources: [] };
let ecoFilter = 'all';

function initialState() { return ecoFilter; }
function statCard(label, value, sub = '') {
  return `<div class="stat eco-stat"><b>${esc(String(value))}</b><span>${esc(label)}</span>${sub ? `<div class="stat-sub muted">${esc(sub)}</div>` : ''}</div>`;
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
  if (p.logo && p.logoSource && p.logoSource !== LOGO_SOURCE.FALLBACK) {
    const src = '/api/ecosystem/logo?url=' + encodeURIComponent(p.logo);
    return `<img class="eco-logo" src="${src}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'" />
      <span class="eco-logo-fallback" style="display:none">${esc(initials(p.name))}</span>`;
  }
  return `<span class="eco-logo-fallback">${esc(initials(p.name))}</span>`;
}

function registryBadge(state) {
  const map = {
    discovered: 'badge-info', review: 'badge-warn', adopted: 'badge-ok', ignored: 'badge-muted', duplicate: 'badge-muted', deprecated: 'badge-warn',
  };
  return badge(state, map[state] || 'badge-muted');
}
function statusBadge(s) { return badge(s, s === 'validated' || s === 'available' ? 'badge-ok' : s === 'unavailable' || s === 'deprecated' ? 'badge-warn' : 'badge-info'); }

async function fetchEcosystem() {
  const [p, s, sum] = await Promise.all([
    fetch('/api/ecosystem/providers').then((r) => r.json()),
    fetch('/api/ecosystem/sources').then((r) => r.json()),
    fetch('/api/ecosystem/summary').then((r) => r.json()),
  ]);
  ecoCache = { all: p.providers || [], sources: s.sources || [], summary: sum };
  return ecoCache;
}

function filteredProviders() {
  let list = ecoCache.all;
  if (ecoFilter !== 'all') list = list.filter((p) => (p.registryState || 'discovered') === ecoFilter);
  return list;
}

export async function renderEcosystem() {
  const root = document.getElementById('page-ecosystem');
  if (!root) return;
  root.innerHTML = `
    <div class="page-head">
      <h1>Ecosystem Discovery</h1>
      <p>An evidence-based registry of AI providers, gateways, aggregators and catalogues discovered from trusted sources. Discovered providers stay separate from your configuration until explicitly adopted.</p>
    </div>
    <div class="ic-toolbar">
      <div class="seg eco-filter" id="ecoFilter">
        ${['all', 'discovered', 'review', 'adopted', 'ignored'].map((f) => `<button class="seg-btn ${f === ecoFilter ? 'active' : ''}" data-f="${f}" onclick="ecosystemSetFilter('${f}')">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
      </div>
      <button class="btn btn-go" id="ecoDiscover" onclick="ecosystemDiscover()">↻ Refresh Sources</button>
    </div>
    <div id="ecoBody" class="ic-body"><div class="ic-loading muted">Loading ecosystem…</div></div>`;
  await renderEcoBody(root);
}

async function renderEcoBody(root) {
  const body = root.querySelector('#ecoBody');
  if (!body) return;
  try { await fetchEcosystem(); } catch (e) { body.innerHTML = `<div class="ic-empty"><span>Could not load ecosystem data. ${esc(String(e.message || e))}</span></div>`; return; }
  const sum = ecoCache.summary || {};
  const overview = `<div class="ic-overview">
    ${statCard('Curated providers', sum.curatedProviders || 0)}
    ${statCard('Discovered', sum.discoveredProviders || 0)}
    ${statCard('Newly discovered', sum.newlyDiscovered || 0, 'last 7 days')}
    ${statCard('Needs review', sum.needsReview || 0)}
    ${statCard('Stale sources', sum.staleSources || 0)}
  </div>`;

  const sources = `<section class="ic-section">
    <h2 class="ic-h2">Discovery Sources</h2>
    <div class="eco-sources">
      ${ecoCache.sources.map((s) => `
        <div class="card eco-source ${s.status === 'failed' ? 'eco-src-bad' : ''}">
          <div class="eco-src-head"><b>${esc(s.name)}</b>${s.stale ? badge('stale', 'badge-warn') : ''}</div>
          <div class="eco-src-meta muted">${esc(s.type)} · trust: ${esc(s.trustLevel)}</div>
          <div class="eco-src-foot">
            ${badge(s.status, s.status === 'ok' ? 'badge-ok' : s.status === 'failed' ? 'badge-warn' : 'badge-muted')}
            <span class="muted">${s.candidatesFound || 0} found</span>
            <span class="muted">${timeLabel(s.lastRefresh)}</span>
          </div>
          ${s.failureReason ? `<div class="eco-src-err muted">${esc(s.failureReason)}</div>` : ''}
        </div>`).join('')}
    </div>
  </section>`;

  const list = filteredProviders();
  const grid = `<section class="ic-section">
    <h2 class="ic-h2">Discovered Providers</h2>
    ${list.length ? `<div class="ic-grid">${list.map(providerCard).join('')}</div>` : `<div class="ic-empty"><span>No providers in this view. Run a refresh to discover from configured sources.</span></div>`}
  </section>`;

  body.innerHTML = overview + sources + grid;
  body.querySelectorAll('.eco-card').forEach((c) => {
    c.addEventListener('click', () => openEcosystemProvider(c.dataset.id));
  });
}

function providerCard(p) {
  const isNew = p.discoveredAt && (Date.now() - new Date(p.discoveredAt).getTime()) < 7 * 86400000;
  const badges = [
    registryBadge(p.registryState || 'discovered'),
    statusBadge(p.discoveryStatus || 'discovered'),
    badge(p.category || 'unknown', 'badge-muted'),
    ...(p.duplicateState === 'likely-duplicate' ? [badge('likely dup', 'badge-warn')] : []),
    ...(isNew ? [badge('NEW', 'badge-ok')] : []),
  ].join(' ');
  const actions = actionButtons(p);
  return `<div class="card eco-card" data-id="${esc(p.id)}" role="button" tabindex="0">
    <div class="eco-card-head">
      <div class="eco-logo-wrap">${ecoLogoHtml(p)}</div>
      <div class="eco-card-meta"><b>${esc(p.name)}</b><span class="muted">${esc(p.sourceLabel || (p.sources && p.sources[0] ? p.sources[0].sourceName : ''))}</span></div>
    </div>
    <div class="eco-card-badges">${badges}</div>
    <div class="eco-card-desc muted">${esc((p.description || '').slice(0, 120))}</div>
    <div class="eco-card-foot muted">seen ${timeLabel(p.lastSeenAt)} · ${esc((p.sources || []).length)} source(s)</div>
    <div class="eco-card-actions">${actions}</div>
  </div>`;
}

function actionButtons(p) {
  const id = esc(p.id);
  const adoptable = p.registryState !== 'adopted' && p.registryState !== 'ignored';
  return [
    `<button class="btn btn-sm" onclick="event.stopPropagation();openEcosystemProvider('${id}')">Details</button>`,
    `<button class="btn btn-sm" onclick="event.stopPropagation();ecosystemAction('validate','${id}')">Validate</button>`,
    adoptable ? `<button class="btn btn-sm btn-go" onclick="event.stopPropagation();ecosystemAction('adopt','${id}')">Adopt</button>` : '',
    p.registryState === 'ignored' ? `<button class="btn btn-sm" onclick="event.stopPropagation();ecosystemAction('restore','${id}')">Restore</button>` : `<button class="btn btn-sm" onclick="event.stopPropagation();ecosystemAction('ignore','${id}')">Ignore</button>`,
  ].join('');
}

async function openEcosystemProvider(id) {
  let p;
  try {
    const r = await fetch('/api/ecosystem/providers/' + encodeURIComponent(id));
    if (!r.ok) { notify.toast('Provider not found', 'error'); return; }
    p = (await r.json()).provider;
  } catch (e) { notify.toast('Failed to load provider', 'error'); return; }

  const changes = await fetch('/api/provider-changes?provider=' + encodeURIComponent(id) + '&limit=15').then((r) => r.json()).then((d) => d.changes || []).catch(() => []);
  const evidenceEvents = (p.evidence || []).map((e, i) => ({
    id: 'ev' + i, kind: 'evidence', title: `${e.field}: ${e.value}`, description: `via ${e.sourceId} (${e.sourceType})`, category: e.sourceType, severity: 'INFO', confidence: e.confidence, timestamp: e.observedAt, action: null,
  }));

  const val = p.validation || {};
  const valRows = [
    ['Identity', val.identity], ['Website reachable', val.websiteReachable], ['API documented', val.apiDocumented],
    ['Endpoint public', val.endpointPubliclyKnown], ['Models observed', val.modelsObserved], ['Configurable', val.configurable],
  ].map(([k, v]) => `<div class="eco-kv"><span class="muted">${esc(k)}</span><span>${v == null ? 'unknown' : esc(String(v))}</span></div>`).join('');

  const sourcesList = (p.sources || []).map((s) => `<li><b>${esc(s.sourceName || s.sourceId)}</b> · ${esc(s.sourceType)} · trust ${esc(s.trustLevel)} ${s.found ? '' : '(not seen this run)'}</li>`).join('');

  const models = (p.models || []).slice(0, 12).map((m) => `<span class="chip chip-sm">${esc(m.name || m.modelId)}</span>`).join(' ');

  openModal({
    title: p.name,
    subtitle: (CATEGORY_LABELS[p.category] || p.category || 'unknown') + ' · ' + (p.registryState || 'discovered'),
    size: 'wide',
    bodyHTML: `
      <div class="eco-detail">
        <div class="eco-detail-head">
          <div class="eco-logo-wrap lg">${ecoLogoHtml(p)}</div>
          <div>
            <div class="eco-detail-name">${esc(p.name)}</div>
            <div class="muted">${esc(p.description || '')}</div>
            <div class="eco-detail-links">
              ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : ''}
              ${p.documentationUrl ? `<a href="${esc(p.documentationUrl)}" target="_blank" rel="noopener noreferrer">Docs ↗</a>` : ''}
              ${p.apiDocumentationUrl ? `<a href="${esc(p.apiDocumentationUrl)}" target="_blank" rel="noopener noreferrer">API Docs ↗</a>` : ''}
            </div>
            <div class="eco-detail-badges">${registryBadge(p.registryState || 'discovered')} ${statusBadge(p.discoveryStatus || 'discovered')} ${badge('logo: ' + (p.logoSource || 'fallback'), 'badge-muted')}</div>
          </div>
        </div>

        <div class="eco-cols">
          <div>
            <h3>Validation</h3>
            <div class="eco-kv-grid">${valRows}</div>
            <h3>Compatibility</h3>
            <div class="muted">${p.compatibility ? esc(JSON.stringify(p.compatibility)) : 'Not claimed by sources.'}</div>
            <h3>Discovered models</h3>
            <div>${models || '<span class="muted">None observed.</span>'}</div>
          </div>
          <div>
            <h3>Sources &amp; provenance</h3>
            <ul class="eco-src-list">${sourcesList || '<li class="muted">No source recorded.</li>'}</ul>
          </div>
        </div>

        <h3>Evidence</h3>
        ${renderTimeline(evidenceEvents, { emptyText: 'No evidence recorded.' })}
        <h3>Recent changes</h3>
        ${renderTimeline(changes, { emptyText: 'No recorded changes.' })}
      </div>`,
    onMount: () => {},
  });
}

// ── Global action dispatch (inline onclick handlers) ──
window.ecosystemSetFilter = (f) => { ecoFilter = f; const root = document.getElementById('page-ecosystem'); if (root) renderEcoBody(root); };
window.ecosystemDiscover = async () => {
  const btn = document.getElementById('ecoDiscover');
  if (btn) { btn.disabled = true; btn.textContent = 'Discovering…'; }
  try {
    const r = await fetch('/api/ecosystem/discover', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) notify.toast(`Discovery complete — ${d.newlyDiscovered} new, ${d.discovered} total`, 'success');
    else notify.toast(d.message || 'Discovery failed', 'error');
  } catch (e) { notify.toast('Discovery failed: ' + (e.message || e), 'error'); }
  const root = document.getElementById('page-ecosystem');
  if (root) await renderEcoBody(root);
  if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh Sources'; }
};
window.ecosystemAction = async (token, id) => {
  const map = {
    adopt: ['adopt', 'Adopted'], ignore: ['ignore', 'Ignored'], restore: ['restore', 'Restored'], review: ['review', 'Marked for review'], validate: ['validate', 'Validated'],
  };
  const m = map[token];
  if (!m) { notify.toast('Unknown action', 'warning'); return; }
  try {
    let url = `/api/ecosystem/providers/${encodeURIComponent(id)}/${m[0]}`;
    const r = await fetch(url, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { notify.toast(d.error || 'Action failed', 'error'); return; }
    notify.toast(`${m[1]} ${d.provider?.name || id}`, 'success');
    // Keep the detail modal fresh when open.
    await openEcosystemProvider(id);
    const root = document.getElementById('page-ecosystem'); if (root) await renderEcoBody(root);
  } catch (e) { notify.toast('Action failed: ' + (e.message || e), 'error'); }
};
window.openEcosystemProvider = (id) => openEcosystemProvider(id);
