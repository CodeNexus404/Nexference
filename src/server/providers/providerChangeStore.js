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
  MODELS_ADDED: 'models_added',
  MODELS_REMOVED: 'models_removed',
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
  [CHANGE_TYPES.MODELS_ADDED]: 'info',
  [CHANGE_TYPES.MODELS_REMOVED]: 'warning',
  [CHANGE_TYPES.FREE_MODELS_CHANGED]: 'info',
  [CHANGE_TYPES.SOURCE_CHANGED]: 'info',
  [CHANGE_TYPES.METADATA_CHANGED]: 'info',
};

export function recordChange({ providerId, providerName, type, summary, details = {} }) {
  if (!providerId || !type) throw new Error('recordChange requires providerId and type');
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    providerId,
    providerName: providerName || providerId,
    type,
    category: 'provider-discovery',
    severity: SEVERITY[type] || 'info',
    detectedAt: new Date().toISOString(),
    summary,
    details: sanitize(details),
  };
  const list = readAll();
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
