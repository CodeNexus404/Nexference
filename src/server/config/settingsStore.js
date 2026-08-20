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
// ═══════════════════════════════════════════════════════════════

export const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

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

  let existing = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      existing = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch {
      existing = {}; // tolerate a malformed/hand-edited settings.json
    }
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
