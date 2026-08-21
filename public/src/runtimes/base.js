// Runtime Adapter base — abstracts detection/status of a local runtime. Status
// is always fetched from the server's /api/local/runtimes (the browser cannot
// probe localhost directly), so this never fakes a running runtime.
export class RuntimeAdapter {
  constructor(meta) {
    this.meta = meta || {};
    this.id = this.meta.id;
    this.name = this.meta.name;
  }

  getProtocol() { return (this.meta.protocols || [])[0] || 'unknown'; }
  getProtocols() { return this.meta.protocols || []; }

  async fetchStatus() {
    try {
      const r = await fetch('/api/local/runtimes');
      if (!r.ok) return null;
      const list = await r.json();
      return Array.isArray(list) ? list.find((x) => x.id === this.id) || null : null;
    } catch {
      return null;
    }
  }

  async detect() { return this.fetchStatus(); }
  async getStatus() { return this.fetchStatus(); }

  async listModels() {
    const s = await this.fetchStatus();
    return (s && s.models) || [];
  }

  async testConnection() {
    const s = await this.fetchStatus();
    const running = !!(s && s.running);
    return { ok: running, running, detected: !!(s && s.detected) };
  }
}
