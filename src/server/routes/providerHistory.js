// Provider History API (v1.5.0) — monitoring snapshots + per-provider summary.
// Secret-free: snapshots contain only coarse, recorded state.

import { getProviderSnapshots, getRecentSnapshots, getProviderSummary, getLatest } from '../providers/providerHistoryStore.js';
import { getReliability } from '../providers/providerMetricsStore.js';
import { listChanges, getChangeSummary } from '../providers/providerChangeStore.js';
import { getProvider } from '../providers/registry.js';

export function registerProviderHistoryRoutes(app) {
  // Global history index: one entry per provider with its latest snapshot.
  app.get('/api/provider-history', (req, res) => {
    try {
      const { limit } = req.query;
      const recent = getRecentSnapshots({ limit: limit ? parseInt(limit, 10) : 100 });
      // Build per-provider index from the most recent snapshot per provider.
      const index = {};
      for (const s of recent) {
        if (!index[s.providerId]) {
          index[s.providerId] = { providerId: s.providerId, latest: s, total: 1 };
        } else {
          index[s.providerId].total++;
        }
      }
      const providers = Object.values(index);
      res.json({ providers, total: providers.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Snapshots for a single provider (timeline).
  app.get('/api/provider-history/:providerId', (req, res) => {
    const id = req.params.providerId;
    if (!getProvider(id)) return res.status(404).json({ error: 'Unknown provider' });
    try {
      const { limit } = req.query;
      const snapshots = getProviderSnapshots(id, { limit: limit ? parseInt(limit, 10) : 50 });
      res.json({ providerId: id, snapshots });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Summary for a single provider (history + reliability + recent changes).
  app.get('/api/provider-history/:providerId/summary', (req, res) => {
    const id = req.params.providerId;
    if (!getProvider(id)) return res.status(404).json({ error: 'Unknown provider' });
    try {
      const summary = getProviderSummary(id);
      const reliability = getReliability(id);
      const recentChanges = listChanges({ provider: id, limit: 15 });
      res.json({ providerId: id, summary, reliability, recentChanges, changeSummary: getChangeSummary({ provider: id }) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
