// Dynamic Provider Store (v1.8.0) — persistent records for providers that were
// discovered by the Ecosystem layer and explicitly adopted by the user.
//
// Lives at ~/.nexference/dynamic-providers.json, completely separate from the
// curated registry (which stays source-controlled) and from the ecosystem
// discovery store. Same safety philosophy as the other Nexference stores:
//   • Atomic writes (temp file + rename) — a crash mid-write never corrupts state.
//   • Corrupted JSON is treated as empty — the app must still boot.
//   • Schema version marker (_v) so a foreign app's data is never consumed.
//   • Bounded, validated records; duplicate protection by id / ecosystemId.
//   • No secrets: callers must never pass keys/tokens/headers.
//
// This store ONLY holds metadata + integration capabilities. Model lists are
// imported by reference (provenance) and connection test OUTCOMES only.

import { join } from 'path';
import { homedir } from 'os';
import { safeRead, atomicWrite } from '../ecosystem/ecosystemStore.js';

const DATA_DIR = join(homedir(), '.nexference');
const FILE = join(DATA_DIR, 'dynamic-providers.json');
const STORE_VERSION = '1.8.0';
const MAX_RECORDS = 500;

function emptyState() { return { _v: STORE_VERSION, providers: [] }; }

function isValid(rec) {
  return rec && typeof rec === 'object' && typeof rec.id === 'string' && typeof rec.name === 'string';
}

export function loadDynamicProviders() {
  const obj = safeRead(FILE);
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.providers)) return emptyState();
  const list = obj.providers
    .filter((r) => isValid(r) && r._v === STORE_VERSION)
    .slice(0, MAX_RECORDS);
  return { _v: STORE_VERSION, providers: list };
}

export function saveDynamicProviders(state) {
  const s = state && typeof state === 'object' ? state : emptyState();
  s._v = STORE_VERSION;
  if (!Array.isArray(s.providers)) s.providers = [];
  s.providers = s.providers.filter(isValid).slice(0, MAX_RECORDS);
  atomicWrite(FILE, s);
}

export function getDynamicProvider(id) {
  return loadDynamicProviders().providers.find((p) => p.id === id) || null;
}

export function findByEcosystemId(ecoId) {
  if (!ecoId) return null;
  return loadDynamicProviders().providers.find((p) => p.ecosystemId === ecoId) || null;
}

export function upsertDynamicProvider(rec) {
  if (!isValid(rec)) throw new Error('invalid dynamic provider record');
  const state = loadDynamicProviders();
  const i = state.providers.findIndex((p) => p.id === rec.id);
  if (i >= 0) state.providers[i] = rec; else state.providers.push(rec);
  saveDynamicProviders(state);
  return rec;
}

export function setDynamicProviderStatus(id, status) {
  const rec = getDynamicProvider(id);
  if (!rec) return null;
  rec.status = status;
  rec.updatedAt = new Date().toISOString();
  upsertDynamicProvider(rec);
  return rec;
}

export function removeDynamicProvider(id) {
  const state = loadDynamicProviders();
  const before = state.providers.length;
  state.providers = state.providers.filter((p) => p.id !== id);
  saveDynamicProviders(state);
  return before !== state.providers.length;
}
