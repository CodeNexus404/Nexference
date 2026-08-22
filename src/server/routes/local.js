import { detectRuntimes, startRuntime } from '../local/runtimes.js';
import { benchmarkRuntime } from '../execution/executionService.js';
import { recordActivity } from '../activity/activityService.js';

// Local AI routes — report detected local runtimes. Detection of Ollama is
// real (HTTP probe); other runtimes are reported as planned (not faked).
export function registerLocalRoutes(app) {
  app.get('/api/local-runtimes', async (req, res) => {
    try {
      const runtimes = await detectRuntimes();
      res.json({ runtimes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Start a local runtime that is offline. Uses a safe, allowlisted command
  // per runtime — never arbitrary shell input.
  app.post('/api/local-runtimes/:id/start', (req, res) => {
    try {
      const result = startRuntime(req.params.id);
      if (result?.ok) {
        recordActivity('runtime', 'start', 'success', `${result.app || result.id} runtime start requested`, { runtimeId: req.params.id, app: result.app });
      } else if (result?.supported === false) {
        recordActivity('runtime', 'start', 'info', `Auto-start not supported for ${req.params.id}`);
      } else {
        recordActivity('runtime', 'start', 'warning', `Could not start ${req.params.id}: ${result?.message || 'unknown'}`, { runtimeId: req.params.id });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Benchmark a local model: runs a fixed prompt and returns honest metrics
  // (duration, time-to-first-token, tokens, speed). No secrets involved.
  app.post('/api/local-runtimes/:id/benchmark', async (req, res) => {
    try {
      const result = await benchmarkRuntime({ runtimeId: req.params.id, ...(req.body || {}) });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
