// ═══════════════════════════════════════════════════════════════
//  Playground API client (v0.9.0)
//
//  Thin wrapper over the Execution API. API keys are read from
//  Storage only at call time and passed in-memory — never persisted
//  by this module, and never logged.
// ═══════════════════════════════════════════════════════════════

import { Storage } from '../core/storage.js';

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const playgroundService = {
  // Pre-flight honesty check. Returns the raw validation object.
  async validate(req) {
    const data = await post('/api/executions/validate', req);
    return data.validation;
  },

  // Start an execution. Returns { executable, executionId?, validation, status }.
  async create(req) {
    const body = { ...req };
    if (body.source === 'cloud' && body.providerId && !('key' in body)) {
      body.key = Storage.getKey(body.providerId) || '';
    }
    return post('/api/executions', body);
  },

  // Open an SSE stream for an execution id. Returns the EventSource so the
  // caller owns its lifecycle (close it on completion / cancel / unmount).
  stream(id, onEvent) {
    const es = new EventSource('/api/executions/' + encodeURIComponent(id) + '/stream');
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (onEvent) onEvent(ev);
      } catch { /* ignore malformed frame */ }
    };
    es.onerror = () => { /* server ended the stream; caller closes */ };
    return es;
  },

  async cancel(id) {
    return post('/api/executions/' + encodeURIComponent(id) + '/cancel', {});
  },

  async capabilities() {
    const res = await fetch('/api/executions/capabilities');
    if (!res.ok) throw new Error('capabilities failed');
    return res.json();
  },

  async list() {
    const res = await fetch('/api/executions');
    const data = await res.json();
    return data.executions || [];
  },

  async get(id) {
    const res = await fetch('/api/executions/' + encodeURIComponent(id));
    return res.json();
  },

  // Sequential comparison. Returns { executions: [{ ref, validation, executionId }] }.
  async compare(req) {
    return post('/api/executions/compare', req);
  },
};
