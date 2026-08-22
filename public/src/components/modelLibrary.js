import { esc } from '../components/util.js';
import { openModal } from '../components/modal.js';
import { modelService } from '../models/modelService.js';
import { getProvider } from '../providers/registry.js';
import { notify } from '../core/notifications.js';

// ═══════════════════════════════════════════════════════════════
//  Model Library (v0.8.0) — the enhanced Models explorer.
//
//  A single, searchable, filterable view over the unified model catalogue
//  (cloud + local). Every model carries an honest source-status badge
//  (LIVE / FALLBACK / CACHED / INSTALLED), free/paid marking, capability
//  flags, and a Details view. Plus workspace-aware Recommendations and a
//  secret-free Recent list. Also exports a unified picker for the config
//  workflow's model step.
// ═══════════════════════════════════════════════════════════════

function relTime(iso) {
  if (!iso) return 'unknown';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function statusBadge(sourceStatus) {
  const map = {
    'live': ['live', 'LIVE'],
    'fallback-website': ['fallback', 'FALLBACK'],
    'fallback-static': ['fallback', 'FALLBACK'],
    'cached': ['cached', 'CACHED'],
    'installed': ['installed', 'INSTALLED'],
  };
  const [cls, label] = map[sourceStatus] || ['cached', 'CACHED'];
  return `<span class="ml-status ${cls}">${label}</span>`;
}

function capBadge(cap, val) {
  if (val === true) return `<span class="ml-cap on">${esc(cap)}</span>`;
  if (val === false) return `<span class="ml-cap off">${esc(cap)}</span>`;
  return `<span class="ml-cap unk" title="unknown">${esc(cap)}?</span>`;
}

function modelRowHTML(m, currentId) {
  const freeBadge = m.isFree
    ? '<span class="badge free">free</span>'
    : (m.isPaid ? '<span class="badge paid">paid</span>' : '');
  const rec = m.recommended ? '<span class="ml-star" title="Recommended">★</span>' : '';
  return `
    <div class="ml-row ${currentId === m.id ? 'sel' : ''}" data-p="${esc(m.providerId)}" data-id="${esc(m.id)}">
      <div class="ml-row-main">
        <span class="ml-name mono">${esc(m.name || m.id)}</span>
        ${rec}
        <span class="ml-id">${esc(m.id)}</span>
      </div>
      <div class="ml-row-meta">
        <span class="ml-prov">${esc(m.providerName || m.providerId)}</span>
        ${statusBadge(m.sourceStatus)}
        ${freeBadge}
        ${m.capabilities && m.capabilities.chat ? '<span class="ml-cap on">chat</span>' : (m.capabilities && m.capabilities.chat === false ? '<span class="ml-cap off">non-chat</span>' : '<span class="ml-cap unk">chat?</span>')}
      </div>
      <div class="ml-row-acts">
        <button class="btn btn2 ml-use" data-p="${esc(m.providerId)}" data-id="${esc(m.id)}">Use</button>
        <button class="btn btn2 ml-det" data-p="${esc(m.providerId)}" data-id="${esc(m.id)}">Details</button>
      </div>
    </div>`;
}

function groupByProvider(models) {
  const groups = new Map();
  for (const m of models) {
    if (!groups.has(m.providerId)) groups.set(m.providerId, { providerName: m.providerName, providerId: m.providerId, sourceStatus: m.sourceStatus, items: [] });
    groups.get(m.providerId).items.push(m);
  }
  return [...groups.values()];
}

async function showDetails(providerId, modelId) {
  const detail = await modelService.getDetail(providerId, modelId);
  if (!detail) { notify.toast('Model details unavailable', 'warning'); return; }
  const prov = getProvider(providerId);
  const fmt = (v) => (v === null || v === undefined || v === '') ? '<span class="ml-cap unk">unknown</span>' : esc(String(v));
  const caps = detail.capabilities || {};
  const prov2 = detail.provenance || {};
  const fetched = prov2.fetchedAt ? new Date(prov2.fetchedAt).toLocaleString() : 'unknown';
  const bodyHTML = `
    <div class="ml-detail">
      <div class="ml-detail-head">
        <h4 class="mono">${esc(detail.name || detail.id)}</h4>
        <span class="ml-id">${esc(detail.id)}</span>
      </div>
      <div class="kv"><span>Provider</span><b>${esc(detail.providerName || detail.providerId)}</b></div>
      <div class="kv"><span>Kind</span><b>${esc(detail.kind)}</b></div>
      <div class="kv"><span>Source</span><b>${esc(detail.source || 'unknown')} · ${statusBadge(detail.sourceStatus)}</b></div>
      <div class="kv"><span>Pricing</span><b>${detail.pricing ? esc(JSON.stringify(detail.pricing)) : 'unknown'}</b></div>
      <div class="kv"><span>Free</span><b>${detail.isFree ? 'Yes' : (detail.isPaid ? 'No' : 'unknown')}</b></div>
      <div class="kv"><span>Context length</span><b>${fmt(detail.contextLength)}</b></div>
      <div class="kv"><span>Parameters</span><b>${fmt(detail.parameters)}</b></div>
      <div class="kv"><span>Size</span><b>${fmt(detail.size)}</b></div>
      <div class="kv"><span>Quantization</span><b>${fmt(detail.quantization)}</b></div>
      <div class="kv"><span>Installed</span><b>${detail.installed ? 'Yes' : 'No'}</b></div>
      <h4 style="margin:14px 0 6px">Capabilities</h4>
      <div class="ml-caps">
        ${capBadge('chat', caps.chat)}
        ${capBadge('vision', caps.vision)}
        ${capBadge('reasoning', caps.reasoning)}
        ${capBadge('tools', caps.tools)}
        ${capBadge('embeddings', caps.embeddings)}
      </div>
      <h4 style="margin:14px 0 6px">Provenance</h4>
      <div class="muted">Last fetched: ${esc(fetched)} · total in catalogue: ${esc(prov2.total ?? 'unknown')} · source: ${esc(prov2.source || 'unknown')}</div>
      ${detail.recommendationReason ? `<div class="ml-rec-note">★ ${esc(detail.recommendationReason)}</div>` : ''}
    </div>`;
  openModal({ title: 'Model details', subtitle: `${esc(prov ? prov.name : detail.providerId)} · honest metadata only`, size: 'wide', bodyHTML });
}

// ── Main explorer ──
export async function renderModelLibrary(host) {
  if (!host) return;
  host.innerHTML = '<div class="muted ml-loading">Loading model intelligence…</div>';

  let all = [];
  let stats = null;
  let recommended = [];
  let providerTests = {};
  try {
    [all, stats, recommended] = await Promise.all([
      modelService.getUnified({}),
      modelService.getStats(),
      modelService.getRecommended(),
    ]);
    const cloudIds = [...new Set(all.filter((m) => m.kind === 'cloud').map((m) => m.providerId))];
    const tests = await Promise.all(cloudIds.map((id) => modelService.getProviderTest(id).then((t) => [id, t])));
    providerTests = Object.fromEntries(tests);
  } catch (e) {
    host.innerHTML = '<div class="muted">Could not load the model catalogue.</div>';
    return;
  }

  const recent = modelService.getRecent();
  const filterState = { q: '', type: 'all', provider: '', free: false, chat: false };

  function providersList() {
    return [...new Set(all.map((m) => m.providerId))]
      .map((pid) => {
        const m = all.find((x) => x.providerId === pid);
        return { id: pid, name: m.providerName || pid };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function applyFilter() {
    let list = all;
    if (filterState.type === 'cloud') list = list.filter((m) => m.kind === 'cloud');
    if (filterState.type === 'local') list = list.filter((m) => m.kind === 'local');
    if (filterState.provider) list = list.filter((m) => m.providerId === filterState.provider);
    if (filterState.free) list = list.filter((m) => m.isFree);
    if (filterState.chat) list = list.filter((m) => m.capabilities && m.capabilities.chat === true);
    if (filterState.q) {
      const ql = filterState.q.toLowerCase();
      list = list.filter((m) => (m.id || '').toLowerCase().includes(ql) || (m.name || '').toLowerCase().includes(ql) || (m.providerName || '').toLowerCase().includes(ql));
    }
    return list;
  }

  function draw() {
    const list = applyFilter();
    const groups = groupByProvider(list);
    const recSet = new Set(recommended.map((r) => r.providerId + '::' + r.id));
    const cur = { ...currentSelection() };

    const statsChips = stats ? `
      <div class="ml-stats">
        <span class="ml-chip"><b>${stats.cloudTotal}</b> cloud</span>
        <span class="ml-chip"><b>${stats.cloudFree}</b> free</span>
        <span class="ml-chip"><b>${stats.cloudPaid}</b> paid</span>
        <span class="ml-chip"><b>${stats.localTotal}</b> local</span>
        <span class="ml-chip"><b>${stats.providersWithModels}</b> providers</span>
      </div>` : '';

    const recHTML = recommended.length ? `
      <div class="ml-section">
        <h3 class="ml-h">Recommended for your setup</h3>
        <div class="ml-rec-row">
          ${recommended.map((m) => `
            <div class="ml-rec-card" data-p="${esc(m.providerId)}" data-id="${esc(m.id)}">
              <div class="ml-rec-top"><span class="mono">${esc(m.name || m.id)}</span>${m.isFree ? '<span class="badge free">free</span>' : ''}</div>
              <div class="muted">${esc(m.providerName || m.providerId)}</div>
              <div class="ml-rec-reason">${esc(m.recommendationReason || '')}</div>
            </div>`).join('')}
        </div>
      </div>` : '';

    const recentHTML = recent.length ? `
      <div class="ml-section">
        <h3 class="ml-h">Recent</h3>
        <div class="ml-recent">
          ${recent.map((m) => `<button class="chipx ml-recent-chip" data-p="${esc(m.providerId)}" data-id="${esc(m.id)}">${esc(m.name || m.id)} <span class="muted">· ${esc(m.providerName)}</span></button>`).join('')}
          <button class="chipx ml-recent-clear" title="Clear recent">clear</button>
        </div>
      </div>` : '';

    const listHTML = groups.length ? groups.map((g) => {
      const test = providerTests[g.providerId];
      const testHTML = test ? `<span class="ml-test ${test.status >= 200 && test.status < 300 ? 'ok' : 'bad'}" title="Last tested ${esc(relTime(test.at))}">${test.status >= 200 && test.status < 300 ? '✓ tested' : '✕ test failed'} · ${esc(relTime(test.at))}</span>` : '';
      return `
      <div class="ml-group">
        <div class="ml-group-head">
          <span class="ml-group-name">${esc(g.providerName)}</span>
          ${statusBadge(g.sourceStatus)}
          ${testHTML}
          <span class="ml-count">${g.items.length}</span>
        </div>
        <div class="ml-rows">
          ${g.items.map((m) => modelRowHTML(m, cur[m.providerId])).join('')}
        </div>
      </div>`;
    }).join('') : '<div class="muted">No models match your filters.</div>';

    host.innerHTML = `
      <div class="ml-toolbar">
        <div class="ml-stats-wrap">${statsChips}</div>
        <button class="btn btn2 ml-refresh" id="mlRefresh">↻ Refresh catalogue</button>
      </div>
      <div class="ml-filters">
        <input class="inp ml-search" placeholder="Search models across providers…" aria-label="Search models" />
        <div class="ml-seg">
          <button class="ml-seg-btn on" data-type="all">All</button>
          <button class="ml-seg-btn" data-type="cloud">Cloud</button>
          <button class="ml-seg-btn" data-type="local">Local</button>
        </div>
        <select class="inp ml-prov-sel"><option value="">All providers</option>${providersList().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        <label class="ml-toggle"><input type="checkbox" class="ml-free-chk"> Free only</label>
        <label class="ml-toggle"><input type="checkbox" class="ml-chat-chk"> Chat</label>
      </div>
      ${recHTML}
      ${recentHTML}
      <div class="ml-list">${listHTML}</div>`;

    wire(host, list);
  }

  function wire(root, list) {
    const search = root.querySelector('.ml-search');
    search.addEventListener('input', (e) => { filterState.q = e.target.value; draw(); });
    root.querySelectorAll('.ml-seg-btn').forEach((b) => b.addEventListener('click', () => {
      filterState.type = b.dataset.type;
      root.querySelectorAll('.ml-seg-btn').forEach((x) => x.classList.toggle('on', x === b));
      draw();
    }));
    root.querySelector('.ml-prov-sel').addEventListener('change', (e) => { filterState.provider = e.target.value; draw(); });
    root.querySelector('.ml-free-chk').addEventListener('change', (e) => { filterState.free = e.target.checked; draw(); });
    root.querySelector('.ml-chat-chk').addEventListener('change', (e) => { filterState.chat = e.target.checked; draw(); });
    root.querySelector('#mlRefresh').addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.classList.add('spinning');
      try {
        await modelService.refresh();
        all = await modelService.getUnified({});
        recommended = await modelService.getRecommended();
        stats = await modelService.getStats();
        notify.toast('Model catalogue refreshed', 'success');
        draw();
      } catch { notify.toast('Refresh failed', 'error'); }
      finally { btn.disabled = false; btn.classList.remove('spinning'); }
    });

    root.querySelectorAll('.ml-row, .ml-rec-card, .ml-recent-chip').forEach((el) => {
      if (el.classList.contains('ml-recent-clear')) return;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.ml-det')) { showDetails(el.dataset.p, el.dataset.id); return; }
        if (e.target.closest('.ml-use')) { useModel(el.dataset.p, el.dataset.id); return; }
        // Clicking the row opens details (unless it's an action button).
        if (e.target.closest('.ml-use') || e.target.closest('.ml-det')) return;
        showDetails(el.dataset.p, el.dataset.id);
      });
    });
    root.querySelectorAll('.ml-det').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); showDetails(b.dataset.p, b.dataset.id); }));
    root.querySelectorAll('.ml-use').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); useModel(b.dataset.p, b.dataset.id); }));
    const clearBtn = root.querySelector('.ml-recent-clear');
    if (clearBtn) clearBtn.addEventListener('click', (e) => { e.stopPropagation(); modelService.clearRecent(); notify.toast('Recent cleared', 'info'); draw(); });
  }

  function currentSelection() {
    const sel = {};
    try {
      for (const m of all) {
        const stored = localStorage.getItem('gw_model_' + m.providerId);
        if (stored) sel[m.providerId] = stored;
      }
    } catch { /* ignore */ }
    return sel;
  }

  function useModel(providerId, modelId) {
    const model = all.find((m) => m.providerId === providerId && m.id === modelId) || { providerId, id: modelId };
    modelService.addRecent(model);
    if (window.useModel) window.useModel(providerId, modelId);
    else notify.toast(`Selected ${modelId}`, 'success');
    draw();
  }

  draw();
}

// ── Unified picker for the config workflow (cloud step) ──
// Mirrors the existing modelPicker UX but reads the unified catalogue so it
// shows source status, free/paid, and capability honestly.
export async function renderModelPickerUnified(host, providerId, opts = {}) {
  const { onSelect = null, includePaid = false, current = '', showPaidToggle = true } = opts;
  const provider = getProvider(providerId);
  if (!provider) return host;
  const wrap = document.createElement('div');
  wrap.className = 'model-picker ml-picker';
  wrap.innerHTML = `
    ${showPaidToggle ? `<label class="paid-toggle mp-paid"><input type="checkbox" ${includePaid ? 'checked' : ''}><span class="paid-track"></span><span class="paid-text">Include paid</span></label>` : ''}
    <input class="inp mp-input" type="text" placeholder="Search models…" aria-label="Search models" />
    <div class="mp-list ml-picker-list" role="listbox"></div>`;
  host.appendChild(wrap);

  const input = wrap.querySelector('.mp-input');
  const list = wrap.querySelector('.mp-list');
  let showPaid = includePaid;
  let query = '';
  let models = [];

  async function load() {
    models = await modelService.getUnified({ provider: providerId, free: showPaid ? false : true });
    draw();
  }

  function draw() {
    const q = query.trim().toLowerCase();
    const matches = models.filter((m) => !q || (m.id || '').toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q));
    if (!matches.length) {
      list.innerHTML = `<div class="mp-empty">${models.length ? 'No models match “' + esc(query) + '”.' : 'Loading models…'}</div>`;
      return;
    }
    list.innerHTML = matches.map((m) => `
      <button type="button" class="mp-item ${current === m.id ? 'sel' : ''}" data-id="${esc(m.id)}" role="option">
        <span class="mp-name">${esc(m.name || m.id)}</span>
        ${m.isFree ? '<span class="mp-free">free</span>' : '<span class="badge paid">paid</span>'}
        ${statusBadge(m.sourceStatus)}
        <span class="mp-id">${esc(m.id)}</span>
        <button class="btn btn2 ml-det-sm" data-id="${esc(m.id)}" title="Details">ⓘ</button>
      </button>`).join('');
    list.querySelectorAll('.mp-item').forEach((b) => b.addEventListener('click', (e) => {
      if (e.target.closest('.ml-det-sm')) return;
      const id = b.dataset.id;
      list.querySelectorAll('.mp-item').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      if (onSelect) onSelect(id);
    }));
    list.querySelectorAll('.ml-det-sm').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); showDetails(providerId, b.dataset.id); }));
  }

  const paidToggle = wrap.querySelector('.mp-paid input');
  if (paidToggle) paidToggle.addEventListener('change', (e) => { showPaid = e.target.checked; load(); });
  input.addEventListener('input', () => { query = input.value; draw(); });
  load();
  return wrap;
}
