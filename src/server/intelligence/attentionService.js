// Attention Service (v1.6.0) — aggregates real, actionable attention items from
// existing signals. It does NOT invent problems: every item maps to a concrete
// condition (stale intelligence, an unavailable provider, a recent breaking
// model change, a benchmark regression, or a configuration-impact gap).
//
// Severity vocabulary: INFO, WARNING, IMPORTANT. CRITICAL is reserved for when the
// user's own configured workspace is genuinely impacted — never used for unrelated
// provider problems. Items are de-duplicated within a run.

import { providerDiscoveryService } from '../providers/providerDiscoveryService.js';
import { getLatest } from '../providers/providerHistoryStore.js';
import { listChanges, CHANGE_TYPES } from '../providers/providerChangeStore.js';
import { listResults } from '../benchmarks/benchmarkStore.js';
import { getReliability } from '../providers/providerMetricsStore.js';
import { FRESHNESS_MS } from './confidence.js';

const SEV_RANK = { INFO: 0, WARNING: 1, IMPORTANT: 2 };

function item(category, providerId, title, description, detectedAt, action, severity = 'INFO', modelId = null) {
  return {
    id: `${category}:${providerId}:${modelId || 'p'}`,
    severity,
    category,
    title,
    description,
    relatedProviderId: providerId,
    relatedModelId: modelId,
    detectedAt: detectedAt || new Date().toISOString(),
    action,
  };
}

export function getAttention({ since = null, workspaceProviderId = null } = {}) {
  const intel = providerDiscoveryService.getAllProviderIntelligence();
  const sinceMs = since ? new Date(since).getTime() : null;
  const now = Date.now();
  const items = [];
  const seen = new Map(); // dedupe key -> item

  const add = (it) => {
    const k = `${it.category}:${it.relatedProviderId}:${it.relatedModelId || 'p'}`;
    const prev = seen.get(k);
    if (prev) {
      if (SEV_RANK[it.severity] > SEV_RANK[prev.severity]) seen.set(k, it);
      return;
    }
    seen.set(k, it);
  };

  const isWorkspace = (pid) => workspaceProviderId && pid === workspaceProviderId;

  for (const rec of intel) {
    const pid = rec.id;
    const name = rec.identity?.name || pid;
    const lastChecked = rec.source?.lastCheckedAt || rec.timestamps?.lastCheckedAt || null;
    const lastCheckedMs = lastChecked ? new Date(lastChecked).getTime() : null;

    // 1) Stale intelligence
    const staleByStatus = rec.status?.discoveryStatus === 'stale';
    const staleByAge = lastCheckedMs != null && (now - lastCheckedMs) > FRESHNESS_MS;
    if (staleByStatus || staleByAge) {
      const when = lastChecked ? ` Last checked ${new Date(lastChecked).toLocaleDateString()}.` : '';
      add(item('stale_intelligence', pid,
        `${name} intelligence is stale`,
        `No fresh check has confirmed this provider recently.${when} Refresh to update models, availability and metrics.`,
        lastChecked, 'refresh_provider', isWorkspace(pid) ? 'WARNING' : 'INFO'));
    }

    // 2) Provider unavailable (cross-check history's latest snapshot)
    const latest = getLatest(pid);
    const unavailable = rec.status?.availability === 'unavailable'
      || (latest && latest.availability === 'unavailable');
    if (unavailable) {
      add(item('provider_unavailable', pid,
        `${name} is currently unreachable`,
        `The last check could not confirm availability. This may be a temporary outage or a removed endpoint.`,
        latest?.checkedAt || lastChecked, 'view_changes', isWorkspace(pid) ? 'IMPORTANT' : 'WARNING'));
    }

    // 3) Recent breaking model changes
    const breaking = listChanges({
      provider: pid, since,
      type: [CHANGE_TYPES.MODELS_REMOVED, CHANGE_TYPES.MODEL_REMOVED, CHANGE_TYPES.MODEL_ACCESS_CHANGED, CHANGE_TYPES.FREE_MODELS_CHANGED, CHANGE_TYPES.MODEL_AVAILABILITY_CHANGED],
    });
    if (breaking.length) {
      add(item('breaking_change', pid,
        `${name}: ${breaking.length} model change(s) detected`,
        `${breaking.length} model-level change(s) (removed, access, or availability) were observed${since ? ' in the selected period' : ''}.`,
        breaking[0]?.detectedAt, 'view_changes', isWorkspace(pid) ? 'WARNING' : 'INFO'));
    }
  }

  // 4) Benchmark regression (success observed earlier, failure recently)
  const bench = listResults({ limit: 500 });
  const byProvider = new Map();
  for (const r of bench) {
    if (!byProvider.has(r.providerId)) byProvider.set(r.providerId, []);
    byProvider.get(r.providerId).push(r);
  }
  for (const [pid, results] of byProvider) {
    const within = sinceMs ? results.filter((r) => new Date(r.measuredAt).getTime() >= sinceMs) : results;
    const recentFails = within.filter((r) => r.ok === false && r.connectionState && r.connectionState !== 'not-tested');
    const anySuccess = results.some((r) => r.ok === true);
    if (recentFails.length && anySuccess) {
      const name = intel.find((x) => x.id === pid)?.identity?.name || pid;
      add(item('benchmark_failure', pid,
        `Benchmark regression on ${name}`,
        `A benchmark succeeded previously but recent measured attempts failed (${recentFails[0].connectionState || 'error'}).`,
        recentFails[0].measuredAt, 'view_benchmark', isWorkspace(pid) ? 'IMPORTANT' : 'WARNING'));
    }
  }

  // 5) Configuration impact — only when the user's own provider is involved
  if (workspaceProviderId) {
    const rel = getReliability(workspaceProviderId);
    const wpIntel = intel.find((x) => x.id === workspaceProviderId);
    const wpName = wpIntel?.identity?.name || workspaceProviderId;
    const insufficient = !rel || rel.state === 'insufficient-data';
    // Only raise this if we haven't already escalated the same provider above.
    const alreadyLoud = [...seen.values()].some((i) => i.relatedProviderId === workspaceProviderId && i.severity === 'IMPORTANT');
    if (insufficient && !alreadyLoud) {
      const lastTest = rel?.lastCheckedAt;
      const basis = lastTest ? `Last successful connection test was ${new Date(lastTest).toLocaleDateString()}.` : 'No successful connection test has been recorded yet.';
      add(item('configuration_impact', workspaceProviderId,
        `Your configured provider ${wpName} hasn't been tested recently`,
        basis, lastTest, 'run_connection_test', 'WARNING'));
    }
  }

  return [...seen.values()].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}
