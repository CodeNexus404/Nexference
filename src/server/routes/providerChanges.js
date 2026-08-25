// Provider Change API (v1.4.0) — exposes the discovery change store.
// Secret-free by construction.

import { listChanges, getChangeSummary } from '../providers/providerChangeStore.js';
import { getProvider } from '../providers/registry.js';

export function registerProviderChangesRoutes(app) {
  // List changes, optionally filtered by provider / type / since.
  app.get('/api/provider-changes', (req, res) => {
    try {
      const { provider, type, since, limit } = req.query;
      const changes = listChanges({
        provider: provider || undefined,
        type: type || undefined,
        since: since || undefined,
        limit: limit ? parseInt(limit, 10) : 100,
      });
      res.json({ changes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Aggregate summary (counts by type / provider, recently-unavailable).
  app.get('/api/provider-changes/summary', (req, res) => {
    try {
      const summary = getChangeSummary();
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Changes for a single provider.
  app.get('/api/provider-changes/:providerId', (req, res) => {
    const id = req.params.providerId;
    if (!getProvider(id)) return res.status(404).json({ error: 'Unknown provider' });
    const changes = listChanges({ provider: id, limit: 50 });
    res.json({ providerId: id, changes });
  });
}
