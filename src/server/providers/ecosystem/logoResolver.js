// Logo resolution & safe proxy (v1.7.0).
//
// SAFE logo handling only: we never hotlink arbitrary search results, never embed
// tracking URLs, never download executable content, and never treat a GitHub
// avatar as the official logo when identity is uncertain.
//
// Priority: explicit official/source-provided URL → website favicon → GitHub
// org/repo avatar (only when the project IS the discovered entity) → null
// (client falls back to a deterministic initials avatar).

import { LOGO_SOURCE } from './constants.js';

const PRIVATE_RE = /(^|\.)(localhost|internal|local|example|test)$|^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i;
const MAX_BYTES = 600 * 1024;
const FETCH_TIMEOUT_MS = 6000;

// Returns { ok, reason } — https only, no scheme tricks, no local/private hosts.
export function validateLogoUrl(url) {
  if (!url || typeof url !== 'string') return { ok: false, reason: 'empty' };
  let u;
  try { u = new URL(url); } catch { return { ok: false, reason: 'invalid-url' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'only-https-allowed' };
  if (/^(javascript|data|file|blob):/i.test(u.protocol)) return { ok: false, reason: 'unsafe-scheme' };
  if (PRIVATE_RE.test(u.hostname)) return { ok: false, reason: 'private-host' };
  return { ok: true };
}

// Synchronous resolution: returns { url, source } or null. Actual bytes are
// fetched lazily through the proxy endpoint so discovery stays cheap.
export function resolveLogo(entry) {
  if (!entry) return null;
  // 1. Explicit official/source-provided logo URL.
  if (entry.logo && validateLogoUrl(entry.logo).ok) {
    return { url: entry.logo, source: entry.logoSource === LOGO_SOURCE.OFFICIAL ? LOGO_SOURCE.OFFICIAL : LOGO_SOURCE.SOURCE_PROVIDED };
  }
  const domain = entry.website ? safeHost(entry.website) : null;
  // 2. Website favicon.
  if (domain) {
    const fav = `https://${domain}/favicon.ico`;
    if (validateLogoUrl(fav).ok) return { url: fav, source: LOGO_SOURCE.FAVICON };
  }
  // 3. GitHub avatar — only when the project itself is the discovered entity.
  const repo = entry.repository || entry.github;
  if (repo && /^https?:\/\/github\.com\/[\w.-]+\/?/.test(repo)) {
    const owner = repo.replace(/^https?:\/\/github\.com\//, '').split('/')[0];
    if (owner) {
      const av = `https://github.com/${owner}.png`;
      if (validateLogoUrl(av).ok) return { url: av, source: LOGO_SOURCE.GITHUB };
    }
  }
  return null;
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

// Proxy an already-validated logo URL to the browser, checking content-type and
// size. Never reflects errors or redirects to unsafe hosts.
export async function proxyLogo(rawUrl) {
  const v = validateLogoUrl(rawUrl);
  if (!v.ok) return { ok: false, status: 400, reason: v.reason };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(rawUrl, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(timer);
    // Validate the FINAL url after any redirects — never reflect a redirect to an
    // unsafe host back to the browser.
    if (resp.url && !validateLogoUrl(resp.url).ok) return { ok: false, status: 400, reason: 'unsafe-redirect' };
    if (!resp.ok) return { ok: false, status: 502, reason: `upstream-${resp.status}` };
    const ct = resp.headers.get('content-type') || '';
    if (!/^image\//i.test(ct)) return { ok: false, status: 415, reason: 'not-image' };
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_BYTES) return { ok: false, status: 413, reason: 'too-large' };
    return { ok: true, status: 200, contentType: ct, buffer: buf };
  } catch (e) {
    return { ok: false, status: 502, reason: 'fetch-failed' };
  }
}
