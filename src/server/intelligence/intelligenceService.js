// Intelligence Service (v1.6.0) — the single aggregation entry point for the
// Intelligence Center. It reads EXISTING intelligence sources and combines them
// into one structured response. It creates no new persistent store and adds no
// fabricated data: every field is either an aggregate of real records or an
// honest empty/insufficient signal.

import { parsePeriod, periodSince, FRESHNESS_MS, MIN_SAMPLES_FOR_TREND, CONFIDENCE } from './confidence.js';
import { getAttention } from './attentionService.js';
import { getProviderTrends, getModelTrends, getRecentChanges } from './trendService.js';
import { getRecommendations } from './recommendationService.js';
import {
  providerDiscoveryService,
} from '../providers/providerDiscoveryService.js';
import { getModelStats } from '../models/modelIntelligenceService.js';
import { getSummary as benchmarkSummary, listResults } from '../benchmarks/benchmarkStore.js';
import { getAllMetrics } from '../providers/providerMetricsStore.js';
import { getRecentSnapshots } from '../providers/providerHistoryStore.js';
import { listActivities } from '../activity/activityService.js';

function countGrouped(snaps) {
  const byProvider = new Map();
  for (const s of snaps) {
    if (!byProvider.has(s.providerId)) byProvider.set(s.providerId, 0);
    byProvider.set(s.providerId, byProvider.get(s.providerId) + 1);
  }
  return byProvider;
}

function buildOverview({ intel, modelStats, bench, metricsAll, snapsGrouped }) {
  const monitored = snapsGrouped.size;
  const available = intel.filter((r) => r.status?.availability === 'available').length;
  let realSamples = 0;
  for (const m of Object.values(metricsAll)) realSamples += Array.isArray(m.checks) ? m.checks.length : 0;
  return {
    providersTotal: intel.length,
    providersAvailable: available,
    providersMonitored: monitored,
    cloudModels: modelStats.cloudTotal,
    localModels: modelStats.localTotal,
    freeModels: modelStats.cloudFree,
    benchmarkSamples: bench.total,
    realConnectionSamples: realSamples,
    generatedAt: new Date().toISOString(),
  };
}

function buildDataQuality({ intel, snapsGrouped, metricsAll, bench }) {
  const now = Date.now();
  let realSamples = 0;
  for (const m of Object.values(metricsAll)) realSamples += Array.isArray(m.checks) ? m.checks.length : 0;

  const providersWithSufficientHistory = [...snapsGrouped.values()].filter((n) => n >= MIN_SAMPLES_FOR_TREND).length;
  const curatedOnlyProviders = intel.filter((r) => !snapsGrouped.has(r.id)).length;
  const staleProviders = intel.filter((r) => {
    const last = r.source?.lastCheckedAt || r.timestamps?.lastCheckedAt;
    if (!last) return false;
    return (now - new Date(last).getTime()) > FRESHNESS_MS;
  }).length;
  const unknownProviders = intel.filter((r) => r.source?.confidence === 'unknown' || r.status?.availability === 'unknown').length;

  return {
    providerSnapshots: [...snapsGrouped.values()].reduce((a, b) => a + b, 0),
    providersWithHistory: snapsGrouped.size,
    providersWithSufficientHistory,
    curatedOnlyProviders,
    staleProviders,
    unknownProviders,
    realConnectionSamples: realSamples,
    benchmarkSamples: bench.total,
    confidence: bench.total > 0 || realSamples > 0 ? CONFIDENCE.MEASURED : CONFIDENCE.UNKNOWN,
    notes: [
      curatedOnlyProviders > 0 ? `${curatedOnlyProviders} provider(s) have only curated data and no monitoring history.` : null,
      staleProviders > 0 ? `${staleProviders} provider(s) have stale intelligence (older than 7 days).` : null,
      bench.total === 0 ? 'No benchmark samples yet — measured latency trends are unavailable.' : null,
    ].filter(Boolean),
  };
}

function buildBenchmarkInsights(benchList) {
  const total = Array.isArray(benchList) ? benchList.length : 0;
  if (total === 0) {
    return {
      confidence: CONFIDENCE.UNKNOWN,
      summary: 'No benchmark data yet.',
      note: 'Run benchmarks from a provider to populate measured latency and reliability.',
      okRate: null, avgLatencyMs: null, total: 0,
    };
  }
  const ok = benchList.filter((r) => r.ok === true).length;
  const okRate = Math.round((ok / total) * 100);
  const lats = benchList.map((r) => (typeof r.latencyMs === 'number' ? r.latencyMs : null)).filter((v) => v != null);
  const avgLatencyMs = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
  const providers = new Set(benchList.map((r) => r.providerId)).size;
  return {
    confidence: CONFIDENCE.MEASURED,
    summary: `${total} benchmark run(s), ${okRate}% succeeded.`,
    note: `Measured across ${providers} provider(s).`,
    okRate, avgLatencyMs, total,
  };
}

function mapChangeToEvent(c) {
  return {
    id: c.id,
    kind: 'change',
    type: String(c.type || 'change').replace(/[-_]/g, ' '),
    title: c.summary || `${c.type} on ${c.providerName || c.providerId}`,
    description: c.details ? (c.details.before ? `Changed from ${c.details.before} to ${c.details.after}` : '') : '',
    category: c.category || 'model',
    severity: String(c.severity || 'info').toUpperCase(),
    confidence: c.confidence || CONFIDENCE.UNKNOWN,
    timestamp: c.detectedAt,
    relatedProviderId: c.providerId,
    relatedModelId: c.modelId,
    action: 'view_changes',
  };
}

// Raw activity entries ({ timestamp, category, action, status, summary, details })
// are normalised to the same event shape as changes so the feed renders every
// row with a label, body text and severity-coloured badge.
function mapActivityToEvent(a) {
  const status = String(a.status || 'info').toLowerCase();
  const severity = status === 'error' ? 'ERROR' : status === 'warning' ? 'WARNING' : 'INFO';
  const detail = a.details && typeof a.details === 'object' ? ((a.details.message || a.details.note || '') || '') : '';
  return {
    id: a.id,
    kind: 'activity',
    type: String(a.action || a.category || 'event').replace(/[-_]/g, ' '),
    title: a.summary || a.action || a.category || 'Activity',
    description: detail,
    category: a.category || 'system',
    severity,
    confidence: status,
    timestamp: a.timestamp || null,
    relatedProviderId: a.provider ? (Array.isArray(a.provider) ? a.provider[0] : null) : null,
    action: null,
  };
}

export async function getIntelligence({ period = '7d', workspaceProviderId = null } = {}) {
  const p = parsePeriod(period);
  const since = periodSince(p);

  const intel = providerDiscoveryService.getAllProviderIntelligence();
  const modelStats = getModelStats();
  const bench = benchmarkSummary();
  const benchList = listResults({ limit: 1000 });
  const metricsAll = getAllMetrics();
  const snaps = getRecentSnapshots({ limit: 3000 });
  const snapsGrouped = countGrouped(snaps);

  const [attention, providerTrends, modelTrends, recommendations] = await Promise.all([
    Promise.resolve(getAttention({ since, workspaceProviderId })),
    Promise.resolve(getProviderTrends({ since })),
    Promise.resolve(getModelTrends({ since })),
    getRecommendations({ workspaceProviderId, since }),
  ]);

  const changes = getRecentChanges({ since, limit: 40 });
  const changeTimeline = changes.map(mapChangeToEvent);

  const rawActivity = listActivities(20);
  const activityList = (Array.isArray(rawActivity) ? rawActivity : (rawActivity?.activities || [])).map(mapActivityToEvent);

  return {
    generatedAt: new Date().toISOString(),
    period: p,
    overview: buildOverview({ intel, modelStats, bench, metricsAll, snapsGrouped }),
    attention,
    providerTrends,
    modelTrends,
    recentChanges: changeTimeline,
    recommendations,
    benchmarkInsights: buildBenchmarkInsights(benchList),
    dataQuality: buildDataQuality({ intel, snapsGrouped, metricsAll, bench }),
    activity: activityList,
  };
}
