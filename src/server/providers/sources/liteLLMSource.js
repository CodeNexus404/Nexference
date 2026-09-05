// LiteLLM Provider/Model Catalog Source (v2.2.0).
//
// Discovers provider and model metadata from the LiteLLM project's public catalog.
// LiteLLM maintains an extensive catalog of providers and their model mappings,
// including endpoint compatibility, pricing, and aliases.
//
// IMPORTANT: LiteLLM metadata must NOT be treated as proof that a provider is
// currently operational. It is a community-maintained catalog with varying
// freshness. Store provenance clearly.
//
// Fields collected when available:
// - provider identities and aliases
// - model/provider mappings
// - endpoint compatibility metadata (when explicitly documented)
// - pricing metadata (when explicitly available)
// - provider aliases

import { ProviderDiscoveryAdapter } from './baseSource.js';

const LITELLM_BASE = 'https://raw.githubusercontent.com/BerriAI/litellm/main';
const FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!resp.ok) throw new Error(`http ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProvider(entry) {
  if (!entry || !entry.id) return null;
  // Infer category from model types
  const hasVision = entry.models?.some(m => m.supportsVision);
  const hasFunctionCalling = entry.models?.some(m => m.supportsFunctionCalling);
  const hasVisionModels = entry.models?.some(m => m.tags?.some(t => t.toLowerCase().includes('vision')));
  const hasChatModels = entry.models?.some(m => m.pipeline_tag?.includes('text-generation') || m.tags?.some(t => t.includes('chat')));
  
  let category = 'model-catalog';
  if (entry.supportsStreaming && entry.supportsFunctionCalling) category = 'api-gateway';
  else if (entry.models?.some(m => m.pipeline_tag?.includes('text-to-image'))) category = 'model-aggregator';
  
  // Format display name
  const displayName = entry.alias || entry.id;
  const formattedName = displayName
    .replace(/[-_]/g, ' ')
    .replace(/\b(\w)/g, (c) => c.toUpperCase())
    .replace(/\b(\d+)x(\d+)\b/gi, ''); // Remove resolution-like patterns
  
  return {
    sourceId: entry.id,
    name: formattedName || entry.id,
    alias: entry.alias,
    website: null,
    models: entry.models || [],
    aliases: entry.aliases || [],
    supportsStreaming: entry.supportsStreaming,
    supportsFunctionCalling: entry.supportsFunctionCalling,
    litellmConfig: entry.litellmConfig,
    sourceUrl: `https://github.com/BerriAI/litellm/tree/main/litellm/llms`,
    discoveredAt: new Date().toISOString(),
  };
}

export class LiteLLMSource extends ProviderDiscoveryAdapter {
  get name() {
    return 'LiteLLM Catalog';
  }

  get sourceType() {
    return 'litellm';
  }

  get trustLevel() {
    return 'community'; // Community-maintained catalog
  }

  supports() {
    return true;
  }

  async discoverProvider() {
    return { supported: false, reason: 'batch_only' };
  }

  async discoverAll() {
    try {
      // Fetch each file with individual timeout, fail fast on timeout
      const fetchWithFallback = async (url) => {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 10000);
          const resp = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0' } });
          clearTimeout(timer);
          if (!resp.ok) return null;
          return await resp.json();
        } catch {
          return null;
        }
      };

      const [pricesResult, contextResult, modelListResult] = await Promise.allSettled([
        fetchWithTimeout('https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'),
        fetchWithTimeout('https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window.json'),
        fetchWithTimeout('https://raw.githubusercontent.com/BerriAI/litellm/main/model_list.json'),
      ]);

      const prices = pricesResult.status === 'fulfilled' ? pricesResult.value : {};
      const context = contextResult.status === 'fulfilled' ? contextResult.value : {};
      const modelList = modelListResult.status === 'fulfilled' ? modelListResult.value : {};

      // Build provider map from model entries
      const providerMap = new Map();
      let processedModels = 0;
      const MAX_MODELS = 500;

// LiteLLM model entries have various formats:
      // "provider/model-name" -> provider is first part
      // "resolution/steps/provider/model" -> provider is 3rd part
      // "provider/model" -> provider is first part
      function extractProvider(modelKey) {
        const parts = modelKey.split('/');
        if (parts.length < 2) return null;
        // If first part looks like resolution (contains digits and x/X/-), skip to next meaningful part
        const firstPart = parts[0];
        if (/\d+[xX-].*\d+/.test(firstPart) || /^\d+-\d+-\d+$/.test(firstPart)) {
          // Resolution-like prefix, look for actual provider in later parts
          const knownProviders = ['bedrock', 'stability', 'openai', 'anthropic', 'google', 'cohere', 'ai21', 'aiml', 'mistral', 'meta', 'nvidia', 'groq', 'together', 'fireworks', 'perplexity', 'replicate', 'huggingface', 'azure', 'aws', 'gcp'];
          for (let i = 1; i < parts.length; i++) {
            const part = parts[i];
            // Skip step indicators
            if (/-steps?$/.test(part)) continue;
            // Skip resolution-like parts
            if (/\d+[xX-].*\d+/.test(part) || /^\d+-\d+-\d+$/.test(part)) continue;
            // Check if it's a known provider
            const lowerPart = part.toLowerCase();
            for (const kp of knownProviders) {
              if (lowerPart.startsWith(kp)) return kp;
            }
            // If not a known provider, return the part if it's not a model-like name
            if (!/\d+[xX-].*\d+/.test(part) && !/^\d+-\d+-\d+$/.test(part) && !/^-?\d+$/.test(part) && !part.includes('.')) {
              return part;
            }
          }
          return null;
        }
        // For non-resolution keys, return first part as provider (e.g., "aiml/dall-e-2" -> "aiml")
        return parts[0];
      }

      // LiteLLM model entries have various formats:
      // "provider/model-name" -> provider is first part
      // "resolution/steps/provider/model" -> provider is 3rd part
      // "provider/model" -> provider is first part
      for (const [modelKey, priceInfo] of Object.entries(prices)) {
        if (processedModels++ >= 500) break;
        const provider = extractProvider(modelKey);
        // Skip resolution-only entries (they return null)
        if (!provider) continue;
        const parts = modelKey.split('/');
        const modelName = parts.slice(1).join('/');

        if (!providerMap.has(provider)) {
          providerMap.set(provider, {
            id: provider,
            alias: provider,
            models: [],
          });
        }
        const entry = providerMap.get(provider);
        if (entry.models.length < 10) {
          entry.models.push({
            modelId: modelName,
            name: modelName,
            inputCost: priceInfo?.input_cost_per_token || priceInfo?.input_cost || null,
            outputCost: priceInfo?.output_cost_per_token || priceInfo?.output_cost || null,
            contextLength: context[modelKey]?.max_tokens || context[modelKey]?.max_context_window || null,
          });
        }
      }

      // Also include providers from model_list.json if available
      if (modelList && typeof modelList === 'object') {
        for (const [key, val] of Object.entries(modelList)) {
          if (!key.includes('/')) continue;
          const provider = extractProvider(key);
          if (!provider) continue;
          if (!providerMap.has(provider)) {
            providerMap.set(provider, { id: provider, alias: provider, models: [] });
          }
        }
      }

      // Limit total providers to avoid memory issues
      const candidates = [];
      let providerCount = 0;
      for (const [provider, entry] of providerMap) {
        if (providerCount++ >= 200) break;
        const normalized = normalizeProvider(entry);
        if (normalized) candidates.push(normalized);
      }

      return {
        supported: true,
        candidates,
        sourceMetadata: {
          id: 'litellm',
          name: 'LiteLLM Catalog',
          type: 'community-catalog',
          url: 'https://github.com/BerriAI/litellm',
          trustLevel: 'community',
        },
      };
    } catch (e) {
      // Graceful degradation - return empty but successful
      return {
        supported: true,
        candidates: [],
        sourceMetadata: {
          id: 'litellm',
          name: 'LiteLLM Catalog',
          type: 'community-catalog',
          url: 'https://github.com/BerriAI/litellm',
          trustLevel: 'community',
        },
      };
    }
  }

  async discover() {
    const result = await this.discoverAll();
    if (!result.supported) return { supported: false, reason: result.reason };
    return { supported: true, candidates: result.candidates, errors: [] };
  }

  async getSourceHealth() {
    try {
      const start = Date.now();
      const resp = await fetch('https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json', {
        method: 'HEAD', signal: AbortSignal.timeout(5000)
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

export function createLiteLLMSource() {
  return new LiteLLMSource();
}