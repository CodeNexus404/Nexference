import { Storage } from '../core/storage.js';

// Client-side Model Intelligence access layer (v0.8.0). Thin wrappers over the
// unified /api/models endpoints, plus a secret-free "recent models" store kept
// in localStorage (references only — never keys).
const RECENT_KEY = 'nx_recent_models';
const RECENT_MAX = 8;

export const modelService = {
  // Unified catalogue. opts: { type, provider, q, free, capabilities, recommended, clientId, providerId }
  async getUnified(opts = {}) {
    const qs = new URLSearchParams();
    if (opts.type) qs.set('type', opts.type);
    if (opts.provider) qs.set('provider', opts.provider);
    if (opts.q) qs.set('q', opts.q);
    if (opts.free) qs.set('free', '1');
    if (opts.capabilities) qs.set('capabilities', Array.isArray(opts.capabilities) ? opts.capabilities.join(',') : opts.capabilities);
    if (opts.recommended) qs.set('recommended', '1');
    if (opts.clientId) qs.set('clientId', opts.clientId);
    if (opts.providerId) qs.set('ctxProvider', opts.providerId);
    const res = await fetch('/api/models?' + qs.toString());
    const d = await res.json();
    return d.models || [];
  },

  async getDetail(provider, id) {
    const res = await fetch(`/api/models/detail?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return res.json();
  },

  async getRecommended(ctx = {}) {
    const qs = new URLSearchParams(ctx);
    const res = await fetch('/api/models/recommended?' + qs.toString());
    const d = await res.json();
    return d.models || [];
  },

  async getStats() {
    const res = await fetch('/api/models/stats');
    return res.json();
  },

  async refresh(providerId) {
    const res = await fetch('/api/models/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(providerId ? { providerId } : {}),
    });
    return res.json();
  },

  // Last recorded provider connection test (server persists only non-secret
  // outcome metadata — status + timestamp). Used to show test history.
  async getProviderTest(id) {
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(id)}/test`);
      const d = await res.json();
      return d.lastTest || null;
    } catch { return null; }
  },

  // ── Recent models (secret-free, last N references) ──
  getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
    catch { return []; }
  },
  addRecent(model) {
    const entry = {
      providerId: model.providerId,
      id: model.id,
      name: model.name || model.id,
      providerName: model.providerName || '',
      addedAt: Date.now(),
    };
    const cur = this.getRecent().filter((m) => !(m.providerId === entry.providerId && m.id === entry.id));
    cur.unshift(entry);
    const trimmed = cur.slice(0, RECENT_MAX);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
    return trimmed;
  },
  clearRecent() {
    try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
  },
};
