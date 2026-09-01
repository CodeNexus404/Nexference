// Unified Provider Registry (v2.1.0) — the single canonical source for the full
// provider catalogue. It merges:
//
//     Curated Registry (source-controlled, authoritative)
//            +
//     Dynamic / Adopted Registry (discovered + explicitly adopted)
//            +
//     Custom Providers (user-created)
//            =
//     Unified Provider Catalogue
//
// Curated providers are never mutated; dynamic providers carry their own origin.
// Custom providers have origin='custom' and are managed via the custom provider store.
// Consumers (Cloud Providers page, Intelligence Center, CLI integrations) should
// use getUnifiedProviders() / getUnifiedProvider() instead of reaching into the
// curated registry directly. Existing curated behaviour is preserved exactly.

import { PROVIDERS } from '../registry.js';
import { loadDynamicProviders } from './dynamicProviderStore.js';
import { listCustomProviders, getCustomProvider } from '../custom/customProviderStore.js';
import { toCustomUnified } from '../custom/customProviderRegistry.js';

const INTEGRATION = {
  METADATA_ONLY: 'metadata-only',
  CONFIGURABLE: 'configurable',
  ADAPTER_READY: 'adapter-ready',
  TESTED: 'tested',
  UNKNOWN: 'unknown',
};

function curatedIntegration(p) {
  if (p.claudeCode || p.id === 'openrouter') return { level: INTEGRATION.ADAPTER_READY, adapterType: p.format, status: 'untested', baseUrl: p.baseUrl || null, format: p.format };
  if (['openai', 'anthropic', 'gemini'].includes(p.format)) return { level: INTEGRATION.CONFIGURABLE, adapterType: p.format, status: 'untested', baseUrl: p.baseUrl || null, format: p.format };
  if (p.website || p.baseUrl) return { level: INTEGRATION.METADATA_ONLY, adapterType: null, status: 'untested', baseUrl: p.baseUrl || null, format: p.format || null };
  return { level: INTEGRATION.UNKNOWN, adapterType: null, status: 'untested', baseUrl: null, format: null };
}

function toCuratedUnified(p) {
  return {
    id: p.id,
    name: p.name,
    slug: p.id,
    origin: 'curated',
    ecosystemId: null,
    status: 'active',
    lifecycle: 'active',
    website: p.baseUrl ? new URL(p.baseUrl).origin : (p.signup || null),
    documentationUrl: p.signup || null,
    logo: p.logo ? { url: p.logo, source: 'curated', status: 'resolved' } : { url: null, source: 'fallback', status: 'none' },
    category: null,
    source: { type: 'curated', name: 'Nexference Curated', url: null, confidence: 'CURATED' },
    capabilities: {
      openaiCompatible: p.format === 'openai',
      anthropicCompatible: p.format === 'anthropic',
      customBaseUrl: !!p.hasCustomUrl,
      modelDiscovery: !!p.publicModels,
    },
    access: { type: 'unknown', requiresApiKey: true, pricingStatus: 'unknown' },
    integration: curatedIntegration(p),
    modelSupport: { status: p.publicModels ? 'verified' : 'curated', count: 0, lastUpdated: null, models: [] },
    lastUpdated: null,
    discoveredAt: null,
    adoptedAt: null,
  };
}

function toEcosystemUnified(rec) {
  return {
    id: rec.id,
    name: rec.name,
    slug: rec.slug,
    origin: 'ecosystem',
    ecosystemId: rec.ecosystemId,
    status: rec.status, // active | inactive | removed
    lifecycle: rec.lifecycle || 'unknown',
    website: rec.website || null,
    documentationUrl: rec.documentationUrl || null,
    logo: rec.logo || { url: null, source: 'fallback', status: 'none' },
    category: null,
    source: rec.source || { type: 'unknown', name: 'unknown', url: null, confidence: 'OBSERVED' },
    capabilities: rec.capabilities || {},
    access: rec.access || { type: 'unknown', requiresApiKey: null, pricingStatus: 'unknown' },
    integration: rec.integration || curatedIntegration({}),
    modelSupport: rec.modelSupport || { status: 'unknown', count: 0, lastUpdated: null, models: [] },
    lastUpdated: rec.updatedAt || null,
    discoveredAt: rec.discoveredAt || null,
    adoptedAt: rec.adoptedAt || null,
  };
}

// Curated providers are ALWAYS included (they are the core). Dynamic providers are
// shown only when active by default; inactive/removed are excluded from normal
// lists unless explicitly requested via ?status=.
// Custom providers are included when origin is not filtered, or when origin='custom'.
export function getUnifiedProviders({ origin, status } = {}) {
  const curated = PROVIDERS.map(toCuratedUnified);
  const dynFilter = status ? (p) => p.status === status : (p) => p.status === 'active';
  const dyn = loadDynamicProviders().providers.filter(dynFilter).map(toEcosystemUnified);
  const custFilter = status ? (p) => p.lifecycle === status : (p) => p.lifecycle === 'active';
  const cust = listCustomProviders().filter(custFilter).map(toCustomUnified);
  let all = [...curated, ...dyn, ...cust];
  if (origin === 'curated') all = curated;
  else if (origin === 'ecosystem') all = dyn;
  else if (origin === 'custom') all = cust;
  return all;
}

export function getUnifiedProvider(id) {
  const curated = PROVIDERS.find((p) => p.id === id);
  if (curated) return toCuratedUnified(curated);
  const dyn = loadDynamicProviders().providers.find((p) => p.id === id);
  if (dyn) return toEcosystemUnified(dyn);
  if (id?.startsWith('cst:')) return toCustomUnified(getCustomProvider(id));
  return null;
}

export function getActiveDynamicProviders() {
  return getUnifiedProviders({ origin: 'ecosystem', status: 'active' });
}
