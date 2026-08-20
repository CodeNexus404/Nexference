import { Storage } from './storage.js';

// Global Workspace state — the single mutable source of truth the UI reads from
// and writes to. Replaces the scattered module-scope variables that previously
// lived at the top of app.js (liveModels, selected/applied provider, filter
// text, custom-gateway fields, in-flight fetch bookkeeping).
//
// Introduced for the v0.1.0 architecture milestone. Behaviour unchanged.
export const workspace = {
  liveModels: {},
  selectedProviderId: null,
  appliedProviderId: null,
  filterText: '',
  customUrl: '',
  customModel: '',
  customFormat: Storage.getCustomFormat() || 'anthropic',
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
