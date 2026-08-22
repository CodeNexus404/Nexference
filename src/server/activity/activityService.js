// Activity / Event service (v1.0.0) — a lightweight, persistent, secret-free
// audit trail of important workspace events: configuration applied, backup
// created/restored/deleted, runtime started, execution finished/failed/cancelled,
// profile applied.
//
// It NEVER stores API keys, secret configuration values, authorization headers,
// or full prompts. Each entry is a normalised event:
//
//   { id, timestamp, category, action, status, summary, details }
//
// Persistence is a simple JSON file under the Nexference data directory, capped
// so it can't grow unbounded. This is the server-side complement to the existing
// frontend activityStore (which tracks client-only events); the UI merges both.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.nexference');
const FILE = join(DATA_DIR, 'activity.json');
const MAX = 100;

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
  } catch { /* best-effort; never throw from logging */ }
}

// category: 'config' | 'backup' | 'runtime' | 'execution' | 'profile' | 'system'
// status:   'success' | 'warning' | 'error' | 'info'
export function recordActivity(category, action, status, summary, details = {}) {
  // Strip any accidental secret-like keys before persisting.
  const safe = {};
  for (const [k, v] of Object.entries(details || {})) {
    const kl = k.toLowerCase();
    if (/(key|secret|token|password|authorization|auth|bearer)/.test(kl)) continue;
    safe[k] = v;
  }
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    category,
    action,
    status,
    summary,
    details: safe,
  };
  const list = readAll();
  list.unshift(entry);
  writeAll(list);
  return entry;
}

export function listActivities(limit = MAX) {
  const list = readAll();
  return limit ? list.slice(0, limit) : list;
}
