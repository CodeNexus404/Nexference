// Benchmarks API (v1.5.0) — provider benchmark catalogue + run + results.
// Secret-free: results contain only timing/reachability/outcome, never keys.

import { listProfiles } from '../benchmarks/benchmarkProfiles.js';
import { listResults, getSummary } from '../benchmarks/benchmarkStore.js';
import { benchmarkService } from '../benchmarks/benchmarkService.js';
import { getProvider } from '../providers/registry.js';

export function registerBenchmarkRoutes(app) {
  // Available benchmark profiles (catalogue).
  app.get('/api/benchmarks/profiles', (req, res) => {
    try {
      res.json({ profiles: listProfiles() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // List benchmark results (optionally filtered by provider).
  app.get('/api/benchmarks', (req, res) => {
    try {
      const { providerId, limit } = req.query;
      const results = listResults({ providerId: providerId || null, limit: limit ? parseInt(limit, 10) : 50 });
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Aggregate summary.
  app.get('/api/benchmarks/summary', (req, res) => {
    try {
      res.json(getSummary());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Run a benchmark for a provider + profile (manual only).
  app.post('/api/benchmarks/run', async (req, res) => {
    try {
      const { providerId, profileId } = req.body || {};
      if (!providerId || !getProvider(providerId)) return res.status(400).json({ error: 'Valid providerId required' });
      if (!profileId) return res.status(400).json({ error: 'profileId required' });
      const result = await benchmarkService.runBenchmark(providerId, profileId);
      res.json({ result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
