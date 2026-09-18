// Dynamic Provider routes (v1.8.0).
//   GET  /api/dynamic-providers
//   GET  /api/dynamic-providers/:id
//   POST /api/dynamic-providers/:id/refresh-metadata
//   POST /api/dynamic-providers/:id/discover-models
//   POST /api/dynamic-providers/:id/test          (key from client; never stored)
//   POST /api/dynamic-providers/:id/deactivate
//   POST /api/dynamic-providers/:id/reactivate
//   GET  /api/dynamic-providers/:id/stored-models (normalized from modelSupport)
//   GET  /api/dynamic-providers/:id/fetch-models   (re-import discovery list)
//   PATCH /api/dynamic-providers/:id               (edit name/website/baseUrl/format)
//   DELETE /api/dynamic-providers/:id
//
// The unified catalogue lives at GET /api/providers (see routes/providers.js).
import { Router } from 'express';
import {
  loadDynamicProviders, getDynamicProvider, removeDynamicProvider,
} from '../providers/dynamic/dynamicProviderStore.js';
import {
  deactivateDynamicProvider, reactivateDynamicProvider, removeDynamicProviderRecord,
  refreshDynamicMetadata, discoverDynamicModels, testDynamicConnection,
  updateDynamicProvider,
} from '../providers/dynamic/dynamicProviderService.js';
import { recordTest } from '../config/credentialsStore.js';

// Normalize a stored modelSupport entry into the {id,name,…} shape the custom
// provider modal / model picker expects. Pricing is preserved when discovery
// reported it (e.g. OpenRouter/HF/LiteLLM), so the free/paid toggle and the
// per-model "free" badge can classify models instead of asserting nothing.
function toModelList(rec) {
  return (rec?.modelSupport?.models || []).map((m) => ({
    id: m.modelId || m.id || m.name,
    name: m.name || m.modelId || 'unknown',
    source: m.source || 'ecosystem',
    accessType: m.accessType || 'unknown',
    availability: m.availability || 'unknown',
    pricing: m.pricing || null,
    contextLength: m.contextLength || null,
  }));
}

export function registerDynamicProviderRoutes(app) {
  const router = Router();

  router.get('/dynamic-providers', (req, res) => {
    const list = loadDynamicProviders().providers.filter((p) => p.status !== 'removed');
    res.json({ providers: list, count: list.length });
  });

  router.get('/dynamic-providers/:id', (req, res) => {
    const p = getDynamicProvider(req.params.id);
    if (!p || p.status === 'removed') return res.status(404).json({ error: 'Unknown dynamic provider' });
    res.json({ provider: p });
  });

  const withProvider = (fn) => async (req, res) => {
    try {
      const p = getDynamicProvider(req.params.id);
      if (!p || p.status === 'removed') return res.status(404).json({ error: 'Unknown dynamic provider' });
      const out = await fn(req.params.id, req.body || {});
      res.json({ ok: true, provider: getDynamicProvider(req.params.id), ...(out && typeof out === 'object' ? out : {}) });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  };

  router.post('/dynamic-providers/:id/refresh-metadata', withProvider((id) => refreshDynamicMetadata(id)));
  router.post('/dynamic-providers/:id/discover-models', withProvider((id) => discoverDynamicModels(id)));
  router.post('/dynamic-providers/:id/deactivate', withProvider((id) => deactivateDynamicProvider(id)));
  router.post('/dynamic-providers/:id/reactivate', withProvider((id) => reactivateDynamicProvider(id)));

  router.post('/dynamic-providers/:id/test', async (req, res) => {
    const p = getDynamicProvider(req.params.id);
    if (!p || p.status === 'removed') return res.status(404).json({ error: 'Unknown dynamic provider' });
    const { key, model, baseUrl } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing key' });
    try {
      const result = await testDynamicConnection(p.id, { key, model, baseUrl });
      // Persist ONLY the non-sensitive outcome.
      recordTest(p.id, { status: result.status, model: model || null });
      if (result.error) return res.status(400).json({ ok: false, error: result.error, message: result.message, result });
      res.json({ ok: true, tested: result.tested, status: result.status, provider: getDynamicProvider(p.id) });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // Stored model list — the authoritative modelSupport persisted on the record
  // (probing + fetched by discovery imports). Mirrors custom-provider stored-models.
  router.get('/dynamic-providers/:id/stored-models', (req, res) => {
    const p = getDynamicProvider(req.params.id);
    if (!p || p.status === 'removed') return res.status(404).json({ error: 'Unknown dynamic provider' });
    const models = toModelList(p);
    res.json({ ok: true, models, count: models.length, source: 'ecosystem' });
  });

  // Refresh models — re-import the ecosystem discovery list, then return the
  // normalized result. The transient `key` is accepted for API parity with the
  // custom-provider endpoint but is never read or stored (discovery imports only).
  router.get('/dynamic-providers/:id/fetch-models', async (req, res) => {
    const p = getDynamicProvider(req.params.id);
    if (!p || p.status === 'removed') return res.status(404).json({ error: 'Unknown dynamic provider' });
    try {
      const imported = await discoverDynamicModels(p.id);
      const models = toModelList(getDynamicProvider(p.id));
      res.json({ ok: true, count: models.length, models, source: 'ecosystem', imported: imported.imported || 0 });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // Edit an adopted provider (name/website/description/baseUrl/format) — the
  // dynamic counterpart of PATCH /api/custom-providers/:id.
  router.patch('/dynamic-providers/:id', async (req, res) => {
    const p = getDynamicProvider(req.params.id);
    if (!p || p.status === 'removed') return res.status(404).json({ error: 'Unknown dynamic provider' });
    try {
      const rec = updateDynamicProvider(p.id, req.body || {});
      res.json({ ok: true, provider: rec });
    } catch (e) {
      const msg = String(e?.message || e);
      const status = msg.includes('baseUrl must be') ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.delete('/dynamic-providers/:id', (req, res) => {
    const p = getDynamicProvider(req.params.id);
    if (!p) return res.status(404).json({ error: 'Unknown dynamic provider' });
    // Curated providers can never reach this route (they are not dynamic records).
    const ok = removeDynamicProviderRecord(req.params.id);
    res.json({ ok, removed: ok });
  });

  app.use('/api', router);
}
