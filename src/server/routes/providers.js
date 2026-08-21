import { PROVIDERS } from '../providers/registry.js';
import { modelCache } from '../providers/modelCache.js';
import { getProviderAdapter } from '../providers/providerAdapter.js';
import { recordTest, getTest } from '../config/credentialsStore.js';

// ═══════════════════════════════∏═══════════════════════════════
//  Provider routes — independent connection testing and model listing per
//  provider. Test results persist lastTestedAt/lastTestStatus (NO secrets) so
//  the UI can show test history without re-probing or logging keys.
// ═══════════════════════════════════════════════════════════════

function isFreeModel(p, m) {
  if (m.paid) return false;
  if (p.id === 'openrouter') {
    return m.id?.endsWith(':free') || (m.pricing && parseFloat(m.pricing.prompt || 0) === 0 && parseFloat(m.pricing.completion || 0) === 0);
  }
  if (['nvidia', 'huggingface', 'chutes', 'orcarouter'].includes(p.id)) {
    return !/embed|rerank|reranker|ocr|parse|nemoretriever|asr|tts|whisper|canary|parakeet|riva|magpie|conformer|megatron-1b-nmt|voicechat|studio.?voice|noise|guard|safety|jailbreak|content.?safety|gliner|topic-control|vista|molmim|genmol|diffdock|rfdiffusion|proteinmpnn|esm|alphafold|openfold|boltz|evo2|fourcastnet|cosmos|flux|stable-diffusion|sdxl|qwen-image|paligemma|trellis|bge|paddleocr|yolox|page-elements|table-structure|graphic-elements|eyecontact|lipsync|speaker|streampetr|bevformer|sparsedrive|cuopt|fastpitch|relight|synthetic-video|diffusiongemma/i.test(m.id || '');
  }
  return true;
}

export function registerProviderRoutes(app) {
  // ─── GET cached models for a provider ───
  app.get('/api/providers/:id/models', (req, res) => {
    const p = PROVIDERS.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Unknown provider' });
    const cached = modelCache[p.id];
    if (cached && cached.models) {
      const freeModels = cached.models.filter((m) => isFreeModel(p, m));
      res.json({
        id: p.id,
        models: cached.models,
        freeModels,
        total: cached.total,
        freeCount: freeModels.length,
        fetchedAt: cached.fetchedAt,
        source: cached.source,
      });
    } else {
      res.json({ id: p.id, models: null, freeModels: null, total: 0, freeCount: 0, fetchedAt: null, source: null });
    }
  });

  // ─── GET last recorded test result (no secrets) ───
  app.get('/api/providers/:id/test', (req, res) => {
    const p = PROVIDERS.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Unknown provider' });
    res.json({ id: p.id, lastTest: getTest(p.id) });
  });

  // ─── POST test a provider connection (uses server-known base URL; key from client) ───
  app.post('/api/providers/:id/test', async (req, res) => {
    const p = PROVIDERS.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Unknown provider' });
    const { key, model } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing key' });

    // Format-specific auth header choice.
    const auth = p.format === 'anthropic' ? 'x-api-key' : 'bearer';
    try {
      const adapter = getProviderAdapter({ format: p.format });
      const result = await adapter.testConnection({ url: p.baseUrl, key, model, auth });
      // Persist ONLY non-sensitive outcome metadata.
      recordTest(p.id, { status: result.status, model: model || null });
      res.json({ id: p.id, ...result, lastTest: getTest(p.id) });
    } catch (err) {
      recordTest(p.id, { status: 0, model: model || null });
      res.json({ id: p.id, status: 0, error: err.message });
    }
  });
}
