import { getHardwareProfileDetailed, getHardwareCapabilities, getDeviceInfo } from '../environment/hardwareService.js';

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

  // Live, re-probable snapshot of the host machine (CPU usage, memory, GPU, etc.).
  app.get('/api/hardware/device', async (req, res) => {
    try {
      const info = await getDeviceInfo();
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
