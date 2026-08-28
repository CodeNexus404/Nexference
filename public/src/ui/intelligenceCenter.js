// Intelligence Center (v1.6.0) — client entry. Aggregates the GET
// /api/intelligence response into an honest, scannable dashboard: overview,
// attention-required, provider & model trends, smart recommendations, benchmark
// insights, recent changes/activity timelines, and a data-quality panel.
//
// Honesty rules mirrored from the backend: trends only render with real samples,
// empty states are explicit, and every recommendation shows its confidence + basis.
import { esc } from '../components/util.js';
import { router } from '../core/router.js';
import { Storage } from '../core/storage.js';
import { notify } from '../core/notifications.js';
import { trendChart } from '../components/trendChart.js';
import { renderTimeline } from '../components/intelligenceTimeline.js';

const PERIODS = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'all', label: 'All' },
];

const METRIC_LABEL = {
  availability: 'Availability',
  model_count: 'Model count',
  free_model_count: 'Free models',
  latency: 'Latency',
  reliability: 'Reliability',
};

const DIR_TEXT = { IMPROVING: 'Improving', DECLINING: 'Declining', STABLE: 'Stable', UNKNOWN: 'Unknown' };
const DIR_CLASS = { IMPROVING: 'up', DECLINING: 'down', STABLE: 'flat', UNKNOWN: 'flat' };

async function loadIntel(period) {
  const applied = Storage.getApplied();
  const wid = applied && applied.providerId ? applied.providerId : null;
  const qs = 'period=' + encodeURIComponent(period) + (wid ? '&workspaceProvider=' + encodeURIComponent(wid) : '');
  const res = await fetch('/api/intelligence?' + qs);
  if (!res.ok) throw new Error('intelligence_failed');
  return res.json();
}

function statCard(label, value, sub = '') {
  const v = value === undefined || value === null ? 0 : value;
  return `<div class="stat ic-stat"><b>${esc(String(v))}</b><span>${esc(label)}</span>${sub ? `<div class="stat-sub muted">${esc(sub)}</div>` : ''}</div>`;
}

function badge(text, kind = '') {
  return `<span class="badge ${kind}">${esc(String(text))}</span>`;
}

function attentionCard(a) {
  const sevIcon = a.severity === 'IMPORTANT' ? '⚠' : a.severity === 'WARNING' ? '⚠' : '•';
  const sevClass = a.severity === 'IMPORTANT' ? 'att-important' : a.severity === 'WARNING' ? 'att-warning' : 'att-info';
  const actionBtn = a.action
    ? `<button class="btn btn-sm" onclick="intelAction('${esc(a.action)}', '${esc(JSON.stringify({ providerId: a.relatedProviderId, modelId: a.relatedModelId }))}')">View</button>`
    : '';
  return `<div class="card ic-att ${sevClass}">
    <div class="ic-att-head"><span class="ic-att-sev">${sevIcon}</span><span class="ic-att-title">${esc(a.title)}</span></div>
    <div class="ic-att-desc muted">${esc(a.description)}</div>
    <div class="ic-att-foot">${badge(a.severity)} ${badge(a.category)} ${actionBtn}</div>
  </div>`;
}

function providerTrendBlock(p) {
  const trends = p.trends.map((t) => {
    const dir = DIR_TEXT[t.direction] || 'Unknown';
    const dirCls = DIR_CLASS[t.direction] || 'flat';
    const delta = t.detail && typeof t.detail.delta === 'number'
      ? `${t.detail.delta > 0 ? '+' : ''}${t.detail.delta}${t.detail.unit || ''}`
      : '—';
    return `<div class="ic-trend-row">
      <div class="ic-trend-meta">
        <span class="ic-trend-name">${esc(METRIC_LABEL[t.metric] || t.metric)}</span>
        <span class="dir dir-${dirCls}">${esc(dir)}</span>
        <span class="muted ic-trend-delta">${esc(delta)}</span>
      </div>
      ${trendChart(t.series, { direction: t.direction, height: 40 })}
      <div class="ic-trend-foot">${badge(t.confidence)} <span class="muted">${t.sampleSize} sample(s)</span></div>
    </div>`;
  }).join('');
  return `<div class="card ic-ptrend">
    <div class="ic-ptrend-head"><span class="ic-ptrend-name">${esc(p.providerName)}</span></div>
    ${trends}
  </div>`;
}

function recommendationCard(r) {
  const actions = (r.actions || []).map((a) =>
    `<button class="btn btn-sm btn-go" onclick="intelAction('${esc(a.token)}', '${esc(JSON.stringify(a.payload || {}))}')">${esc(a.label)}</button>`,
  ).join('');
  return `<div class="card ic-rec">
    <div class="ic-rec-head">
      <span class="chip">${esc(r.category)}</span>
      <span class="ic-rec-title">${esc(r.title)}</span>
    </div>
    <div class="ic-rec-desc muted">${esc(r.description)}</div>
    <div class="ic-rec-basis"><span class="ic-rec-basis-label">Why:</span> ${esc(r.basis || '')}</div>
    <div class="ic-rec-foot">${badge(r.confidence, 'badge-conf')} ${actions}</div>
  </div>`;
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
  const overview = `<div class="ic-overview">
    ${statCard('Providers', ov.providersTotal, `${ov.providersAvailable || 0} available · ${ov.providersMonitored || 0} monitored`)}
    ${statCard('Cloud models', ov.cloudModels, `${ov.freeModels || 0} free`)}
    ${statCard('Local models', ov.localModels)}
    ${statCard('Connections tested', ov.realConnectionSamples)}
    ${statCard('Benchmarks', ov.benchmarkSamples)}
  </div>`;

  // Attention
  const attention = `<section class="ic-section">
    <h2 class="ic-h2">Attention Required</h2>
    ${data.attention && data.attention.length
      ? `<div class="ic-grid ic-grid-att">${data.attention.map(attentionCard).join('')}</div>`
      : `<div class="ic-empty"><span>Nothing needs your attention right now. Healthy and up to date.</span></div>`}
  </section>`;

  // Provider trends (group by provider)
  const byProvider = new Map();
  (data.providerTrends || []).forEach((t) => {
    if (!byProvider.has(t.providerId)) byProvider.set(t.providerId, { name: t.providerName, trends: [] });
    byProvider.get(t.providerId).trends.push(t);
  });
  const providerTrends = `<section class="ic-section">
    <h2 class="ic-h2">Provider Trends</h2>
    <p class="muted ic-section-sub">Direction is computed from the first vs last real measurement in the selected period. Requires at least two samples.</p>
    ${byProvider.size
      ? `<div class="ic-grid">${[...byProvider.entries()].map(([id, p]) => providerTrendBlock({ providerId: id, providerName: p.name, trends: p.trends })).join('')}</div>`
      : `<div class="ic-empty"><span>Not enough monitoring history yet to show provider trends. Run a refresh to collect samples.</span></div>`}
  </section>`;

  // Model trends
  const mt = data.modelTrends || {};
  const mtCounts = mt.counts || {};
  const modelTrends = `<section class="ic-section">
    <h2 class="ic-h2">Model Trends</h2>
    <div class="ic-grid ic-grid-mini">
      ${statCard('Discovered', mtCounts.discovered || 0)}
      ${statCard('Removed', mtCounts.removed || 0)}
      ${statCard('Access changed', mtCounts.accessChanged || 0)}
      ${statCard('Availability changed', mtCounts.availabilityChanged || 0)}
    </div>
    ${(mt.insights && mt.insights.length) ? `<ul class="ic-insights">${mt.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<div class="ic-empty"><span>No model-level changes detected in this period.</span></div>`}
    ${mt.confidence ? `<div class="ic-confidence">${badge(mt.confidence, 'badge-conf')}</div>` : ''}
  </section>`;

  // Recommendations
  const recommendations = `<section class="ic-section">
    <h2 class="ic-h2">Smart Recommendations</h2>
    <p class="muted ic-section-sub">Every recommendation states its confidence and why it was suggested. No black-box scoring.</p>
    ${(data.recommendations && data.recommendations.length)
      ? `<div class="ic-grid">${data.recommendations.map(recommendationCard).join('')}</div>`
      : `<div class="ic-empty"><span>No recommendations for the current state. As you monitor providers, suggestions will appear here.</span></div>`}
  </section>`;

  // Benchmark insights
  const bi = data.benchmarkInsights || {};
  const benchmark = `<section class="ic-section">
    <h2 class="ic-h2">Benchmark Insights</h2>
    <div class="card ic-bench">
      <div class="ic-bench-summary">${esc(bi.summary || 'No benchmark data.')}</div>
      <div class="ic-bench-stats">
        ${bi.okRate != null ? statCard('Success rate', bi.okRate + '%') : ''}
        ${bi.avgLatencyMs != null ? statCard('Avg latency', bi.avgLatencyMs + ' ms') : ''}
        ${statCard('Runs', bi.total || 0)}
      </div>
      <div class="muted ic-bench-note">${esc(bi.note || '')}</div>
    </div>
  </section>`;

  // Timelines
  const timelines = `<div class="ic-twocol">
    <section class="ic-section">
      <h2 class="ic-h2">Recent Changes</h2>
      ${renderTimeline(data.recentChanges || [], { emptyText: 'No model or provider changes recorded yet.' })}
    </section>
    <section class="ic-section">
      <h2 class="ic-h2">Activity</h2>
      ${renderTimeline(data.activity || [], { emptyText: 'No activity recorded yet.' })}
    </section>
  </div>`;

  // Data quality
  const dq = data.dataQuality || {};
  const dqBadges = [
    ['History snapshots', dq.providerSnapshots],
    ['Providers w/ history', dq.providersWithHistory],
    ['Sufficient history', dq.providersWithSufficientHistory],
    ['Real connection samples', dq.realConnectionSamples],
    ['Benchmark samples', dq.benchmarkSamples],
    ['Stale providers', dq.staleProviders],
    ['Curated-only providers', dq.curatedOnlyProviders],
    ['Unknown providers', dq.unknownProviders],
  ].filter(([, v]) => v !== undefined && v !== null)
    .map(([l, v]) => `<div class="ic-dq-item"><span class="ic-dq-val">${esc(String(v))}</span><span class="ic-dq-label muted">${esc(l)}</span></div>`).join('');

  const dataQuality = `<section class="ic-section">
    <h2 class="ic-h2">Data Quality &amp; Confidence</h2>
    <div class="card ic-dq">
      <div class="ic-dq-head">${badge(dq.confidence || 'UNKNOWN', 'badge-conf')}</div>
      <div class="ic-dq-grid">${dqBadges}</div>
      ${(dq.notes && dq.notes.length) ? `<ul class="ic-insights">${dq.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </div>
  </section>`;

  body.innerHTML = overview + attention + providerTrends + modelTrends + recommendations + benchmark + timelines + dataQuality;
}

// ── Global action dispatch (referenced by inline onclick handlers) ──
async function handleIntelAction(token, payload = {}) {
  const p = payload || {};
  switch (token) {
    case 'open_provider':
      router.navigate('cloud-providers');
      if (window.openProviderConfig && p.providerId) window.openProviderConfig(p.providerId);
      break;
    case 'open_cloud_providers': router.navigate('cloud-providers'); break;
    case 'open_localai': router.navigate('localai'); break;
    case 'open_models': router.navigate('models'); break;
    case 'open_configuration':
      router.navigate('configuration');
      if (window.setCfgTab) window.setCfgTab('config');
      break;
    case 'view_model': router.navigate('models'); break;
    case 'run_connection_test':
      if (window.testConnection) await window.testConnection(p.providerId);
      notify.toast('Connection test dispatched', 'success');
      break;
    case 'refresh_provider':
      if (window.refreshProviderMonitoring) await window.refreshProviderMonitoring(p.providerId);
      else router.navigate('cloud-providers');
      break;
    case 'view_changes':
      if (window.openProviderChangesModal) window.openProviderChangesModal();
      else router.navigate('cloud-providers');
      break;
    case 'view_benchmark':
      router.navigate('cloud-providers');
      if (window.openProviderIntelligence && p.providerId) window.openProviderIntelligence(p.providerId);
      break;
    default:
      notify.toast('Unknown action: ' + token, 'warning');
  }
}

export async function renderIntelligenceCenter() {
  const root = document.getElementById('page-intelligence');
  if (!root) return;
  const period = Storage.getIntelPeriod() || '7d';
  root.innerHTML = `
    <div class="page-head">
      <h1>Intelligence Center</h1>
      <p>Aggregated, honest view of your providers, models, and benchmarks — trends and recommendations built only from real monitoring data.</p>
    </div>
    <div class="ic-toolbar">
      <div class="seg ic-period" id="icPeriod">
        ${PERIODS.map((p) => `<button class="seg-btn ${p.id === period ? 'active' : ''}" data-period="${p.id}" onclick="intelSetPeriod('${p.id}')">${esc(p.label)}</button>`).join('')}
      </div>
      <button class="btn btn-go" id="icRefresh" onclick="intelRefresh()">Refresh</button>
    </div>
    <div id="icBody" class="ic-body"></div>`;
  await renderIntelBody(root, period);
}

// Expose handlers used by inline onclick attributes.
window.intelSetPeriod = (p) => {
  Storage.setIntelPeriod(p);
  renderIntelligenceCenter();
};
window.intelRefresh = async () => {
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
};
window.intelAction = (token, payloadJSON) => {
  let payload = {};
  try { payload = payloadJSON ? JSON.parse(payloadJSON) : {}; } catch { payload = {}; }
  handleIntelAction(token, payload).catch((e) => notify.toast('Action failed: ' + (e.message || e), 'error'));
};
