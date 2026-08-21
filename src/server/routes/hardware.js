import { getHardwareProfileDetailed, getHardwareCapabilities } from '../environment/hardwareService.js';

// Hardware capability endpoint — normalized profile + conservative, honest
// recommendations (memory/estimate based; never fakes GPU/VRAM).
export function registerHardwareRoutes(app) {
  app.get('/api/hardware/capabilities', async (req, res) => {
    try {
      const profile = await getHardwareProfileDetailed();
      res.json({ profile, capabilities: getHardwareCapabilities(profile) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
