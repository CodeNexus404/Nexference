// Shared custom-provider logo resolver (v2.2.1) — used by the favicon scraping
// route AND by customProviderService when a provider is created/updated with only
// a website/base URL and no explicit logo. Mirrors the route's scrape behaviour:
// candidate origins first (API hosts often serve no site → try the bare domain),
// then <link rel=icon> in the HTML, then /favicon.ico. HTTPS only. Returns a
// base64 data URL so the card renders it inline with no proxy round-trip.

const MAX_FAVICON_BYTES = 2 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

function findIcon(html) {
  const m = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of m) {
    const rel = tag.match(/rel\s*=\s*["'][^"']*icon[^"']*["']/i);
    if (!rel) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (href) return href[1];
  }
  return null;
}

// Candidate origins for favicon scraping, in priority order. API hosts
// (api.example.com) often serve no HTML site and no favicon, so when the
// URL itself fails we also try the bare domain (api.xkiro.com → xkiro.com).
export function faviconOrigins(url) {
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
  } catch {
    return [];
  }
}

// Fetch favicon bytes and return a base64 data URL, or null on any failure
// (non-image content type, oversized, blocked, timeout).
export function faviconDataUrl(href) {
  return new Promise((resolve) => {
    (async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const resp = await fetch(href, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
        clearTimeout(timer);
        if (!resp.ok) return resolve(null);
        const ct = resp.headers.get('content-type') || '';
        if (!/^image\//i.test(ct)) return resolve(null);
        const bytes = Buffer.from(await resp.arrayBuffer());
        if (bytes.length > MAX_FAVICON_BYTES) return resolve(null);
        const mime = (ct.split(';')[0] || 'image/png').trim().toLowerCase();
        return resolve(`data:${mime};base64,${bytes.toString('base64')}`);
      } catch {
        resolve(null);
      }
    })();
  });
}

// Scrape a favicon for `url`. With `data: true` the icon is fetched and returned
// as a base64 data URL; otherwise the absolute icon href is returned. Returns
// { ok: false, url: null } when nothing can be resolved.
export async function scrapeFavicon(url, { data = false } = {}) {
  if (!url) return { ok: false, url: null };
  for (const origin of faviconOrigins(url)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(origin, { signal: ctrl.signal, headers: { 'user-agent': UA } });
      clearTimeout(timer);
      // API gateways often serve a 404 HTML error page with no favicon —
      // skip to the next candidate origin (e.g. the bare domain).
      if (!resp.ok) continue;
      const html = await resp.text();
      let href = findIcon(html) || origin + '/favicon.ico';
      if (href.startsWith('//')) href = 'https:' + href;
      else if (href.startsWith('/')) href = origin + href;
      else if (!href.startsWith('http')) href = origin + '/' + href;
      if (data) {
        const dataUrl = await faviconDataUrl(href);
        if (dataUrl) return { ok: true, url: dataUrl };
        // fall through to next origin only when data conversion failed
        continue;
      }
      return { ok: true, url: href };
    } catch { continue; }
  }
  return { ok: false, url: null };
}