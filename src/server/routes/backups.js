import { listBackups, readBackup, restoreBackup, deleteBackup } from '../config/backupStore.js';
import { BACKUP_DIR } from '../config/settingsStore.js';
import { recordActivity } from '../activity/activityService.js';

// ═══════════════════════════════════════════════════════════════
//  Backup routes — list, inspect, restore (safe), and delete Nexference-owned
//  backups. Restoration backs up the current config first, so it is reversible.
// ═══════════════════════════════════════════════════════════════

export function registerBackupRoutes(app) {
  // ─── GET list backups ───
  app.get('/api/backups', (req, res) => {
    try {
      res.json({ backups: listBackups(), dir: BACKUP_DIR });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET a single backup's content (for "View") ───
  app.get('/api/backups/:id/content', (req, res) => {
    try {
      const cfg = readBackup(req.params.id);
      if (!cfg) return res.status(404).json({ error: 'backup not found' });
      res.json({ id: req.params.id, config: cfg });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST restore a backup (creates a safety backup of the live config first) ───
    app.post('/api/backups/:id/restore', (req, res) => {
    try {
      const result = restoreBackup(req.params.id);
      recordActivity('backup', 'restore', 'success', `Backup ${req.params.id} restored`, { backupId: req.params.id });
      res.json(result);
    } catch (err) {
      recordActivity('backup', 'restore', 'error', `Backup restore failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── DELETE a backup ───
  app.delete('/api/backups/:id', (req, res) => {
    try {
      const ok = deleteBackup(req.params.id);
      if (!ok) return res.status(404).json({ error: 'backup not found' });
      recordActivity('backup', 'delete', 'info', `Backup ${req.params.id} deleted`, { backupId: req.params.id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
