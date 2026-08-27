// Benchmark Store (v1.5.0) — persists provider benchmark results. Secret-free:
// only provider id, profile id, timing, reachability, a coarse outcome, and a
// (non-secret) note. Bounded so it can't grow unbounded.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.nexference');
const FILE = join(DATA_DIR, 'provider-benchmarks.json');
const MAX = 120;

function readAll() {
  try {
    if (!existsSync(FILE)) return [];
    const arr = JSON.parse(readFileSync(FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(list, null, 2));
  } catch {
    /* non-fatal */
  }
}

export function recordResult(result) {
  if (!result || !result.providerId || !result.profileId) return null;
  const list = readAll();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    measuredAt: new Date().toISOString(),
    ...result,
  };
  list.unshift(entry);
  if (list.length > MAX) list.length = MAX;
  writeAll(list);
  return entry;
}

export function listResults({ providerId = null, limit = 50 } = {}) {
  let list = readAll();
  if (providerId) list = list.filter((r) => r.providerId === providerId);
  return list.slice(0, limit);
}

export function getSummary() {
  const list = readAll();
  const byProvider = {};
  for (const r of list) {
    const p = (byProvider[r.providerId] = byProvider[r.providerId] || { providerId: r.providerId, runs: 0, latest: null, profiles: {} });
    p.runs++;
    p.profiles[r.profileId] = (p.profiles[r.profileId] || 0) + 1;
    if (!p.latest || new Date(r.measuredAt) > new Date(p.latest.measuredAt)) p.latest = r;
  }
  return { total: list.length, providers: Object.values(byProvider) };
}
