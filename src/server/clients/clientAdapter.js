import { readSettings, writeSettings, SETTINGS_PATH } from '../config/settingsStore.js';
import { restoreBackup, listBackups } from '../config/backupStore.js';
import { getClient, getClientCapabilities, detectClient } from './registry.js';
import { checkCompatibility } from './compatibilityService.js';
import { spawn } from 'node:child_process';

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
      const p = spawn('claude', [], { stdio: 'ignore', detached: true });
      p.on('error', () => {});
      p.unref();
      return { launched: true, supported: true, note: 'Launched claude' };
    } catch (err) {
      return { launched: false, supported: true, note: `Launch failed: ${err.message}` };
    }
  }
}

const MAP = {
  'claude-code': ClaudeCodeAdapter,
};

export function getClientAdapter(id) {
  const client = getClient(id);
  if (!client) return null;
  const Cls = MAP[id] || ClientAdapter;
  return new Cls(client);
}
