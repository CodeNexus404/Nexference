// ═══════════════════════════════════════════════════════════════
//  Execution Routes (v0.9.0)
//
//  Clean API surface for the Unified Playground. No secrets are ever
//  returned. Validation runs before execution; streaming is delivered
//  over SSE via GET /api/executions/:id/stream.
// ═══════════════════════════════════════════════════════════════

import {
  createExecution, compareExecutions, getExecution, listExecutions,
  streamExecution, cancelExecution, getCapabilities,
} from '../execution/executionService.js';
import { validateExecution } from '../execution/executionValidation.js';

const EXEC_TIMEOUT_MS = 180_000;

export function registerExecutionRoutes(app) {
  // Pre-flight validation (no execution performed).
  app.post('/api/executions/validate', async (req, res) => {
    try {
      const validation = await validateExecution(req.body || {});
      res.json({ validation });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Create + start an execution. Returns immediately with an id; the client
  // streams events from GET /api/executions/:id/stream.
  app.post('/api/executions', async (req, res) => {
    const body = req.body || {};
    if (!body.source || (body.source !== 'cloud' && body.source !== 'local')) {
      return res.status(400).json({ error: 'source must be "cloud" or "local"' });
    }
    if (body.source === 'cloud' && !body.providerId) return res.status(400).json({ error: 'providerId required for cloud execution' });
    if (body.source === 'local' && !body.runtimeId) return res.status(400).json({ error: 'runtimeId required for local execution' });
    try {
      const result = await createExecution({ ...body, execTimeoutMs: EXEC_TIMEOUT_MS });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // History list (no content bodies, no secrets).
  app.get('/api/executions', (req, res) => {
    res.json({ executions: listExecutions() });
  });

  // Honest support matrix.
  app.get('/api/executions/capabilities', (req, res) => {
    res.json(getCapabilities());
  });

  // Compare several models sequentially.
  app.post('/api/executions/compare', async (req, res) => {
    try {
      const result = await compareExecutions(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Single execution record.
  app.get('/api/executions/:id', (req, res) => {
    const ex = getExecution(req.params.id);
    if (!ex) return res.status(404).json({ error: 'Unknown execution' });
    res.json(ex);
  });

  // SSE stream of normalized events.
  app.get('/api/executions/:id/stream', (req, res) => {
    streamExecution(req.params.id, req, res);
  });

  // Cancel a running execution.
  app.post('/api/executions/:id/cancel', (req, res) => {
    res.json(cancelExecution(req.params.id));
  });
}
