// Provider Integration Store (v1.9.0) — persistent integration assessments,
// kept SEPARATELY from provider records and from the dynamic provider store.
//
// Location: ~/.nexference/provider-integrations.json
//
// Guarantees (mirrors the other Nexference stores):
//   • Atomic writes (temp file + rename) — a crash mid-write never corrupts state.
//   • Corrupted JSON is treated as empty — the app must still boot.
//   • Schema version marker (_v) so a foreign app's data is never consumed.
//   • Bounded, validated records; duplicate protection by providerId.
//   • NO secrets: callers must never pass keys/tokens/headers. We assert the
//     shape is secret-free before persisting.
//
// Historical integration data is retained even when the underlying provider is
// deactivated/removed; records reference the provider id (clearly marked inactive).

import { join } from 'path';
import { homedir } from 'os';
import { safeRead, atomicWrite } from '../ecosystem/ecosystemStore.js';
import { INTEGRATION_STATUS, ADAPTER_TYPE, CONFIDENCE } from './integrationTypes.js';

const DATA_DIR = join(homedir(), '.nexference');
const FILE = join(DATA_DIR, 'provider-integrations.json');
const STORE_VERSION = '1.9.0';
const MAX_RECORDS = 2000;

function emptyState() { return { _v: STORE_VERSION, integrations: {} }; }

// A record is secret-free by construction; this guard rejects obviously wrong data
// and any secret-shaped *values* (defense in depth). Key names such as
// `supportsApiKey` are allowed; only actual secret values are rejected.
function looksLikeSecret(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s.length < 16) return false;
  if (/^(sk|pk|rk|ak|xox[abp]|gh[pousr]_|eyJ|Bearer\s)/i.test(s)) return true;
  if (/^[A-Za-z0-9_./+=-]{32,}$/.test(s)) return true; // long random token
  return false;
}

function containsSecret(obj) {
  if (Array.isArray(obj)) return obj.some(containsSecret);
  if (obj && typeof obj === 'object') return Object.values(obj).some(containsSecret);
  return looksLikeSecret(obj);
}

function isValid(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (typeof rec.providerId !== 'string') return false;
  if (rec.integrationStatus && !Object.values(INTEGRATION_STATUS).includes(rec.integrationStatus)) return false;
  if (rec.adapterType && !Object.values(ADAPTER_TYPE).includes(rec.adapterType)) return false;
  if (rec.confidence && !Object.values(CONFIDENCE).includes(rec.confidence)) return false;
  if (containsSecret(rec)) return false;
  return true;
}

export function loadIntegrations() {
  const obj = safeRead(FILE);
  if (!obj || typeof obj !== 'object' || typeof obj.integrations !== 'object') return emptyState();
  const out = { _v: STORE_VERSION, integrations: {} };
  for (const [id, rec] of Object.entries(obj.integrations || {})) {
    if (isValid(rec) && rec._v === STORE_VERSION) out.integrations[id] = rec;
  }
  return out;
}

export function saveIntegrations(state) {
  const s = state && typeof state === 'object' ? state : emptyState();
  s._v = STORE_VERSION;
  if (typeof s.integrations !== 'object' || s.integrations === null) s.integrations = {};
  const cleaned = {};
  for (const [id, rec] of Object.entries(s.integrations)) {
    if (isValid(rec)) cleaned[id] = rec;
  }
  // Bound the store.
  const ids = Object.keys(cleaned).slice(0, MAX_RECORDS);
  const bounded = {};
  for (const id of ids) bounded[id] = cleaned[id];
  s.integrations = bounded;
  atomicWrite(FILE, s);
}

export function getIntegration(providerId) {
  if (!providerId) return null;
  return loadIntegrations().integrations[providerId] || null;
}

export function upsertIntegration(rec) {
  if (!isValid(rec)) throw new Error('invalid integration record');
  const state = loadIntegrations();
  state.integrations[rec.providerId] = rec;
  saveIntegrations(state);
  return rec;
}

export function removeIntegration(providerId) {
  const state = loadIntegrations();
  if (!state.integrations[providerId]) return false;
  delete state.integrations[providerId];
  saveIntegrations(state);
  return true;
}

// Reference a deactivated/removed provider without losing history: the record is
// kept but flagged so the UI can show it clearly.
export function markProviderInactive(providerId, active) {
  const rec = getIntegration(providerId);
  if (!rec) return null;
  rec.providerActive = active;
  rec.updatedAt = new Date().toISOString();
  upsertIntegration(rec);
  return rec;
}

export { STORE_VERSION, FILE };
