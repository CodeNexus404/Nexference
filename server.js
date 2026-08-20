import express from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;
const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

// Prevent crashes from killing the process
process.on('uncaughtException', (err) => console.error('[uncaught]', err.message));
process.on('unhandledRejection', (err) => console.error('[unhandled rejection]', err?.message || err));

app.use(express.json());
app.use(express.static(join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'),
}));

const norm = (u) => (u && u.endsWith('/') ? u : (u || '') + '/');

// ═══════════════════════════════════════════════════════════════
//  Provider definitions (mirrored from app.js for server-side fetching)
// ═══════════════════════════════════════════════════════════════
const PROVIDERS = [
  { id: 'agentrouter', baseUrl: 'https://agentrouter.org/v1/', format: 'anthropic', publicModels: false },
  { id: 'aerolink', baseUrl: 'https://capi.aerolink.lat/v1/', format: 'anthropic', publicModels: false },
  { id: 'freemodel', baseUrl: 'https://cc.freemodel.dev/v1/', format: 'anthropic', publicModels: false },
  { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1/', format: 'openai', publicModels: true },
  { id: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1/', format: 'openai', publicModels: false },
  { id: 'groq', baseUrl: 'https://api.groq.com/openai/v1/', format: 'openai', publicModels: false },
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
const STATIC_MODELS = {
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

// ═══════════════════════════════════════════════════════════════
//  Model Cache — server-side with timestamps
// ═══════════════════════════════════════════════════════════════
const modelCache = {};       // { providerId: { models: [...], fetchedAt: timestamp, source: 'startup'|'proxy'|'refresh', total: N, free: N } }
const FETCH_INTERVAL = 30 * 60 * 1000;  // 30 minutes
const FETCH_TIMEOUT = 15000;

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
    modelCache[id] = { models: scraped.models, fetchedAt: scraped.fetchedAt, total: scraped.total, source: 'website' };
    return { ok: true, count: scraped.total, provider: id, source: 'website' };
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
const PROVIDER_SITES = {
  groq: 'https://console.groq.com/docs/models',
  gemini: 'https://ai.google.dev/gemini-api/docs/models',
  mistral: 'https://docs.mistral.ai/getting-started/models/',
  cerebras: 'https://inference-docs.cerebras.ai/',
  agentrouter: 'https://agentrouter.org',
  orcarouter: 'https://www.orcarouter.ai',
  tokenrouter: 'https://www.tokenrouter.com/models',
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

const SCRAPE_PARSERS = { groq: parseGroq, gemini: parseGemini, mistral: parseMistral };

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
  console.log(`\n  🔄 Fetching models from all providers (${source})…`);
  const results = await Promise.allSettled(
    PROVIDERS.map(async (p) => {
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
  console.log(`  📊 Fetched models from ${successCount}/${PROVIDERS.length} providers\n`);
  return results.map(r => r.value);
}

// ─── Periodic refresh ───
setInterval(() => fetchAllModels('periodic'), FETCH_INTERVAL);

// ═══════════════════════════════════════════════════════════════
//  API Routes
// ═══════════════════════════════════════════════════════════════

// ─── GET current settings.json ───
app.get('/api/config', (req, res) => {
  try {
    if (!existsSync(SETTINGS_PATH)) {
      return res.json({ config: null, path: SETTINGS_PATH });
    }
    const raw = readFileSync(SETTINGS_PATH, 'utf-8');
    let config = null;
    try { config = JSON.parse(raw); } catch { /* tolerate malformed file */ }
    res.json({ config, path: SETTINGS_PATH });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST update settings.json ───
app.post('/api/config', (req, res) => {
  try {
    const config = req.body?.config ?? req.body;
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Missing config' });

    const configDir = dirname(SETTINGS_PATH);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    let existing = {};
    if (existsSync(SETTINGS_PATH)) {
      try {
        existing = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
      } catch {
        existing = {}; // tolerate a malformed/hand-edited settings.json
      }
    }

    // Write the settings.json in the exact gateway format (env + apiKeyHelper + model).
    // Preserve whatever env keys the config carries (ANTHROPIC_* for Anthropic
    // providers, OPENAI_* for OpenAI providers) so both shapes round-trip intact.
    const merged = {
      env: { ...(config.env || {}) },
      apiKeyHelper: config.apiKeyHelper,
      model: config.model,
    };

    writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    res.json({ success: true, path: SETTINGS_PATH, config: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET open the settings.json folder in the OS file manager ───
app.get('/api/open-folder', (req, res) => {
  const dir = dirname(SETTINGS_PATH);
  let cmd, args;
  if (process.platform === 'darwin') { cmd = 'open'; args = [dir]; }
  else if (process.platform === 'win32') { cmd = 'explorer'; args = [dir]; }
  else { cmd = 'xdg-open'; args = [dir]; }

  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', (err) => res.json({ ok: false, error: err.message }));
    p.unref();
    res.json({ ok: true, dir });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─── GET cached models (server pre-fetched on startup) ───
app.get('/api/cached-models', (req, res) => {
  const summary = {};
  for (const p of PROVIDERS) {
    const cached = modelCache[p.id];
    if (cached && cached.models) {
      const freeModels = cached.models.filter(m => {
        if (m.paid) return false;
        if (p.id === 'openrouter') {
          return m.id?.endsWith(':free') || (m.pricing && parseFloat(m.pricing.prompt || 0) === 0 && parseFloat(m.pricing.completion || 0) === 0);
        }
        if (['nvidia', 'huggingface', 'chutes', 'orcarouter'].includes(p.id)) {
          return !/embed|rerank|reranker|ocr|parse|nemoretriever|asr|tts|whisper|canary|parakeet|riva|magpie|conformer|megatron-1b-nmt|voicechat|studio.?voice|noise|guard|safety|jailbreak|content.?safety|gliner|topic-control|vista|molmim|genmol|diffdock|rfdiffusion|proteinmpnn|esm|alphafold|openfold|boltz|evo2|fourcastnet|cosmos|flux|stable-diffusion|sdxl|qwen-image|paligemma|trellis|bge|paddleocr|yolox|page-elements|table-structure|graphic-elements|eyecontact|lipsync|speaker|streampetr|bevformer|sparsedrive|cuopt|fastpitch|relight|synthetic-video|diffusiongemma/i.test(m.id || '');
        }
        return true;
      });
      summary[p.id] = { 
        models: cached.models, 
        freeModels, 
        total: cached.total, 
        freeCount: freeModels.length,
        fetchedAt: cached.fetchedAt, 
        source: cached.source 
      };
    } else {
      summary[p.id] = { models: null, freeModels: null, total: 0, freeCount: 0, fetchedAt: null, source: null };
    }
  }
  res.json({ providers: summary, cacheTime: Date.now() });
});

// ─── POST refresh models (specific provider or all) ───
app.post('/api/refresh-models', async (req, res) => {
  const { providerId, key } = req.body;
  if (providerId) {
    const p = PROVIDERS.find(x => x.id === providerId);
    if (!p) return res.status(404).json({ error: 'Unknown provider' });
    const result = await fetchModelsForProvider(p, key || '');
    if (result.ok) {
      modelCache[p.id].source = 'manual';
    }
    return res.json(result);
  }
  // Refresh all
  const results = await Promise.allSettled(
    PROVIDERS.map(async (p) => {
      const result = await fetchModelsForProvider(p, key || '');
      if (result.ok) modelCache[p.id].source = 'manual';
      return { id: p.id, ...result };
    })
  );
  res.json({ results: results.map(r => r.value) });
});

// ─── GET live model list from a provider (server-side proxy → no CORS) ───
app.get('/api/models', async (req, res) => {
  const { url, key, format = 'openai' } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: 'Missing url' });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const base = norm(url);
    let endpoint;
    const headers = {};

    if (format === 'gemini') {
      endpoint = `${base}models?key=${encodeURIComponent(key || '')}&pageSize=1000`;
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

    const r = await fetch(endpoint, { headers, signal: controller.signal });
    clearTimeout(timeout);
    const text = await r.text();

    if (!r.ok) {
      return res.json({ ok: false, status: r.status, error: text.slice(0, 300) });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.json({ ok: false, error: 'Provider did not return JSON' });
    }

    let models = [];
    if (format === 'gemini') {
      models = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => ({
          id: (m.name || '').replace('models/', ''),
          name: m.displayName || m.name,
          pricing: null,
        }));
    } else {
      models = (data.data || []).map((m) => ({
        id: m.id,
        name: m.display_name || m.name || m.id,
        pricing: m.pricing || null,
        created: m.created || null,
      }));
    }

    // Also cache the result, matched by URL
    const matchedProvider = PROVIDERS.find(p => norm(p.baseUrl) === base);
    if (matchedProvider) {
      modelCache[matchedProvider.id] = {
        models,
        fetchedAt: Date.now(),
        total: models.length,
        source: 'proxy',
      };
    }

    res.json({ ok: true, count: models.length, models });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─── GET test connection to a provider ───
// When format=anthropic this simulates exactly what Claude Code does with
// settings.json: POST {ANTHROPIC_BASE_URL}/v1/messages with the key from
// apiKeyHelper (x-api-key) or ANTHROPIC_AUTH_TOKEN (Authorization: Bearer).
app.get('/api/test', async (req, res) => {
  const { url, key, format = 'anthropic', model, auth = 'x-api-key' } = req.query;
  if (!url || !key) return res.status(400).json({ error: 'Missing url or key' });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const base = norm(url);
    let endpoint, headers, body;

    if (format === 'openai') {
      endpoint = `${base}chat/completions`;
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
      body = JSON.stringify({
        model: model || 'gpt-4o-mini',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      });
    } else if (format === 'gemini') {
      endpoint = `${base}models/${model || 'gemini-2.0-flash'}:generateContent?key=${encodeURIComponent(key)}`;
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] });
    } else {
      const msgPath = base.endsWith('/v1/') ? 'messages' : 'v1/messages';
      endpoint = `${base}${msgPath}`;
      headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      };
      // Send both auth styles: gateways like TokenRouter require `Authorization:
      // Bearer`, while others expect `x-api-key`.
      if (key) {
        headers['x-api-key'] = key;
        headers['Authorization'] = `Bearer ${key}`;
      }
      body = JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      });
    }

    const response = await fetch(endpoint, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.text();
    res.json({ status: response.status, body: data });
  } catch (err) {
    res.json({ status: 0, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  Start server & fetch models
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('');
  console.log('  ⚡ Nexference — AI Coding Gateway Switcher');
  console.log(`  → http://localhost:${PORT}`);
  console.log('');
  console.log(`  📁 Config path: ${SETTINGS_PATH}`);
  console.log('');

  // Fetch models in background — don't block the server
  fetchAllModels('startup');
});
