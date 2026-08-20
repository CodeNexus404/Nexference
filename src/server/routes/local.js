import { detectRuntimes } from '../local/runtimes.js';

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
}
