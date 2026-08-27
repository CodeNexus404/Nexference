// Provider Monitor Service (v1.5.0) — manual, on-demand monitoring.
//
// This is the orchestration layer that turns a "Refresh" action into:
//   1. A discovery pass (reuses providerDiscoveryService, which updates the
//      intelligence record and records granular provider/model changes).
//   2. A connection classification + latency measurement (honest: for public
//      providers we time the real fetch; for keyed providers we do NOT invent a
//      key, so the connection is reported as "not-tested").
//   3. A bounded snapshot persisted to the history store.
//   4. A connection-metrics sample persisted to the metrics store (for reliability).
//   5. A non-secret activity entry.
//
// There is NO background polling. Everything here runs only when explicitly
// invoked by a user action. The discovery layer's own in-flight guard prevents
// overlapping checks for the same provider.

import { providerDiscoveryService } from './providerDiscoveryService.js';
import { CHANGE_TYPES } from './providerChangeStore.js';
import { recordSnapshot } from './providerHistoryStore.js';
import { recordCheck, getReliability } from './providerMetricsStore.js';
import { recordActivity } from '../activity/activityService.js';
import { getProvider, PROVIDERS } from './registry.js';

const DISCOVERABLE = PROVIDERS.filter((p) => p.id !== 'custom');

const CAP = 25;

function classifyConnection(provider, record, latencyMs) {
  if (!record) return { connectionState: 'unknown', errorCategory: null, latencyMs: null };
  if (provider.publicModels) {
    if (record.status.availability === 'available') return { connectionState: 'reachable', errorCategory: null, latencyMs };
    if (record.status.availability === 'unavailable') return { connectionState: 'unreachable', errorCategory: 'unreachable', latencyMs };
    return { connectionState: 'unknown', errorCategory: null, latencyMs };
  }
  // Keyed/unknown provider: we have no key and must not invent one.
  return { connectionState: 'not-tested', errorCategory: null, latencyMs: null };
}

function collectModelIds(changes, types) {
  return changes.filter((c) => types.includes(c.type) && c.modelId).map((c) => c.modelId).slice(0, CAP);
}

// Monitor a single provider: discovery + snapshot + metrics + activity.
async function monitorProvider(providerId, { force = false } = {}) {
  const provider = getProvider(providerId);
  if (!provider) return { providerId, ok: false, error: 'unknown provider' };
  const t0 = Date.now();
  const disc = await providerDiscoveryService.discoverProvider(provider, { force });
  const latencyMs = Date.now() - t0;
  const record = disc.record || providerDiscoveryService.getProviderIntelligence(providerId);
  const conn = classifyConnection(provider, record, latencyMs);

  // Added/removed/changed model ids from the granular change records.
  const addedModels = collectModelIds(disc.changes || [], [CHANGE_TYPES.MODEL_DISCOVERED]);
  const removedModels = collectModelIds(disc.changes || [], [CHANGE_TYPES.MODEL_REMOVED]);
  const changedModels = collectModelIds(disc.changes || [], [
    CHANGE_TYPES.MODEL_ACCESS_CHANGED,
    CHANGE_TYPES.MODEL_LIFECYCLE_CHANGED,
    CHANGE_TYPES.MODEL_AVAILABILITY_CHANGED,
  ]);

  const snapshot = {
    providerId,
    checkedAt: new Date().toISOString(),
    discoveryStatus: record?.status?.discoveryStatus || 'unknown',
    availability: record?.status?.availability || 'unknown',
    sourceStatus: record?.status?.sourceStatus || 'unknown',
    sourceType: record?.source?.type || 'unknown',
    modelCount: record?.models?.total || 0,
    freeModelCount: record?.models?.free || 0,
    paidModelCount: record?.models?.paid || 0,
    recommendedModelCount: record?.models?.recommended || 0,
    addedModels,
    removedModels,
    changedModels,
    latencyMs: conn.latencyMs,
    reliabilityState: 'pending',
    checkResult: {
      ok: conn.connectionState === 'reachable',
      reachable: conn.connectionState === 'reachable',
      connectionState: conn.connectionState,
    },
    errorCategory: conn.errorCategory,
    metadata: {
      identityName: record?.identity?.name || providerId,
      requiresApiKey: record?.access?.requiresApiKey ?? !provider.publicModels,
      accessType: record?.access?.accessType || 'unknown',
    },
  };

  recordCheck(providerId, {
    connectionState: conn.connectionState,
    latencyMs: conn.latencyMs,
    errorCategory: conn.errorCategory,
    at: snapshot.checkedAt,
  });
  const reliability = getReliability(providerId);
  snapshot.reliabilityState = reliability.state;
  recordSnapshot(snapshot);

  const changed = (disc.changes || []).length;
  recordActivity(
    'profile',
    'monitor-refresh',
    conn.connectionState === 'reachable' ? 'success' : conn.connectionState === 'not-tested' ? 'info' : 'warning',
    `${record?.identity?.name || providerId} monitoring refresh (${conn.connectionState})`,
    { providerId, connectionState: conn.connectionState, changed, latencyMs: conn.latencyMs, reliabilityState: reliability.state }
  );

  return {
    providerId,
    ok: true,
    skipped: disc.skipped || false,
    changed,
    snapshot,
    changes: disc.changes || [],
  };
}

// Refresh one or all discoverable providers. Manual only.
async function refreshMonitoring({ force = false, providerId = null } = {}) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const targets = providerId ? [providerId] : DISCOVERABLE.map((p) => p.id);
  const results = [];
  let succeeded = 0;
  let failed = 0;
  let changed = 0;
  for (const id of targets) {
    try {
      const r = await monitorProvider(id, { force });
      results.push(r);
      if (r.ok && !r.skipped) {
        succeeded++;
        changed += r.changed || 0;
      } else if (!r.ok) {
        failed++;
      }
    } catch (err) {
      failed++;
      results.push({ providerId: id, ok: false, error: String(err?.message || err) });
    }
  }
  const completedAt = new Date().toISOString();
  const summary = {
    success: failed === 0,
    checked: results.length,
    succeeded,
    failed,
    changed,
    startedAt,
    completedAt,
    durationMs: Date.now() - t0,
  };
  recordActivity('profile', 'monitor-refresh-all', failed === 0 ? 'success' : 'warning',
    `Monitoring refresh: ${succeeded}/${results.length} providers, ${changed} change(s)`,
    { ...summary });
  return { summary, results };
}

export const providerMonitorService = {
  monitorProvider,
  refreshMonitoring,
};
