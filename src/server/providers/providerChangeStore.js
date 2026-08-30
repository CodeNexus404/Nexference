// Provider Change Store (v1.4.0) — a persistent, secret-free audit trail of
// *discovery* changes: a provider coming online/offline, new or removed models,
// free/paid shifts, source changes. This is intentionally separate from the
// config activity log (which tracks user actions) and from model-change
// intelligence (which is about capability drift).
//
// Every record is normalised and NEVER contains API keys, authorization
// headers, or pricing detail beyond a coarse free/paid count. Each entry:
//
//   { id, providerId, providerName, type, category, severity, detectedAt,
//     summary, details: { before, after, affectedIds } }
//
// Persistence is a single JSON file under ~/.nexference, capped so it can't
// grow unbounded.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.nexference');
const FILE = join(DATA_DIR, 'provider-changes.json');
const MAX = 300;

function readAll() {
  try {
    if (!existsSync(FILE)) return [];
    const raw = readFileSync(FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(list.slice(0, MAX), null, 2));
  } catch { /* best-effort; logging must never throw */ }
}

// Strip any accidental secret-like keys before persisting.
function sanitize(details) {
  if (!details || typeof details !== 'object') return details || {};
  const safe = {};
  for (const [k, v] of Object.entries(details)) {
    const kl = String(k).toLowerCase();
    if (/(key|secret|token|password|authorization|auth|bearer|header)/.test(kl)) continue;
    safe[k] = v;
  }
  return safe;
}

export const CHANGE_TYPES = {
  PROVIDER_DISCOVERED: 'provider_discovered',
  PROVIDER_AVAILABLE: 'provider_available',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  PROVIDER_DOWN: 'provider_down',
  PROVIDER_RESTORED: 'provider_restored',
  PROVIDER_DEPRECATED: 'provider_deprecated',
  // Ecosystem discovery (v1.7.0) — separated from curated provider monitoring.
  PROVIDER_SEEN_AGAIN: 'provider_seen_again',
  PROVIDER_MISSING: 'provider_missing',
  PROVIDER_ADOPTED: 'provider_adopted',
  PROVIDER_IGNORED: 'provider_ignored',
  PROVIDER_REVIEW: 'provider_review',
  PROVIDER_DUPLICATE: 'provider_duplicate',
  // Provider Integration & Adapter Framework (v1.9.0)
  INTEGRATION_ASSESSED: 'integration_assessed',
  INTEGRATION_AVAILABLE: 'integration_available',
  INTEGRATION_LOST: 'integration_lost',
  INTEGRATION_STATUS_CHANGED: 'integration_status_changed',
  ADAPTER_CHANGED: 'adapter_changed',
  CAPABILITY_ADDED: 'capability_added',
  CAPABILITY_REMOVED: 'capability_removed',
  EVIDENCE_ADDED: 'evidence_added',
  LOGO_CHANGED: 'logo_changed',
  WEBSITE_CHANGED: 'website_changed',
  DOCUMENTATION_CHANGED: 'documentation_changed',
  MODELS_DISCOVERED: 'models_discovered',
  MODELS_REMOVED: 'models_removed',
  MODELS_ADDED: 'models_added',
  MODELS_REMOVED: 'models_removed',
  MODEL_DISCOVERED: 'model_discovered',
  MODEL_REMOVED: 'model_removed',
  MODEL_DEPRECATED: 'model_deprecated',
  MODEL_ACCESS_CHANGED: 'model_access_changed',
  MODEL_AVAILABILITY_CHANGED: 'model_availability_changed',
  MODEL_LIFECYCLE_CHANGED: 'model_lifecycle_changed',
  FREE_MODELS_CHANGED: 'free_models_changed',
  SOURCE_CHANGED: 'source_changed',
  METADATA_CHANGED: 'metadata_changed',
};

const SEVERITY = {
  [CHANGE_TYPES.PROVIDER_DISCOVERED]: 'info',
  [CHANGE_TYPES.PROVIDER_AVAILABLE]: 'info',
  [CHANGE_TYPES.PROVIDER_UNAVAILABLE]: 'warning',
  [CHANGE_TYPES.PROVIDER_DOWN]: 'warning',
  [CHANGE_TYPES.PROVIDER_RESTORED]: 'info',
  [CHANGE_TYPES.PROVIDER_DEPRECATED]: 'warning',
  [CHANGE_TYPES.PROVIDER_SEEN_AGAIN]: 'info',
  [CHANGE_TYPES.PROVIDER_MISSING]: 'warning',
  [CHANGE_TYPES.PROVIDER_ADOPTED]: 'info',
  [CHANGE_TYPES.PROVIDER_IGNORED]: 'info',
  [CHANGE_TYPES.PROVIDER_REVIEW]: 'info',
  [CHANGE_TYPES.PROVIDER_DUPLICATE]: 'info',
  [CHANGE_TYPES.INTEGRATION_ASSESSED]: 'info',
  [CHANGE_TYPES.INTEGRATION_AVAILABLE]: 'info',
  [CHANGE_TYPES.INTEGRATION_LOST]: 'warning',
  [CHANGE_TYPES.INTEGRATION_STATUS_CHANGED]: 'info',
  [CHANGE_TYPES.ADAPTER_CHANGED]: 'info',
  [CHANGE_TYPES.CAPABILITY_ADDED]: 'info',
  [CHANGE_TYPES.CAPABILITY_REMOVED]: 'warning',
  [CHANGE_TYPES.EVIDENCE_ADDED]: 'info',
  [CHANGE_TYPES.LOGO_CHANGED]: 'info',
  [CHANGE_TYPES.WEBSITE_CHANGED]: 'info',
  [CHANGE_TYPES.DOCUMENTATION_CHANGED]: 'info',
  [CHANGE_TYPES.MODELS_DISCOVERED]: 'info',
  [CHANGE_TYPES.MODELS_REMOVED]: 'warning',
  [CHANGE_TYPES.MODELS_ADDED]: 'info',
  [CHANGE_TYPES.MODELS_REMOVED]: 'warning',
  [CHANGE_TYPES.MODEL_DISCOVERED]: 'info',
  [CHANGE_TYPES.MODEL_REMOVED]: 'warning',
  [CHANGE_TYPES.MODEL_DEPRECATED]: 'warning',
  [CHANGE_TYPES.MODEL_ACCESS_CHANGED]: 'info',
  [CHANGE_TYPES.MODEL_AVAILABILITY_CHANGED]: 'info',
  [CHANGE_TYPES.MODEL_LIFECYCLE_CHANGED]: 'info',
  [CHANGE_TYPES.FREE_MODELS_CHANGED]: 'info',
  [CHANGE_TYPES.SOURCE_CHANGED]: 'info',
  [CHANGE_TYPES.METADATA_CHANGED]: 'info',
};

// Avoid recording the exact same event twice in a row (e.g. a refresh that
// re-observes an unchanged state must not spam the change feed).
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function recordChange({ providerId, providerName, modelId = null, type, previousValue = null, newValue = null, sourceType = null, confidence = 'medium', summary, details = {} }) {
  if (!providerId || !type) throw new Error('recordChange requires providerId and type');
  const now = Date.now();
  const list = readAll();
  const key = modelId ? `${providerId}:${modelId}:${type}` : `${providerId}:${type}`;
  for (const prev of list.slice(0, 300)) {
    if (now - new Date(prev.detectedAt).getTime() > DEDUP_WINDOW_MS) break;
    const pkey = prev.modelId ? `${prev.providerId}:${prev.modelId}:${prev.type}` : `${prev.providerId}:${prev.type}`;
    if (pkey !== key) continue;
    if (JSON.stringify(prev.previousValue || null) === JSON.stringify(previousValue || null)
        && JSON.stringify(prev.newValue || null) === JSON.stringify(newValue || null)) {
      return null; // duplicate unchanged state — skip
    }
  }
  const entry = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    providerId,
    providerName: providerName || providerId,
    modelId,
    type,
    category: modelId ? 'model-change' : 'provider-discovery',
    severity: SEVERITY[type] || 'info',
    previousValue,
    newValue,
    sourceType,
    confidence,
    detectedAt: new Date(now).toISOString(),
    summary,
    details: sanitize(details),
  };
  list.unshift(entry);
  writeAll(list);
  return entry;
}

export function listChanges({ provider, type, limit, since } = {}) {
  let list = readAll();
  if (provider) list = list.filter((c) => c.providerId === provider);
  if (type) list = list.filter((c) => c.type === type);
  if (since) {
    const t = new Date(since).getTime();
    if (!Number.isNaN(t)) list = list.filter((c) => new Date(c.detectedAt).getTime() >= t);
  }
  return limit ? list.slice(0, limit) : list;
}

export function getChangeSummary() {
  const list = readAll();
  const byType = {};
  const byProvider = {};
  let recentlyUnavailable = 0;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  for (const c of list) {
    byType[c.type] = (byType[c.type] || 0) + 1;
    byProvider[c.providerId] = (byProvider[c.providerId] || 0) + 1;
    if ((c.type === CHANGE_TYPES.PROVIDER_UNAVAILABLE || c.type === CHANGE_TYPES.PROVIDER_DOWN)
        && now - new Date(c.detectedAt).getTime() < day) {
      recentlyUnavailable++;
    }
  }
  return {
    total: list.length,
    byType,
    byProvider,
    recentlyUnavailable,
    lastChangeAt: list.length ? list[0].detectedAt : null,
  };
}
