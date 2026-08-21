import {
  createProfile,
  getProfiles,
  readProfile,
  updateProfileById,
  deleteProfileById,
  previewProfile,
  applyProfile,
} from '../profiles/profileService.js';

// Profile routes — CRUD + safe preview/apply. Profiles store references only
// (never API keys); apply still performs backup → atomic write → verify.
export function registerProfileRoutes(app) {
  app.get('/api/profiles', (req, res) => {
    res.json({ profiles: getProfiles() });
  });

  app.post('/api/profiles', (req, res) => {
    try {
      const p = createProfile(req.body || {});
      res.json(p);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/profiles/:id', (req, res) => {
    const p = readProfile(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json(p);
  });

  app.put('/api/profiles/:id', (req, res) => {
    try {
      const p = updateProfileById(req.params.id, req.body || {});
      if (!p) return res.status(404).json({ error: 'not found' });
      res.json(p);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/profiles/:id', (req, res) => {
    const ok = deleteProfileById(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ success: true });
  });

  // Compatibility preview of the stored selection (no config generation).
  app.post('/api/profiles/:id/preview', (req, res) => {
    const pre = previewProfile(req.params.id);
    if (pre.error) return res.status(404).json(pre);
    res.json(pre);
  });

  // Safe apply: expects a client-generated config; performs backup+write+verify.
  app.post('/api/profiles/:id/apply', (req, res) => {
    try {
      const result = applyProfile(req.params.id, req.body?.config);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
