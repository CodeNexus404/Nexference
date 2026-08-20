import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { readSettings, writeSettings, openFolder, SETTINGS_PATH, BACKUP_DIR } from '../config/settingsStore.js';

// Config routes — GET/POST ~/.claude/settings.json and open-folder.
// Behaviour preserved exactly from the original handlers.

export function registerConfigRoutes(app) {
  // ─── GET current settings.json ───
  app.get('/api/config', (req, res) => {
    try {
      const config = readSettings();
      res.json({ config, path: SETTINGS_PATH });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST update settings.json ───
  app.post('/api/config', (req, res) => {
    try {
      const config = req.body?.config ?? req.body;
      if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Missing config' });

      const merged = writeSettings(config);
      res.json({ success: true, path: SETTINGS_PATH, config: merged });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET open the settings.json folder in the OS file manager ───
  app.get('/api/open-folder', (req, res) => {
    const result = openFolder();
    res.json(result);
  });

  // ─── GET list timestamped backups (read-only, for the Settings page) ───
  app.get('/api/backups', (req, res) => {
    try {
      if (!existsSync(BACKUP_DIR)) return res.json({ backups: [] });
      const files = readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('claude-settings-') && f.endsWith('.json'))
        .map((f) => {
          let mtime = '';
          try { mtime = statSync(join(BACKUP_DIR, f)).mtime.toISOString(); } catch { /* ignore */ }
          return { name: f, mtime };
        })
        .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
      res.json({ backups: files, dir: BACKUP_DIR });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
