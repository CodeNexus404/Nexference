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
export const workspace = {
  // Page / navigation
  currentPage: Storage.getPage() || 'workspace',

  // Active selections (the "what is configured right now" answer)
  activeProvider: null,        // provider id
  activeModel: null,           // model id
  activeClient: 'claude-code', // client id
  activeRuntime: null,         // local runtime id

  // Applied configuration metadata (non-secret). Persisted separately so the
  // Workspace card + top-bar status can reflect the last applied config even
  // before re-reading settings.json.
  applied: Storage.getApplied(),

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

  _fetching: new Set(),
  _keyFetchTimers: {},
};

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
