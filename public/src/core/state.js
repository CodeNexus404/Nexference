import { Storage } from './storage.js';

// Central Nexference workspace state — the single mutable source of truth the UI
// reads from and writes to. v0.2.0 distinguishes five concepts so the platform
// stops treating them as one thing:
//
//   Provider  — a cloud AI gateway (OpenRouter, Agent Router, …)
//   Model     — a specific model id on a provider
//   Client    — the AI coding client the config targets (Claude Code, …)
//   Runtime   — a local AI runtime (Ollama, …)
//   Profile   — a named saved selection of client+provider+model (no secrets)
//
// This replaces the scattered module-scope variables from app.js. Behaviour of
// the Gateway Switcher itself is unchanged; the shape just makes the new pages
// (Workspace / Providers / Configuration / Local AI / Clients / Settings) clean.
// The last applied configuration record (persisted in localStorage). Restored at
// boot so the "applied" badge/glow, workspace card and top-bar status all survive
// a refresh or server restart on every platform (macOS, Windows, Linux) — the
// settings.json re-match in loadConfig() is then used only as the authoritative
// override, not the sole source of truth.
const _storedApplied = Storage.getApplied();
const _storedAppliedId =
  _storedApplied && (_storedApplied.status === 'configured' || _storedApplied.status === 'fallback')
    ? (_storedApplied.provider || null)
    : null;

export const workspace = {
  // Page / navigation
  currentPage: Storage.getPage() || 'workspace',

  // Active selections (the "what is configured right now" answer). Seeded from
  // the persisted applied record so they're valid before /api/config resolves.
  activeProvider: _storedAppliedId,
  activeModel: (_storedApplied && _storedApplied.model) || null,
  activeClient: (_storedApplied && _storedApplied.client) || 'claude-code',
  activeRuntime: (_storedApplied && _storedApplied.runtime) || null,

  // The provider id whose card currently owns settings.json. Starts as the
  // persisted applied provider (keeps a card glowing across refresh/restart
  // without depending on the base-URL re-match), then loadConfig() may override
  // it with a verified match against the live file.
  appliedProviderId: _storedAppliedId,

  // Applied configuration metadata (non-secret). Persisted separately so the
  // Workspace card + top-bar status can reflect the last applied config even
  // before re-reading settings.json.
  applied: _storedApplied,

  // Whether the live settings.json currently points at a gateway (base URL set).
  // Mirrors what the persisted applied record claims, so the top-bar status stays
  // honest even when that record is absent/stale after a refresh or restart.
  liveConfigBase: null,

  // Whether a generated config exists that hasn't been applied yet.
  unsaved: false,

  // Model cache (read-through to the server)
  liveModels: {},

  // UI filters / transient
  filterText: '',
  customUrl: '',
  customModel: '',
  customFormat: Storage.getCustomFormat() || 'anthropic',

  // Provider discovery intelligence (v1.4.0) — populated from /api/provider-intelligence.
  // Maps providerId -> normalized intelligence record. Never contains secrets.
  providerIntel: {},
  providerChangeCounts: {},
  providerIntelSummary: null,
  _intelLoading: false,

  // Provider Monitoring (v1.5.0) — populated from /api/provider-monitor/*.
  // Maps providerId -> insight payload (history + metrics + changes). Never secrets.
  monitorInsights: {},
  benchmarkProfiles: [],
  benchmarkResults: [],
  // Per-model change index derived from /api/provider-changes, used by the
  // Model Library "Changed recently" filter + NEW/REMOVED/FREE badges.
  modelChanges: {},

  _fetching: new Set(),
  _keyFetchTimers: {},
};

// ── Provider Monitoring helpers (v1.5.0) ──
export async function fetchMonitorInsight(providerId) {
  const res = await fetch(`/api/provider-monitor/insight/${encodeURIComponent(providerId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  workspace.monitorInsights[providerId] = data;
  return data;
}

export async function refreshMonitoring(providerId) {
  const body = providerId ? { providerId } : {};
  const res = await fetch('/api/provider-monitor/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json();
  // Re-pull intelligence + insight for the affected provider(s).
  if (providerId) {
    await fetchMonitorInsight(providerId);
  } else if (data.results) {
    for (const r of data.results) if (r.providerId) await fetchMonitorInsight(r.providerId);
  }
  return data;
}

export async function fetchBenchmarkProfiles() {
  const res = await fetch('/api/benchmarks/profiles');
  if (!res.ok) return;
  const data = await res.json();
  workspace.benchmarkProfiles = data.profiles || [];
}

export async function fetchBenchmarks(providerId) {
  const url = providerId ? `/api/benchmarks?providerId=${encodeURIComponent(providerId)}` : '/api/benchmarks';
  const res = await fetch(url);
  if (!res.ok) return;
  const data = await res.json();
  workspace.benchmarkResults = data.results || [];
}

export async function runBenchmark(providerId, profileId) {
  const res = await fetch('/api/benchmarks/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId, profileId }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  await fetchBenchmarks(providerId);
  return data.result;
}

// Build a per-model change index from the change feed (for "Changed recently").
export async function fetchModelChanges(limit = 200) {
  const res = await fetch(`/api/provider-changes?limit=${limit}`);
  if (!res.ok) return;
  const data = await res.json();
  const idx = {};
  for (const c of data.changes || []) {
    if (!c.modelId) continue;
    const e = (idx[c.modelId] = idx[c.modelId] || { types: {}, lastAt: c.detectedAt });
    e.types[c.type] = (e.types[c.type] || 0) + 1;
    if (new Date(c.detectedAt) > new Date(e.lastAt)) e.lastAt = c.detectedAt;
  }
  workspace.modelChanges = idx;
  return idx;
}

// ── Model selectors (read-through to the cached server model list) ──
export function getFreeModels(providerId) {
  const cached = workspace.liveModels[providerId];
  if (!cached?.freeModels?.length) return [];
  return cached.freeModels;
}

export function getModels(providerId) {
  const cached = workspace.liveModels[providerId];
  if (!cached?.models?.length) return [];
  return cached.models;
}

export function getAllModels(providerId) {
  return getModels(providerId);
}

// Provenance of a provider's cached model list, used to render honest
// loading-state text ("live", "cached", "fallback catalogue", …).
export function getModelSource(providerId) {
  return workspace.liveModels[providerId]?.source || null;
}

export function isFetching(providerId) {
  return workspace._fetching.has(providerId);
}
