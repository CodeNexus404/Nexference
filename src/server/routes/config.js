import { readSettings, readSettingsRaw, writeSettings, openFolder, SETTINGS_PATH } from '../config/settingsStore.js';
import { getConfigStatus } from '../config/configService.js';
import { subscribe } from '../config/configWatcher.js';
import { diffConfigs } from '../config/configService.js';
import { checkCompatibility } from '../clients/compatibilityService.js';

// ═══════════════════════════════════════════════════════════════
//  Config routes — read / status / preview / apply / open-folder / live events.
//  Apply uses the atomic+verified write in settingsStore. No secrets are logged.
// ═══════════════════════════════════════════════════════════════

export function registerConfigRoutes(app) {
  // ─── GET current settings.json ───
  app.get('/api/config', (req, res) => {
    try {
      const config = readSettings();
      res.json({ config, path: SETTINGS_PATH, raw: readSettingsRaw() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET aggregated configuration status (file + external change + backups + tests) ───
  app.get('/api/config/status', (req, res) => {
    try {
      res.json(getConfigStatus());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST preview a diff between the live config and a proposed config ───
  app.post('/api/config/preview', (req, res) => {
    try {
      const next = req.body?.next ?? req.body?.config;
      if (!next || typeof next !== 'object') return res.status(400).json({ error: 'Missing next config' });
      const current = readSettings();
      res.json({ diff: diffConfigs(current, next) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST evaluate a proposed workspace selection (client + provider/runtime) ───
  app.post('/api/config/compatibility', (req, res) => {
    try {
      const { clientId, providerId, runtimeId, model } = req.body || {};
      if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
      res.json(checkCompatibility({ clientId, providerId: providerId || null, runtimeId: runtimeId || null, model: model || null }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST apply a configuration (atomic write + backup + verify) ───
  // This is the safe-apply entry point. The frontend generates the config via
  // the PROTECTED client-format logic, then hands it here for durable storage.
  // Claude Code output format is guarded by the frontend engine and is not
  // reinterpreted here.
  app.post('/api/config/apply', (req, res) => {
    try {
      const next = req.body?.config ?? req.body;
      if (!next || typeof next !== 'object') return res.status(400).json({ error: 'Missing config' });

      // Reject obviously malformed payloads before touching disk.
      if (typeof next !== 'object' || Array.isArray(next)) {
        return res.status(400).json({ error: 'Invalid config shape' });
      }

      const result = writeSettings(next); // throws on backup/verify failure
      res.json({ success: true, path: SETTINGS_PATH, config: result.merged, backupPath: result.backupPath, verified: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Keep the legacy alias used by LocalSettingsRuntime.write.
  app.post('/api/config', (req, res) => {
    try {
      const config = req.body?.config ?? req.body;
      if (!config || typeof config !== 'object' || Array.isArray(config)) return res.status(400).json({ error: 'Missing config' });
      const result = writeSettings(config);
      res.json({ success: true, path: SETTINGS_PATH, config: result.merged, backupPath: result.backupPath, verified: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET open the settings.json folder in the OS file manager ───
  app.get('/api/open-folder', (req, res) => {
    const result = openFolder();
    res.json(result);
  });

  // ─── SSE: live external-change events ───
  app.get('/api/config/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (change) => { try { res.write(`data: ${JSON.stringify(change)}\n\n`); } catch { /* ignore */ } };
    const unsub = subscribe(send);
    req.on('close', unsub);
  });
}
