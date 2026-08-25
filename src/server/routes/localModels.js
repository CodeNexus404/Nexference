import { buildRecommendations, downloadLocalModel, deleteLocalModel } from '../local/modelCatalog.js';

// Local model recommendation + management routes (v1.4.0).
export function registerLocalModelRoutes(app) {
  // Device-aware recommended local models with star ratings + installed state.
  app.get('/api/local/models/recommendations', async (req, res) => {
    try {
      const data = await buildRecommendations();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Download (pull) a model onto the device, or return the provider URL.
  app.post('/api/local/models/:runtime/:name/download', async (req, res) => {
    try {
      const { runtime, name } = req.params;
      const result = await downloadLocalModel(runtime, name);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a model from the device.
  app.post('/api/local/models/:runtime/:name/delete', async (req, res) => {
    try {
      const { runtime, name } = req.params;
      const result = await deleteLocalModel(runtime, name);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
