// ═══════════════════════════════════════════════════════════════
//  Codex CLI Config Store (v2.2.1) — server-side storage for
//  ~/.codex/config.json.
//
//  Mirrors the opencodeStore / settingsStore safety pipeline
//  (backup → atomic write → verified re-read → abort on mismatch).
//  The Codex config references API keys via env_key (the env var
//  name only) — Nexference never stores or touches the secret.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

export const CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.json');
export const CODEX_BACKUP_DIR = join(homedir(), '.nexference', 'backups', 'codex');

function ts() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backupFilename() {
  let name = `codex-config-${ts()}.json`;
  let full = join(CODEX_BACKUP_DIR, name);
  let i = 1;
  while (existsSync(full)) {
    name = `codex-config-${ts()}-${i}.json`;
    full = join(CODEX_BACKUP_DIR, name);
    i++;
  }
  return full;
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function backupExisting() {
  if (!existsSync(CODEX_CONFIG_PATH)) return null;
  ensureDir(CODEX_BACKUP_DIR);
  const dest = backupFilename();
  try {
    writeFileSync(dest, readFileSync(CODEX_CONFIG_PATH, 'utf-8'), 'utf-8');
    return dest;
  } catch (err) {
    throw new Error(`backup failed (${err.message}) — refusing to overwrite the live config`);
  }
}

export function readCodexConfig() {
  if (!existsSync(CODEX_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CODEX_CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function normalize(config) {
  return { ...(config || {}) };
}

// Atomic, verified write.  Returns { merged, backupPath }.
export function writeCodexConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Missing config');
  ensureDir(dirname(CODEX_CONFIG_PATH));
  const merged = normalize(config);
  let backupPath = null;
  if (existsSync(CODEX_CONFIG_PATH)) backupPath = backupExisting();
  const tmp = `${CODEX_CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  renameSync(tmp, CODEX_CONFIG_PATH);
  // Verified re-read.
  const reread = readCodexConfig();
  if (!reread) throw new Error('verification failed: written file is not valid JSON');
  const ok = reread.model === merged.model
    && reread.model_provider === merged.model_provider
    && JSON.stringify(reread.model_providers || {}) === JSON.stringify(merged.model_providers || {});
  if (!ok) throw new Error('verification failed: written config does not match the generated config');
  return { merged, backupPath };
}

export function getCodexStatus() {
  const exists = existsSync(CODEX_CONFIG_PATH);
  if (!exists) return { exists: false, valid: false, lastModified: null, model: null, model_provider: null };
  let valid = false, lastModified = null, parsed = null;
  try { parsed = JSON.parse(readFileSync(CODEX_CONFIG_PATH, 'utf-8')); valid = true; } catch { valid = false; }
  try { lastModified = statSync(CODEX_CONFIG_PATH).mtime.toISOString(); } catch { /* ignore */ }
  return { exists: true, valid, lastModified, model: parsed?.model || null, model_provider: parsed?.model_provider || null };
}

export function listCodexBackups() {
  if (!existsSync(CODEX_BACKUP_DIR)) return [];
  try {
    return readdirSync(CODEX_BACKUP_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ id: f, path: join(CODEX_BACKUP_DIR, f), name: f }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch { return []; }
}

export function restoreCodexBackup(backupId) {
  if (!backupId || typeof backupId !== 'string') throw new Error('Missing backup ID');
  const backupPath = join(CODEX_BACKUP_DIR, backupId);
  if (!existsSync(backupPath)) throw new Error('Backup not found');
  const parsed = JSON.parse(readFileSync(backupPath, 'utf-8'));
  ensureDir(dirname(CODEX_CONFIG_PATH));
  const tmp = `${CODEX_CONFIG_PATH}.tmp-restore-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  renameSync(tmp, CODEX_CONFIG_PATH);
  return { restored: true, config: parsed };
}
