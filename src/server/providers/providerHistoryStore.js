// Provider History Store (v1.5.0) — bounded per-provider monitoring snapshots.
//
// Each manual monitoring check produces one snapshot capturing the observed
// state at a point in time: discovery status, availability, model counts,
// added/removed/changed models, latency, connection reliability state, and a
// structured check result. Snapshots are the raw feed the History and Timeline
// UI read from. They never contain secrets.
//
// Per-provider snapshots are capped so a busy monitoring cadence can't grow the
// dataset unbounded.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.nexference');
const FILE = join(DATA_DIR, 'provider-history.json');
const MAX_SNAPSHOTS = 100;

function readAll() {
  try {
    if (!existsSync(FILE)) return {};
    const arr = JSON.parse(readFileSync(FILE, 'utf8'));
    return arr && typeof arr === 'object' ? arr : {};
  } catch {
    return {};
  }
}

function writeAll(obj) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(obj, null, 2));
  } catch {
    /* non-fatal: history is best-effort */
  }
}

// snapshot: { providerId, checkedAt, discoveryStatus, availability, sourceStatus,
//   sourceType, modelCount, freeModelCount, paidModelCount, recommendedModelCount,
//   addedModels, removedModels, changedModels, latencyMs, reliabilityState,
//   checkResult, errorCategory, metadata }
export function recordSnapshot(snapshot) {
  if (!snapshot || !snapshot.providerId) return null;
  const all = readAll();
  const list = all[snapshot.providerId] || [];
  list.unshift(snapshot);
  if (list.length > MAX_SNAPSHOTS) list.length = MAX_SNAPSHOTS;
  all[snapshot.providerId] = list;
  writeAll(all);
  return snapshot;
}

export function getProviderSnapshots(providerId, { limit = 50 } = {}) {
  const all = readAll();
  const list = all[providerId] || [];
  return list.slice(0, limit);
}

export function getLatest(providerId) {
  const all = readAll();
  const list = all[providerId] || [];
  return list[0] || null;
}

// Recent snapshots across all providers, newest first (for a global timeline).
export function getRecentSnapshots({ limit = 100, since = null } = {}) {
  const all = readAll();
  const out = [];
  for (const id of Object.keys(all)) {
    for (const s of all[id]) {
      if (since && new Date(s.checkedAt).getTime() < new Date(since).getTime()) continue;
      out.push(s);
    }
  }
  out.sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime());
  return out.slice(0, limit);
}

// Compact summary for a provider: counts by availability, first/last timestamps.
export function getProviderSummary(providerId) {
  const snaps = getProviderSnapshots(providerId, { limit: MAX_SNAPSHOTS });
  if (!snaps.length) return { providerId, total: 0, firstAt: null, lastAt: null, availability: {} };
  const availability = {};
  for (const s of snaps) {
    const key = s.availability || 'unknown';
    availability[key] = (availability[key] || 0) + 1;
  }
  return {
    providerId,
    total: snaps.length,
    firstAt: snaps[snaps.length - 1].checkedAt,
    lastAt: snaps[0].checkedAt,
    availability,
  };
}

export function resetHistory(providerId) {
  const all = readAll();
  if (providerId) delete all[providerId];
  else return;
  writeAll(all);
}
