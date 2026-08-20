import { getProviderAdapter } from '../providers/providerAdapter.js';

// Test-connection route. Delegates the dialect-specific probe to the matching
// Provider Adapter. Behaviour (status + raw body contract, auth handling) is
// preserved exactly from the original /api/test handler.

export function registerTestRoutes(app) {
  app.get('/api/test', async (req, res) => {
    const { url, key, format = 'anthropic', model, auth = 'x-api-key' } = req.query;
    if (!url || !key) return res.status(400).json({ error: 'Missing url or key' });

    try {
      const adapter = getProviderAdapter({ format });
      const result = await adapter.testConnection({ url, key, model, auth });
      res.json(result);
    } catch (err) {
      res.json({ status: 0, error: err.message });
    }
  });
}
