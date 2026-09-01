// ═══════════════════════════════════════════════════════════════
//  Custom Provider Store (v2.1.0)
//
//  Persists user-created custom providers separately from curated
//  and ecosystem-adopted providers. Atomic writes, corrupt-file
//  safety, bounded count, no secrets ever stored.
// ═══════════════════════════════════════════════════════════════

import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs';

const STORE_DIR = join(homedir(), '.nexference');
const STORE_FILE = join(STORE_DIR, 'custom-providers.json');
const STORE_VERSION = '2.1.0';
const MAX_CUSTOM_PROVIDERS = 200;

let state = loadState();

function loadState() {
  try {
    const raw = JSON.parse(readFileSync(STORE_FILE, 'utf8'));
    if (raw && raw._v === STORE_VERSION && Array.isArray(raw.providers)) return raw;
    return { _v: STORE_VERSION, providers: [] };
  } catch {
    return { _v: STORE_VERSION, providers: [] };
  }
}

function saveState() {
  try {
    mkdirSync(STORE_DIR, { recursive: true });
    const tmp = STORE_FILE + '.tmp.' + Date.now();
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, STORE_FILE);
  } catch { /* best effort */ }
}

export function loadCustomProviders() {
  state = loadState();
  return state.providers;
}

export function getCustomProvider(id) {
  return state.providers.find((p) => p.id === id) || null;
}

export function upsertCustomProvider(rec) {
  if (!rec || !rec.id) return null;
  const idx = state.providers.findIndex((p) => p.id === rec.id);
  if (idx >= 0) {
    state.providers[idx] = { ...state.providers[idx], ...rec, updatedAt: new Date().toISOString() };
  } else {
    if (state.providers.length >= MAX_CUSTOM_PROVIDERS) return null;
    state.providers.push(rec);
  }
  saveState();
  return rec;
}

export function setCustomProviderStatus(id, lifecycle) {
  const rec = getCustomProvider(id);
  if (!rec) return null;
  rec.lifecycle = lifecycle;
  rec.updatedAt = new Date().toISOString();
  saveState();
  return rec;
}

export function removeCustomProvider(id) {
  const before = state.providers.length;
  state.providers = state.providers.filter((p) => p.id !== id);
  if (state.providers.length < before) { saveState(); return true; }
  return false;
}

export function findByHostname(hostname) {
  if (!hostname) return null;
  const norm = hostname.toLowerCase().replace(/^www\./, '');
  return state.providers.find((p) => {
    try {
      const h = new URL(p.identity?.website || '').hostname.replace(/^www\./, '');
      return h === norm;
    } catch { return false; }
  }) || null;
}

export function findByName(name) {
  if (!name) return null;
  const norm = name.toLowerCase().trim();
  return state.providers.find((p) => (p.identity?.name || '').toLowerCase().trim() === norm) || null;
}

export function listCustomProviders({ lifecycle } = {}) {
  let list = state.providers;
  if (lifecycle) list = list.filter((p) => p.lifecycle === lifecycle);
  return list;
}

export function getCustomProviderCount() {
  return state.providers.length;
}
