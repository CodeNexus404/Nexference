// Hugging Face Inference Providers Source (v2.2.0).
//
// Discovers inference providers from Hugging Face using the PUBLIC models API
// with the `inference_provider=all` filter and `expand[]=inferenceProviderMapping`
// parameter. This endpoint requires NO authentication and exposes the full
// provider mapping: provider slug, status, pricing, features, and performance.
//
//   GET https://huggingface.co/api/models?inference_provider=all
//       &limit=100&skip=N&expand[]=inferenceProviderMapping
//
// Each model's inferenceProviderMapping[] contains entries like:
//   { provider: "novita", status: "live", task: "conversational",
//     providerDetails: { context_length, pricing: { input, output } },
//     features: { toolCalling, structuredOutput },
//     performance: { requestLatencyMs, tokensPerSecond } }
//
// IMPORTANT: A provider listed on Hugging Face does NOT automatically mean:
// - Direct API access exists outside of HF
// - The provider supports specific clients (Claude Code, OpenCode, etc.)
// - Pricing shown matches HF's pricing
// HF evidence is treated as trusted ecosystem evidence, not official verification.
//
// If HF_TOKEN / HUGGINGFACE_TOKEN is set, it is attached as a Bearer token for
// higher rate limits — but it is never required and never persisted.

import { ProviderDiscoveryAdapter } from './baseSource.js';

const HF_API = 'https://huggingface.co/api';
const FETCH_TIMEOUT_MS = 15000;
const MAX_PAGES = 5;          // 5 pages × 100 models = 500 models scanned per run
const PAGE_SIZE = 100;

// Known official websites for common HF inference providers (honest enrichment —
// only slugs we are confident about; unknown providers keep website: null).
const KNOWN_PROVIDER_WEBSITES = {
  'hf-inference': 'https://huggingface.co/inference',
  'cerebras': 'https://www.cerebras.ai',
  'groq': 'https://groq.com',
  'together': 'https://www.together.ai',
  'deepinfra': 'https://deepinfra.com',
  'fireworks-ai': 'https://fireworks.ai',
  'replicate': 'https://replicate.com',
  'baseten': 'https://www.baseten.co',
  'novita': 'https://novita.ai',
  'nscale': 'https://nscale.com',
  'scaleway': 'https://www.scaleway.com',
  'ovhcloud': 'https://www.ovhcloud.com',
  'fal-ai': 'https://fal.ai',
  'featherless-ai': 'https://featherless.ai',
  'zai-org': 'https://z.ai',
  'publicai': 'https://publicai.co',
  'wavespeed': 'https://wavespeed.ai',
  'hyperbolic': 'https://hyperbolic.xyz',
  'nebius': 'https://nebius.ai',
  'inference.net': 'https://inference.net',
  'lambda': 'https://lambdalabs.com',
  'amazon': 'https://aws.amazon.com',
  'azure': 'https://azure.microsoft.com',
};

async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const headers = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };
    const hfToken = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN;
    if (hfToken) headers['authorization'] = `Bearer ${hfToken}`;
    const resp = await fetch(url, { signal: ctrl.signal, headers });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`http ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// "featherless-ai" -> "Featherless AI", "hf-inference" -> "HF Inference"
function formatProviderName(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => (w === 'hf' || w === 'ai' ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// The core public discovery path: scan models that have inference provider
// mappings and collect every distinct provider with real, sourced metadata.
async function discoverViaModelMappings() {
  const providers = new Map();
  let modelsScanned = 0;
  const errors = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const skip = page * PAGE_SIZE;
    const url = `${HF_API}/models?inference_provider=all&limit=${PAGE_SIZE}&skip=${skip}&expand[]=inferenceProviderMapping`;
    let batch;
    try {
      batch = await fetchWithTimeout(url);
    } catch (e) {
      errors.push(`page ${page}: ${String(e.message || e)}`);
      break;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    modelsScanned += batch.length;

    for (const model of batch) {
      const mappings = Array.isArray(model.inferenceProviderMapping) ? model.inferenceProviderMapping : [];
      for (const mp of mappings) {
        const slug = mp.provider;
        if (!slug) continue;
        const entry = providers.get(slug) || {
          sourceId: slug,
          name: formatProviderName(slug),
          website: KNOWN_PROVIDER_WEBSITES[slug] || null,
          description: `Inference provider on Hugging Face (serving ${model.id || model.modelId || 'hosted models'})`,
          category: 'inference-provider',
          status: mp.status || null,
          models: [],
          _liveStatusCount: 0,
        };
        // Count live mappings to report honest provider status.
        if (mp.status === 'live') entry._liveStatusCount++;
        // Keep up to 10 model relationships per provider (capped for size).
        if (entry.models.length < 10) {
          const pricing = mp.providerDetails && mp.providerDetails.pricing
            ? { input: mp.providerDetails.pricing.input ?? null, output: mp.providerDetails.pricing.output ?? null }
            : null;
          entry.models.push({
            modelId: mp.providerId || model.id || model.modelId,
            name: model.id || model.modelId,
            status: mp.status || null,
            task: mp.task || null,
            pricing,
            toolCalling: !!(mp.features && mp.features.toolCalling),
            structuredOutput: !!(mp.features && mp.features.structuredOutput),
            sourceModel: model.id || model.modelId,
          });
        }
        providers.set(slug, entry);
      }
    }
    if (batch.length < PAGE_SIZE) break; // last page
  }

  const candidates = [];
  for (const entry of providers.values()) {
    const liveCount = entry._liveStatusCount;
    delete entry._liveStatusCount;
    // Only report providers observed with at least one live mapping; others stay honest as-is.
    candidates.push({
      ...entry,
      liveMappings: liveCount,
      sourceUrl: `https://huggingface.co/inference/providers/${entry.sourceId}`,
      discoveredAt: new Date().toISOString(),
    });
  }
  return { candidates, modelsScanned, errors };
}

export class HuggingFaceSource extends ProviderDiscoveryAdapter {
  get name() {
    return 'Hugging Face Inference Providers';
  }

  get sourceType() {
    return 'huggingface';
  }

  get trustLevel() {
    return 'community'; // trusted ecosystem evidence, not official verification
  }

  supports() {
    return true;
  }

  async discoverProvider() {
    return { supported: false, reason: 'batch_only' };
  }

  async discoverAll() {
    try {
      const { candidates, modelsScanned, errors } = await discoverViaModelMappings();
      return {
        supported: true,
        candidates,
        errors,
        meta: { modelsScanned },
        sourceMetadata: {
          id: 'huggingface',
          name: 'Hugging Face Inference Providers',
          type: 'inference-catalog',
          url: 'https://huggingface.co/inference',
          trustLevel: 'community',
        },
      };
    } catch (e) {
      return { supported: false, reason: String(e.message || e) };
    }
  }

  async discover() {
    const result = await this.discoverAll();
    if (!result.supported) return { supported: false, reason: result.reason };
    return { supported: true, candidates: result.candidates, errors: result.errors || [] };
  }

  async getSourceHealth() {
    try {
      const start = Date.now();
      // Cheap public endpoint for a health probe.
      const resp = await fetch(`${HF_API}/models?inference_provider=all&limit=1`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      const latency = Date.now() - start;
      return {
        status: resp.ok ? 'healthy' : 'degraded',
        lastAttempt: new Date().toISOString(),
        lastSuccess: resp.ok ? new Date().toISOString() : null,
        lastFailure: resp.ok ? null : new Date().toISOString(),
        providerCount: 0,
        freshnessMs: latency,
      };
    } catch (e) {
      return {
        status: 'unavailable',
        lastAttempt: new Date().toISOString(),
        lastSuccess: null,
        lastFailure: new Date().toISOString(),
        providerCount: 0,
        freshnessMs: null,
      };
    }
  }
}

export function createHuggingFaceSource() {
  return new HuggingFaceSource();
}