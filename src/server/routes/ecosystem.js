// Ecosystem Discovery API (v1.7.0).
//   GET  /api/ecosystem/sources
//   GET  /api/ecosystem/providers
//   GET  /api/ecosystem/providers/:id
//   POST /api/ecosystem/discover            (manual, in-flight guarded, timeout)
//   POST /api/ecosystem/sources/:id/refresh (manual)
//   POST /api/ecosystem/providers/:id/validate
//   POST /api/ecosystem/providers/:id/adopt
//   POST /api/ecosystem/providers/:id/ignore
//   POST /api/ecosystem/providers/:id/restore
//   GET  /api/ecosystem/summary
//   GET  /api/ecosystem/logo?url=...        (safe, validated image proxy)
import { Router } from 'express';
import {
  getSources, discoverEcosystem, listEcosystemProviders, getEcosystemProvider,
  validateProvider, adoptProvider, ignoreProvider, restoreProvider, markForReview, getEcosystemSummary,
} from '../providers/ecosystem/ecosystemDiscoveryService.js';
import { proxyLogo, validateLogoUrl } from '../providers/ecosystem/logoResolver.js';

const DISCOVER_TIMEOUT_MS = 60000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('discover_timeout')), ms)),
  ]);
}

export function registerEcosystemRoutes(app) {
  const router = Router();

  router.get('/ecosystem/sources', (req, res) => {
    try { res.json({ sources: getSources() }); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  router.get('/ecosystem/providers', (req, res) => {
    try {
      const q = req.query;
      const list = listEcosystemProviders({
        registryState: q.registryState || undefined,
        category: q.category || undefined,
        search: q.search || undefined,
        missing: q.missing === 'true' ? true : undefined,
      });
      res.json({ providers: list, count: list.length });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  router.get('/ecosystem/providers/:id', (req, res) => {
    try {
      const p = getEcosystemProvider(req.params.id);
      if (!p) return res.status(404).json({ error: 'Unknown ecosystem provider' });
      res.json({ provider: p });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  router.post('/ecosystem/discover', async (req, res) => {
    try {
      const result = await withTimeout(discoverEcosystem({ force: req.body?.force !== false }), DISCOVER_TIMEOUT_MS);
      if (result && result.ok === false && result.error === 'already_running') {
        return res.status(429).json({ error: 'already_running', message: 'A discovery run is already in progress.' });
      }
      res.json(result);
    } catch (e) {
      res.status(504).json({ error: 'discover_failed', message: String(e.message || e) });
    }
  });

  router.post('/ecosystem/sources/:id/refresh', async (req, res) => {
    // Sources are few and the store is shared; a source refresh runs a full
    // discovery pass (other enabled sources simply re-report their candidates).
    try {
      const sources = getSources();
      const src = sources.find((s) => s.id === req.params.id);
      if (!src) return res.status(404).json({ error: 'Unknown source' });
      const result = await withTimeout(discoverEcosystem({ force: true }), DISCOVER_TIMEOUT_MS);
      res.json(result);
    } catch (e) { res.status(504).json({ error: 'refresh_failed', message: String(e.message || e) }); }
  });

  const providerAction = (fn) => async (req, res) => {
    try {
      const p = getEcosystemProvider(req.params.id);
      if (!p) return res.status(404).json({ error: 'Unknown ecosystem provider' });
      const rec = fn(req.params.id);
      res.json({ ok: true, provider: rec });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  };

  router.post('/ecosystem/providers/:id/validate', async (req, res) => {
    try {
      const rec = await validateProvider(req.params.id);
      if (!rec) return res.status(404).json({ error: 'Unknown ecosystem provider' });
      res.json({ ok: true, provider: rec });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  router.post('/ecosystem/providers/:id/adopt', providerAction(adoptProvider));
  router.post('/ecosystem/providers/:id/ignore', providerAction(ignoreProvider));
  router.post('/ecosystem/providers/:id/restore', providerAction(restoreProvider));
  router.post('/ecosystem/providers/:id/review', providerAction(markForReview));

  router.get('/ecosystem/summary', (req, res) => {
    try { res.json(getEcosystemSummary()); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // Safe logo proxy — validates the URL (https only, no private hosts) and proxies
  // a small, image-typed response. Never reflects redirects to unsafe destinations.
  router.get('/ecosystem/logo', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'missing url' });
    if (!validateLogoUrl(url).ok) return res.status(400).json({ error: 'invalid logo url' });
    const r = await proxyLogo(url);
    if (!r.ok) return res.status(r.status).json({ error: r.reason });
    res.setHeader('Content-Type', r.contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(r.buffer);
  });

  app.use('/api', router);
}
