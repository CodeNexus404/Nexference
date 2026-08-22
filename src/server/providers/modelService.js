import { norm } from '../utils/index.js';
import { PROVIDERS, STATIC_MODELS, PROVIDER_SITES, SCRAPE_PARSERS } from './registry.js';
import { modelCache, FETCH_TIMEOUT } from './modelCache.js';

// ═══════════════════════════════════════════════════════════════
//  Model fetch service — resolves a provider's model list through a
//  three-tier fallback: live API → scrape public site → curated static list.
//  Logic preserved exactly from the original server.js.
// ═══════════════════════════════════════════════════════════════

async function fetchModelsForProvider(provider, key = '') {
  const { baseUrl, format, id } = provider;
  const base = norm(baseUrl);
  let endpoint;
  const headers = {};
  let models = [];
  let apiFailed = false;
  let data;

  try {
    if (format === 'gemini') {
      endpoint = `${base}models?key=${encodeURIComponent(key)}&pageSize=1000`;
    } else if (format === 'anthropic') {
      const modelsPath = base.endsWith('/v1/') ? 'models' : 'v1/models';
      endpoint = `${base}${modelsPath}`;
      // Send both auth styles: some Anthropic-format gateways (e.g. TokenRouter)
      // require `Authorization: Bearer`, while others expect `x-api-key`.
      if (key) {
        headers['x-api-key'] = key;
        headers['Authorization'] = `Bearer ${key}`;
      }
      headers['anthropic-version'] = '2023-06-01';
    } else {
      endpoint = `${base}models`;
      if (key) headers['Authorization'] = `Bearer ${key}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    headers['user-agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
    const r = await fetch(endpoint, { headers, signal: controller.signal });
    clearTimeout(timeout);
    const text = await r.text();

    if (!r.ok) {
      apiFailed = true;
    } else {
      try { data = JSON.parse(text); } catch { apiFailed = true; }
    }
  } catch (err) {
    apiFailed = true;
  }

  if (!apiFailed && data) {
    if (format === 'gemini') {
      models = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => ({
          id: (m.name || '').replace('models/', ''),
          name: m.displayName || m.name,
          pricing: null,
        }));
    } else {
      const list = data.data || data.models || data.results || data.model_list || (Array.isArray(data) ? data : []);
      models = list.map((m) => ({
        id: m.id,
        name: m.display_name || m.name || m.id,
        pricing: m.pricing || null,
      }));
    }
  }

  if (models.length) {
    modelCache[id] = { models, fetchedAt: Date.now(), total: models.length };
    return { ok: true, count: models.length, provider: id };
  }

  // API returned nothing (usually needs a key) — fall back to scraping the provider's public website
  const scraped = await scrapeModelsForProvider(provider);
  if (scraped) {
    let models = scraped.models;
    // Merge curated static entries so a thin/partial website scrape never drops
    // known-good models (e.g. paid flags, or providers whose site yields little).
    if (STATIC_MODELS[id]) {
      const have = new Set(models.map(m => m.id));
      for (const entry of STATIC_MODELS[id]) {
        const mid = typeof entry === 'string' ? entry : entry.id;
        if (!have.has(mid)) {
          const paid = typeof entry === 'string' ? false : !!entry.paid;
          models = models.concat({ id: mid, name: mid, pricing: paid ? { prompt: '1', completion: '1' } : null, paid });
          have.add(mid);
        }
      }
    }
    modelCache[id] = { models, fetchedAt: scraped.fetchedAt, total: models.length, source: 'website' };
    return { ok: true, count: models.length, provider: id, source: 'website' };
  }

  // Static curated fallback for providers without a fetchable model list.
  if (STATIC_MODELS[id]) {
    const models = STATIC_MODELS[id].map((entry) => {
      const mid = typeof entry === 'string' ? entry : entry.id;
      const paid = typeof entry === 'string' ? false : !!entry.paid;
      return { id: mid, name: mid, pricing: paid ? { prompt: '1', completion: '1' } : null, paid };
    });
    modelCache[id] = { models, fetchedAt: Date.now(), total: models.length, source: 'static' };
    return { ok: true, count: models.length, provider: id, source: 'static' };
  }

  modelCache[id] = { models: [], fetchedAt: Date.now(), total: 0 };
  return { ok: false, error: apiFailed ? 'api failed' : 'no models' };
}

// ═══════════════════════════════════════════════════════════════
//  Website-scraping fallback — visit the provider's site and pull
//  the model list when the API needs a key (or is unavailable).
// ═══════════════════════════════════════════════════════════════

async function scrapeModelsForProvider(provider) {
  const url = PROVIDER_SITES[provider.id];
  const parse = SCRAPE_PARSERS[provider.id];
  if (!url || !parse) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Nexference/1.0)' },
    });
    clearTimeout(timeout);
    if (!r.ok) return null;
    const html = await r.text();
    const ids = parse(html);
    if (!ids.length) return null;
    const models = ids.map((id) => ({ id, name: id }));
    return { models, fetchedAt: Date.now(), total: models.length, source: 'website' };
  } catch {
    return null;
  }
}

// ─── Fetch all providers (non-blocking) ───
async function fetchAllModels(source = 'startup') {
  // Anthropic is Claude Code's native provider and is intentionally excluded from
  // the configurable provider list (and the health count), so it is also skipped
  // here — keeping the fetched set and its denominator consistent with what the
  // UI actually shows.
  const fetchable = PROVIDERS.filter((p) => p.id !== 'anthropic');
  console.log(`\n  🔄 Fetching models from all providers (${source})…`);
  const results = await Promise.allSettled(
    fetchable.map(async (p) => {
      const result = await fetchModelsForProvider(p, '');
      if (result.ok) {
        if (result.source !== 'website') modelCache[p.id].source = source;
        console.log(`    ✅ ${p.id}: ${result.count} models${result.source === 'website' ? ' (website)' : ''}`);
      } else {
        console.log(`    ⏭️  ${p.id}: ${result.error?.slice(0, 60) || 'no key'}`);
      }
      return { id: p.id, ...result };
    })
  );

  const successCount = results.filter(r => r.value?.ok).length;
  console.log(`  📊 Fetched models from ${successCount}/${fetchable.length} providers\n`);
  return results.map(r => r.value);
}

export { fetchModelsForProvider, scrapeModelsForProvider, fetchAllModels };
