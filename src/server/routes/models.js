import { norm } from '../utils/index.js';
import { PROVIDERS } from '../providers/registry.js';
import { modelCache } from '../providers/modelCache.js';
import { fetchModelsForProvider } from '../providers/modelService.js';
import { listCustomProviders } from '../providers/custom/customProviderStore.js';
import { loadDynamicProviders } from '../providers/dynamic/dynamicProviderStore.js';
import {
  getUnifiedModels, getModelDetails, getRecommendedModels, getModelStats,
  refreshProviderModels, refreshAllModels, isFreeModel,
} from '../models/modelIntelligenceService.js';
import { modelIsFree } from '../providers/modelClassifier.js';

// Model routes — three responsibilities, all read-through to the server-side
// model cache / discovery:
//   1. Legacy endpoints kept verbatim: /api/cached-models, /api/refresh-models,
//      and the /api/models?url=… live proxy (used for on-demand fetches).
//   2. v0.8.0 unified intelligence: GET /api/models (no `url`) returns a single
//      normalized catalogue across cloud + local models; plus /detail,
//      /recommended, /stats, and POST /models/refresh.
// Logic (including the free-model filter) preserved from the original server.js.

export function registerModelRoutes(app) {
  // Free/paid classification for stored model lists — shared server-side
  // classifier (see ../providers/modelClassifier.js): zero pricing (numeric or
  // string), accessType === 'free', or a free-tier name marker
  // (free/claude-opus-4.6, free:gpt-4o, free-gpt4, gpt-4o:free, "Free GPT-4")
  // for gateways like APInex / Inference Dahl that flag free models purely by
  // name convention. The curated per-provider heuristic stays with
  // isFreeModel() from modelIntelligenceService.

  // ─── GET cached models (server pre-fetched on startup) — legacy ───
  app.get('/api/cached-models', (req, res) => {
    const summary = {};
    for (const p of PROVIDERS) {
      const cached = modelCache[p.id];
      if (cached && cached.models) {
        const freeModels = cached.models.filter(m => isFreeModel(p.id, m));
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
    // Custom (cst:) providers — seed from the models persisted in each record's
    // modelSupport so the card badges stay consistent across page refreshes (no
    // "0 free" flash until a manual card refresh happens). The client merges
    // these under its (possibly fresher) client-side liveModels entries.
    for (const rec of listCustomProviders()) {
      const models = rec.modelSupport?.models || [];
      if (!models.length) continue;
      const freeModels = models.filter(modelIsFree);
      summary[rec.id] = {
        models,
        freeModels,
        total: models.length,
        freeCount: freeModels.length,
        fetchedAt: rec.modelSupport?.fetchedAt || rec.updatedAt || null,
        source: 'stored',
      };
    }
    // Adopted (dyn:) providers — seed from the modelSupport imported at
    // adoption/discovery so their cards render the model count on refresh (no
    // "0 free" flash) and the detail modal's picker opens populated. Pricing is
    // preserved when discovery knew it (OpenRouter/HF/LiteLLM), so free/paid is
    // classified like custom providers; unknown pricing simply stays uncounted.
    for (const rec of loadDynamicProviders().providers) {
      const source = rec.modelSupport?.models || [];
      if (!source.length) continue;
      const models = source.map(m => ({
        id: m.modelId || m.id || m.name,
        name: m.name || m.modelId || 'unknown',
        source: m.source || 'ecosystem',
        accessType: m.accessType || 'unknown',
        availability: m.availability || 'unknown',
        pricing: m.pricing || null,
        contextLength: m.contextLength || null,
      }));
      const freeModels = models.filter(modelIsFree);
      summary[rec.id] = {
        models,
        freeModels,
        total: models.length,
        freeCount: freeModels.length,
        fetchedAt: rec.modelSupport?.lastUpdated || rec.updatedAt || null,
        source: 'stored',
      };
    }
    res.json({ providers: summary, cacheTime: Date.now() });
  });

  // ─── POST refresh models (specific provider or all) — legacy ───
  app.post('/api/refresh-models', async (req, res) => {
    const { providerId, key } = req.body || {};
    if (providerId) {
      const p = PROVIDERS.find(x => x.id === providerId);
      if (!p) return res.status(404).json({ error: 'Unknown provider' });
      const result = await fetchModelsForProvider(p, key || '');
      if (result.ok) modelCache[p.id].source = 'manual';
      return res.json(result);
    }
    const results = await Promise.allSettled(
      PROVIDERS.map(async (p) => {
        const result = await fetchModelsForProvider(p, key || '');
        if (result.ok) modelCache[p.id].source = 'manual';
        return { id: p.id, ...result };
      })
    );
    res.json({ results: results.map(r => r.value) });
  });

  // ─── Unified model catalogue (v0.8.0) ───
  // GET /api/models                → all cloud + local, normalized
  // GET /api/models?type=cloud     → cloud only
  // GET /api/models?type=local     → local only
  // GET /api/models?provider=openrouter&free=1&q=gpt&capabilities=chat
  // GET /api/models?recommended=1  → workspace-aware recommendations
  // If `url` is present, this falls back to the legacy live proxy behaviour.
  app.get('/api/models', async (req, res) => {
    const { url } = req.query;
    if (url) return liveProxy(req, res);

    const opts = {
      type: req.query.type,
      provider: req.query.provider,
      q: req.query.q,
      free: req.query.free,
      source: req.query.source,
      access: req.query.access,
      availability: req.query.availability,
      lifecycle: req.query.lifecycle,
      capabilities: req.query.capabilities,
      recommended: req.query.recommended,
      context: { clientId: req.query.clientId, providerId: req.query.ctxProvider },
    };
    try {
      const records = await getUnifiedModels(opts);
      res.json({ total: records.length, models: records, generatedAt: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Single model detail (v0.8.0) ───
  app.get('/api/models/detail', async (req, res) => {
    const { provider, id } = req.query;
    if (!provider || !id) return res.status(400).json({ error: 'provider and id are required' });
    const detail = await getModelDetails(provider, id);
    if (!detail) return res.status(404).json({ error: 'Model not found in cache' });
    res.json(detail);
  });

  // ─── Recommended models (v0.8.0) ───
  app.get('/api/models/recommended', async (req, res) => {
    const ctx = { clientId: req.query.clientId, providerId: req.query.providerId };
    const recs = await getRecommendedModels(ctx);
    res.json({ total: recs.length, models: recs });
  });

  // ─── Aggregate stats (v0.8.0) ───
  app.get('/api/models/stats', async (req, res) => {
    res.json(await getModelStats());
  });

  // ─── Refresh the unified catalogue (v0.8.0) ───
  app.post('/api/models/refresh', async (req, res) => {
    const { providerId, key } = req.body || {};
    try {
      if (providerId) {
        const result = await refreshProviderModels(providerId, key || '');
        return res.json(result);
      }
      const results = await refreshAllModels();
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET live model list from a provider (server-side proxy → no CORS) ───
  async function liveProxy(req, res) {
    const { url, key, format = 'openai' } = req.query;
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
  }
}
