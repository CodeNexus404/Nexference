import { getEnvironment, refreshEnvironment } from '../environment/environmentService.js';

// Unified environment state — a single secret-free payload describing the
// user's machine: detected clients, runtimes, models, hardware, configuration,
// and a derived health summary. The frontend no longer needs to fan out to many
// endpoints just to understand its basic environment.
export function registerEnvironmentRoutes(app) {
  app.get('/api/environment', async (req, res) => {
    try {
      res.json(await getEnvironment());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/environment/refresh', async (req, res) => {
    try {
      res.json(await refreshEnvironment());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
