import { CLIENTS, getClient, getClientCapabilities, detectClient } from '../clients/registry.js';
import { getClientAdapter } from '../clients/clientAdapter.js';

// Exposes the AI client catalogue + capability matrix + status to the frontend.
export function registerClientRoutes(app) {
  app.get('/api/clients', (req, res) => {
    res.json(CLIENTS);
  });

  app.get('/api/clients/:id', (req, res) => {
    const c = getClient(req.params.id);
    if (!c) return res.status(404).json({ error: 'client not found' });
    res.json(c);
  });

  // Capability matrix (autoConfigure / supportsCloudProviders / …) — drives the UI.
  app.get('/api/clients/:id/capabilities', (req, res) => {
    const caps = getClientCapabilities(req.params.id);
    if (!caps) return res.status(404).json({ error: 'client not found' });
    res.json(caps);
  });

  // Best-effort detection (no secrets).
  app.get('/api/clients/:id/status', async (req, res) => {
    const c = getClient(req.params.id);
    if (!c) return res.status(404).json({ error: 'client not found' });
    const adapter = getClientAdapter(req.params.id);
    const detection = adapter ? await adapter.detect() : detectClient(req.params.id);
    const configured = !!c.capabilities?.autoConfigure;
    res.json({
      id: c.id,
      name: c.name,
      support: c.support,
      level: c.level,
      capabilities: c.capabilities,
      configPath: c.configPath,
      detected: detection.detected,
      detectionNote: detection.note,
      autoConfigure: configured,
    });
  });
}
