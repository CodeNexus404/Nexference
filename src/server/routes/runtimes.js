import {
  RUNTIMES,
} from '../local/runtimes.js';
import {
  getRuntimeCapabilities,
  getRuntimeStatus,
  listRuntimeModels,
  aggregateLocalModels,
} from '../runtimes/runtimeAdapter.js';

// Local runtime routes — detection, status, models, and aggregated discovery.
export function registerRuntimeRoutes(app) {
  app.get('/api/runtimes', async (req, res) => {
    try {
      const list = await Promise.all(RUNTIMES.map((r) => getRuntimeStatus(r.id)));
      res.json({ runtimes: list });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/runtimes/:id/status', async (req, res) => {
    try {
      const s = await getRuntimeStatus(req.params.id);
      if (!s) return res.status(404).json({ error: 'runtime not found' });
      res.json(s);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/runtimes/:id/models', async (req, res) => {
    try {
      const models = await listRuntimeModels(req.params.id);
      res.json({ id: req.params.id, models });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Unified local model discovery — every model retains its source runtime.
  app.get('/api/local-models', async (req, res) => {
    try {
      const models = await aggregateLocalModels();
      res.json({ models, count: models.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
