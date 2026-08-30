// Provider Integration API client (v2.0.0) — thin wrappers over the
// /api/provider-integrations and /api/executions/* endpoints. No secrets:
// test/model endpoints send credentials transiently and the server never
// persists them.
import { notify } from '../core/notifications.js';

const BASE = '/api/provider-integrations';
const EXEC_BASE = '/api/executions';

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('request_failed');
  return r.json();
}

export async function getIntegrations() {
  const d = await jget(BASE);
  return d.integrations || [];
}

export async function getIntegration(id) {
  try { const d = await jget(`${BASE}/${encodeURIComponent(id)}`); return d.integration; }
  catch { return null; }
}

export async function getCoverage() {
  return jget(`${BASE}/coverage`);
}

export async function getCapabilities(id) {
  return jget(`${BASE}/${encodeURIComponent(id)}/capabilities`);
}

export async function assess(id, evidence) {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}/assess`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId: id, evidence: evidence || [] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { notify.toast(d.error || d.message || 'Assessment failed', 'error'); return null; }
  return d.integration || d;
}

export async function testConnection(id, { key, baseUrl, model }) {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, baseUrl, model }),
  });
  return r.json().catch(() => ({ supported: false, reason: 'test failed' }));
}

export async function listModels(id, { key, baseUrl, model }) {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}/models`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, baseUrl, model }),
  });
  return r.json().catch(() => ({ supported: false, reason: 'model listing failed' }));
}

// ── Execution Gateway APIs (v2.0.0) ──

export async function getGatewayCapabilities() {
  return jget(`${EXEC_BASE}/gateway-capabilities`);
}

export async function getExecutionCoverage() {
  return jget(`${EXEC_BASE}/coverage`);
}

export async function getExecutionStatus(providerId) {
  return jget(`${EXEC_BASE}/status/${encodeURIComponent(providerId)}`);
}

export async function getExecutionDiagnostics(executionId) {
  return jget(`${EXEC_BASE}/${encodeURIComponent(executionId)}/diagnostics`);
}
