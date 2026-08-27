// Provider Monitor API (v1.5.0) — manual monitoring refresh + insights.
// Secret-free: only returns recorded/sanitised monitoring data.

import { providerMonitorService } from '../providers/providerMonitorService.js';
import { providerInsightService } from '../providers/providerInsightService.js';
import { PROVIDERS } from '../providers/registry.js';

export function registerProviderMonitorRoutes(app) {
  // Trigger a manual monitoring refresh (all providers, or one by id).
  app.post('/api/provider-monitor/refresh', async (req, res) => {
    try {
      const body = req.body || {};
      const { summary, results } = await providerMonitorService.refreshMonitoring({
        force: !!body.force,
        providerId: body.providerId || null,
      });
      res.json({ summary, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Insight payload for a single provider (history + metrics + changes).
  app.get('/api/provider-monitor/insight/:providerId', (req, res) => {
    try {
      const insight = providerInsightService.getProviderInsight(req.params.providerId);
      if (!insight.intelligence) return res.status(404).json({ error: 'Unknown provider' });
      res.json(insight);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Insights for all discoverable providers (compact).
  app.get('/api/provider-monitor/insights', (req, res) => {
    try {
      const ids = PROVIDERS.filter((p) => p.id !== 'custom').map((p) => p.id);
      const insights = ids.map((id) => {
        const i = providerInsightService.getProviderInsight(id);
        return {
          providerId: id,
          reliability: i.reliability,
          latestSnapshot: i.latestSnapshot,
          changeCount: i.recentChanges.length,
          recommendations: i.recommendations,
        };
      });
      res.json({ providers: insights });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
