// Trend Service (v1.6.0) — derives provider & model trends from EXISTING data:
// provider history snapshots (model counts, latency, availability) and the change
// store (model-level changes). No new permanent store is created; trends are
// computed on demand and labelled with an honest confidence.
//
// Method is intentionally simple and explainable:
//   • Order the samples oldest → newest within the period.
//   • Compare the first and last non-null values.
//   • A direction is only asserted when the change exceeds a small, documented
//     minimum delta (so two nearly-identical measurements stay STABLE).
//   • No statistical libraries, no smoothing, no invented precision.

import { getRecentSnapshots } from '../providers/providerHistoryStore.js';
import { getAllMetrics } from '../providers/providerMetricsStore.js';
import { providerDiscoveryService } from '../providers/providerDiscoveryService.js';
import { listChanges, CHANGE_TYPES } from '../providers/providerChangeStore.js';
import { CONFIDENCE, MIN_SAMPLES_FOR_TREND } from './confidence.js';

const MAX_SERIES = 60;

function direction(first, last, higherIsBetter, minDelta) {
  if (first == null || last == null) return 'UNKNOWN';
  const delta = last - first;
  if (Math.abs(delta) < minDelta) return 'STABLE';
  const improving = higherIsBetter ? delta > 0 : delta < 0;
  return improving ? 'IMPROVING' : 'DECLINING';
}

function minDeltaFor(metric, first) {
  switch (metric) {
    case 'availability': return 1;
    case 'latency': return Math.max(15, Math.round((first || 0) * 0.05));
    case 'reliability': return 0.05;
    default: return Math.max(1, Math.round(Math.abs(first || 0) * 0.02)); // counts
  }
}

function buildTrend(providerId, providerName, metric, pairs, { higherIsBetter = true, unit = '' } = {}) {
  const vals = pairs.filter((p) => p.v != null);
  if (vals.length < 2) return null;
  const series = vals.slice(-MAX_SERIES).map((p) => ({ t: p.t, v: p.v }));
  const first = vals[0].v;
  const last = vals[vals.length - 1].v;
  const confidence = vals.length >= MIN_SAMPLES_FOR_TREND ? CONFIDENCE.MEASURED : CONFIDENCE.INSUFFICIENT_DATA;
  const metricKey = metric;
  return {
    providerId,
    providerName,
    metric: metricKey,
    direction: direction(first, last, higherIsBetter, minDeltaFor(metricKey, first)),
    confidence,
    sampleSize: vals.length,
    detail: { first, last, delta: Math.round((last - first) * 100) / 100, unit },
    series,
  };
}

export function getProviderTrends({ since = null } = {}) {
  const snaps = getRecentSnapshots({ since, limit: 3000 }); // newest-first
  const byProvider = new Map();
  for (const s of snaps) {
    if (!byProvider.has(s.providerId)) byProvider.set(s.providerId, []);
    byProvider.get(s.providerId).push(s);
  }
  const intel = providerDiscoveryService.getAllProviderIntelligence();
  const nameOf = (id) => intel.find((r) => r.id === id)?.identity?.name || id;
  const metricsAll = getAllMetrics();

  const out = [];
  for (const [pid, list] of byProvider) {
    const ordered = [...list].reverse(); // oldest → newest
    if (ordered.length < 2) continue;

    const avail = ordered.map((s) => ({ t: s.checkedAt, v: s.availability === 'available' ? 1 : 0 }));
    const modelCount = ordered.map((s) => ({ t: s.checkedAt, v: s.modelCount || 0 }));
    const freeCount = ordered.map((s) => ({ t: s.checkedAt, v: s.freeModelCount || 0 }));
    const latency = ordered.map((s) => ({ t: s.checkedAt, v: typeof s.latencyMs === 'number' ? s.latencyMs : null }));

    const t = buildTrend(pid, nameOf(pid), 'availability', avail, { higherIsBetter: true });
    const tm = buildTrend(pid, nameOf(pid), 'model_count', modelCount, { higherIsBetter: true });
    const tf = buildTrend(pid, nameOf(pid), 'free_model_count', freeCount, { higherIsBetter: true });
    const tl = buildTrend(pid, nameOf(pid), 'latency', latency, { higherIsBetter: false, unit: 'ms' });
    [t, tm, tf, tl].forEach((x) => { if (x) out.push(x); });

    // Reliability trend from the metrics store (separate, real connection checks).
    const m = metricsAll[pid];
    if (m && Array.isArray(m.checks) && m.checks.length >= 2) {
      const checks = m.checks
        .filter((c) => !since || new Date(c.at) >= new Date(since))
        .map((c) => ({ t: c.at, v: c.connectionState === 'reachable' ? 1 : 0 }));
      const tr = buildTrend(pid, nameOf(pid), 'reliability', checks, { higherIsBetter: true });
      if (tr) out.push(tr);
    }
  }
  return out;
}

export function getModelTrends({ since = null } = {}) {
  const changes = listChanges({ since, limit: 1000 });
  const counts = {
    discovered: 0, removed: 0, accessChanged: 0, availabilityChanged: 0, lifecycleChanged: 0, freeChanged: 0,
  };
  const providersWithDiscovery = new Set();
  let hasAny = false;
  for (const c of changes) {
    switch (c.type) {
      case CHANGE_TYPES.MODEL_DISCOVERED: counts.discovered++; hasAny = true; if (c.providerId) providersWithDiscovery.add(c.providerId); break;
      case CHANGE_TYPES.MODEL_REMOVED: counts.removed++; hasAny = true; break;
      case CHANGE_TYPES.MODEL_ACCESS_CHANGED: counts.accessChanged++; hasAny = true; break;
      case CHANGE_TYPES.MODEL_AVAILABILITY_CHANGED: counts.availabilityChanged++; hasAny = true; break;
      case CHANGE_TYPES.MODEL_LIFECYCLE_CHANGED: counts.lifecycleChanged++; hasAny = true; break;
      case CHANGE_TYPES.FREE_MODELS_CHANGED: counts.freeChanged++; hasAny = true; break;
      default: break;
    }
  }
  const insights = [];
  if (counts.discovered > 0) insights.push(`${counts.discovered} model(s) discovered across ${providersWithDiscovery.size} provider(s)${since ? ' in the selected period' : ''}.`);
  if (counts.removed > 0) insights.push(`${counts.removed} model(s) removed.`);
  if (counts.accessChanged > 0) insights.push(`${counts.accessChanged} model(s) changed access (free/paid).`);
  if (counts.availabilityChanged > 0) insights.push(`${counts.availabilityChanged} model(s) changed availability.`);
  if (counts.freeChanged > 0) insights.push(`${counts.freeChanged} provider(s) changed their free/paid mix.`);

  return {
    counts,
    providersAffected: providersWithDiscovery.size,
    insights,
    confidence: hasAny ? CONFIDENCE.OBSERVED : CONFIDENCE.UNKNOWN,
  };
}

export function getRecentChanges({ since = null, limit = 40 } = {}) {
  return listChanges({ since, limit });
}
