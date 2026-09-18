// ═══════════════════════════════════════════════════════════════
//  Custom Provider Model Fetch (v2.1.0)
//
//  Shared three-tier model-list resolution for user-created custom
//  providers, used by BOTH the /fetch-models route and the startup
//  background fetch:
//
//    1. Official /v1/models endpoint — with the user's transient
//       key when supplied (never persisted).
//    2. Keyless /api/pricing — new-one-api gateway convention
//       (NARA, Agent Router, Orca Router…) exposing every served
//       model with real quota/pricing ratios.
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
        // Ratios here are token-quota weights, not money. A model is free when
        // it costs zero credits, OR the gateway marks it explicitly free via
        // the `-free`/`:free` id convention (free-tier models that carry a
        // non-zero quota weight but consume no balance on the free plan).
        const zeroCredit = (Number.isFinite(inputRatio) && inputRatio === 0) || /(:free|-free)$/i.test(id);
        const isPaid = !zeroCredit && ((Number.isFinite(inputRatio) && inputRatio > 0) || (Number.isFinite(outputRatio) && outputRatio > 0) || Number(m.model_price) > 0);
        return {
          id,
          name: m.display_name || id,
          pricing: isPaid ? { input: inputRatio, output: outputRatio } : { input: 0, output: 0 },
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
    const usedCatalogue = pricing ? merged.length - tier1.models.length : 0;
    return {
      ok: true,
      models: merged.map(m => ({ ...m, source: 'fetched' })),
      source: pricing ? 'official-api+pricing' : 'official-api',
    };
  }

  // Tier 2 — the pricing catalogue alone is a complete, authoritative list.
  if (pricing) return { ok: true, models: pricing.models.map(m => ({ ...m, source: 'fetched' })), source: 'pricing-api' };

  // Tier 3 — strict website scrape (last resort, honest defaults).
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
