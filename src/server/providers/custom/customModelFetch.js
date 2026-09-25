// ═══════════════════════════════════════════════════════════════
//  Custom Provider Model Fetch (v2.1.0)
//
//  Shared model-list resolution for user-created custom
//  providers, used by BOTH the /fetch-models route and the startup
//  background fetch:
//
//    1. Official /v1/models endpoint — with the user's transient
//       key when supplied (never persisted).
//    2. Keyless /api/pricing — new-one-api gateway convention
//       (NARA, Agent Router, Orca Router…) exposing every SERVED
//       model with real quota/pricing ratios (live truth — matches
//       the storefront's own live free count).
//    2.5. Storefront sitemap enumeration — a last-resort signal ONLY:
//       storefronts keep offline/deprecated model pages published,
//       so it over-counts live models. When a live catalogue exists
//       (tiers 1-2) it wins; the sitemap fills in when nothing else
//       does (bot-challenged storefronts with no pricing endpoint).
//    3. Strict website scraping — only tokens that start with a
//       known model-family prefix; never asset hashes or version
//       fragments.
//
//  No secrets are persisted anywhere — keys are request-scoped.
// ═══════════════════════════════════════════════════════════════

import { FREE_NAME_RE } from '../modelClassifier.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Free-tier id/name marker (shared with the Model Classifier): matches "free" as
// a whole token at a delimiter — free/claude-opus-4.6, free:gpt-4o, free-gpt4,
// gpt-4o:free, "Free GPT-4". Gateways like APInex / Inference Dahl flag free
// models purely by this convention with no pricing to classify from.
const FREE_ID = FREE_NAME_RE;

function timeoutFetch(url, { headers = {}, ms = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { headers, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── 1. Official /models endpoint (OpenAI / Anthropic / Gemini shapes) ──
async function tryOfficialApi(rec, key) {
  if (!rec.api?.baseUrl || !rec.api?.format || rec.api.format === 'unknown') return null;
  try {
    const base = rec.api.baseUrl.endsWith('/') ? rec.api.baseUrl : rec.api.baseUrl + '/';
    let endpoint;
    const headers = { 'user-agent': UA };
    if (rec.api.format === 'gemini') {
      endpoint = `${base}models?key=${encodeURIComponent(key || '')}&pageSize=1000`;
    } else if (rec.api.format === 'anthropic') {
      const modelsPath = base.endsWith('/v1/') ? 'models' : 'v1/models';
      endpoint = `${base}${modelsPath}`;
      if (key) {
        headers['x-api-key'] = key;
        headers['Authorization'] = `Bearer ${key}`;
      }
      headers['anthropic-version'] = '2023-06-01';
    } else {
      endpoint = `${base}models`;
      if (key) headers['Authorization'] = `Bearer ${key}`;
    }
    const resp = await timeoutFetch(endpoint, { headers });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    const list = data?.data || data?.models || data?.results || data?.model_list || (Array.isArray(data) ? data : []);
    // Some gateways (Kira AI…) mark free models with an explicit is_free/free
    // flag and return no pricing object — synthesize a zero pricing from it so
    // free models aren't misclassified as paid by the no-signal default.
    const flagFree = (m) => m.is_free === true || m.is_free === 1 || m.free === true || m.free === 1 || m.isFree === true;
    const models = list
      .filter((m) => m && (m.id || m.model_name || m.name))
      .map((m) => ({
        id: m.id || m.model_name || m.name,
        name: m.display_name || m.displayName || m.name || m.id,
        pricing: m.pricing || (flagFree(m) ? { input: 0, output: 0 } : null),
        context_length: m.context_length || m.contextLength || m.max_context_tokens || null,
        capabilities: m.capabilities || null,
      }));
    return models.length ? { models, source: 'official-api' } : null;
  } catch { return null; }
}

// ── 2. Keyless /api/pricing (new-one-api gateways) ──
async function tryPricingApi(rec) {
  try {
    const origin = rec.api?.baseUrl
      ? new URL(rec.api.baseUrl).origin
      : (rec.identity?.website ? new URL(rec.identity.website).origin : null);
    if (!origin) return null;
    const resp = await timeoutFetch(`${origin}/api/pricing`, { headers: { 'user-agent': UA } });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    const models = list
      .filter((m) => m && (m.alias || m.model_name || m.id))
      .map((m) => {
        const id = m.alias || m.model_name || m.id;
        const inputRatio = Number(m.input_credit_per_1k ?? m.model_ratio ?? NaN);
        const outputRatio = Number(m.output_credit_per_1k ?? m.completion_ratio ?? NaN);
        // model_money (per-1k money price) is the charge for quota_type-1
        // "credit by money" models, which carry no meaningful quota ratio;
        // some gateways report that rate under model_price instead.
        const money = Number(m.model_money ?? m.model_price ?? NaN);
        // The gateway's explicit free flag is authoritative (some gateways
        // mark is_free on free-tier models that still carry a non-zero quota
        // weight and no `:free`/`-free` suffix — e.g. UNO Router's free
        // reps). Honor it exactly like tryOfficialApi does.
        const flaggedFree = m.is_free === true || m.is_free === 1 || m.free === true || m.free === 1 || m.isFree === true;
        // Ratios here are token-quota weights, not money. A model is free when
        // it costs zero credits, OR the gateway marks it explicitly free via
        // the `-free`/`:free` id convention (free-tier models that carry a
        // non-zero quota weight but consume no balance on the free plan).
        // A zero ratio only means free when the model is quota-priced — a
        // money-priced model (model_money > 0, quota_type 1) is paid regardless
        // of its quota ratio (e.g. UNO Router's image models: ratio 0, $0.02).
        const zeroCredit = flaggedFree ||
          (Number.isFinite(inputRatio) && inputRatio === 0 && money === 0) ||
          FREE_ID.test(id);
        const paidSignal =
          (Number.isFinite(inputRatio) && inputRatio !== 0) ||
          (Number.isFinite(outputRatio) && outputRatio !== 0) ||
          (Number.isFinite(money) && money > 0) ||
          Number(m.model_price) > 0;
        const isPaid = !zeroCredit && paidSignal;
        // Money-priced models report their money rate when they carry no quota
        // weight — keeps them visibly paid instead of a confusing zero.
        const inP = isPaid && Number.isFinite(inputRatio) && inputRatio > 0 ? inputRatio
          : (isPaid && Number.isFinite(money) && money > 0 ? money : 0);
        const outP = isPaid && Number.isFinite(outputRatio) && outputRatio > 0 ? outputRatio : inP;
        return {
          id,
          name: m.display_name || id,
          pricing: isPaid ? { input: inP, output: outP } : { input: 0, output: 0 },
          context_length: m.max_context_tokens || null,
          capabilities: {
            streaming: m.supports_streaming ?? null,
            vision: m.supports_vision ?? null,
            image: m.supports_image_generation ?? null,
            video: m.supports_video_generation ?? null,
            reasoning: m.reasoning ?? null,
          },
        };
      });
    return models.length ? { models, source: 'pricing-api' } : null;
  } catch { return null; }
}

// ── 2.5 Sitemap catalog enumeration (Cloudflare / JS storefronts) ──
// Some gateways wrap their model catalog in a marketing storefront whose
// models page is locked behind auth or a bot challenge, while the SEO sitemap
// stays fully public and enumerates every model as /models/<vendor>/<id>.
// UNO Router lists 480+ ids there, but most are offline/deprecated pages the
// storefront keeps published — its LIVE catalogue is the ~240 /api/pricing
// rows (137 free). So the sitemap is only a LAST-RESORT source used when no
// live catalogue (official /models or /api/pricing) is available. Free/paid
// is decided by the `:free` convention, since sitemaps carry no pricing.
async function trySitemapCatalog(rec) {
  // The sitemap is a storefront artifact — prefer the WEBSITE origin (the API
  // origin often 404s it, e.g. unorouter.com vs api.unorouter.com), and fall
  // back to the API origin for gateways that host their own storefront there.
  const websiteOrigin = rec.identity?.website ? new URL(rec.identity.website).origin : null;
  const apiOrigin = rec.api?.baseUrl ? new URL(rec.api.baseUrl).origin : null;
  const origins = [...new Set([websiteOrigin, apiOrigin].filter(Boolean))];
  if (!origins.length) return null;
  for (const origin of origins) {
    try {
      const resp = await timeoutFetch(`${origin}/sitemap.xml`, { headers: { 'user-agent': UA }, ms: 12000 });
      if (!resp.ok) continue;
      const xml = await resp.text();
      if (!xml || xml.length > 12_000_000) continue;

      const locs = new Set([...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
      // Sitemap indexes: follow the sub-sitemaps one level deep.
      const subsitemaps = [...xml.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      if (subsitemaps.length) {
        for (const sub of subsitemaps.slice(0, 25)) {
          try {
            const res = await timeoutFetch(sub, { headers: { 'user-agent': UA }, ms: 10000 });
            if (!res.ok) continue;
            const subXml = await res.text();
            if (subXml && subXml.length <= 12_000_000) {
              [...subXml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].forEach((m) => locs.add(m[1]));
            }
          } catch { /* skip a broken sub-sitemap */ }
        }
      }
      if (!locs.size) continue;

      // Model ids hang off /models/<vendor>/<id> routes. Anchor on the URL shape
      // itself (never trust a free-text token here): the segment right after
      // /models/<vendor>/ is a model id; a lone /models/<id> segment must at
      // least carry a version digit or a free marker so vendor/category pages
      // (single bare words) are never mistaken for models.
      const JUNK = /(^|[-_.])(css|js|mjs|png|svg|ico|woff2?|ttf|eot|map|chunk|\d{6,}|[0-9a-f]{8,})/i;
      const FILE_EXT = /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf|eot|map|json|xml|txt|pdf|zip|html?)$/i;
      const MODELISH = /^[A-Za-z0-9][A-Za-z0-9._:/'-]{2,72}$/;
      const ids = new Map();
      for (const url of locs) {
        const segs = url.replace(/\/+$/, '').split('?')[0].split('/').filter(Boolean);
        const mIdx = segs.findIndex((s) => s.toLowerCase() === 'models');
        if (mIdx === -1) continue;
        const after = segs.slice(mIdx + 1);
        if (!after.length || after.length > 2) continue;
        let id;
        if (after.length === 2) {
          id = after[1]; // /models/<vendor>/<id>
        } else {
          id = after[0]; // /models/<id> — needs a digit or free marker to qualify
          if (!/(\d|free)/i.test(id)) continue;
        }
        try { id = decodeURIComponent(id); } catch { continue; }
        if (!id || id.length < 3 || !/[a-zA-Z]/.test(id) || !MODELISH.test(id) || JUNK.test(id) || FILE_EXT.test(id)) continue;
        if (!ids.has(id)) {
          ids.set(id, {
            id,
            name: id,
            // Honest default (same rule as the website scrape below): a free-marked
            // id is free; anything else is paid — never claim free without a signal.
            pricing: FREE_ID.test(id) ? { input: 0, output: 0 } : { input: 1, output: 1 },
            context_length: null,
          });
        }
      }
      const models = [...ids.values()].slice(0, 2000);
      return models.length ? { models, source: 'sitemap' } : null;
    } catch { /* try the next origin / bail silently */ }
  }
}

// ── 3. Strict website scraping (never produce junk tokens) ──
async function tryWebsiteScrape(rec) {
  if (!rec.identity?.website) return null;
  try {
    const resp = await timeoutFetch(rec.identity.website, { headers: { 'user-agent': UA }, ms: 8000 });
    const html = await resp.text();
    const models = new Set();

    // Known vendor prefixes — only tokens that start with a real model family.
    const VENDOR_PREFIX = /^(gpt|chatgpt|o[134](-|$)|claude|gemini|deepseek|qwen|mistral|mixtral|llama|codellama|kimi|grok|glm|zai|minimax|muse|agnes|laguna|mimo|stepfun|nano|phi|yi|falcon|command|dbrx|embed|whisper|dall|flux|stable|sonnet|opus|haiku|auto)/;
    // Junk patterns — asset hashes, version fragments, css classes, file names.
    const JUNK = /(^|[-_.])(css|js|mjs|png|svg|ico|woff2?|ttf|eot|map|chunk|v\d+(\.|$)|\d{6,}|[0-9a-f]{8,})/i;
    const FILE_EXT = /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf|eot|map|json|xml|txt|pdf|zip|html?)$/i;

    // Pattern A: quoted strings in JSON/JS contexts ("model":"x" / "id":"x" / alias)
    const jsonModelPattern = /["'](?:model|id|name|model_id|model-name|alias)["']\s*:\s*["']([a-zA-Z][\w./-]{3,60})["']/g;
    let match;
    while ((match = jsonModelPattern.exec(html)) !== null) {
      const m = match[1].toLowerCase();
      if (VENDOR_PREFIX.test(m) && !JUNK.test(m) && !FILE_EXT.test(m)) models.add(m);
    }

    // Pattern B: plain-text vendor model names (rendered HTML text only)
    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    const textModelPattern = /\b(gpt-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+|deepseek-[\w.-]+|qwen[\w.-]*|mistral-[\w.-]+|kimi-[\w.-]+|grok-[\w.-]+|glm-[\w.-]+|minimax-[\w.-]+|agnes-[\w.-]+|muse-[\w.-]+|llama[\w.-]*|o[134]-[\w.-]+)\b/gi;
    while ((match = textModelPattern.exec(textContent)) !== null) {
      const m = match[1].toLowerCase();
      if (!JUNK.test(m) && !FILE_EXT.test(m) && m.length < 60) models.add(m);
    }

    // Pattern C: <option value="…"> lists
    const optionPattern = /<option[^>]*value="([a-zA-Z][\w./-]{3,60})"[^>]*>/gi;
    while ((match = optionPattern.exec(html)) !== null) {
      const m = match[1].toLowerCase();
      if (VENDOR_PREFIX.test(m) && !JUNK.test(m) && !FILE_EXT.test(m)) models.add(m);
    }

    const list = [...models].slice(0, 500).map(id => ({
      id,
      name: id.split(/[-._]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      // Honest default: scraped catalogues carry no pricing signal, so a
      // free-marked id is treated as free; anything else is paid (never claim
      // free without a signal).
      pricing: FREE_ID.test(id) ? { input: 0, output: 0 } : { input: 1, output: 1 },
      context_length: null,
    }));
    return list.length ? { models: list, source: 'website' } : null;
  } catch { return null; }
}

// ─── Public: resolve a custom provider's model list ───
// Returns { ok, models, source, reason } — models carry `source:'fetched'`.
// Strategy: the official /models endpoint is the source of truth for WHICH
// models exist, but it rarely carries pricing — so when tier 1 succeeds we
// ALSO pull the keyless /api/pricing catalogue and merge its real free/paid
// data in. That keeps the Include-paid toggle meaningful in every case:
//   - pricing present & zero  → free
//   - pricing present & >0    → paid (with ratios)
//   - no pricing signal       → `-free`/`:free` id convention decides,
//                               otherwise honestly unknown → treated paid.
// The key is used transiently for tier 1 only and never persisted.
export async function fetchCustomProviderModelsList(rec, key = '') {
  if (!rec) return { ok: false, models: [], reason: 'No provider record.' };
  if (!rec.api?.baseUrl && !rec.identity?.website) return { ok: false, models: [], reason: 'No base URL or website configured.' };
  if (rec.api?.format === 'unknown' && !rec.identity?.website) return { ok: false, models: [], reason: 'Cannot fetch models for unknown format with no website.' };

  const pricing = await tryPricingApi(rec); // may be null — that's fine
  const pricingById = new Map((pricing?.models || []).map(m => [m.id, m]));
  const freeConvention = (id) => FREE_ID.test(id);
  // Storefront sitemap enumeration is a LAST-RESORT signal only: it includes
  // offline/deprecated model pages the storefront keeps published (UNO Router
  // lists 480+ ids, but only its live catalogue — the ~240 /api/pricing rows —
  // is actually servable right now). When a live catalog (pricing or /models)
  // exists it is the source of truth; the sitemap only fills in when there is
  // nothing else.
  const sitemap = await trySitemapCatalog(rec);

  // Tier 1 — official /models with the user's transient key. UNION with the
  // pricing catalogue: some gateways return only the user's plan-allotted
  // subset from /models, while /api/pricing lists the FULL catalogue. Tier-1
  // entries win on name/context; catalogue-only entries are appended so the
  // card badge never shrinks from "57 total" to "10 total" after a keyed
  // refresh. Pricing always comes from the catalogue when available.
  const tier1 = await tryOfficialApi(rec, key);
  if (tier1) {
    const merged = [];
    const seen = new Set();
    for (const m of tier1.models) {
      const pm = pricingById.get(m.id);
      seen.add(m.id);
      if (pm) {
        merged.push({
          ...m,
          name: m.name && m.name !== m.id ? m.name : pm.name,
          pricing: pm.pricing,
          context_length: m.context_length || pm.context_length,
          capabilities: m.capabilities || pm.capabilities,
        });
      } else if (m.pricing) {
        // Real pricing came from /models itself (gateway flag or native field) — keep it.
        merged.push({ ...m });
      } else {
        // No pricing signal for this id — fall back to the free-id convention.
        const free = freeConvention(m.id);
        merged.push({ ...m, pricing: { input: free ? 0 : 1, output: free ? 0 : 1 } });
      }
    }
    // Catalogue-only models (present in /api/pricing, absent from the keyed
    // /models subset) — still part of the gateway's real catalogue.
    for (const pm of pricing?.models || []) {
      if (!seen.has(pm.id)) { merged.push(pm); seen.add(pm.id); }
    }
    return {
      ok: true,
      models: merged.map(m => ({ ...m, source: 'fetched' })),
      source: pricing ? 'official-api+pricing' : 'official-api',
    };
  }

  // Tier 2 — the pricing catalogue is a complete, authoritative list of what
  // the gateway is serving RIGHT NOW (the site's own live free count).
  if (pricing) return { ok: true, models: pricing.models.map(m => ({ ...m, source: 'fetched' })), source: 'pricing-api' };

  // Tier 3 — storefront sitemap enumeration, then strict website scrape.
  // Both are honest-default fallbacks: no live pricing signal, so `:free` ids
  // are free and everything else defaults to paid.
  if (sitemap) return { ok: true, models: sitemap.models.map(m => ({ ...m, source: 'fetched' })), source: 'sitemap' };
  const tier3 = await tryWebsiteScrape(rec);
  if (tier3) return { ok: true, models: tier3.models.map(m => ({ ...m, source: 'fetched' })), source: tier3.source };

  return { ok: false, models: [], reason: 'No models could be fetched (API needs a key, no pricing endpoint, and the website has no model list).' };
}

// ─── Public: fetch AND persist into the record's modelSupport ───
export async function refreshCustomProviderModels(rec, key = '') {
  const result = await fetchCustomProviderModelsList(rec, key);
  if (result.ok && result.models.length) {
    rec.modelSupport = { status: 'verified', models: result.models, count: result.models.length };
    rec.integration = { status: 'metadata-only' };
  }
  return result;
}
