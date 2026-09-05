// OpenRouter Provider Discovery Source (v2.2.0).
//
// Discovers providers listed by OpenRouter's public API.
// This source provides metadata about providers that are available through
// the OpenRouter aggregator. It does NOT imply direct API access, Claude Code
// compatibility, or any specific client support — only what OpenRouter itself
// reports.
//
// Fields collected when available from OpenRouter:
// - provider identity (id, name, slug)
// - website, privacy policy, terms, status page
// - model relationships (which models OpenRouter offers from this provider)
// - source URL for provenance
// - timestamps

import { ProviderDiscoveryAdapter } from './baseSource.js';

const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const FETCH_TIMEOUT_MS = 10000;

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

function normalizeProvider(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id || raw.slug || raw.name;
  if (!id) return null;

  const name = raw.name || raw.title || id;

  return {
    sourceId: id,
    name,
    website: raw.website || raw.url || raw.homepage || null,
    privacyPolicy: raw.privacy_policy || raw.privacyPolicy || null,
    termsOfService: raw.terms_of_service || raw.termsOfService || null,
    statusPage: raw.status_page || raw.statusPage || null,
    description: raw.description || null,
    category: 'model-aggregator', // OpenRouter aggregates models from multiple providers
    models: Array.isArray(raw.models) ? raw.models.slice(0, 20).map((m) => ({
      modelId: m.id || m.name,
      name: m.name || m.id,
      contextLength: m.context_length || m.contextLength || null,
      pricing: m.pricing || null,
      capabilities: m.capabilities || null,
    })) : [],
    sourceUrl: `https://openrouter.ai/${id}`,
    discoveredAt: new Date().toISOString(),
    _raw: raw,
  };
}

export class OpenRouterSource extends ProviderDiscoveryAdapter {
  get name() {
    return 'OpenRouter';
  }

  get sourceType() {
    return 'openrouter';
  }

  get trustLevel() {
    return 'community';
  }

  supports() {
    return true;
  }

  async discoverProvider() {
    return { supported: false, reason: 'batch_only' };
  }

  async discoverAll() {
    try {
      // Step 1: Fetch all providers from /providers endpoint (primary source)
      let providerMeta = new Map();
      try {
        const providersData = await fetchWithTimeout(`${OPENROUTER_API}/providers`);
        if (providersData && Array.isArray(providersData.data)) {
          for (const p of providersData.data) {
            const slug = p.slug || p.id || p.name;
            if (slug) {
              // Derive website from privacy policy URL if website not provided
              let website = p.website || p.url || p.homepage;
              if (!website && p.privacy_policy_url) {
                try {
                  website = new URL(p.privacy_policy_url).origin;
                } catch {}
              } else if (!website && p.terms_of_service_url) {
                try {
                  website = new URL(p.terms_of_service_url).origin;
                } catch {}
              } else if (!website && p.status_page_url) {
                try {
                  website = new URL(p.status_page_url).origin;
                } catch {}
              }
              providerMeta.set(slug, {
                name: p.name || slug,
                slug: p.slug,
                website,
                privacy_policy: p.privacy_policy_url,
                terms_of_service: p.terms_of_service_url,
                status_page: p.status_page_url,
                description: p.description,
              });
            }
          }
        }
      } catch {
        // Continue without provider metadata
      }

      // Step 1: Build providerMap from providerMeta (primary source)
      const providerMap = new Map();
      for (const [slug, meta] of providerMeta) {
        providerMap.set(slug, {
          id: slug,
          name: meta.name,
          models: [],
        });
      }

      // Step 2: Fetch models (limited) to enrich provider model lists
      const data = await fetchWithTimeout(`${OPENROUTER_API}/models`);
      if (!data || !Array.isArray(data.data)) {
        return { supported: false, reason: 'unexpected_response' };
      }

      // Step 2: Enrich with models from /models endpoint (limited)
      let processed = 0;
      const MAX_MODELS = 500;
      for (const model of data.data) {
        if (processed++ >= 500) break;
        const providerSlug = model.provider || model.provider_name || 'unknown';
        if (!providerMap.has(providerSlug)) {
          providerMap.set(providerSlug, {
            id: providerSlug,
            name: providerSlug,
            models: [],
          });
        }
        const entry = providerMap.get(providerSlug);
        if (entry.models.length < 10) {
          entry.models.push({
            modelId: model.id,
            name: model.name || model.id,
            contextLength: model.context_length || null,
            pricing: model.pricing || null,
            capabilities: model.architecture ? { architecture: model.architecture } : null,
          });
        }
      }

      const candidates = [];
      for (const [providerId, entry] of providerMap) {
        if (providerId === 'unknown') continue; // Skip unknown providers
        const meta = providerMeta.get(providerId);
        // Use the best available name: meta name > entry.name > providerId
        const bestName = meta?.name || entry.name || providerId;
        const normalized = normalizeProvider({
          id: providerId,
          name: bestName,
          website: meta?.website || meta?.url,
          privacy_policy: meta?.privacy_policy,
          terms_of_service: meta?.terms_of_service,
          status_page: meta?.status_page,
          description: meta?.description,
          models: entry.models,
        });
        if (normalized) {
          candidates.push(normalized);
        }
      }

      return {
        supported: true,
        candidates,
        sourceMetadata: {
          id: 'openrouter',
          name: 'OpenRouter',
          type: 'aggregator-api',
          url: 'https://openrouter.ai',
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
    return { supported: true, candidates: result.candidates, errors: [] };
  }

  async getSourceHealth() {
    try {
      const start = Date.now();
      const resp = await fetch(`${OPENROUTER_API}/models`, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
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

export function createOpenRouterSource() {
  return new OpenRouterSource();
}