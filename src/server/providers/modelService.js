import { norm } from '../utils/index.js';
import { PROVIDERS, STATIC_MODELS, PROVIDER_SITES, SCRAPE_PARSERS } from './registry.js';
import { modelCache, FETCH_TIMEOUT } from './modelCache.js';
import { normalizePricing } from './modelClassifier.js';

// ═══════════════════════════════════════════════════════════════
//  Model fetch service — resolves a provider's model list through a
//  four-tier fallback: live API → public pricing API → scrape public
//  site → curated static list.
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
        pricing: normalizePricing(m.pricing),
        capabilities: m.capabilities || null,
        architecture: m.architecture || null,
        context_length: m.context_length || m.contextLength || null,
      }));
    }
    // Drop models the provider declares as non-chat (Groq lists whisper STT,
    // reranker and moderation models alongside chat ones; selecting those makes
    // Claude Code fail with a max_tokens/context_window 400). Applied after
    // mapping so it covers every id shape the endpoint returns.
    if (provider.excludeModels && models.length) {
      const before = models.length;
      models = models.filter((m) => m && m.id && !provider.excludeModels.test(m.id));
      if (models.length !== before) {
        // A provider that declares exclusions but returns ONLY excluded models
        // would otherwise silently look empty; fall through to the other
        // sources by clearing the list.
        if (!models.length) models = [];
      }
    }
  }

  if (models.length) {
    // Apply paid flags from static list even when API succeeds — providers like
    // Aerolink/FreeModel list Claude models without pricing, but the freemium
    // period has ended and they are now paid.
    if (STATIC_MODELS[id]) {
      const staticPaid = new Set();
      for (const entry of STATIC_MODELS[id]) {
        const mid = typeof entry === 'string' ? entry : entry.id;
        if (typeof entry !== 'string' && entry.paid) staticPaid.add(mid);
      }
      for (const m of models) {
        if (staticPaid.has(m.id) && !isFreeSuffixedModel(m.id)) {
          m.paid = true;
          if (!m.pricing) m.pricing = { prompt: '1', completion: '1' };
        }
      }
    }
    modelCache[id] = { models, fetchedAt: Date.now(), total: models.length };
    return { ok: true, count: models.length, provider: id };
  }

  // API required a key / returned nothing — fall back to the provider's official
  // public model-list endpoint (e.g. Cerebras /public/v1/models) which lists the
  // free/community models keylessly. This is a real, official source — never a
  // fallback to fabricated names.
  const pub = await fetchFromPublicListApi(provider);
  if (pub) {
    modelCache[id] = { models: pub.models, fetchedAt: pub.fetchedAt, total: pub.models.length, source: 'public-api' };
    return { ok: true, count: pub.models.length, provider: id, source: 'public-api' };
  }

  // API returned nothing (usually needs a key) — fall back to the provider's
  // public pricing/model endpoint (new-one-api gateways expose it keyless).
  const priced = await fetchFromPricingApi(provider);
  if (priced) {
    modelCache[id] = { models: priced.models, fetchedAt: priced.fetchedAt, total: priced.models.length, source: 'pricing' };
    return { ok: true, count: priced.models.length, provider: id, source: 'pricing' };
  }

  // API returned nothing (usually needs a key) — fall back to scraping the provider's public website
  const scraped = await scrapeModelsForProvider(provider);
  if (scraped) {
    const models = scraped.models;
    // Overlay paid flags from the static list onto scraped models with matching
    // IDs so the UI never mislabels a paid model as free. This only corrects
    // pricing on genuinely-fetched models — it never injects model NAMES, which
    // must always come from a real source (API/pricing/website).
    if (STATIC_MODELS[id]) {
      const staticPaid = new Set();
      for (const entry of STATIC_MODELS[id]) {
        const mid = typeof entry === 'string' ? entry : entry.id;
        if (typeof entry !== 'string' && entry.paid) staticPaid.add(mid);
      }
      for (const m of models) {
        if (staticPaid.has(m.id) && !isFreeSuffixedModel(m.id)) {
          m.paid = true;
          if (!m.pricing) m.pricing = { prompt: '1', completion: '1' };
        }
      }
    }
    modelCache[id] = { models, fetchedAt: scraped.fetchedAt, total: models.length, source: 'website' };
    return { ok: true, count: models.length, provider: id, source: 'website' };
  }

  // No live source produced models. Per the honesty rules we never present a
  // curated list AS IF it were live — the list must come from a real source (live
  // API, public pricing API, or website scrape). If all of those fail we report
  // zero models rather than fabricating names.
  //
  // There is deliberately no curated-list fallback here. A previous attempt
  // added a `staticFallback` opt-in, but it surfaced a hand-written list whose
  // ids did not match the gateway's real conventions — strictly worse than an
  // empty list, because the user cannot tell invented ids from real ones.
  // Providers with a key-gated catalogue must expose a genuine public source
  // (TokenRouter: /api/pricing) instead.
  modelCache[id] = { models: [], fetchedAt: Date.now(), total: 0 };
  return { ok: false, error: apiFailed ? 'api failed' : 'no models' };
}

// ═══════════════════════════════════════════════════════════════
//  Website-scraping fallback — visit the provider's site and pull
//  the model list when the API needs a key (or is unavailable).
// ═══════════════════════════════════════════════════════════════

// Explicitly-marked free ids (`:free` OpenRouter convention, `-free` suffix).
export function isFreeSuffixedModel(id) {
  return /(:free|-free)$/i.test(id || '');
}

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
    let ids = parse(html);
    // Same non-chat exclusion as the keyed /models path, so the keyless docs
    // scrape never offers speech/reranker/moderation models either.
    if (provider.excludeModels) ids = ids.filter((id) => !provider.excludeModels.test(id));
    if (!ids.length) return null;
    // When a provider's catalogue is paid by default (e.g. TokenRouter, where
    // only explicitly `-free`/`:free` models are a temporary free promo), mark
    // every scraped entry paid so the UI/intelligence never claim free without
    // a real signal.
    const models = ids.map((id) => {
      if (!provider.scrapeDefaultPaid || isFreeSuffixedModel(id)) return { id, name: id };
      return { id, name: id, pricing: { prompt: '1', completion: '1' }, paid: true };
    });
    return { models, fetchedAt: Date.now(), total: models.length, source: 'website' };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Public model-list API fallback — a provider's official, keyless
//  model endpoint (OpenAI-shaped { data: [{ id, name, pricing,
//  limits, capabilities }] }). Used when the primary API needs a
//  key so the free/community models are still listed honestly.
// ═══════════════════════════════════════════════════════════════

async function fetchFromPublicListApi(provider) {
  const url = provider.publicListApi;
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Nexference/1.0)' },
    });
    clearTimeout(timeout);
    if (!r.ok) return null;
    const data = await r.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    const models = list
      .filter((m) => m && m.id)
      .map((m) => {
        // Flatten any pricing shape (flat object or Requesty-style array of
        // volume tiers) so the paid flag and pricing row stay honest.
        const p = normalizePricing(m.pricing) || {};
        const price = (v) => (v == null ? null : Number(v));
        const prompt = price(p.prompt ?? p.input ?? p.input_price);
        const completion = price(p.completion ?? p.output ?? p.output_price);
        return {
          id: m.id,
          name: m.name || m.id,
          // These models come from an authenticated/paid catalogue, so a price
          // (or any listed model) counts as paid unless it is explicitly $0 or
          // carries a free-tier `:free`/`-free` id marker.
          paid: !isFreeSuffixedModel(m.id) && (prompt !== 0 || completion !== 0 || (m.pricing != null)),
          pricing: prompt != null || completion != null ? { prompt, completion } : null,
          context_length: (m.limits && m.limits.max_context_length) || m.context_length || null,
          capabilities: m.capabilities || null,
          owned_by: m.owned_by || null,
        };
      })
      .filter((m) => m.id);
    if (!models.length) return null;
    return { models, fetchedAt: Date.now(), total: models.length, source: 'public-api' };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Public pricing-API fallback — new-one-api style gateways (Agent
//  Router, Orca Router, …) expose a keyless /api/pricing endpoint
//  that lists every served model with ratios and supported endpoint
//  types. This is the live source of truth for their model lists.
// ═══════════════════════════════════════════════════════════════

async function fetchFromPricingApi(provider) {
  const url = provider.pricingApi;
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Nexference/1.0)' },
    });
    clearTimeout(timeout);
    if (!r.ok) return null;
    const data = await r.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    // Free/paid classification: only an EXPLICIT signal marks a model free — the
    // gateway's own is_free flag or the `:free`/`-free` id convention. A money
    // price (model_money/model_price > 0) always wins and marks it paid, even at
    // ratio 0. An ambiguous zero rate with no free marker resolves to PAID,
    // because claiming free without a real signal is the one mistake the UI
    // cannot recover from (see the per-field notes below).
    const markerFree = /(^|[:._\-\s/])free(?=$|[:._\-\s/])/i;
    const models = list
      .filter((m) => m && (m.alias || m.model_name || m.id))
      .map((m) => {
        const id = m.alias || m.model_name || m.id;
        const ratio = Number(m.model_ratio ?? NaN);
        const compRatio = Number(m.completion_ratio ?? NaN);
        const money = Number(m.model_money ?? m.model_price ?? NaN);
        const flaggedFree = m.is_free === true || m.is_free === 1 || m.free === true || m.free === 1 || m.isFree === true;
        // Free requires an EXPLICIT signal — the gateway's own is_free flag or the
        // `:free`/`-free` id convention.
        //
        // A bare model_ratio of 0 is NOT a free signal. On TokenRouter, for
        // instance, `stealth/union-alpha` and `stealth/ox-alpha` publish the same
        // ratio 0 / price 0 / quota_type 0 row as the genuinely free
        // `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, but only the
        // latter is actually free — the others are zero-weighted placeholders
        // that still bill. Treating ratio 0 as free invented two free models, so
        // an ambiguous zero rate now resolves to PAID and we never claim free
        // without a real signal. Verified safe for the other pricingApi
        // providers: agentrouter has no zero-ratio rows at all, and all four of
        // orcarouter's zero-ratio rows carry the `:free` marker.
        const paidSignal = (Number.isFinite(ratio) && ratio !== 0)
          || (Number.isFinite(money) && money > 0)
          || Number(m.model_price) > 0;
        const isFree = !paidSignal && (flaggedFree || markerFree.test(id));
        // A paid model must never carry zero pricing: the client's free/paid
        // classifier reads input/output and treats 0 as free, so an unknown rate
        // falls back to the codebase's honest "paid, price unknown" default of 1.
        const inP = isFree ? 0
          : (Number.isFinite(ratio) && ratio > 0 ? ratio
            : (Number.isFinite(money) && money > 0 ? money : 1));
        const outP = isFree ? 0 : (Number.isFinite(compRatio) && compRatio > 0 ? compRatio : inP);
        return {
          id,
          name: id,
          // Both price conventions are emitted so every classifier agrees:
          // server isFreeModel reads prompt/completion, the client reads input/output.
          pricing: { prompt: inP, completion: outP, input: inP, output: outP },
          supported_endpoint_types: Array.isArray(m.supported_endpoint_types) ? m.supported_endpoint_types : null,
          free: isFree,
          paid: !isFree,
        };
      });
    if (!models.length) return null;
    return { models, fetchedAt: Date.now(), total: models.length, source: 'pricing' };
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
        if (result.source !== 'website' && result.source !== 'pricing') modelCache[p.id].source = source;
        const srcNote = result.source === 'website' ? ' (website)' : result.source === 'pricing' ? ' (pricing API)' : result.source === 'public-api' ? ' (public API)' : '';
        console.log(`    ✅ ${p.id}: ${result.count} models${srcNote}`);
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
