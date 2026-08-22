import { getWorkspaceHealth } from '../health/workspaceHealthService.js';

// Workspace Health route (v1.0.0).
export function registerHealthRoutes(app) {
  app.get('/api/health', async (req, res) => {
    try {
      res.json(await getWorkspaceHealth());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
