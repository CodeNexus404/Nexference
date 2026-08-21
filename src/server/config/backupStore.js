import { readFileSync, existsSync, unlinkSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { BACKUP_DIR, writeSettings } from './settingsStore.js';

// ═══════════════════════════════════════════════════════════════
//  Backup store — inspect, restore, and delete Nexference-owned backups in
//  ~/.nexference/backups/. Restoration is SAFE: the current config is backed up
//  before being overwritten, so a restore is itself reversible.
// ═══════════════════════════════════════════════════════════════

// Backup filenames are `claude-settings-<timestamp>.json`. The "id" is the part
// between the prefix and the .json. We never trust an id to traverse the dir.
function safeId(id) {
  if (typeof id !== 'string' || /[^a-zA-Z0-9._-]/.test(id)) return null;
  return id;
}

function pathFor(id) {
  return join(BACKUP_DIR, `claude-settings-${id}.json`);
}

export function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('claude-settings-') && f.endsWith('.json'))
    .map((f) => {
      const id = f.replace(/^claude-settings-/, '').replace(/\.json$/, '');
      let mtime = '';
      let size = 0;
      try {
        const s = statSync(join(BACKUP_DIR, f));
        mtime = s.mtime.toISOString();
        size = s.size;
      } catch { /* ignore */ }
      return { id, name: f, mtime, size };
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

export function readBackup(id) {
  const sid = safeId(id);
  if (!sid) return null;
  const p = pathFor(sid);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

// Restores a backup. Writes through the SAME atomic+verified path as apply, so
// the live config is backed up first (safety net) and verified after.
export function restoreBackup(id) {
  const cfg = readBackup(id);
  if (!cfg) throw new Error('backup not found');
  const result = writeSettings(cfg); // backs up the current config before overwriting
  return { success: true, restored: id, safetyBackup: result.backupPath, config: result.merged };
}

export function deleteBackup(id) {
  const sid = safeId(id);
  if (!sid) return false;
  const p = pathFor(sid);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}
