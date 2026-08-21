// Client Adapter base — the conceptual interface every AI client adapter
// implements. Subclasses only override the capabilities they actually support;
// everything else defaults to an honest "not implemented / manual" response so
// Nexference never pretends to configure what it cannot.
export class ClientAdapter {
  constructor(meta) {
    this.meta = meta || {};
    this.id = this.meta.id;
    this.name = this.meta.name;
  }

  get capabilities() { return this.meta.capabilities || {}; }

  // Best-effort detection. Browser apps cannot inspect the filesystem, so this
  // reports what Nexference can know (the declared client) and leaves real
  // detection to explicit user state. Never fakes "installed".
  async detect() {
    return { id: this.id, name: this.name, detected: false, status: 'unknown' };
  }

  getConfigLocation() { return this.meta.configPath || null; }

  getSupportedProviders() { return []; }
  getSupportedRuntimes() { return []; }

  checkCompatibility() { return { compatible: false, level: 'unsupported' }; }

  // Returns { config, instructions }. `config` is null for manual clients.
  generateConfig() {
    return { config: null, instructions: [`Manual configuration required for ${this.name}.`] };
  }

  validateConfig() { return { valid: false, errors: ['No validator implemented'] }; }

  async backupConfig() { return { ok: false, reason: 'not implemented' }; }
  async applyConfig() { return { ok: false, reason: 'not implemented' }; }
  async launch() { return { ok: false, reason: 'not implemented' }; }
  openFolder() { return this.meta.configPath || null; }
}
