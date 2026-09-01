// Intelligence Center (v2.1.0) — redesigned dashboard.
// Sections: Overview stats · Provider health trends · Attention alerts ·
// Recommendations (with working actions) · Benchmark insights · Data quality ·
// Recent activity · Ecosystem summary. Every button is wired; no dead UI.
import { esc } from '../components/util.js';
import { router } from '../core/router.js';
import { Storage } from '../core/storage.js';
import { notify } from '../core/notifications.js';

const PERIODS = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'all', label: 'All' },
];

async function loadIntel(period) {
  const applied = Storage.getApplied();
  const wid = applied && applied.providerId ? applied.providerId : null;
  const qs = 'period=' + encodeURIComponent(period) + (wid ? '&workspaceProvider=' + encodeURIComponent(wid) : '');
  const res = await fetch('/api/intelligence?' + qs);
  if (!res.ok) throw new Error('intelligence_failed');
  return res.json();
}

function relTime(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function statCard(label, value, sub = '') {
  const v = value === undefined || value === null ? 0 : value;
  return `<div class="stat ic-stat"><b>${esc(String(v))}</b><span>${esc(label)}</span>${sub ? `<div class="stat-sub muted">${esc(sub)}</div>` : ''}</div>`;
}

function badge(text, kind = '') {
  return `<span class="badge ${kind}">${esc(String(text))}</span>`;
}

// ── Provider health trends ──
const TREND_ARROW = { IMPROVING: '↑', DEGRADING: '↓', STABLE: '→', FLUCTUATING: '↕' };
const TREND_CLASS = { IMPROVING: 'trend-up', DEGRADING: 'trend-down', STABLE: 'trend-stable', FLUCTUATING: 'trend-flux' };

function trendRow(t) {
  const arrow = TREND_ARROW[t.direction] || '→';
  const cls = TREND_CLASS[t.direction] || 'trend-stable';
  const detail = t.detail && t.detail.unit !== undefined
    ? `${t.detail.first} → ${t.detail.last}${t.detail.unit || ''}`
    : '';
  return `<div class="ic-trend" data-provider="${esc(t.providerId)}">
    <span class="ic-trend-name">${esc(t.providerName || t.providerId)}</span>
    <span class="ic-trend-metric muted">${esc(t.metric)}</span>
    <span class="ic-trend-dir ${cls}">${arrow} ${esc(t.direction)}</span>
    <span class="ic-trend-detail muted">${esc(detail)}</span>
    ${badge(`${t.sampleSize} samples`, 'badge-muted')}
    <button class="btn btn2 sm ic-trend-open" data-open="${esc(t.providerId)}" type="button">Open</button>
  </div>`;
}

// ── Attention alerts ──
function attentionCard(a) {
  const sevClass = a.severity === 'IMPORTANT' ? 'att-important' : a.severity === 'WARNING' ? 'att-warning' : 'att-info';
  const actions = (a.actions || []).map((act) =>
    `<button class="btn btn2 sm" data-intel-action="${esc(act.token)}" data-payload='${esc(JSON.stringify(act.payload || {}))}' type="button">${esc(act.label)}</button>`
  ).join(' ');
  return `<div class="card ic-att ${sevClass}">
    <div class="ic-att-head"><span class="ic-att-title">${esc(a.title)}</span></div>
    <div class="ic-att-desc muted">${esc(a.description)}</div>
    <div class="ic-att-foot">${badge(a.severity)} ${badge(a.category)}${actions ? `<div class="ic-att-actions">${actions}</div>` : ''}</div>
  </div>`;
}

// ── Recommendations ──
function recommendationCard(r) {
  const actions = (r.actions || []).map((act) =>
    `<button class="btn btn-go sm" data-intel-action="${esc(act.token)}" data-payload='${esc(JSON.stringify(act.payload || {}))}' type="button">${esc(act.label)}</button>`
  ).join(' ');
  return `<div class="card ic-rec">
    <div class="ic-rec-head">
      <span class="chip">${esc(r.category)}</span>
      <span class="ic-rec-title">${esc(r.title)}</span>
    </div>
    <div class="ic-rec-desc muted">${esc(r.description)}</div>
    <div class="ic-rec-basis"><span class="ic-rec-basis-label">Why:</span> ${esc(r.basis || '')}</div>
    <div class="ic-rec-foot">${badge(r.confidence, 'badge-conf')}${actions ? `<div class="ic-rec-actions">${actions}</div>` : ''}</div>
  </div>`;
}

// ── Recent activity ──
function activityItem(a) {
  const ts = a.timestamp ? relTime(a.timestamp) : '';
  return `<div class="ic-activity-item">
    <span class="badge ${a.severity === 'WARNING' ? 'badge-warn' : a.severity === 'ERROR' ? 'badge-err' : 'badge-info'}">${esc(a.type || 'event')}</span>
    <span class="ic-activity-text">${esc(a.title || a.description || '')}</span>
    <span class="ic-activity-ts muted">${esc(ts)}</span>
  </div>`;
}

// ── Sparkline for provider trends ──
function sparkline(series) {
  if (!series || series.length < 2) return '';
  const vals = series.map(s => Number(s.v) || 0);
  const max = Math.max(...vals), min = Math.min(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${28 - ((v - min) / range) * 24}`).join(' ');
  return `<svg class="ic-spark" viewBox="0 0 100 28" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

async function renderIntelBody(root, period) {
  const body = root.querySelector('#icBody');
  if (!body) return;
  body.innerHTML = `<div class="ic-loading muted">Loading intelligence…</div>`;

  let data;
  try {
    data = await loadIntel(period);
  } catch (e) {
    body.innerHTML = `<div class="ic-empty"><span>Could not load intelligence data. ${esc(String(e.message || e))}</span></div>`;
    return;
  }

  const ov = data.overview || {};
  const lastGen = data.generatedAt ? relTime(data.generatedAt) : 'unknown';

  // ── Overview stats ──
  const overview = `<div class="ic-section">
    <div class="ic-overview-head">
      <h2 class="ic-h2">Overview</h2>
      <span class="muted ic-gen-at">generated ${esc(lastGen)}</span>
    </div>
    <div class="ic-overview">
      ${statCard('Providers', ov.providersTotal, `${ov.providersAvailable || 0} available · ${ov.providersMonitored || 0} monitored`)}
      ${statCard('Connections tested', ov.realConnectionSamples)}
      ${statCard('Benchmarks', ov.benchmarkSamples)}
      ${statCard('Ecosystem discovered', (data.dataQuality || {}).unknownProviders, 'unclassified origins')}
    </div>
  </div>`;

  // ── Provider health trends ──
  const trends = data.providerTrends || [];
  const trendSections = trends.length ? `<section class="ic-section">
    <h2 class="ic-h2">Provider Health Trends</h2>
    <div class="ic-trends">
      ${trends.slice(0, 12).map(t => `
        <div class="ic-trend-row">
          ${trendRow(t)}
          ${sparkline(t.series)}
        </div>`).join('')}
    </div>
  </section>` : '';

  // ── Attention Required ──
  const attention = `<section class="ic-section">
    <h2 class="ic-h2">Attention Required</h2>
    ${data.attention && data.attention.length
      ? `<div class="ic-grid ic-grid-att">${data.attention.map(attentionCard).join('')}</div>`
      : `<div class="ic-empty"><span>Nothing needs attention. All providers healthy.</span></div>`}
  </section>`;

  // ── Recommendations ──
  const recommendations = `<section class="ic-section">
    <h2 class="ic-h2">Recommendations</h2>
    ${(data.recommendations && data.recommendations.length)
      ? `<div class="ic-grid">${data.recommendations.map(recommendationCard).join('')}</div>`
      : `<div class="ic-empty"><span>No recommendations for the current state.</span></div>`}
  </section>`;

  // ── Benchmark insights ──
  const bi = data.benchmarkInsights || {};
  const benchmarks = bi.total ? `<section class="ic-section">
    <h2 class="ic-h2">Benchmark Insights</h2>
    <div class="ic-overview">
      ${statCard('Runs', bi.total, bi.summary || '')}
      ${statCard('Success rate', (bi.okRate ?? 0) + '%')}
      ${statCard('Avg latency', bi.avgLatencyMs != null ? bi.avgLatencyMs + 'ms' : '—')}
    </div>
    <div class="ic-foot-row">
      <button class="btn btn2 sm" data-intel-action="open_localai" type="button">Open Local AI</button>
      <button class="btn btn2 sm" data-intel-action="view_changes" type="button">View Changes</button>
    </div>
  </section>` : '';

  // ── Data quality ──
  const dq = data.dataQuality || {};
  const quality = `<section class="ic-section">
    <h2 class="ic-h2">Data Quality</h2>
    <div class="ic-overview">
      ${statCard('Provider snapshots', dq.providerSnapshots)}
      ${statCard('Providers with history', dq.providersWithHistory)}
      ${statCard('Connection samples', dq.realConnectionSamples)}
      ${statCard('Confidence', dq.confidence || 'unknown')}
    </div>
  </section>`;

  // ── Recent Activity ──
  const activity = [...(data.recentChanges || []), ...(data.activity || [])].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).slice(0, 20);
  const activityHtml = `<section class="ic-section">
    <h2 class="ic-h2">Recent Activity</h2>
    ${activity.length ? `<div class="ic-activity">${activity.map(activityItem).join('')}</div>` : `<div class="ic-empty"><span>No recent activity.</span></div>`}
  </section>`;

  // ── Ecosystem summary (lazy-loaded) ──
  const ecosystemSection = `<section class="ic-section">
    <h2 class="ic-h2">Ecosystem</h2>
    <div id="icEcosystem"><div class="muted">Loading…</div></div>
  </section>`;

  body.innerHTML = overview + trendSections + attention + recommendations + benchmarks + quality + activityHtml + ecosystemSection;

  // Wire all action buttons (attention cards, recommendations, section buttons)
  body.querySelectorAll('[data-intel-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      let payload = {};
      try { payload = btn.dataset.payload ? JSON.parse(btn.dataset.payload) : {}; } catch { payload = {}; }
      intelAction(btn.dataset.intelAction, payload);
    });
  });

  fetch('/api/ecosystem/summary').then((r) => r.json()).then((sum) => {
    const host = document.getElementById('icEcosystem');
    if (!host) return;
    host.innerHTML = `<div class="ic-overview">
      ${statCard('Curated', sum.curatedProviders || 0)}
      ${statCard('Discovered', sum.discoveredProviders || 0)}
      ${statCard('Adopted', sum.adopted || 0)}
      ${statCard('Needs review', sum.needsReview || 0)}
    </div>
    <div class="ic-foot-row">
      <button class="btn btn2 sm" data-intel-action="open_ecosystem" type="button">Open Ecosystem</button>
      <button class="btn btn2 sm" data-intel-action="open_cloud_providers" type="button">Open Providers</button>
    </div>`;
    host.querySelectorAll('[data-intel-action]').forEach((btn) => {
      btn.addEventListener('click', () => intelAction(btn.dataset.intelAction, {}));
    });
  }).catch(() => {
    const host = document.getElementById('icEcosystem');
    if (host) host.innerHTML = '<div class="muted">Ecosystem summary unavailable.</div>';
  });
}

export async function renderIntelligenceCenter() {
  const root = document.getElementById('page-intelligence');
  if (!root) return;
  const period = Storage.getIntelPeriod() || '7d';
  root.innerHTML = `
    <div class="page-head">
      <h1>Intelligence Center</h1>
      <p>Provider health, alerts, and recommendations built from real monitoring data.</p>
    </div>
    <div class="ic-toolbar">
      <div class="seg ic-period" id="icPeriod">
        ${PERIODS.map((p) => `<button class="seg-btn ${p.id === period ? 'active' : ''}" data-period="${p.id}" type="button">${esc(p.label)}</button>`).join('')}
      </div>
      <button class="btn btn-go" id="icRefresh" type="button">Refresh</button>
    </div>
    <div id="icBody" class="ic-body"></div>`;

  // Wire period buttons (no inline onclick — clean listeners)
  root.querySelectorAll('#icPeriod .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      Storage.setIntelPeriod(btn.dataset.period);
      renderIntelligenceCenter();
    });
  });
  const refreshBtn = root.querySelector('#icRefresh');
  refreshBtn?.addEventListener('click', () => intelRefresh());

  await renderIntelBody(root, period);
}

async function intelRefresh() {
  const btn = document.getElementById('icRefresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  try {
    const res = await fetch('/api/intelligence/refresh', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) notify.toast('Intelligence refreshed', 'success');
    else notify.toast(data.message || 'Refresh failed', 'error');
  } catch (e) {
    notify.toast('Refresh failed: ' + (e.message || e), 'error');
  }
  const root = document.getElementById('page-intelligence');
  if (root) await renderIntelBody(root, Storage.getIntelPeriod() || '7d');
  if (btn) { btn.disabled = false; btn.textContent = 'Refresh'; }
}

// Central action dispatcher — every intel button routes through here.
function intelAction(token, payload = {}) {
  switch (token) {
    case 'open_provider': {
      const pid = payload.providerId;
      if (!pid) { router.navigate('cloud-providers'); return; }
      // Custom providers have their own config dialog.
      if (pid.startsWith('cst:') && window.openCustomProvider) { window.openCustomProvider(pid); return; }
      if (pid.startsWith('dyn:') && window.openDynamicProvider) { window.openDynamicProvider(pid); return; }
      if (window.openProviderConfig) { window.openProviderConfig(pid); return; }
      router.navigate('cloud-providers');
      return;
    }
    case 'view_model': {
      const pid = payload.providerId;
      // Route to the models page scoped to the provider when possible.
      if (pid && window.openProviderConfig) { window.openProviderConfig(pid); return; }
      router.navigate('models');
      return;
    }
    case 'open_cloud_providers': router.navigate('cloud-providers'); return;
    case 'open_localai': router.navigate('localai'); return;
    case 'open_models': router.navigate('models'); return;
    case 'open_ecosystem': router.navigate('ecosystem'); return;
    case 'view_changes':
      if (window.openProviderChangesModal) window.openProviderChangesModal();
      else router.navigate('cloud-providers');
      return;
    default:
      notify.toast('Action: ' + token, 'info');
  }
}
