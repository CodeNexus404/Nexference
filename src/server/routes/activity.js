import { listActivities } from '../activity/activityService.js';

// Activity feed route (v1.0.0). Server-side, secret-free event log.
export function registerActivityRoutes(app) {
  app.get('/api/activity', (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
      res.json({ activities: listActivities(limit) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
