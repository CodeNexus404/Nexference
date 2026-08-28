// Recommendation Service (v1.6.0) — explains, never black-boxes. Every
// recommendation carries an explicit basis and confidence so the user can judge
// it. We never claim "best"/"fastest"/"most reliable" without comparable measured
// data; when comparisons are incomplete we say so.
//
// Categories: CONFIGURATION, PROVIDER, MODEL, LOCAL_AI, BENCHMARK, DISCOVERY.

import { providerDiscoveryService } from '../providers/providerDiscoveryService.js';
import { listChanges, CHANGE_TYPES } from '../providers/providerChangeStore.js';
import { getReliability } from '../providers/providerMetricsStore.js';
import { getSummary as benchmarkSummary } from '../benchmarks/benchmarkStore.js';
import { getModelStats, getRecommendedModels } from '../models/modelIntelligenceService.js';
import { getEnvironment } from '../environment/environmentService.js';
import { CONFIDENCE } from './confidence.js';

function rec(id, category, title, description, basis, confidence, actions) {
  return { id, category, title, description, basis, confidence, actions: actions || [] };
}

export async function getRecommendations({ workspaceProviderId = null, since = null } = {}) {
  const out = [];
  const ids = new Set();

  const push = (r) => { if (!ids.has(r.id)) { ids.add(r.id); out.push(r); } };

  // ── CONFIGURATION ──
  if (workspaceProviderId) {
    const rel = getReliability(workspaceProviderId);
    const intel = providerDiscoveryService.getAllProviderIntelligence().find((x) => x.id === workspaceProviderId);
    const name = intel?.identity?.name || workspaceProviderId;
    if (!rel || rel.state === 'insufficient-data') {
      const last = rel?.lastCheckedAt;
      push(rec('cfg-not-tested', 'CONFIGURATION',
        `Your configured provider ${name} hasn't been tested recently`,
        last ? 'Run a connection test so reliability and latency are measured.' : 'No successful connection test has been recorded — reliability is currently unknown.',
        last ? `Last successful connection test was ${new Date(last).toLocaleDateString()}.` : '0 successful connection tests found.',
        CONFIDENCE.INSUFFICIENT_DATA,
        [
          { label: 'Run connection test', token: 'run_connection_test', payload: { providerId: workspaceProviderId } },
          { label: 'Open Configuration', token: 'open_configuration', payload: {} },
        ]));
    }
  }

  // ── PROVIDER (free models) ──
  const intel = providerDiscoveryService.getAllProviderIntelligence();
  const freeProviders = intel
    .filter((r) => (r.models?.free || 0) > 0)
    .sort((a, b) => (b.models.free || 0) - (a.models.free || 0));
  if (freeProviders.length) {
    const p = freeProviders[0];
    push(rec('prov-free', 'PROVIDER',
      `${p.identity?.name || p.id} currently has known free models`,
      `Free models let you experiment without spend and are a good first test target.`,
      `Current provider catalogue contains ${p.models.free} model(s) explicitly marked free.`,
      CONFIDENCE.CURATED,
      [{ label: `Open ${p.identity?.name || p.id}`, token: 'open_provider', payload: { providerId: p.id } }]));
  }

  // ── LOCAL_AI ──
  let localCount = 0;
  try {
    const env = await getEnvironment();
    localCount = Array.isArray(env?.models) ? env.models.length : 0;
  } catch { /* non-fatal */ }
  const benchSummary = benchmarkSummary();
  const totalBench = benchSummary?.total || 0;
  if (localCount > 0 && totalBench === 0) {
    push(rec('local-not-benchmarked', 'LOCAL_AI',
      'Your installed local model(s) haven’t been benchmarked',
      'A quick benchmark shows real latency and reachability for your local setup.',
      `0 benchmark records found, but ${localCount} local model(s) detected.`,
      CONFIDENCE.INSUFFICIENT_DATA,
      [{ label: 'Open Local AI', token: 'open_localai', payload: {} }]));
  }

  // ── BENCHMARK ──
  if (totalBench === 0) {
    push(rec('bench-none', 'BENCHMARK',
      'No benchmarks have been run yet',
      'Benchmarks produce the measured latency/reliability trends shown in this dashboard.',
      '0 benchmark records found.',
      CONFIDENCE.UNKNOWN,
      [{ label: 'Open Cloud Providers', token: 'open_cloud_providers', payload: {} }]));
  }

  // ── MODEL (capability match) ──
  try {
    const recs = await getRecommendedModels({ providerId: workspaceProviderId || null });
    const match = recs.find((m) => m.isFree && m.capabilities?.chat);
    if (match) {
      push(rec('model-match', 'MODEL',
        `Try ${match.name || match.id} — a free chat model on ${match.providerName}`,
        'Matches your active client and capability requirements with no spend.',
        'Recommended from the live catalogue by capability + free status.',
        CONFIDENCE.OBSERVED,
        [{ label: 'View model', token: 'view_model', payload: { providerId: match.providerId, modelId: match.id } }]));
    }
  } catch { /* non-fatal */ }

  // ── DISCOVERY ──
  const newProviders = listChanges({ since, type: CHANGE_TYPES.PROVIDER_DISCOVERED });
  if (newProviders.length) {
    push(rec('disc-new', 'DISCOVERY',
      `${newProviders.length} new provider(s) discovered recently`,
      'Fresh providers can mean new free models or better pricing — worth a look.',
      `${newProviders.length} provider_discovered change(s) in the selected period.`,
      CONFIDENCE.OBSERVED,
      [{ label: 'Open Cloud Providers', token: 'open_cloud_providers', payload: {} }]));
  }

  return out.slice(0, 10);
}
