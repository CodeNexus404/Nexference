// Provider Insight Service (v1.5.0) — assembles monitoring history, connection
// metrics, and change records into a single data-derived "intelligence" payload
// for the Provider Intelligence UI. Everything here is computed from recorded
// data; nothing is invented or asserted without a recorded basis.

import { providerDiscoveryService } from './providerDiscoveryService.js';
import { getReliability } from './providerMetricsStore.js';
import { getProviderSnapshots, getLatest } from './providerHistoryStore.js';
import { listChanges, getChangeSummary } from './providerChangeStore.js';

const TREND_LIMIT = 10;

function computeTrends(snapshots) {
  if (!snapshots || snapshots.length < 2) return null;
  const ordered = [...snapshots].reverse(); // oldest → newest
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  return {
    sampleSize: ordered.length,
    modelCountFirst: first.modelCount,
    modelCountLast: last.modelCount,
    modelCountDelta: (last.modelCount || 0) - (first.modelCount || 0),
    freeCountFirst: first.freeModelCount,
    freeCountLast: last.freeModelCount,
    freeCountDelta: (last.freeModelCount || 0) - (first.freeModelCount || 0),
  };
}

function deriveRecommendations(providerId, intelligence, reliability, latest) {
  const recs = [];
  if (!reliability || reliability.state === 'insufficient-data') {
    recs.push({ level: 'info', text: 'Not enough monitoring checks yet to estimate reliability — run a manual refresh.' });
  }
  if (latest && latest.availability === 'unavailable') {
    recs.push({ level: 'warning', text: 'Provider is currently unreachable based on the last manual check.' });
  }
  if (latest && latest.connectionState === 'not-tested') {
    recs.push({ level: 'info', text: 'Connection not actively tested (provider requires an API key). Discovery is via curated registry only.' });
  }
  if (intelligence && intelligence.models && intelligence.models.free > 0) {
    recs.push({ level: 'info', text: `${intelligence.models.free} free model(s) observed — good for cost-free experimentation.` });
  }
  return recs;
}

export function getProviderInsight(providerId) {
  const intelligence = providerDiscoveryService.getProviderIntelligence(providerId);
  const reliability = getReliability(providerId);
  const snapshots = getProviderSnapshots(providerId, { limit: TREND_LIMIT });
  const latest = getLatest(providerId);
  const recentChanges = listChanges({ provider: providerId, limit: 20 });
  const changeSummary = getChangeSummary({ provider: providerId });
  const trends = computeTrends(snapshots);
  const recommendations = deriveRecommendations(providerId, intelligence, reliability, latest);

  return {
    providerId,
    intelligence,
    reliability,
    latestSnapshot: latest,
    recentSnapshots: snapshots.slice(0, 5),
    recentChanges,
    changeSummary,
    trends,
    recommendations,
  };
}

export function getAllProviderInsights(providerIds) {
  const ids = providerIds || [];
  return ids.map((id) => getProviderInsight(id));
}

export const providerInsightService = {
  getProviderInsight,
  getAllProviderInsights,
};
