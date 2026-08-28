// Intelligence Center routes (v1.6.0)
//   GET  /api/intelligence?period=7d&workspaceProvider=<id>
//   POST /api/intelligence/refresh   (manual, with in-flight guard)
import { Router } from 'express';
import { getIntelligence } from '../intelligence/intelligenceService.js';
import { providerMonitorService } from '../providers/providerMonitorService.js';
import { recordActivity } from '../activity/activityService.js';
import { parsePeriod } from '../intelligence/confidence.js';

let refreshing = false;
let lastRefreshAt = null;

export function registerIntelligenceRoutes(app) {
  const router = Router();

  router.get('/intelligence', async (req, res) => {
    try {
      const period = parsePeriod(req.query.period || '7d');
      const workspaceProvider = req.query.workspaceProvider || null;
      const data = await getIntelligence({ period, workspaceProviderId: workspaceProvider });
      res.json(data);
    } catch (e) {
      console.error('[intelligence] GET failed', e);
      res.status(500).json({ error: 'intelligence_failed', message: String(e?.message || e) });
    }
  });

  router.post('/intelligence/refresh', async (req, res) => {
    if (refreshing) {
      return res.status(429).json({ error: 'already_refreshing', message: 'A refresh is already in progress.', startedAt: lastRefreshAt });
    }
    refreshing = true;
    lastRefreshAt = new Date().toISOString();
    try {
      recordActivity('profile', 'intelligence_refresh_started', 'success', 'Intelligence Center refresh started', {});
      const summary = await providerMonitorService.refreshMonitoring({ force: false });
      recordActivity('profile', 'intelligence_refresh_completed', 'success', 'Intelligence Center refresh completed', { summary });
      res.json({ ok: true, startedAt: lastRefreshAt, completedAt: new Date().toISOString(), summary });
    } catch (e) {
      recordActivity('profile', 'intelligence_refresh_failed', 'error', 'Intelligence Center refresh failed', { error: String(e?.message || e) });
      console.error('[intelligence] refresh failed', e);
      res.status(500).json({ error: 'refresh_failed', message: String(e?.message || e) });
    } finally {
      refreshing = false;
    }
  });

  app.use('/api', router);
}
