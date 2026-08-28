// Dynamic Provider routes (v1.8.0).
//   GET  /api/dynamic-providers
//   GET  /api/dynamic-providers/:id
//   POST /api/dynamic-providers/:id/refresh-metadata
//   POST /api/dynamic-providers/:id/discover-models
//   POST /api/dynamic-providers/:id/test          (key from client; never stored)
//   POST /api/dynamic-providers/:id/deactivate
//   POST /api/dynamic-providers/:id/reactivate
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
} from '../providers/dynamic/dynamicProviderService.js';
import { recordTest } from '../config/credentialsStore.js';

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

  router.delete('/dynamic-providers/:id', (req, res) => {
    const p = getDynamicProvider(req.params.id);
    if (!p) return res.status(404).json({ error: 'Unknown dynamic provider' });
    // Curated providers can never reach this route (they are not dynamic records).
    const ok = removeDynamicProviderRecord(req.params.id);
    res.json({ ok, removed: ok });
  });

  app.use('/api', router);
}
