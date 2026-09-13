import { readSettings, readSettingsRaw, writeSettings, openFolder, SETTINGS_PATH } from '../config/settingsStore.js';
import { getConfigStatus } from '../config/configService.js';
import { subscribe } from '../config/configWatcher.js';
import { diffConfigs } from '../config/configService.js';
import { checkCompatibility } from '../clients/compatibilityService.js';
import { recordActivity } from '../activity/activityService.js';
import { getClientAdapter } from '../clients/clientAdapter.js';

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
      // Guard: an empty payload would overwrite the live config with nothing.
      if (Object.keys(next).length === 0) {
        return res.status(400).json({ error: 'Empty config rejected — refusing to overwrite the live config' });
      }

      const result = writeSettings(next); // throws on backup/verify failure
      recordActivity('config', 'apply', 'success', 'Claude Code configuration applied', {
        path: SETTINGS_PATH, backupId: result.backupId,
      });
      res.json({ success: true, path: SETTINGS_PATH, config: result.merged, backupPath: result.backupPath, verified: true });
    } catch (err) {
      recordActivity('config', 'apply', 'error', `Configuration apply failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Keep the legacy alias used by LocalSettingsRuntime.write.
  app.post('/api/config', (req, res) => {
    try {
      const config = req.body?.config ?? req.body;
      if (!config || typeof config !== 'object' || Array.isArray(config)) return res.status(400).json({ error: 'Missing config' });
      if (Object.keys(config).length === 0) return res.status(400).json({ error: 'Empty config rejected — refusing to overwrite the live config' });
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

  // ═══════════════════════════════════════════════════════════════
  //  Client-specific config endpoints (OpenCode, Codex, …).
  //  Registered LAST so literal paths above (/status, /preview, /events)
  //  always win over the :clientId parameter. The Claude Code path is
  //  intentionally NOT routed here — /api/config + /api/config/apply remain
  //  its exclusive domain (see protected-engine note).
  // ═══════════════════════════════════════════════════════════════

  // ─── GET a client's current config ───
  app.get('/api/config/:clientId', (req, res) => {
    try {
      const adapter = getClientAdapter(req.params.clientId);
      if (!adapter) return res.status(404).json({ error: `No config adapter for client '${req.params.clientId}'` });
      const cfg = adapter.readConfig();
      res.json({ config: cfg, path: adapter.getConfigLocation ? adapter.getConfigLocation() : null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET a client's config status (exists/valid/model/provider) ───
  app.get('/api/config/:clientId/status', (req, res) => {
    try {
      const adapter = getClientAdapter(req.params.clientId);
      if (!adapter) return res.status(404).json({ error: `No config adapter for client '${req.params.clientId}'` });
      // Adapters expose a status() when available; fall back to a live read.
      if (adapter.status) return res.json(adapter.status());
      const cfg = adapter.readConfig();
      res.json({ exists: cfg != null, valid: cfg != null && typeof cfg === 'object', config: cfg });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST preview a diff against a client's live config ───
  app.post('/api/config/:clientId/preview', (req, res) => {
    try {
      const adapter = getClientAdapter(req.params.clientId);
      if (!adapter) return res.status(404).json({ error: `No config adapter for client '${req.params.clientId}'` });
      const next = req.body?.next ?? req.body?.config;
      if (!next || typeof next !== 'object') return res.status(400).json({ error: 'Missing next config' });
      const current = adapter.readConfig();
      res.json({ diff: diffConfigs(current, next) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST apply a client's config (atomic + backup + verified) ───
  app.post('/api/config/:clientId', (req, res) => {
    try {
      const { clientId } = req.params;
      const adapter = getClientAdapter(clientId);
      if (!adapter) return res.status(404).json({ error: `No config adapter for client '${clientId}'` });
      const config = req.body?.config ?? req.body;
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return res.status(400).json({ error: 'Invalid config shape' });
      }
      const valid = adapter.validateConfig ? adapter.validateConfig(config) : { valid: true };
      if (!valid.valid) return res.status(400).json({ error: valid.error || 'Invalid config' });

      const result = adapter.applyConfig(config); // throws on backup/verify failure
      recordActivity('config', 'apply', 'success', `${clientId} configuration applied`, {
        path: adapter.getConfigLocation ? adapter.getConfigLocation() : null,
      });
      res.json({
        success: true,
        path: adapter.getConfigLocation ? adapter.getConfigLocation() : null,
        config: result?.merged ?? config,
        backupPath: result?.backupPath ?? null,
        verified: true,
      });
    } catch (err) {
      recordActivity('config', 'apply', 'error', `Apply failed for ${req.params.clientId}: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });
}
