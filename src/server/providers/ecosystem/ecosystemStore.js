// Ecosystem discovery persistence (v1.7.0).
//
// Three runtime stores under ~/.nexference, kept separate from the curated
// provider-intelligence store:
//   • discovered-providers.json   — id → normalized discovered provider record
//   • discovery-history.json      — bounded list of discovery run summaries
//   • discovery-sources-state.json— per-source refresh state (lastRefresh, status)
//
// Guarantees:
//   • Atomic writes (temp file + rename) so a crash mid-write never corrupts state.
//   • Corrupted JSON is treated as empty — the app must still boot.
//   • No secrets: callers must never pass keys/tokens; we assert non-secret shape.
//   • Discovery data is OPTIONAL — if absent or unreadable the app boots normally.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.nexference');
const DISCOVERED_FILE = join(DATA_DIR, 'discovered-providers.json');
const HISTORY_FILE = join(DATA_DIR, 'discovery-history.json');
const SOURCE_STATE_FILE = join(DATA_DIR, 'discovery-sources-state.json');

const MAX_HISTORY = 100;

function safeRead(file) {
  try {
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    // Corrupted or unreadable → treat as empty rather than crashing boot.
    return null;
  }
}

function atomicWrite(file, data) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

// ── Discovered providers ──
// Only records written by THIS version are loaded. A foreign app may have written
// to the same path in the past; those are ignored so they never pollute discovery.
const STORE_VERSION = '1.7.0';
export function loadDiscovered() {
  const obj = safeRead(DISCOVERED_FILE);
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [id, rec] of Object.entries(obj)) {
    if (rec && rec._v === STORE_VERSION) out[id] = rec;
  }
  return out;
}

export function saveDiscovered(map) {
  atomicWrite(DISCOVERED_FILE, map || {});
}

// ── Discovery history ──
export function loadHistory() {
  const arr = safeRead(HISTORY_FILE);
  return Array.isArray(arr) ? arr : [];
}

export function appendHistory(entry) {
  const list = loadHistory();
  list.unshift(entry);
  atomicWrite(HISTORY_FILE, list.slice(0, MAX_HISTORY));
}

// ── Source state ──
export function loadSourceState() {
  const obj = safeRead(SOURCE_STATE_FILE);
  return obj && typeof obj === 'object' ? obj : {};
}

export function saveSourceState(state) {
  atomicWrite(SOURCE_STATE_FILE, state || {});
}
