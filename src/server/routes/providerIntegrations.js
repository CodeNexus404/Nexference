// Provider Integration & Adapter Framework API (v1.9.0).
//   GET  /api/provider-integrations
//   GET  /api/provider-integrations/coverage
//   GET  /api/provider-integrations/:providerId
//   GET  /api/provider-integrations/:providerId/capabilities
//   POST /api/provider-integrations/assess
//   POST /api/provider-integrations/:providerId/assess
//   POST /api/provider-integrations/:providerId/test
//   POST /api/provider-integrations/:providerId/models
//
// Manual assessment only — no background polling. Connection tests and model
// listing accept credentials transiently and never persist them.
import { Router } from 'express';
import {
  listProviderIntegrations, getProviderIntegration, getIntegrationCapabilities,
  assessProviderIntegration, testProviderIntegration, listProviderModels, getIntegrationCoverage,
} from '../providers/integrations/providerIntegrationService.js';
import { INTEGRATION_STATUS, ADAPTER_TYPE } from '../providers/integrations/integrationTypes.js';

export function registerProviderIntegrationRoutes(app) {
  const router = Router();

  router.get('/provider-integrations', (req, res) => {
    try {
      const all = listProviderIntegrations();
      res.json({ integrations: Object.values(all), count: Object.keys(all).length });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  router.get('/provider-integrations/coverage', (req, res) => {
    try { res.json(getIntegrationCoverage()); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  router.get('/provider-integrations/:providerId', (req, res) => {
    try {
      const rec = getProviderIntegration(req.params.providerId);
      if (!rec) return res.status(404).json({ error: 'Unknown provider' });
      res.json({ integration: rec });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  router.get('/provider-integrations/:providerId/capabilities', (req, res) => {
    try {
      const caps = getIntegrationCapabilities(req.params.providerId);
      if (!caps || caps.supported === false) return res.status(404).json({ error: 'Unknown provider' });
      res.json(caps);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  const doAssess = (providerId, body) => {
    if (!providerId) return { status: 400, json: { error: 'missing providerId' } };
    const out = assessProviderIntegration(providerId, { evidence: body && body.evidence ? body.evidence : [] });
    if (!out.success) return { status: 400, json: out };
    return { status: 200, json: { ok: true, integration: out.integration } };
  };

  router.post('/provider-integrations/assess', (req, res) => {
    const r = doAssess(req.body && req.body.providerId, req.body);
    res.status(r.status).json(r.json);
  });

  router.post('/provider-integrations/:providerId/assess', (req, res) => {
    const r = doAssess(req.params.providerId, req.body);
    res.status(r.status).json(r.json);
  });

  router.post('/provider-integrations/:providerId/test', async (req, res) => {
    try {
      const { key, baseUrl, model } = req.body || {};
      if (!key) return res.status(400).json({ supported: false, reason: 'API key required for connection test (not stored).' });
      const result = await testProviderIntegration(req.params.providerId, { key, baseUrl, model });
      res.json(result);
    } catch (e) { res.status(500).json({ supported: false, reason: String(e.message || e) }); }
  });

  router.post('/provider-integrations/:providerId/models', async (req, res) => {
    try {
      const { key, baseUrl, model } = req.body || {};
      if (!key) return res.status(400).json({ supported: false, reason: 'API key required for model listing (not stored).' });
      const result = await listProviderModels(req.params.providerId, { key, baseUrl, model });
      res.json(result);
    } catch (e) { res.status(500).json({ supported: false, reason: String(e.message || e) }); }
  });

  app.use('/api', router);
}

// Re-export the vocab so other modules can reference the canonical enums.
export { INTEGRATION_STATUS, ADAPTER_TYPE };
