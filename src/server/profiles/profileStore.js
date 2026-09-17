import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { atomicRenameSync } from '../utils/fs.js';

// ═══════════════════════════════════════════════════
//  Profile store — persistent, portable configuration profiles. A profile is a
//  REUSABLE DESIRED configuration (client + connection + provider/runtime +
//  model). It stores REFERENCES ONLY — never API keys. Distinct from backups,
//  which are historical snapshots of settings.json.
// ═══════════════════════════════════════════════════

const STORE_DIR = join(homedir(), '.nexference');
const STORE_PATH = join(STORE_DIR, 'profiles.json');

// Reject any attempt to smuggle secrets into a profile.
const SECRET_KEYS = ['key', 'apiKey', 'api_key', 'token', 'secret', 'apiKeyHelper', 'password'];
function sanitize(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (SECRET_KEYS.some((s) => k.toLowerCase().includes(s))) continue; // drop secrets
    out[k] = v;
  }
  return out;
}

function load() {
  if (!existsSync(STORE_PATH)) return {};
  try { return JSON.parse(readFileSync(STORE_PATH, 'utf-8')); }
  catch { return {}; }
}

function persist(map) {
  try {
    if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
    const tmp = `${STORE_PATH}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf-8');
    atomicRenameSync(tmp, STORE_PATH);
  } catch { /* non-fatal */ }
}

export function listProfiles() {
  const map = load();
  return Object.values(map).map((p) => ({ id: p.id, name: p.name }));
}

export function getProfile(id) {
  return load()[id] || null;
}

export function saveProfile(data) {
  const map = load();
  const clean = sanitize(data);
  if (!clean.id) clean.id = 'pf_' + Date.now().toString(36);
  if (!clean.name) clean.name = 'Untitled profile';
  map[clean.id] = clean;
  persist(map);
  return clean;
}

export function updateProfile(id, data) {
  const map = load();
  if (!map[id]) return null;
  map[id] = { ...map[id], ...sanitize(data), id };
  persist(map);
  return map[id];
}

export function deleteProfile(id) {
  const map = load();
  if (!map[id]) return false;
  delete map[id];
  persist(map);
  return true;
}

// Produce an export object with NO secrets (already enforced by sanitize).
export function exportProfile(id) {
  const p = getProfile(id);
  if (!p) return null;
  return { kind: 'nexference-profile', version: 1, profile: sanitize(p) };
}
