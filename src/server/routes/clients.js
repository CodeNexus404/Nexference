import { CLIENTS } from '../clients/registry.js';

// Exposes the AI client catalogue to the frontend and any external tooling.
export function registerClientRoutes(app) {
  app.get('/api/clients', (req, res) => {
    res.json(CLIENTS);
  });
  app.get('/api/clients/:id', (req, res) => {
    const c = CLIENTS.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'client not found' });
    res.json(c);
  });
}
