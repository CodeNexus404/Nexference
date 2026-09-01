// Custom Provider API client (v2.1.0) — thin wrappers over the
// /api/custom-providers endpoints. No secrets are ever sent or stored.
import { notify } from '../core/notifications.js';

const BASE = '/api/custom-providers';

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('request_failed');
  return r.json();
}

export async function listCustomProviders({ lifecycle } = {}) {
  const q = lifecycle ? `?lifecycle=${lifecycle}` : '';
  return jget(BASE + q);
}

export async function getCustomProvider(id) {
  try { return jget(`${BASE}/${encodeURIComponent(id)}`); } catch { return null; }
}

export async function createCustomProvider(data) {
  const r = await fetch(BASE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { notify.toast(d.error || 'Creation failed', 'error'); return null; }
  return d;
}

export async function updateCustomProvider(id, data) {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { notify.toast(d.error || 'Update failed', 'error'); return null; }
  return d;
}

export async function duplicateCustomProvider(id) {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { notify.toast(d.error || 'Duplicate failed', 'error'); return null; }
  return d;
}

export async function deactivateCustomProvider(id) {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}/deactivate`, { method: 'POST' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { notify.toast(d.error || 'Deactivate failed', 'error'); return null; }
  return d;
}

export async function reactivateCustomProvider(id) {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}/reactivate`, { method: 'POST' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { notify.toast(d.error || 'Reactivate failed', 'error'); return null; }
  return d;
}

export async function deleteCustomProvider(id) {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { notify.toast(d.error || 'Delete failed', 'error'); return null; }
  return d;
}

export async function testCustomProvider(id, { key, model }) {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, model }),
  });
  return r.json().catch(() => ({ supported: false, reason: 'Test failed.' }));
}

export async function validateCustomProvider(data) {
  const r = await fetch(`${BASE}/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return r.json().catch(() => ({ valid: false, errors: ['Validation request failed.'] }));
}

export async function fetchCustomProviderModels(id, key = '') {
  try {
    // Key is transient — sent for this request only, never stored server-side.
    const qs = key ? `?key=${encodeURIComponent(key)}` : '';
    const r = await fetch(`${BASE}/${encodeURIComponent(id)}/fetch-models${qs}`);
    return r.json().catch(() => ({ ok: false, models: [] }));
  } catch { return { ok: false, models: [] }; }
}

export async function getStoredModels(id) {
  try {
    const r = await fetch(`${BASE}/${encodeURIComponent(id)}/stored-models`);
    return r.json().catch(() => ({ ok: false, models: [] }));
  } catch { return { ok: false, models: [] }; }
}

export async function scrapeFavicon(url) {
  try {
    const r = await fetch(`${BASE}/favicon?url=${encodeURIComponent(url)}`);
    return r.json().catch(() => ({ ok: false, url: null }));
  } catch { return { ok: false, url: null }; }
}

export async function uploadLogo(dataUrl) {
  try {
    const r = await fetch(`${BASE}/logo-upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    return r.json().catch(() => ({ ok: false }));
  } catch { return { ok: false }; }
}

export async function scrapeModelsFromWebsite(url) {
  try {
    const r = await fetch(`${BASE}/scrape-models?url=${encodeURIComponent(url)}`);
    return r.json().catch(() => ({ ok: false, models: [] }));
  } catch { return { ok: false, models: [] }; }
}
