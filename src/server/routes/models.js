import { norm } from '../utils/index.js';
import { PROVIDERS } from '../providers/registry.js';
import { modelCache } from '../providers/modelCache.js';
import { fetchModelsForProvider } from '../providers/modelService.js';

// Model routes — cached summary, manual refresh, and a live proxy fetch.
// Logic (including the free-model filter) preserved verbatim from server.js.

function isFreeModel(p, m) {
  if (m.paid) return false;
  if (p.id === 'openrouter') {
    return m.id?.endsWith(':free') || (m.pricing && parseFloat(m.pricing.prompt || 0) === 0 && parseFloat(m.pricing.completion || 0) === 0);
  }
  if (['nvidia', 'huggingface', 'chutes', 'orcarouter'].includes(p.id)) {
    return !/embed|rerank|reranker|ocr|parse|nemoretriever|asr|tts|whisper|canary|parakeet|riva|magpie|conformer|megatron-1b-nmt|voicechat|studio.?voice|noise|guard|safety|jailbreak|content.?safety|gliner|topic-control|vista|molmim|genmol|diffdock|rfdiffusion|proteinmpnn|esm|alphafold|openfold|boltz|evo2|fourcastnet|cosmos|flux|stable-diffusion|sdxl|qwen-image|paligemma|trellis|bge|paddleocr|yolox|page-elements|table-structure|graphic-elements|eyecontact|lipsync|speaker|streampetr|bevformer|sparsedrive|cuopt|fastpitch|relight|synthetic-video|diffusiongemma/i.test(m.id || '');
  }
  return true;
}

export function registerModelRoutes(app) {
  // ─── GET cached models (server pre-fetched on startup) ───
  app.get('/api/cached-models', (req, res) => {
    const summary = {};
    for (const p of PROVIDERS) {
      const cached = modelCache[p.id];
      if (cached && cached.models) {
        const freeModels = cached.models.filter(m => isFreeModel(p, m));
        summary[p.id] = {
          models: cached.models,
          freeModels,
          total: cached.total,
          freeCount: freeModels.length,
          fetchedAt: cached.fetchedAt,
          source: cached.source,
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
}
