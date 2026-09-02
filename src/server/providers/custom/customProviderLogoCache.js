// ═══════════════════════════════════════════════════════════════
//  Custom Provider Logo Cache (v1.0.0)
//
//  Ensures every custom provider's card renders its logo instantly on
//  page load with no network round-trip: the logo is fetched once
//  server-side and persisted into the record as a base64 `data:` URL.
//  Records created through the wizard already carry the data URL; this
//  backfill migrates older records that only stored the remote URL.
//
//  The cache lives inside the provider record itself, so deleting the
//  provider (removeCustomProvider) automatically deletes the cache.
// ═══════════════════════════════════════════════════════════════

import { loadCustomProviders, upsertCustomProvider } from './customProviderStore.js';

const MAX_BYTES = 2 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function timeoutFetch(url, { headers = {}, ms = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { headers, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function resolveIconHref(html, origin) {
  // rel matches icon/shortcut icon/apple-touch-icon in any attribute order.
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (href) {
      let h = href[1];
      if (h.startsWith('//')) h = 'https:' + h;
      else if (h.startsWith('/')) h = origin + h;
      else if (!/^https?:/.test(h)) h = origin + '/' + h;
      return h;
    }
  }
  return origin + '/favicon.ico';
}

// Candidate origins: the record's URL first, then the bare domain when the
// URL is an API host (api.xkiro.com → xkiro.com) — API gateways often serve
// no site at all, so their favicon lives on the marketing domain.
function candidateOrigins(rec) {
  const url = rec.api?.baseUrl || rec.identity?.website;
  if (!url) return [];
  try {
    const u = new URL(url);
    const host = u.hostname;
    const origins = [u.origin];
    const parts = host.split('.');
    const first = (parts[0] || '').toLowerCase();
    if ((first === 'api' || first === 'www') && parts.length > 2) {
      const bare = parts.slice(1).join('.');
      try { origins.push(new URL(`${u.protocol}//${bare}`).origin); } catch { /* skip */ }
    }
    return [...new Set(origins)];
  } catch { return []; }
}

async function toDataUrl(href) {
  try {
    const resp = await timeoutFetch(href, { headers: { 'user-agent': UA } });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!/^image\//i.test(ct)) return null;
    const bytes = Buffer.from(await resp.arrayBuffer());
    if (bytes.length > MAX_BYTES) return null;
    const mime = (ct.split(';')[0] || 'image/png').trim().toLowerCase();
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch { return null; }
}

function websiteOrigin(rec) {
  const origins = candidateOrigins(rec);
  return origins[0] || null;
}

// Backfill persisted logo data URLs. Safe to re-run (idempotent): records
// that already carry a data: URL are skipped, as are logos uploaded by the
// user (source 'upload' — the data URL is already inline).
export async function backfillCustomProviderLogoCache() {
  try {
    const providers = loadCustomProviders();
    if (!providers?.length) return;
    let migrated = 0;
    for (const rec of providers) {
      try {
        const logo = rec.logo;
        // Already cached inline, uploaded, or deliberately absent → skip.
        if (!logo?.url || logo.url.startsWith('data:') || logo.source === 'upload') continue;
        // Try the stored logo URL itself first (it was already resolved), then
        // each candidate origin's site (API host, then bare domain).
        let dataUrl = await toDataUrl(logo.url);
        if (!dataUrl) {
          for (const origin of candidateOrigins(rec)) {
            try {
              const resp = await timeoutFetch(origin, { headers: { 'user-agent': UA } });
              if (!resp.ok) continue; // API gateways often 404 — try next origin
              dataUrl = await toDataUrl(resolveIconHref(await resp.text(), origin));
              if (dataUrl) break;
            } catch { /* next origin */ }
          }
        }
        if (!dataUrl) continue;
        rec.logo = { ...logo, url: dataUrl, status: 'resolved' };
        upsertCustomProvider(rec);
        migrated++;
      } catch { /* per-record best effort */ }
    }
    if (migrated) console.log(`  🖼  Cached logos for ${migrated} custom provider(s)`);
  } catch { /* best effort — never block startup */ }
}
