import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

// ═══════════════════════════════════════════════════════════════
//  Settings store — the server-side storage layer for ~/.claude/settings.json.
//
//  Preserves the exact prior behaviour: GET returns the parsed config (or null),
//  POST merges the provided env/apiKeyHelper/model into a minimal gateway shape
//  (preserving whatever ANTHROPIC_*/OPENAI_* env keys the config carries so both
//  round-trip intact), and open-folder shells out to the OS file manager.
//
//  v0.3.0 backup hardening: before overwriting an EXISTING settings.json, a
//  timestamped copy is written to ~/.nexference/backups/ (Nexference-owned,
//  isolated from Claude's config). Backups are never overwritten (the filename
//  carries a unique timestamp) and the original is never touched until the backup
//  succeeds. If an existing file is present and the backup fails, the write is
//  ABORTED with a clear error — unless there was no existing file to back up.
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

export function writeSettings(config) {
  const configDir = dirname(SETTINGS_PATH);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Back up the previous config BEFORE overwriting it. If an existing file is
  // present and the backup fails, abort (don't touch the live config).
  const hadExisting = existsSync(SETTINGS_PATH);
  if (hadExisting) {
    backupExisting(); // throws → propagates to the route → 500 with clear error
  }

  // Write the settings.json in the exact gateway format (env + apiKeyHelper + model).
  // Preserve whatever env keys the config carries (ANTHROPIC_* for Anthropic
  // providers, OPENAI_* for OpenAI providers) so both shapes round-trip intact.
  const merged = {
    env: { ...(config.env || {}) },
    apiKeyHelper: config.apiKeyHelper,
    model: config.model,
  };

  writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  return merged;
}

export function openFolder() {
  const dir = dirname(SETTINGS_PATH);
  let cmd, args;
  if (process.platform === 'darwin') { cmd = 'open'; args = [dir]; }
  else if (process.platform === 'win32') { cmd = 'explorer'; args = [dir]; }
  else { cmd = 'xdg-open'; args = [dir]; }

  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', (err) => ({ ok: false, error: err.message }));
    p.unref();
    return { ok: true, dir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
