// ═══════════════════════════════════════════════════════════════
//  OpenCode Config Store (v2.2.1) — server-side storage for
//  ~/.config/opencode/opencode.json.
//
//  Mirrors the settingsStore safety pipeline (backup → atomic write →
//  verified re-read → abort on mismatch) so the "Preview → Diff →
//  Backup → Atomic Write → Verified Re-read → Restore" guarantee
//  is preserved across every client Nexference can configure.
//
//  OpenCode does NOT hot-reload config; the user must restart the
//  CLI after a write.  Nexference stores only metadata + env-var
//  references — NEVER the actual API key.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

export const OPENCODE_CONFIG_PATH = join(homedir(), '.config', 'opencode', 'opencode.json');
export const OPENCODE_BACKUP_DIR = join(homedir(), '.nexference', 'backups', 'opencode');

function ts() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backupFilename() {
  let name = `opencode-config-${ts()}.json`;
  let full = join(OPENCODE_BACKUP_DIR, name);
  let i = 1;
  while (existsSync(full)) {
    name = `opencode-config-${ts()}-${i}.json`;
    full = join(OPENCODE_BACKUP_DIR, name);
    i++;
  }
  return full;
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Back up the current config (if any) to the backup dir.
function backupExisting() {
  if (!existsSync(OPENCODE_CONFIG_PATH)) return null;
  ensureDir(OPENCODE_BACKUP_DIR);
  const dest = backupFilename();
  try {
    writeFileSync(dest, readFileSync(OPENCODE_CONFIG_PATH, 'utf-8'), 'utf-8');
    return dest;
  } catch (err) {
    throw new Error(`backup failed (${err.message}) — refusing to overwrite the live config`);
  }
}

export function readOpenCodeConfig() {
  if (!existsSync(OPENCODE_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(OPENCODE_CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function readOpenCodeConfigRaw() {
  if (!existsSync(OPENCODE_CONFIG_PATH)) return null;
  try {
    return readFileSync(OPENCODE_CONFIG_PATH, 'utf-8');
  } catch {
    return null;
  }
}

// Normalise the incoming config: preserve every key the user or engine placed
// but ensure the minimum required fields are present.
function normalize(config) {
  return {
    ...(config || {}),
    $schema: config?.$schema || 'https://opencode.ai/config.json',
  };
}

// Atomic, verified write.  Returns { merged, backupPath }.
export function writeOpenCodeConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Missing config');

  ensureDir(dirname(OPENCODE_CONFIG_PATH));

  const merged = normalize(config);

  // Back up BEFORE overwriting.  If backup fails, abort.
  let backupPath = null;
  if (existsSync(OPENCODE_CONFIG_PATH)) {
    backupPath = backupExisting();
  }

  // Atomic write: temp file + rename.
  const tmp = `${OPENCODE_CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  renameSync(tmp, OPENCODE_CONFIG_PATH);

  // Verified re-read: structural comparison.
  const reread = readOpenCodeConfig();
  if (!reread) throw new Error('verification failed: written file is not valid JSON');
  const ok = reread.$schema === merged.$schema
    && reread.model === merged.model
    && JSON.stringify(reread.provider || {}) === JSON.stringify(merged.provider || {});
  if (!ok) throw new Error('verification failed: written config does not match the generated config');

  return { merged, backupPath };
}

// Status of the on-disk config (no secrets).
export function getOpenCodeStatus() {
  const exists = existsSync(OPENCODE_CONFIG_PATH);
  if (!exists) return { exists: false, valid: false, lastModified: null, model: null, provider: null };
  let raw = '';
  let valid = false;
  let lastModified = null;
  let parsed = null;
  try {
    raw = readFileSync(OPENCODE_CONFIG_PATH, 'utf-8');
    parsed = JSON.parse(raw);
    valid = true;
  } catch { valid = false; }
  try { lastModified = statSync(OPENCODE_CONFIG_PATH).mtime.toISOString(); } catch { /* ignore */ }
  const providerName = parsed?.provider ? Object.keys(parsed.provider)[0] : null;
  return { exists: true, valid, lastModified, model: parsed?.model || null, provider: providerName };
}

// List backups (newest first).
export function listOpenCodeBackups() {
  if (!existsSync(OPENCODE_BACKUP_DIR)) return [];
  try {
    return readdirSync(OPENCODE_BACKUP_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ id: f, path: join(OPENCODE_BACKUP_DIR, f), name: f }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch { return []; }
}

export function restoreOpenCodeBackup(backupId) {
  if (!backupId || typeof backupId !== 'string') throw new Error('Missing backup ID');
  const backupPath = join(OPENCODE_BACKUP_DIR, backupId);
  if (!existsSync(backupPath)) throw new Error('Backup not found');
  const raw = readFileSync(backupPath, 'utf-8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Backup is not valid JSON'); }
  // Atomic write the restored content.
  ensureDir(dirname(OPENCODE_CONFIG_PATH));
  const tmp = `${OPENCODE_CONFIG_PATH}.tmp-restore-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  renameSync(tmp, OPENCODE_CONFIG_PATH);
  return { restored: true, config: parsed };
}
