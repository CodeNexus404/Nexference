// Provider registry — the single source of truth for gateway endpoints on the
// server side. Mirrored (intentionally) from the client registry in
// public/src/providers/registry.js; the server needs base URLs + formats to
// proxy model fetches without leaking CORS to the browser.
//
// Behaviour preserved exactly from the previous single-file server.js.

export const PROVIDERS = [
  { id: 'anthropic', baseUrl: 'https://api.anthropic.com/', format: 'anthropic', publicModels: false },
  { id: 'agentrouter', baseUrl: 'https://agentrouter.org/v1/', format: 'anthropic', publicModels: false },
  { id: 'aerolink', baseUrl: 'https://capi.aerolink.lat/v1/', format: 'anthropic', publicModels: false },
  { id: 'freemodel', baseUrl: 'https://cc.freemodel.dev/v1/', format: 'anthropic', publicModels: false },
  { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1/', format: 'openai', publicModels: true },
  { id: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1/', format: 'openai', publicModels: false },
  { id: 'groq', baseUrl: 'https://api.groq.com/openai/v1/', format: 'openai', publicModels: false },
  { id: 'opencode-api', baseUrl: 'http://localhost:4099/v1/', format: 'openai', publicModels: false },
  { id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/', format: 'gemini', publicModels: false },
  { id: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1/', format: 'openai', publicModels: false },
  { id: 'orcarouter', baseUrl: 'https://api.orcarouter.ai/v1/', format: 'openai', publicModels: false },
  { id: 'mistral', baseUrl: 'https://api.mistral.ai/v1/', format: 'openai', publicModels: false },
  { id: 'huggingface', baseUrl: 'https://router.huggingface.co/v1/', format: 'openai', publicModels: false },
  { id: 'chutes', baseUrl: 'https://llm.chutes.ai/v1/', format: 'openai', publicModels: false },
  { id: 'tokenrouter', baseUrl: 'https://api.tokenrouter.io/v1/', format: 'anthropic', publicModels: false },
];

// Curated fallback model lists for providers whose list endpoint is unavailable
// or requires a client allow-list (e.g. Agent/Token Router reject unknown clients).
export const STATIC_MODELS = {
  agentrouter: [
    'claude-sonnet-4', 'claude-opus-4',
    { id: 'claude-opus-4-8', paid: true }, { id: 'claude-opus-5', paid: true },
    { id: 'gpt-5.6-sol', paid: true },
    'gpt-4o', 'gpt-4o-mini',
    'deepseek-chat', 'deepseek-reasoner', 'llama-3.3-70b-instruct',
  ],
  tokenrouter: [
    'claude-sonnet-4', 'claude-opus-4', 'gpt-4o', 'gpt-4o-mini', 'deepseek-chat',
    { id: 'claude-opus-4-8', paid: true }, { id: 'claude-opus-5', paid: true },
  ],
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
  const re = /((?:mistral|codestral|ministral|magistral|pixtral)(?:-[\w.\-]+)?|open-(?:mistral|mixtral|codestral)-[\w.\-]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = m[1].toLowerCase().replace(/\\$/, '');
    if (!t.includes('-')) continue;
    if (/(^-ai|models|weight|opener|-models|-ai$)/.test(t)) continue;
    out.add(t);
  }
  return [...out];
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

const TOKENROUTER_RE = /(claude-(?:opus|sonnet|haiku)-[0-9]+(?:-[0-9]+)?|gpt-[0-9]+(?:\.[0-9]+)?(?:-[a-z0-9]+)?|deepseek-[a-z]+(?:-[a-z]+)?|llama-[\d.]+(?:-[\w]+)?)/gi;
function parseTokenRouter(html) {
  const out = new Set();
  let m;
  while ((m = TOKENROUTER_RE.exec(html))) {
    const t = m[1].toLowerCase().replace(/\.$/, '');
    if (/(limits|price|-stable|logo|models|custom)$/.test(t)) continue;
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
