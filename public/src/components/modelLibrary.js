import { esc } from '../components/util.js';
import { openModal } from '../components/modal.js';
import { modelService } from '../models/modelService.js';
import { getProvider } from '../providers/registry.js';
import { notify } from '../core/notifications.js';
import { historyStore } from '../playground/historyStore.js';

// ═══════════════════════════════════════════════════
//  Model Library (v0.9.0) — the enhanced Models explorer.
//
//  A single, searchable, filterable gallery over the unified model catalogue
//  (cloud + local). Every model carries an honest source-status badge
//  (LIVE / FALLBACK / CACHED / INSTALLED), free/paid marking, capability
//  flags, and a Details view. Plus workspace-aware Recommendations and a
//  secret-free Recent list.
//
//  Buttons are functional, not decorative:
//    • Use        → selects the model as active AND opens the Playground
//                   preloaded with it (so it is immediately runnable).
//    • Details    → opens the honest-metadata modal, which also offers
//                   "Open in Playground".
// ═══════════════════════════════════════════════════

function relTime(iso) {
  if (!iso) return '—';
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
  return ''; // unknown → omit rather than show a misleading "?"
}

function capChips(caps) {
  if (!caps) return '';
  const order = ['chat', 'vision', 'reasoning', 'tools', 'embeddings'];
  const html = order.filter((c) => caps[c]).map((c) => `<span class="ml-cap on">${esc(c)}</span>`).join('');
  return html ? `<div class="ml-caps">${html}</div>` : '';
}

function starsHTML(n) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<span class="rec-star ${i <= v ? 'on' : 'off'}">${i <= v ? '★' : '☆'}</span>`;
  return `<span class="rec-stars" aria-label="${v} out of 5 stars">${s}</span>`;
}

function fitsBadge(fits) {
  if (fits === true) return '<span class="ml-fit good">Fits your device</span>';
  if (fits === false) return '<span class="ml-fit warn">May not fit</span>';
  return '<span class="ml-fit unknown">Fit unknown</span>';
}

async function showDetails(providerId, modelId) {
  const detail = await modelService.getDetail(providerId, modelId);
  if (!detail) { notify.toast('Model details unavailable', 'warning'); return; }
  const prov = getProvider(providerId);
  const DASH = '—';
  const fmt = (v) => (v === null || v === undefined || v === '') ? DASH : esc(String(v));
  const caps = detail.capabilities || {};
  const prov2 = detail.provenance || {};
  const fetched = prov2.fetchedAt ? new Date(prov2.fetchedAt).toLocaleString() : DASH;
  const isLocal = detail.kind === 'local' || detail.providerFormat === 'local';

  // For local models, pull the device-aware rating/reason from the
  // recommendation engine so the dialog reflects the user's actual hardware.
  let rec = null;
  let devInfo = null;
  if (isLocal) {
    try {
      const recData = await modelService.getLocalRecommendations();
      devInfo = recData.device || null;
      rec = (recData.models || []).find((r) =>
        r.runtime === providerId && (r.id === modelId || r.installedName === modelId));
    } catch { /* recommendations are best-effort */ }
  }

  // Only render spec rows that actually carry data — no "—" clutter.
  const rows = [];
  const addRow = (label, valueHTML) => {
    if (valueHTML == null || valueHTML === '') return;
    rows.push(`<div class="kv"><span>${esc(label)}</span><b>${valueHTML}</b></div>`);
  };
  addRow('Provider', esc(detail.providerName || detail.providerId || DASH));
  addRow('Source', `${detail.source ? esc(detail.source) + ' · ' : ''}${statusBadge(detail.sourceStatus || DASH)}`);
  if (detail.pricing) addRow('Pricing', esc(typeof detail.pricing === 'string' ? detail.pricing : JSON.stringify(detail.pricing)));
  if (detail.isFree === true || detail.isPaid === true) addRow('Free', detail.isFree ? 'Yes' : 'No');
  if (detail.contextLength != null) addRow('Context length', fmt(detail.contextLength));
  if (detail.parameters) addRow('Parameters', esc(typeof detail.parameters === 'string' ? detail.parameters : JSON.stringify(detail.parameters)));
  if (detail.size) addRow('Size', esc(detail.size));
  if (detail.quantization) addRow('Quantization', esc(detail.quantization));
  if (detail.installed === true || detail.installed === false) addRow('Installed', detail.installed ? 'Yes' : 'No');

  const capBadges = ['chat', 'vision', 'reasoning', 'tools', 'embeddings']
    .map((c) => capBadge(c, caps[c])).join('');
  const capHTML = capBadges || '<span class="muted">No capability data reported.</span>';

  // ── Recommended-for-your-device section (local models only) ──
  let recSection = '';
  if (isLocal && rec) {
    const devChips = [];
    if (devInfo && devInfo.ramGB != null) devChips.push(`<span class="ml-devchip">${esc(devInfo.ramGB)} GB RAM · ${esc(devInfo.ramTier || 'unknown')} tier</span>`);
    if (devInfo && devInfo.gpuName) devChips.push(`<span class="ml-devchip">${esc(devInfo.gpuName)}</span>`);
    else if (devInfo && devInfo.gpuVram != null) devChips.push(`<span class="ml-devchip">${esc(devInfo.gpuVram)} GB VRAM</span>`);
    recSection = `
      <section class="ml-dsec ml-dsec-rec">
        <h4 class="ml-dsec-h">Recommended for your device</h4>
        <div class="ml-rec-stars">${starsHTML(rec.rating)}<span class="ml-rec-rating">${esc(rec.rating != null ? rec.rating + '/5' : '—')}</span></div>
        ${rec.reason ? `<p class="ml-rec-reason">${esc(rec.reason)}</p>` : ''}
        <div class="ml-rec-meta">
          ${fitsBadge(rec.fits)}
          ${devChips.join('')}
          ${devInfo && devInfo.estimate ? '<span class="ml-devchip muted">estimated</span>' : ''}
        </div>
      </section>`;
  } else if (detail.recommendationReason) {
    recSection = `
      <section class="ml-dsec">
        <h4 class="ml-dsec-h">Recommendation</h4>
        <div class="ml-rec-note">★ ${esc(detail.recommendationReason)}</div>
      </section>`;
  }

  const provHTML = `<div class="muted">Last fetched: ${esc(fetched)} · total in catalogue: ${esc(prov2.total != null ? prov2.total : DASH)} · source: ${esc(prov2.source || DASH)}</div>`;

  const bodyHTML = `
    <div class="ml-detail">
      <div class="ml-detail-head">
        <div class="ml-dh-title">
          <h3 class="ml-dh-name">${esc(detail.name || detail.id)}</h3>
          <code class="ml-id">${esc(detail.id)}</code>
        </div>
        <div class="ml-dh-badges">
          ${statusBadge(detail.sourceStatus || DASH)}
          ${detail.kind ? `<span class="badge">${esc(detail.kind)}</span>` : ''}
        </div>
      </div>

      ${recSection}

      <section class="ml-dsec">
        <h4 class="ml-dsec-h">Specifications</h4>
        <div class="ml-kv-grid">${rows.join('')}</div>
      </section>

      <section class="ml-dsec">
        <h4 class="ml-dsec-h">Capabilities</h4>
        <div class="ml-caps">${capHTML}</div>
      </section>

      <section class="ml-dsec">
        <h4 class="ml-dsec-h">Provenance</h4>
        ${provHTML}
      </section>
    </div>
    <div class="modal-actions">
      <button class="btn btn2" id="mlDetClose" type="button">Close</button>
      <button class="btn btn-go" id="mlDetGo" type="button">Open in Playground</button>
    </div>`;

  openModal({
    title: 'Model details',
    subtitle: `${esc(prov ? prov.name : detail.providerId)} · honest metadata only`,
    size: 'wide',
    bodyHTML,
    onMount: (body, ctrl) => {
      body.querySelector('#mlDetClose').addEventListener('click', () => ctrl.close());
      body.querySelector('#mlDetGo').addEventListener('click', () => {
        useAndGo(providerId, modelId, detail.kind, detail.runtimeId);
      });
    },
  });
}

// ── A single model as a gallery card ──
function modelCardHTML(m, isUsing) {
  const freeBadge = m.isFree
    ? '<span class="badge free">free</span>'
    : (m.isPaid ? '<span class="badge paid">paid</span>' : '');
  const rec = m.recommended ? '<span class="ml-rec-star" title="Recommended for your setup">★</span>' : '';
  const useLabel = isUsing ? 'Using ✓' : 'Use';
  return `
    <article class="ml-card ${isUsing ? 'using' : ''}" style="--d:${(m._i || 0) * 0.025}s" data-p="${esc(m.providerId)}" data-id="${esc(m.id)}" data-kind="${esc(m.kind || 'cloud')}" data-rt="${esc(m.runtimeId || '')}">
      <header class="ml-card-top">
        <div class="ml-titles">
          <h3 class="ml-name">${esc(m.name || m.id)}</h3>
          <code class="ml-id">${esc(m.id)}</code>
        </div>
        ${rec}
      </header>
      <div class="ml-card-meta">
        <span class="ml-prov">${esc(m.providerName || m.providerId)}</span>
        ${statusBadge(m.sourceStatus)}
        ${freeBadge}
      </div>
      ${capChips(m.capabilities)}
      <footer class="ml-card-acts">
        <button class="btn btn-go ml-use" data-p="${esc(m.providerId)}" data-id="${esc(m.id)}" data-kind="${esc(m.kind || 'cloud')}" data-rt="${esc(m.runtimeId || '')}">${useLabel}</button>
        <button class="btn btn2 ml-details" data-p="${esc(m.providerId)}" data-id="${esc(m.id)}">Details</button>
      </footer>
    </article>`;
}

// Select a model as active AND drop the user into the Playground with it
// preloaded, so "Use" is a real, observable action — not a silent preference.
async function useAndGo(providerId, modelId, kind, runtimeId) {
  if (window.useModel) window.useModel(providerId, modelId);
  const draft = { source: kind === 'local' ? 'local' : 'cloud', model: modelId };
  if (kind === 'local') draft.runtimeId = runtimeId || 'ollama';
  else draft.providerId = providerId;
  try { historyStore.saveDraft(draft); } catch { /* ignore */ }
  if (window.navigate) window.navigate('playground');
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
      list = list.filter((m) => {
        if ((m.id || '').toLowerCase().includes(ql)) return true;
        if ((m.name || '').toLowerCase().includes(ql)) return true;
        if ((m.providerName || '').toLowerCase().includes(ql)) return true;
        const caps = m.capabilities || {};
        if (['chat', 'vision', 'reasoning', 'tools', 'embeddings'].some((c) => caps[c] && c.includes(ql))) return true;
        return false;
      });
    }
    return list;
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

  // Render the (stateful) toolbar + filters ONCE. The dynamic area below is the
  // only part re-rendered on filter changes, so search keeps focus/state.
  function buildShell() {
    const statsChips = stats ? `
      <div class="ml-stats">
        <span class="ml-chip"><b>${stats.cloudTotal}</b> cloud</span>
        <span class="ml-chip"><b>${stats.cloudFree}</b> free</span>
        <span class="ml-chip"><b>${stats.cloudPaid}</b> paid</span>
        <span class="ml-chip"><b>${stats.localTotal}</b> local</span>
        <span class="ml-chip"><b>${stats.providersWithModels}</b> providers</span>
      </div>` : '';
    host.innerHTML = `
      <div class="ml-page">
        <div class="ml-bar">
          <div class="ml-bar-top">
            ${statsChips}
            <button class="btn btn2 ml-refresh" id="mlRefresh">↻ Refresh catalogue</button>
          </div>
          <div class="ml-filters">
            <span class="ml-search-wrap">
              <span class="ml-search-ico" aria-hidden="true">⌕</span>
              <input class="inp ml-search" placeholder="Search models, providers, capabilities…" aria-label="Search models" value="${esc(filterState.q)}" />
            </span>
            <div class="ml-seg">
              <button class="ml-seg-btn ${filterState.type === 'all' ? 'on' : ''}" data-type="all">All</button>
              <button class="ml-seg-btn ${filterState.type === 'cloud' ? 'on' : ''}" data-type="cloud">Cloud</button>
              <button class="ml-seg-btn ${filterState.type === 'local' ? 'on' : ''}" data-type="local">Local</button>
            </div>
            <select class="inp ml-prov-sel"><option value="">All providers</option>${providersList().map((p) => `<option value="${esc(p.id)}" ${filterState.provider === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
            <label class="ml-toggle"><input type="checkbox" class="ml-free-chk" ${filterState.free ? 'checked' : ''}> Free only</label>
            <label class="ml-toggle"><input type="checkbox" class="ml-chat-chk" ${filterState.chat ? 'checked' : ''}> Chat</label>
            <button class="btn btn2 sm ml-clear-filters" id="mlClearFilters" type="button" hidden>Clear filters</button>
          </div>
        </div>
        <div id="mlDyn"></div>
      </div>`;
    wireStatic(host);
  }

  // Re-render only the dynamic area (search/segment/toggle state persists).
  function draw() {
    const list = applyFilter();
    const cur = currentSelection();
    const isUsing = (m) => cur[m.providerId] === m.id;
    const searching = !!filterState.q;
    const activeFilters = filterState.type !== 'all' || filterState.provider || filterState.free || filterState.chat || filterState.q;

    const recHTML = (!searching && recommended.length) ? `
      <div class="ml-section">
        <h3 class="ml-h">Recommended for your setup</h3>
        <div class="ml-strip">${recommended.map((m) => `
          <div class="ml-rec-card" data-p="${esc(m.providerId)}" data-id="${esc(m.id)}">
            <div class="ml-rec-top"><span class="mono">${esc(m.name || m.id)}</span>${m.isFree ? '<span class="badge free">free</span>' : ''}</div>
            <div class="muted">${esc(m.providerName || m.providerId)}</div>
            <div class="ml-rec-reason">${esc(m.recommendationReason || '')}</div>
          </div>`).join('')}</div>
      </div>` : '';

    const recentHTML = (!searching && recent.length) ? `
      <div class="ml-section">
        <h3 class="ml-h">Recent</h3>
        <div class="ml-recent">${recent.map((m) => `<button class="chipx ml-recent-chip" data-p="${esc(m.providerId)}" data-id="${esc(m.id)}">${esc(m.name || m.id)} <span class="muted">· ${esc(m.providerName)}</span></button>`).join('')}<button class="chipx ml-recent-clear" title="Clear recent">clear</button></div>
      </div>` : '';

    const countLine = `<div class="ml-count-row">
        <span class="ml-count">${list.length} model${list.length === 1 ? '' : 's'}${activeFilters ? ' (filtered)' : ''}</span>
      </div>`;
    const cards = list.length
      ? list.map((m, i) => { m._i = i; return modelCardHTML(m, isUsing(m)); }).join('')
      : '<div class="muted ml-empty">No models match your filters.</div>';

    const dyn = host.querySelector('#mlDyn');
    if (!dyn) return;
    dyn.innerHTML = `${recHTML}${recentHTML}${countLine}<div class="ml-grid">${cards}</div>`;
    const clearBtn = host.querySelector('#mlClearFilters');
    if (clearBtn) clearBtn.hidden = !activeFilters;
    wireDyn(dyn);
  }

  // Listeners bound once to the persistent filter controls.
  function wireStatic(root) {
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
    root.querySelector('#mlRefresh').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true; btn.classList.add('spinning');
      try {
        await modelService.refresh();
        all = await modelService.getUnified({});
        recommended = await modelService.getRecommended();
        stats = await modelService.getStats();
        notify.toast('Model catalogue refreshed', 'success');
        buildShell(); draw();
      } catch { notify.toast('Refresh failed', 'error'); }
      finally { btn.disabled = false; btn.classList.remove('spinning'); }
    });
    const clearBtn = root.querySelector('#mlClearFilters');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      filterState.q = ''; filterState.type = 'all'; filterState.provider = ''; filterState.free = false; filterState.chat = false;
      const s = root.querySelector('.ml-search'); if (s) s.value = '';
      root.querySelectorAll('.ml-seg-btn').forEach((x) => x.classList.toggle('on', x.dataset.type === 'all'));
      const sel = root.querySelector('.ml-prov-sel'); if (sel) sel.value = '';
      const f = root.querySelector('.ml-free-chk'); if (f) f.checked = false;
      const c = root.querySelector('.ml-chat-chk'); if (c) c.checked = false;
      draw();
    });
  }

  // Listeners bound to the dynamic area after each draw().
  function wireDyn(root) {
    root.querySelectorAll('.ml-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // let button handlers own the click
        showDetails(el.dataset.p, el.dataset.id);
      });
    });
    root.querySelectorAll('.ml-use').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      useAndGo(b.dataset.p, b.dataset.id, b.dataset.kind, b.dataset.rt);
    }));
    root.querySelectorAll('.ml-details').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      showDetails(b.dataset.p, b.dataset.id);
    }));
    root.querySelectorAll('.ml-rec-card').forEach((el) => el.addEventListener('click', () => showDetails(el.dataset.p, el.dataset.id)));
    root.querySelectorAll('.ml-recent-chip').forEach((b) => b.addEventListener('click', () => showDetails(b.dataset.p, b.dataset.id)));
    const clearBtn = root.querySelector('.ml-recent-clear');
    if (clearBtn) clearBtn.addEventListener('click', (e) => { e.stopPropagation(); modelService.clearRecent(); notify.toast('Recent cleared', 'info'); draw(); });
  }

  buildShell();
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
        <span class="ml-det-sm" role="button" tabindex="0" data-id="${esc(m.id)}" title="Model details" aria-label="Model details">i</span>
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
