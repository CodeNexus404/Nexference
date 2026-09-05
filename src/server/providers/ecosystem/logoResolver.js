// Logo resolution & safe proxy (v1.7.0).
//
// SAFE logo handling only: we never hotlink arbitrary search results, never embed
// tracking URLs, never download executable content, and never treat a GitHub
// avatar as the official logo when identity is uncertain.
//
// Priority: explicit official/source-provided URL → website favicon → Google
// favicon service → GitHub org/repo avatar (only when the project IS the
// discovered entity) → null (client falls back to a deterministic initials
// avatar).

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

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function isGithubRepo(url) {
  return typeof url === 'string' && /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url);
}

function githubOwner(url) {
  if (!isGithubRepo(url)) return null;
  return url.replace(/^https?:\/\/github\.com\//, '').split('/')[0];
}

function pushFaviconCandidates(out, domain, source) {
  if (!domain) return;
  const fav = `https://${domain}/favicon.ico`;
  if (validateLogoUrl(fav).ok) out.push({ url: fav, source });
  // Google favicon service — reliable fallback for sites that only expose their
  // icon via <link rel="icon"> and 404 /favicon.ico.
  const google = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  if (validateLogoUrl(google).ok) out.push({ url: google, source });
}

// Returns all acceptable logo candidates in priority order: [{ url, source }].
// The caller picks the first that actually resolves as an image.
//
// For GitHub-hosted projects we deliberately prefer the project's own
// website/docs favicon (the real brand logo) over the maintainer's personal
// GitHub avatar, which would be a misleading "random" logo for a person-owned
// repo. The owner avatar is kept only as a last resort.
export function candidateLogoUrls(entry) {
  if (!entry) return [];
  const out = [];
  // 1. Explicit official/source-provided logo URL.
  if (entry.logo && validateLogoUrl(entry.logo).ok && !String(entry.logo).endsWith('/favicon.ico')) {
    out.push({ url: entry.logo, source: entry.logoSource === LOGO_SOURCE.OFFICIAL ? LOGO_SOURCE.OFFICIAL : LOGO_SOURCE.SOURCE_PROVIDED });
  }
  const repo = entry.repository || entry.github;
  const websiteIsRepo = isGithubRepo(entry.website);

  if (websiteIsRepo || (repo && isGithubRepo(repo))) {
    // 2. Brand favicon from the project's own site / docs (skipping github.com).
    const seen = new Set();
    const brandUrls = [entry.documentationUrl, websiteIsRepo ? null : entry.website, entry.homepage].filter(Boolean);
    for (const u of brandUrls) {
      if (isGithubRepo(u)) continue;
      const dom = safeHost(u);
      if (!dom || dom === 'github.com' || seen.has(dom)) continue;
      seen.add(dom);
      pushFaviconCandidates(out, dom, LOGO_SOURCE.FAVICON);
    }
    // 3. Maintainer/repo owner GitHub avatar — the GitHub-linked fallback.
    const owner = githubOwner(entry.website) || githubOwner(repo);
    if (owner) {
      const av = `https://github.com/${owner}.png`;
      if (validateLogoUrl(av).ok) out.push({ url: av, source: LOGO_SOURCE.GITHUB });
    }
    return out;
  }

  // Non-GitHub-hosted: website favicon first, GitHub avatar only as a final
  // fallback for a bare repo with no own website.
  pushFaviconCandidates(out, entry.website ? safeHost(entry.website) : null, LOGO_SOURCE.FAVICON);
  const owner = repo ? githubOwner(repo) : null;
  if (owner) {
    const av = `https://github.com/${owner}.png`;
    if (validateLogoUrl(av).ok) out.push({ url: av, source: LOGO_SOURCE.GITHUB });
  }
  return out;
}

// Synchronous resolution: picks the first statically-safe candidate (no network
// check). Actual bytes are fetched lazily through the proxy endpoint so
// discovery stays cheap. Prefer candidateLogoUrls() for live verification.
export function resolveLogo(entry) {
  return candidateLogoUrls(entry)[0] || null;
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