// Provider Intelligence API (v1.4.0) — exposes the discovery service.
// All responses are secret-free by construction (the service never touches keys).

import { providerDiscoveryService } from '../providers/providerDiscoveryService.js';
import { getProvider } from '../providers/registry.js';

export function registerProviderIntelligenceRoutes(app) {
  // All providers' intelligence + an aggregate summary.
  app.get('/api/provider-intelligence', (req, res) => {
    try {
      const providers = providerDiscoveryService.getAllProviderIntelligence();
      const summary = providerDiscoveryService.getDiscoverySummary();
      res.json({ providers, summary });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // One provider's intelligence. Works for curated AND user-created custom
  // (cst:*) providers — the service resolves custom ids from their store.
  app.get('/api/provider-intelligence/:id', (req, res) => {
    const id = req.params.id;
    const rec = providerDiscoveryService.getProviderIntelligence(id);
    if (!rec) return res.status(404).json({ error: 'No intelligence for provider' });
    const changes = providerDiscoveryService.getChangesForProvider(id, 20);
    res.json({ provider: rec, changes });
  });

  // Manual refresh — on demand only, never auto. Refreshes one provider or all.
  app.post('/api/provider-intelligence/refresh', async (req, res) => {
    try {
      const body = req.body || {};
      let summary;
      if (body.providerId && getProvider(body.providerId)) {
        const r = await providerDiscoveryService.discoverProvider(getProvider(body.providerId), { force: true });
        summary = { checked: 1, updated: r.changes ? r.changes.length : 0, unchanged: r.skipped ? 1 : 0, failed: 0, providers: r.record ? [{ id: r.record.id, discoveryStatus: r.record.status.discoveryStatus, availability: r.record.status.availability, modelCount: r.record.models.total, changeCount: r.changes ? r.changes.length : 0 }] : [] };
      } else {
        summary = await providerDiscoveryService.discoverAllProviders({ force: true });
      }
      const providers = providerDiscoveryService.getAllProviderIntelligence();
      res.json({ ok: true, summary, providers });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
