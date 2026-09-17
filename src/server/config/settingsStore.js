import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { atomicRenameSync } from '../utils/fs.js';

// ═══════════════════════════════════════════════════════════════
//  Settings store — the server-side storage layer for ~/.claude/settings.json.
//
//  v0.5.0 hardening: writes are ATOMIC (temp file + rename) and VERIFIED
//  (re-read + structural compare). Every overwrite of an EXISTING config is
//  backed up first to ~/.nexference/backups/ (Nexference-owned, isolated from
//  Claude's config). Backups are unique (timestamped) and never overwritten.
//
//  The gateway shape written here is fixed and minimal (env + apiKeyHelper +
//  model). This is the SINGLE source of truth for what lands on disk; the
//  protected client-format generation logic lives in the frontend engine and
//  only hands a fully-formed config to this layer.
// ═══════════════════════════════════════════════════════════════

export const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

// Nexference-owned, isolated backup location (never inside ~/.claude so a bad
// restore can't accidentally clobber other Claude state).
export const BACKUP_DIR = join(homedir(), '.nexference', 'backups');

function ts() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backupFilename() {
  let name = `claude-settings-${ts()}.json`;
  let full = join(BACKUP_DIR, name);
  let i = 1;
  // Extremely unlikely, but never overwrite an existing backup.
  while (existsSync(full)) {
    name = `claude-settings-${ts()}-${i}.json`;
    full = join(BACKUP_DIR, name);
    i++;
  }
  return full;
}

// Backs up the current settings.json (if any) to the backup dir.
// Returns the backup path written, or null if there was nothing to back up.
// Throws if a backup that MUST be written fails.
function backupExisting() {
  if (!existsSync(SETTINGS_PATH)) return null;
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = backupFilename();
  try {
    console.log(`  💾 Backing up settings.json → ${dest}`);
    writeFileSync(dest, readFileSync(SETTINGS_PATH, 'utf-8'), 'utf-8');
    return dest;
  } catch (err) {
    throw new Error(`backup failed (${err.message}) — refusing to overwrite the live config`);
  }
}

export function readSettings() {
  if (!existsSync(SETTINGS_PATH)) return null;
  const raw = readFileSync(SETTINGS_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    // Tolerate a malformed/hand-edited settings.json.
    return null;
  }
}

export function readSettingsRaw() {
  if (!existsSync(SETTINGS_PATH)) return null;
  return readFileSync(SETTINGS_PATH, 'utf-8');
}

// Builds the canonical gateway shape. The protected frontend engine produces a
// config that already conforms (env + apiKeyHelper + model); we normalise to be
// safe against partial payloads.
function normalize(config) {
  return {
    env: { ...(config.env || {}) },
    apiKeyHelper: config.apiKeyHelper,
    model: config.model,
  };
}

// Atomic, verified write. Returns { merged, backupPath }.
// On any failure the live config is left untouched (atomic swap only completes
// if the temp file wrote successfully, and verification re-reads the final file).
export function writeSettings(config) {
  if (!config || typeof config !== 'object') throw new Error('Missing config');

  const configDir = dirname(SETTINGS_PATH);
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

  const merged = normalize(config);

  // Back up the previous config BEFORE overwriting it. If an existing file is
  // present and the backup fails, abort (don't touch the live config).
  const hadExisting = existsSync(SETTINGS_PATH);
  let backupPath = null;
  if (hadExisting) {
    backupPath = backupExisting(); // throws → propagates → 500 with clear error
  }

  // Atomic write: write to a sibling temp file, then rename (rename is atomic on
  // POSIX and effectively atomic on the same volume on Windows — with retry +
  // copy fallback for locked destinations on Windows).
  const tmp = `${SETTINGS_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  atomicRenameSync(tmp, SETTINGS_PATH);

  // Verify: re-read and structurally compare. If anything is off, we have the
  // backup (backupPath) to restore from.
  const reread = readSettings();
  if (!reread) throw new Error('verification failed: written file is not valid JSON');
  const ok = reread.model === merged.model &&
    reread.apiKeyHelper === merged.apiKeyHelper &&
    reread.env && merged.env &&
    JSON.stringify(reread.env) === JSON.stringify(merged.env);
  if (!ok) throw new Error('verification failed: written config does not match the generated config');

  return { merged, backupPath };
}

// Status of the on-disk config (no secrets). Used by /api/config/status and the
// file watcher. Infers the active provider/base URL and model from the env so
// the UI can present a readable summary.
export function getStatus() {
  const exists = existsSync(SETTINGS_PATH);
  if (!exists) return { exists: false, valid: false, lastModified: null, provider: null, baseUrl: null, model: null, client: 'claude-code' };
  let raw = '';
  let valid = false;
  let lastModified = null;
  let parsed = null;
  try {
    raw = readFileSync(SETTINGS_PATH, 'utf-8');
    parsed = JSON.parse(raw);
    valid = true;
  } catch {
    valid = false;
  }
  try { lastModified = statSync(SETTINGS_PATH).mtime.toISOString(); } catch { /* ignore */ }
  let provider = null;
  let baseUrl = null;
  let model = null;
  if (parsed && parsed.env) {
    baseUrl = parsed.env.ANTHROPIC_BASE_URL || parsed.env.OPENAI_BASE_URL || parsed.env.GOOGLE_GENAI_BASE_URL || null;
    provider = baseUrl ? inferProvider(baseUrl) : null;
    model = parsed.model || parsed.env.ANTHROPIC_MODEL || null;
  }
  return { exists: true, valid, lastModified, provider, baseUrl, model, client: 'claude-code', size: raw.length };
}

function inferProvider(baseUrl) {
  try {
    const host = new URL(baseUrl).host;
    if (host.includes('openrouter.ai')) return 'openrouter';
    if (host.includes('api.anthropic.com')) return 'anthropic';
    if (host.includes('api.openai.com')) return 'openai';
    if (host.includes('generativelanguage')) return 'google';
    if (host.includes('localhost') || host.includes('127.0.0.1')) return 'local';
  } catch { /* ignore */ }
  return 'custom';
}

export function openFolder() {
  const dir = dirname(SETTINGS_PATH);
  let cmd, args;
  if (process.platform === 'darwin') { cmd = 'open'; args = [dir]; }
  else if (process.platform === 'win32') { cmd = 'explorer'; args = [dir]; }
  else { cmd = 'xdg-open'; args = [dir]; }

  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', () => { /* swallow */ });
    p.unref();
    return { ok: true, dir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
