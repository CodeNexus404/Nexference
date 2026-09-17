import { readSettings, writeSettings, SETTINGS_PATH } from '../config/settingsStore.js';
import { restoreBackup, listBackups } from '../config/backupStore.js';
import { getClient, getClientCapabilities, detectClient } from './registry.js';
import { checkCompatibility } from './compatibilityService.js';
import { spawn } from 'node:child_process';
import {
  readOpenCodeConfig, readOpenCodeConfigRaw, writeOpenCodeConfig,
  getOpenCodeStatus, listOpenCodeBackups, restoreOpenCodeBackup,
} from '../config/opencodeStore.js';
import {
  readCodexConfig, writeCodexConfig, getCodexStatus,
  listCodexBackups, restoreCodexBackup,
} from '../config/codexStore.js';

// npm-installed CLIs ship as `.cmd` shims on Windows; Node's spawn() (shell:false)
// cannot execute .bat/.cmd directly, so those launches silently failed there.
// POSIX keeps shell:false (no shell interpretation), so Mac behaviour is unchanged.
const launchOpts = () => ({ stdio: 'ignore', detached: true, shell: process.platform === 'win32' });

// ═══════════════════════════════════════════════════════════════
//  Server-side Client Adapter interface (v0.6.0).
//
//  IMPORTANT — generation stays on the CLIENT (protected): the Claude Code
//  config format is produced by the frontend engine (the proven buildClaudeSettings).
//  The server adapter therefore orchestrates the server-relevant lifecycle
//  (detect / read / validate / apply / backup / restore / launch / compatibility)
//  WITHOUT re-implementing the protected generator. `buildConfig` is intentionally
//  not provided server-side for Claude Code — the frontend engine owns that output.
// ═══════════════════════════════════════════════════════════════

export class ClientAdapter {
  constructor(client) {
    this.client = client;
    this.id = client.id;
    this.name = client.name;
  }

  getCapabilities() { return this.client.capabilities || {}; }

  async detect() { return detectClient(this.id); }

  // Generation is owned by the client engine; adapters that can't generate
  // here return null and rely on the frontend wizard. Honest, not faked.
  buildConfig() { return null; }

  supportsProvider(providerId) {
    const res = checkCompatibility({ clientId: this.id, providerId });
    return res.compatible && res.mode === 'cloud';
  }

  supportsRuntime(runtimeId) {
    const res = checkCompatibility({ clientId: this.id, runtimeId });
    return res.compatible && res.mode === 'local';
  }

  readConfig() {
    return readSettings();
  }

  validateConfig(config) {
    if (!config || typeof config !== 'object') return { valid: false, error: 'Config must be an object' };
    if (config.env && typeof config.env !== 'object') return { valid: false, error: 'env must be an object' };
    return { valid: true };
  }

  // Safe apply: backup + atomic write + verify (delegates to settingsStore).
  applyConfig(config) {
    return writeSettings(config);
  }

  backup() {
    const list = listBackups();
    return list[0] || null;
  }

  restore(backupId) {
    return restoreBackup(backupId);
  }

  // Launch is best-effort; unsupported clients return a clear "not supported".
  launch() {
    return { launched: false, supported: false, note: 'Launch not implemented for this client' };
  }

  getConfigLocation() { return this.client.configPath; }
}

export class ClaudeCodeAdapter extends ClientAdapter {
  constructor(client) { super(client); }

  // Claude Code uses the server-owned settings store directly.
  readConfig() { return readSettings(); }

  applyConfig(config) {
    // The protected generation happens client-side; here we only persist safely.
    return writeSettings(config);
  }

  launch() {
    try {
      const p = spawn('claude', [], launchOpts());
      p.on('error', () => {});
      p.unref();
      return { launched: true, supported: true, note: 'Launched claude' };
    } catch (err) {
      return { launched: false, supported: true, note: `Launch failed: ${err.message}` };
    }
  }
}

// ═══ OpenCode adapter ════════════════════════════════════════════════════════
// opencode reads ~/.config/opencode/opencode.json at startup (no hot-reload).
// The config format is schema-validated ($schema declaration + provider map);
// API keys are referenced as {env:VAR} — Nexference never touches the actual
// secret, so the safety pipeline (Backup → Atomic → Verified Re-read → Restore)
// operates on the config shape only.
export class OpenCodeAdapter extends ClientAdapter {
  constructor(client) { super(client); }

  readConfig() { return readOpenCodeConfig(); }

  applyConfig(config) { return writeOpenCodeConfig(config); }

  validateConfig(config) {
    if (!config || typeof config !== 'object') return { valid: false, error: 'Config must be an object' };
    if (typeof config.model !== 'string' || !config.model) return { valid: false, error: 'opencode config requires a model' };
    if (!config.provider || typeof config.provider !== 'object' || !Object.keys(config.provider).length) {
      return { valid: false, error: 'opencode config requires at least one provider entry' };
    }
    const unprefixed = Object.entries(config.provider).some(([k, v]) => k !== 'model' && k !== '$schema');
    if (!unprefixed) return { valid: false, error: 'opencode config provider entries are malformed' };
    for (const [k, v] of Object.entries(config.provider)) {
      if (!v || typeof v !== 'object') return { valid: false, error: `opencode provider '${k}' must be an object` };
      if (typeof v.options?.baseURL !== 'string' || !v.options.baseURL) {
        return { valid: false, error: `opencode provider '${k}' requires options.baseURL` };
      }
    }
    return { valid: true };
  }

  status() { return getOpenCodeStatus(); }

  backup() { const list = listOpenCodeBackups(); return list[0] || null; }

  restore(backupId) { return restoreOpenCodeBackup(backupId); }

  getConfigLocation() { return this.client.configPath; }

  // OpenCode uses `claude` CLI to launch? Actually opencode binary is `opencode`.
  launch() {
    try {
      const p = spawn('opencode', [], launchOpts());
      p.on('error', () => {});
      p.unref();
      return { launched: true, supported: true, note: 'Launched opencode' };
    } catch (err) {
      return { launched: false, supported: true, note: `Launch failed: ${err.message}` };
    }
  }
}

// ═══ Codex adapter ═══════════════════════════════════════════════════════════
// Codex reads ~/.codex/config.json at startup.  The config maps a model +
// provider with an env_key reference (no secret in file).  Nexference applies
// the same safety pipeline (Backup → Atomic → Verified Re-read → Restore).
export class CodexAdapter extends ClientAdapter {
  constructor(client) { super(client); }

  readConfig() { return readCodexConfig(); }
  applyConfig(config) { return writeCodexConfig(config); }
  status() { return getCodexStatus(); }

  validateConfig(config) {
    if (!config || typeof config !== 'object') return { valid: false, error: 'Config must be an object' };
    if (typeof config.model !== 'string' || !config.model) return { valid: false, error: 'Codex config requires a model' };
    if (!config.model_provider || typeof config.model_provider !== 'string') return { valid: false, error: 'Codex config requires model_provider' };
    if (!config.model_providers || typeof config.model_providers !== 'object' || !Object.keys(config.model_providers).length) {
      return { valid: false, error: 'Codex config requires at least one model_providers entry' };
    }
    for (const [k, v] of Object.entries(config.model_providers)) {
      if (!v || typeof v !== 'object') return { valid: false, error: `Codex provider '${k}' must be an object` };
      if (typeof v.base_url !== 'string' || !v.base_url) return { valid: false, error: `Codex provider '${k}' requires base_url` };
    }
    return { valid: true };
  }

  backup() { const list = listCodexBackups(); return list[0] || null; }
  restore(backupId) { return restoreCodexBackup(backupId); }
  getConfigLocation() { return this.client.configPath; }

  launch() {
    try {
      const p = spawn('codex', [], launchOpts());
      p.on('error', () => {});
      p.unref();
      return { launched: true, supported: true, note: 'Launched codex' };
    } catch (err) {
      return { launched: false, supported: true, note: `Launch failed: ${err.message}` };
    }
  }
}

const MAP = {
  'claude-code': ClaudeCodeAdapter,
  'opencode-cli': OpenCodeAdapter,
  'codex': CodexAdapter,
};

export function getClientAdapter(id) {
  const client = getClient(id);
  if (!client) return null;
  const Cls = MAP[id] || ClientAdapter;
  return new Cls(client);
}
