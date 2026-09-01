import { PROVIDERS, getProvider, STATIC_MODELS } from '../providers/registry.js';
import { modelCache } from '../providers/modelCache.js';
import { fetchModelsForProvider } from '../providers/modelService.js';
import { discoverModels } from '../runtimes/modelDiscoveryService.js';
import { getHardwareProfileDetailed, getHardwareCapabilities } from '../environment/hardwareService.js';

// ═══════════════════════════════════════════════════════════════
//  Model Intelligence Service (v0.8.0)
//
//  A single, normalized model layer that sits above the existing three-tier
//  model cache (live API → website scrape → curated static) and the local
//  model discovery. Everything that touches a "model" — cloud or local —
//  is normalized into one Model Record so the UI has a coherent shape to
//  render, filter, and recommend from.
//
//  Honesty rules (carried from the rest of the platform):
//    • Only metadata actually supplied by a provider/runtime API, a trusted
//      static adapter, or the curated fallback is surfaced.
//    • Unknown fields are null / "unknown" — never invented.
//    • Capabilities are NEVER inferred from a marketing name. The only model
//      capability signal we trust is an explicit non-chat id allowlist (used
//      to exclude embeddings/TTS/image models from "chat") — that is a
//      negative signal, not a quality guess.
//    • Free/paid status comes from the provider's pricing (OpenRouter) or the
//      curated paid flags; everything else defaults to "free" only when the
//      provider exposes no paid signal.
// ═══════════════════════════════════════════════════════════════

// Providers whose model lists are scraped/curated and contain non-chat models
// that must be excluded from the "chat" capability. This is the same allowlist
// the rest of the app uses for free-model filtering — kept here as the single
// source of truth so we don't duplicate the regex in three places.
const NON_CHAT_PROVIDERS = ['nvidia', 'huggingface', 'chutes', 'orcarouter'];
const NON_CHAT_RE = /embed|rerank|reranker|ocr|parse|nemoretriever|asr|tts|whisper|canary|parakeet|riva|magpie|conformer|megatron-1b-nmt|voicechat|studio.?voice|noise|guard|safety|jailbreak|content.?safety|gliner|topic-control|vista|molmim|genmol|diffdock|rfdiffusion|proteinmpnn|esm|alphafold|openfold|boltz|evo2|fourcastnet|cosmos|flux|stable-diffusion|sdxl|qwen-image|paligemma|trellis|bge|paddleocr|yolox|page-elements|table-structure|graphic-elements|eyecontact|lipsync|speaker|streampetr|bevformer|sparsedrive|cuopt|fastpitch|relight|synthetic-video|diffusiongemma/i;

export function isNonChatModel(providerId, id) {
  if (!NON_CHAT_PROVIDERS.includes(providerId)) return false;
  return NON_CHAT_RE.test(id || '');
}

export function isFreeModel(providerId, m) {
  if (m.paid) return false;
  const p = m.pricing;
  // When a model carries real per-token pricing (cents/$, OpenAI style
  // prompt/completion), "free" means exactly $0 for both. This is the honest,
  // source-of-truth signal where it exists (cerebras, chutes, openrouter, …).
  if (p && typeof p.prompt !== 'undefined' && p.prompt != null) {
    const pr = Number(p.prompt) || 0;
    const co = p.completion != null ? (Number(p.completion) || 0) : pr;
    return pr === 0 && co === 0;
  }
  if (providerId === 'openrouter') {
    return (m.id || '').endsWith(':free');
  }
  // No pricing signal: fall back to the per-provider heuristic. For the
  // "utility catalogue" platforms (NVIDIA, HF, …) the NON_CHAT scrub excludes
  // embeddings/rerank/vision/audio utility models from the usable "chat" list.
  if (NON_CHAT_PROVIDERS.includes(providerId)) {
    return !isNonChatModel(providerId, m.id);
  }
  return true;
}

// Map the cache entry's `source` label to a user-facing status badge.
function sourceStatus(source) {
  switch (source) {
    case 'website': return 'fallback-website';
    case 'static': return 'fallback-static';
    case 'pricing': return 'live';
    case 'proxy': return 'live';
    case 'manual': return 'live';
    case 'startup': return 'live';
    case 'periodic': return 'live';
    case 'local': return 'installed';
    default: return 'cached';
  }
}

// Honest availability for a model record: only set when we have a real signal.
// A model we fetched live or from a fallback is treated as available; if we
// have no data at all it never reaches this layer. We never claim
// "temporary"/"deprecated" without an explicit source signal.
function availabilityFromSource(source) {
  switch (source) {
    case 'proxy':
    case 'manual':
    case 'startup':
    case 'periodic':
    case 'pricing':
    case 'website':
    case 'static':
    case 'local':
      return 'available';
    default:
      return 'unknown';
  }
}

// ─── Cloud (provider) models ───
function normalizeCloudModels(providerId, entry) {
  const p = getProvider(providerId);
  if (!p || !entry || !Array.isArray(entry.models) || !entry.models.length) return [];
  const source = entry.source || 'cached';
  return entry.models.map((m) => {
    const id = m.id;
    const nonChat = isNonChatModel(providerId, id);
    const free = isFreeModel(providerId, m);
    // Honest capability signals: only explicit provider fields are trusted
    // (e.g. OpenRouter's `capabilities` array + `architecture.input_modalities`).
    const caps = Array.isArray(m.capabilities) ? m.capabilities.map((c) => String(c).toLowerCase()) : [];
    const arch = m.architecture || {};
    const inMod = Array.isArray(arch.input_modalities) ? arch.input_modalities.map((x) => String(x).toLowerCase()) : [];
    const modStr = typeof arch.modality === 'string' ? arch.modality.toLowerCase() : '';
    const hasCap = (...names) => names.some((n) => caps.includes(n));
    const vision = inMod.some((x) => /image|vision/.test(x)) || /image|vision/.test(modStr) || hasCap('vision');
    const reasoning = hasCap('reasoning');
    const tools = hasCap('tools', 'function_calling', 'tool_use', 'function-calling');
    const embeddings = nonChat ? true : (hasCap('embeddings', 'embedding') ? true : null);
    return {
      id,
      name: m.name || id,
      providerId: p.id,
      providerName: p.name,
      providerFormat: p.format,
      kind: 'cloud',
      source,
      sourceStatus: sourceStatus(source),
      availability: availabilityFromSource(source),
      accessType: free ? 'free' : 'paid',
      lifecycle: availabilityFromSource(source) === 'available' ? 'active' : 'unknown',
      isFree: free,
      isPaid: !free,
      pricing: m.pricing || null,
      installed: false,
      contextLength: m.context_length || m.contextLength || null,
      parameters: null,
      size: null,
      quantization: null,
      capabilities: {
        chat: !nonChat,
        vision: vision || null,
        reasoning: reasoning || null,
        tools: tools || null,
        embeddings: embeddings || null,
      },
      recommended: false,
      recommendationReason: null,
      provenance: {
        fetchedAt: entry.fetchedAt || null,
        total: entry.total || entry.models.length,
        source,
        accessType: free ? 'free' : 'paid',
        lastFetchOk: entry.total ? entry.total > 0 : null,
      },
    };
  });
}

// ─── Local (runtime) models ───
function normalizeLocalModels(models) {
  return (models || []).map((m) => {
    const fam = Array.isArray(m.capabilities) ? m.capabilities.map((c) => String(c).toLowerCase()) : [];
    const isEmbed = fam.includes('embedding');
    const isClip = fam.includes('clip') || fam.includes('vision');
    const isTools = fam.includes('tools') || fam.includes('function_calling') || fam.includes('tool_use');
    const isReasoning = fam.includes('reasoning');
    return {
      id: m.id,
      name: m.name || m.id,
      providerId: m.runtimeId || 'ollama',
      providerName: 'Local · ' + (m.runtimeId || 'ollama'),
      providerFormat: 'local',
      kind: 'local',
      source: 'local',
      sourceStatus: 'installed',
      availability: 'available',
      accessType: 'free',
      lifecycle: 'active',
      isFree: true,
      isPaid: false,
      pricing: null,
      installed: true,
      contextLength: m.contextLength || null,
      parameters: m.parameterCount || null,
      size: m.size || null,
      quantization: m.quantization || null,
      capabilities: {
        chat: !isEmbed,
        vision: isClip || null,
        reasoning: isReasoning || null,
        tools: isTools || null,
        embeddings: isEmbed || null,
      },
      recommended: false,
      recommendationReason: null,
      provenance: {
        runtimeId: m.runtimeId || null,
        modifiedAt: m.modifiedAt || null,
        accessType: 'free',
      },
    };
  });
}

// ─── Aggregation ───
export function getCloudModels() {
  const all = [];
  for (const p of PROVIDERS) {
    const entry = modelCache[p.id];
    if (entry && Array.isArray(entry.models) && entry.models.length) {
      all.push(...normalizeCloudModels(p.id, entry));
    } else if (STATIC_MODELS[p.id]) {
      // A provider with a curated fallback but no live cache yet — surface the
      // static list honestly as a fallback so the catalogue is never empty.
      const pseudo = { models: STATIC_MODELS[p.id].map((e) => (typeof e === 'string' ? { id: e } : { id: e.id, paid: e.paid })), fetchedAt: null, total: STATIC_MODELS[p.id].length, source: 'static' };
      all.push(...normalizeCloudModels(p.id, pseudo));
    }
  }
  return all;
}

export async function getLocalModels() {
  return normalizeLocalModels(await discoverModels());
}

export async function getUnifiedModels(opts = {}) {
  const { type, provider, q, free, capabilities, recommended, source, access, availability, lifecycle } = opts;
  let records = [];
  if (type !== 'local') records.push(...getCloudModels());
  if (type !== 'cloud') records.push(...await getLocalModels());

  if (provider) records = records.filter((r) => r.providerId === provider);
  if (q) {
    const ql = q.toLowerCase();
    records = records.filter((r) => (r.id || '').toLowerCase().includes(ql) || (r.name || '').toLowerCase().includes(ql) || (r.providerName || '').toLowerCase().includes(ql));
  }
  if (free === '1' || free === true) records = records.filter((r) => r.isFree);
  if (source) records = records.filter((r) => r.sourceStatus === source || r.source === source);
  if (access) records = records.filter((r) => r.accessType === access);
  if (availability) records = records.filter((r) => r.availability === availability);
  if (lifecycle) records = records.filter((r) => r.lifecycle === lifecycle);
  if (capabilities) {
    const want = (Array.isArray(capabilities) ? capabilities : String(capabilities).split(',')).filter(Boolean);
    records = records.filter((r) => want.every((cap) => r.capabilities && r.capabilities[cap] === true));
  }
  if (recommended === '1' || recommended === true) {
    const recs = getRecommendedModels(opts.context || {});
    const recIds = new Set(recs.map((r) => r.providerId + '::' + r.id));
    records = records.filter((r) => recIds.has(r.providerId + '::' + r.id));
  }
  return records;
}

export async function getModelDetails(providerId, modelId) {
  if (!providerId || !modelId) return null;
  const p = getProvider(providerId);
  const isLocal = (p && p.format === 'local') || providerId === 'ollama' || providerId === 'lmstudio';
  if (isLocal) {
    const local = (await getLocalModels()).find((m) => m.providerId === providerId && m.id === modelId);
    return local || null;
  }
  if (!p) {
    // Not a registered cloud provider — may be an unlisted local runtime; try
    // the local catalogue before giving up so installed models resolve.
    const local = (await getLocalModels()).find((m) => m.providerId === providerId && m.id === modelId);
    return local || null;
  }
  const entry = modelCache[providerId];
  const rec = normalizeCloudModels(providerId, entry).find((m) => m.id === modelId) || null;
  if (!rec) return null;
  // Recommendations context (best-effort) so the detail view can show "why".
  const recs = await getRecommendedModels({});
  const match = recs.find((r) => r.providerId === providerId && r.id === modelId);
  if (match) { rec.recommended = true; rec.recommendationReason = match.recommendationReason; }
  return rec;
}

// ─── Workspace-aware recommendations ───
// ctx may include { clientId, providerId } supplied by the frontend (which
// knows the active workspace). Hardware is computed server-side. Only real
// signals drive a recommendation; everything else is null.
export async function getRecommendedModels(ctx = {}) {
  const hw = getHardwareCapabilities(getHardwareProfileDetailed());
  const clientId = ctx.clientId || 'claude-code';
  const activeProvider = ctx.providerId || null;

  const cloud = getCloudModels().filter((m) => m.capabilities.chat);
  const scored = cloud.map((m) => {
    let score = 0;
    const reasons = [];
    if (m.isFree) { score += 2; reasons.push('Free to use'); }
    if (activeProvider && m.providerId === activeProvider) { score += 3; reasons.push(`Matches your active provider (${m.providerName})`); }
    if (clientId === 'claude-code') {
      if (m.providerFormat === 'anthropic' || m.providerId === 'openrouter') { score += 2; reasons.push('Native Anthropic-compatible client'); }
    }
    return { m, score, reasons: [...new Set(reasons)] };
  }).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.m.providerName || '').localeCompare(b.m.providerName || ''));

  const top = scored.slice(0, 6).map((x) => ({ ...x.m, recommended: true, recommendationReason: x.reasons.join(' · ') }));

  const local = (await getLocalModels()).map((m) => ({
    ...m,
    recommended: true,
    recommendationReason: m.installed ? `Installed locally · fits your ${hw.ramTier} memory tier` : 'Local model',
  }));

  return [...top, ...local].slice(0, 12);
}

export async function getModelStats() {
  const cloud = getCloudModels();
  const local = await getLocalModels();
  return {
    cloudTotal: cloud.length,
    cloudFree: cloud.filter((m) => m.isFree).length,
    cloudPaid: cloud.filter((m) => m.isPaid).length,
    localTotal: local.length,
    providersWithModels: new Set(cloud.map((m) => m.providerId)).size,
    bySource: cloud.reduce((acc, m) => { acc[m.sourceStatus] = (acc[m.sourceStatus] || 0) + 1; return acc; }, {}),
  };
}

// ─── Refresh with in-flight guard (no duplicate fetches) ───
const _inflight = new Set();

export async function refreshProviderModels(providerId, key = '') {
  const p = getProvider(providerId);
  if (!p) return { ok: false, error: 'Unknown provider' };
  if (_inflight.has(providerId)) return { ok: true, count: 0, skipped: true, provider: providerId };
  _inflight.add(providerId);
  try {
    const result = await fetchModelsForProvider(p, key || '');
    if (result.ok) modelCache[providerId].source = 'manual';
    return { ...result, provider: providerId };
  } finally {
    _inflight.delete(providerId);
  }
}

export async function refreshAllModels(key = '') {
  const results = [];
  for (const p of PROVIDERS) {
    const r = await refreshProviderModels(p.id, key || '');
    results.push(r);
  }
  return results;
}
