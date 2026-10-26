// Provider registry — the single source of truth for gateway endpoints on the
// server side. Mirrored (intentionally) from the client registry in
// public/src/providers/registry.js; the server needs base URLs + formats to
// proxy model fetches without leaking CORS to the browser.
//
// Behaviour preserved exactly from the previous single-file server.js.

// The `pricingApi` field points at a provider's keyless, public pricing/model
// endpoint (new-one-api style gateways expose /api/pricing?all=true). When the
// keyed /v1/models endpoint rejects us, this yields the live model list.
// `publicModels: true` marks endpoints verifiably callable without an API key.
export const PROVIDERS = [
  { id: 'agentrouter', name: 'Agent Router', baseUrl: 'https://agentrouter.org/v1/', format: 'anthropic', publicModels: true, pricingApi: 'https://agentrouter.org/api/pricing?all=true' },
  { id: 'aerolink', name: 'AeroLink', baseUrl: 'https://capi.aerolink.lat/v1/', format: 'anthropic', publicModels: true },
  { id: 'freemodel', name: 'FreeModel', baseUrl: 'https://cc.freemodel.dev/v1/', format: 'anthropic', publicModels: true },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1/', format: 'openai', publicModels: true },
  { id: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1/', format: 'openai', publicModels: false },
  // Groq's catalogue mixes chat models with non-chat ones. Its /v1/models (when
  // a key is present) and its public docs page both list speech-to-text
  // (whisper-*), reranker and content-moderation models (llama-prompt-guard-*,
  // gpt-oss-safeguard-*). Those are not chat completions: selecting one and
  // pointing Claude Code at it fails with
  //   400 `max_tokens` must be less than or equal to `4096` … context_window
  // because the model has no usable chat endpoint / context window.
  // `excludeModels` is applied to BOTH the keyed /models response and the
  // keyless docs scrape, so the picker only ever offers servable chat models.
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1/', format: 'openai', publicModels: false, scrapeDefaultPaid: true, excludeModels: /whisper|prompt-?guard|safeguard|guard|rerank|embed|moderation|(^|\/)(tts|audio|vision)\b/i },
  { id: 'gemini', name: 'Gemini', baseUrl: 'https://generativalanguage.googleapis.com/v1beta/', format: 'gemini', publicModels: false,
    openaiCompat: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', format: 'openai' } },
  { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1/', format: 'openai', publicModels: false, publicListApi: 'https://api.cerebras.ai/public/v1/models' },
  { id: 'orcarouter', name: 'Orca Router', baseUrl: 'https://api.orcarouter.ai/v1/', format: 'openai', publicModels: true, pricingApi: 'https://api.orcarouter.ai/api/pricing?all=true' },
  // Mistral serves /v1/models only to authenticated callers (401 "Invalid API
  // Key"), so the catalogue comes from the docs page via scrapeModelsForProvider,
  // which returns bare `{id, name}` records with NO pricing. A model with no
  // pricing signal falls through to isFreeModel's final `return true`, which
  // marked all 157 scraped models free — wrong, because La Plateforme is a
  // metered API with no broad free tier. `scrapeDefaultPaid` makes the scrape
  // emit the honest paid default (matching the sitemap path and TokenRouter), so
  // free is only ever claimed for an explicitly `:free`/`-free` id.
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1/', format: 'openai', publicModels: false, scrapeDefaultPaid: true },
  { id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1/', format: 'openai', publicModels: false },
  { id: 'chutes', name: 'Chutes', baseUrl: 'https://llm.chutes.ai/v1/', format: 'openai', publicModels: false, publicListApi: 'https://llm.chutes.ai/v1/models' },
  // TokenRouter accepts the Anthropic-format /v1/messages protocol but its auth
  // is Bearer-only — it rejects `x-api-key` outright ("Pass 'Authorization:
  // Bearer tr_...'"). `bearerAuth` records this fact so integrations/tests send
  // the right header and the config flow knows settings.json needs
  // ANTHROPIC_AUTH_TOKEN rather than an apiKeyHelper.
  // `scrapeDefaultPaid` records that TokenRouter's catalogue is paid: only
  // explicitly `:free` / `-free` models (a temporary promo) are free, so
  // anything scraped from the site defaults to paid, never free.
  // TokenRouter's API lives on api.tokenrouter.COM (the .io host answers with a
  // different gateway's error schema and is not this provider).
  //
  // `pricingApi` is the important part: /v1/models and /api/models are both
  // key-gated (401 "Token not provided"), but the new-one-api /api/pricing
  // endpoint is public and returns the full live catalogue — 144 models with
  // real model_ratio/model_price, using OpenRouter-style `org/model` ids and a
  // `:free` suffix. That is a genuine live source, so no curated fallback list
  // is needed or wanted here.
  { id: 'tokenrouter', name: 'TokenRouter', baseUrl: 'https://api.tokenrouter.com/v1/', format: 'openai', publicModels: false, scrapeDefaultPaid: true, bearerAuth: true, pricingApi: 'https://api.tokenrouter.com/api/pricing' },
];

// Curated fallback model lists for providers whose list endpoint is unavailable
// or requires a client allow-list (e.g. Agent/Token Router reject unknown clients).
export const STATIC_MODELS = {
  aerolink: [
    { id: 'claude-opus-5', paid: true }, { id: 'claude-opus-4-8', paid: true },
    { id: 'claude-opus-4-7', paid: true }, { id: 'claude-sonnet-4-6', paid: true },
    { id: 'claude-sonnet-5', paid: true }, { id: 'claude-opus-4-6', paid: true },
    { id: 'claude-haiku-4-5-20251001', paid: true },
  ],
  freemodel: [
    { id: 'claude-opus-5', paid: true }, { id: 'claude-opus-4-8', paid: true },
    { id: 'claude-opus-4-7', paid: true }, { id: 'claude-sonnet-4-6', paid: true },
    { id: 'claude-sonnet-5', paid: true }, { id: 'claude-opus-4-6', paid: true },
    { id: 'claude-haiku-4-5-20251001', paid: true },
  ],
  agentrouter: [
    'claude-sonnet-4', 'claude-opus-4',
    { id: 'claude-opus-4-8', paid: true }, { id: 'claude-opus-5', paid: true },
    { id: 'gpt-5.6-sol', paid: true },
    'gpt-4o', 'gpt-4o-mini',
    'deepseek-chat', 'deepseek-reasoner', 'llama-3.3-70b-instruct',
  ],
  // TokenRouter's catalogue comes from its live, keyless /api/pricing endpoint
  // (see its PROVIDERS entry). There is deliberately NO curated fallback list:
  // the previous one used bare ids (claude-sonnet-4) and a `-free` marker,
  // while TokenRouter actually serves OpenRouter-style `org/model` slugs with a
  // `:free` suffix, so it advertised ids the API would reject and missed the one
  // genuinely free model. Never reintroduce a hand-written list here — if the
  // pricing endpoint ever stops responding, report zero models instead.
  tokenrouter: [],
  mistral: [
    'mistral-small-latest', 'ministral-8b-latest',
    { id: 'mistral-large-latest', paid: true }, { id: 'codestral-latest', paid: true },
  ],
  cerebras: [
    'llama-3.3-70b', 'llama3.1-70b', 'llama3.1-8b', 'qwen-72b', 'llama-3.1-8b-instruct',
    { id: 'llama-3.1-405b-instruct', paid: true },
  ],
  chutes: [
    'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1',
    'Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct',
    { id: 'meta-llama/Llama-3.1-405B-Instruct', paid: true },
  ],
  huggingface: [
    'meta-llama/Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-R1',
    'Qwen/Qwen2.5-72B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3',
    { id: 'meta-llama/Llama-3.1-405B-Instruct', paid: true },
  ],
  orcarouter: [
    'openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat',
    'anthropic/claude-haiku-4.5', 'orcarouter/auto',
    { id: 'openai/gpt-4o', paid: true },
    { id: 'anthropic/claude-sonnet-4.6', paid: true },
    { id: 'anthropic/claude-opus-4.8', paid: true },
    { id: 'google/gemini-2.5-pro', paid: true },
    { id: 'grok/grok-4-fast-reasoning', paid: true },
    { id: 'qwen/qwen3.6-plus', paid: true },
  ],
};

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

// Website-scraping fallback — visit the provider's site and pull the model list
// when the API needs a key (or is unavailable).
export const PROVIDER_SITES = {
  groq: 'https://console.groq.com/docs/models',
  gemini: 'https://ai.google.dev/gemini-api/docs/models',
  mistral: 'https://docs.mistral.ai/getting-started/models/',
  cerebras: 'https://inference-docs.cerebras.ai/',
  agentrouter: 'https://agentrouter.org',
  orcarouter: 'https://www.orcarouter.ai',
  tokenrouter: 'https://www.tokenrouter.com/models',
  chutes: 'https://chutes.ai',
  huggingface: 'https://huggingface.co/models',
};

function parseGroq(html) {
  const out = new Set();
  const re = /(llama-?\d[\w.\-]+|llama3-?\d[\w.\-]+|gemma\d[\w.\-]+|qwen-?[\w.\-]+|deepseek-?[\w.\-]+|whisper-?[\w.\-]+|compound-?[\w.\-]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = m[1].toLowerCase().replace(/\\$/, '');
    if (!t.includes('-')) continue;
    if (/(limits|price|-stable|logo|models|custom)$/.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

function parseGemini(html) {
  const out = new Set();
  const re = /gemini-\d+(?:\.\d+)?-[a-z]+(?:-[a-z0-9-]+)?/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = m[0].toLowerCase();
    if (/(models|stable)$/.test(t)) continue;
    if (/^gemini-\d+\.\d+$/.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

function parseMistral(html) {
  const out = new Set();
  // Broad sweep first, then filtered down to servable chat models. The docs page
  // is prose wrapped around the catalogue, so the raw pattern also matches
  // tutorial scaffolding ("…-readme", "mistral-agents-…-readme",
  // "mistral-connectors-02-build-a-quickstart-generator") and, more importantly,
  // real-but-NON-chat products that the API rejects on /v1/chat/completions
  // (mistral-color-*, mistral-embed*, mistral-moderation-*, mistral-ocr-*,
  // mistral-saba-*, mistral-rag-*, …). Those used to reach the model picker, and
  // because the picker defaults to the first entry the Test Connection button
  // failed with "Invalid model: mistral-color-3".
  const re = /((?:open-)?(?:mistral|mixtral|codestral|ministral|magistral|devstral|pixtral|meltemi)[a-z0-9]*(?:-[a-z0-9.]+)+)/gi;
  // Endpoints/products that are not chat completions, plus documentation noise.
  const DENY = /embed|moderation|ocr|color|image|audio|saba|agent|rag|classif|function|evaluat|compute|data|mlflow|plan|safety|plugin|mamba|code-interpreter|enterprise|transcri|guard|detox|judge|citation|benchmark|readme|example|quickstart|connectors?|sdk|install|cookbook|guide|prompting/;
  // A servable id ends in a real version shape: compact date (2508), dotted date
  // (3-1-25-08), open release (0-1), size parameter (7b, 8x7b) or -latest. This
  // rejects bare version fragments such as "mistral-large" or "mistral-medium-3"
  // that appear in headings but are not API ids.
  const VERSION = /(?:-[0-9]{4}|-[0-9]{2}-[0-9]{2}(?:-[0-9]{2})?|-[0-9]+-[0-9]+|-[0-9]+b(?:-latest)?|-[0-9]+x[0-9]+b(?:-latest)?|-latest)$/;
  let m;
  while ((m = re.exec(html))) {
    const t = m[1].toLowerCase();
    if (t.length > 40) continue;
    if (/[_/\\]/.test(t)) continue;
    if (DENY.test(t)) continue;
    if (!VERSION.test(t)) continue;
    out.add(t);
  }
  // Order flagship families first so the default selection (the first row, which
  // is what an unconfigured Test Connection uses) is a sensible chat model
  // instead of whatever the docs happened to mention first.
  const RANK = ['mistral-large', 'mistral-medium', 'mistral-small', 'mistral-mini', 'magistral', 'devstral', 'codestral', 'ministral', 'pixtral', 'mixtral', 'open-mistral', 'open-mixtral', 'open-codestral'];
  const rank = (id) => { const i = RANK.findIndex((f) => id.startsWith(f)); return i === -1 ? RANK.length : i; };
  return [...out].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// ─── Parsers for the previously static-only gateways ───
// These sites are mostly JS-rendered; the patterns below still catch model IDs
// that are embedded in server HTML or inline JSON. When a site yields nothing
// the curated STATIC_MODELS list remains the fallback, so no models are ever lost.

function parseAgentRouter(html) {
  const out = new Set();
  const re = /(claude-(?:opus|sonnet|haiku)-[0-9]+(?:-[0-9]+)?|gpt-[0-9]+(?:\.[0-9]+)?(?:-[a-z0-9]+)?|deepseek-[a-z]+(?:-[a-z]+)?|llama-[\d.]+(?:-[\w]+)?)/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = m[1].toLowerCase().replace(/\.$/, '');
    if (/(limits|price|-stable|logo|models|custom)$/.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

// TokenRouter model ids appear on the public site as `/models/<org>/<model>`
// routes (and sometimes as bare `org/model` strings in page data). Route
// extraction is the primary signal because hyphenated orgs (z-ai, x-ai,
// bytedance-seed) cannot be captured by a simple `word/name` match. A second
// pass picks up bare tokens (claude-*/gpt-*/deepseek-*/llama-*) and inline
// `org/model` mentions that fall outside route paths.
const TOKENROUTER_ROUTE_RE = /\/models\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9_.:-]*)(?![a-z0-9_.:\-])/gi;
const TOKENROUTER_INLINE_RE = /([a-z][a-z0-9_]*)\/([a-z0-9][a-z0-9_.:-]*\d[a-z0-9_.:-]*)(?![a-z0-9_.:\-])/gi;
const TOKENROUTER_BARE_RE = /(claude-(?:fable|opus|sonnet|haiku)-[0-9][a-z0-9.\-]*|gpt-[0-9][a-z0-9.\-]*|gemini-[0-9][a-z0-9.\-]*|deepseek-[a-z0-9.\-]+|qwen[0-9][a-z0-9.\-]*|llama-[0-9][a-z0-9.\-]*)/gi;
const TOKENROUTER_INLINE_ORG_BLOCK = /^(models|assets|docs|blog|pricing|login|signup|register|console|static|public|api|www|css|script|font|images?|media|i18n|en|us|net|ms|com|org|io|ai|ex|seed|application|text|image|video|audio)$/i;
function parseTokenRouter(html) {
  const out = new Set();
  const lower = html.toLowerCase();
  let m;
  while ((m = TOKENROUTER_ROUTE_RE.exec(lower))) {
    out.add(`${m[1]}/${m[2]}`);
  }
  while ((m = TOKENROUTER_INLINE_RE.exec(lower))) {
    const org = m[1];
    const name = m[2].replace(/\.$/, '');
    if (TOKENROUTER_INLINE_ORG_BLOCK.test(org)) continue;
    if (/\.(js|css|png|jpe?g|svg|gif|ico|woff2?|ttf|otf|map|json|html?|webp|avif|ld)$/.test(name)) continue;
    if (!/\d/.test(name)) continue;
    out.add(`${org}/${name}`);
  }
  while ((m = TOKENROUTER_BARE_RE.exec(lower))) {
    const t = m[1].replace(/\.$/, '');
    if (/(limits|price|-stable|logo|models|custom)$/.test(t)) continue;
    if (/^[a-z]+-[a-z]$/.test(t)) continue; // partial fragments like "deepseek-v"
    out.add(t);
  }
  return [...out];
}

function parseCerebras(html) {
  const out = new Set();
  const re = /(llama-?[\d.]+(?:-[\w]+)?|llama3(?:\.[\d]+)?(?:-[\w]+)?|qwen-?[\d.]+(?:-[\w]+)?|qwen3(?:\.[\d]+)?(?:-[\w]+)?)/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = m[1].toLowerCase().replace(/\.$/, '');
    if (/(limits|price|-stable|logo|models|custom)$/.test(t)) continue;
    out.add(t);
  }
  return [...out];
}

function parseChutes(html) {
  const out = new Set();
  const re = /(meta-llama\/Llama-[\d.]+-[\dA-Za-z.-]+|deepseek-ai\/DeepSeek-[\w.-]+|Qwen\/Qwen[\d.]+-[\dA-Za-z.-]+|mistralai\/Mistral-[\w.-]+)/g;
  let m;
  while ((m = re.exec(html))) out.add(m[1]);
  return [...out];
}

function parseHuggingFace(html) {
  const out = new Set();
  const re = /(meta-llama\/Llama-[\d.]+-[\dA-Za-z.-]+|deepseek-ai\/DeepSeek-[\w.-]+|Qwen\/Qwen[\d.]+-[\dA-Za-z.-]+|mistralai\/Mistral-[\w.-]+)/g;
  let m;
  while ((m = re.exec(html))) out.add(m[1]);
  return [...out];
}

function parseOrcaRouter(html) {
  const out = new Set();
  const re = /(orcarouter\/auto|openai\/gpt-[0-9a-z.-]+|google\/gemini-[0-9a-z.-]+|deepseek\/deepseek-[0-9a-z.-]+|anthropic\/claude-[0-9a-z.-]+|grok\/grok-[0-9a-z.-]+|qwen\/qwen[0-9a-z.-]+)/gi;
  let m;
  while ((m = re.exec(html))) out.add(m[1].toLowerCase().replace(/\.$/, ''));
  return [...out];
}

export const SCRAPE_PARSERS = {
  groq: parseGroq,
  gemini: parseGemini,
  mistral: parseMistral,
  agentrouter: parseAgentRouter,
  tokenrouter: parseTokenRouter,
  cerebras: parseCerebras,
  chutes: parseChutes,
  huggingface: parseHuggingFace,
  orcarouter: parseOrcaRouter,
};
