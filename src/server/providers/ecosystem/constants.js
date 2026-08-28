// Ecosystem Discovery constants (v1.7.0) — the vocabulary for the NEW, separate
// discovery layer. These sit alongside (never replace) the curated provider
// registry and the v1.4–v1.6 discovery-status model.
//
// Honesty rules:
//   • A discovered provider is NOT a curated provider until explicitly adopted.
//   • Nothing here ever claims "verified / live / official / Claude-compatible"
//     unless a real source signal supports that exact claim.
//   • Missing data stays null / unknown — never invented.

// Normalized provider category taxonomy. An open-source gateway/router is NOT
// automatically a cloud provider.
export const PROVIDER_CATEGORIES = {
  DIRECT_PROVIDER: 'direct-provider',
  MODEL_AGGREGATOR: 'model-aggregator',
  INFERENCE_PROVIDER: 'inference-provider',
  API_GATEWAY: 'api-gateway',
  PROXY_SERVICE: 'proxy-service',
  LOCAL_RUNTIME: 'local-runtime',
  MODEL_CATALOG: 'model-catalog',
  COMMUNITY_PROJECT: 'community-project',
  UNKNOWN: 'unknown',
};

export const CATEGORY_LABELS = {
  [PROVIDER_CATEGORIES.DIRECT_PROVIDER]: 'Direct Provider',
  [PROVIDER_CATEGORIES.MODEL_AGGREGATOR]: 'Model Aggregator',
  [PROVIDER_CATEGORIES.INFERENCE_PROVIDER]: 'Inference Provider',
  [PROVIDER_CATEGORIES.API_GATEWAY]: 'API Gateway',
  [PROVIDER_CATEGORIES.PROXY_SERVICE]: 'Proxy Service',
  [PROVIDER_CATEGORIES.LOCAL_RUNTIME]: 'Local Runtime',
  [PROVIDER_CATEGORIES.MODEL_CATALOG]: 'Model Catalog',
  [PROVIDER_CATEGORIES.COMMUNITY_PROJECT]: 'Community Project',
  [PROVIDER_CATEGORIES.UNKNOWN]: 'Unknown',
};

// Registry lifecycle for a discovered provider (adoption workflow).
export const REGISTRY_STATES = {
  DISCOVERED: 'discovered',
  REVIEW: 'review',
  ADOPTED: 'adopted',
  IGNORED: 'ignored',
  DUPLICATE: 'duplicate',
  DEPRECATED: 'deprecated',
};

// Duplicate classification — conservative. We never auto-merge uncertain identities.
export const DUPLICATE_STATES = {
  UNIQUE: 'unique',
  LIKELY: 'likely-duplicate',
  CONFIRMED: 'confirmed-duplicate',
  UNKNOWN: 'unknown',
};

// Validation identity confidence.
export const VALIDATION_IDENTITY = {
  CONFIRMED: 'confirmed',
  LIKELY: 'likely',
  UNKNOWN: 'unknown',
};

// Logo provenance — what produced the logo we show.
export const LOGO_SOURCE = {
  CURATED: 'curated',
  OFFICIAL: 'official',
  SOURCE_PROVIDED: 'source-provided',
  FAVICON: 'favicon',
  GITHUB: 'github',
  FALLBACK: 'fallback',
};

// Discovery lifecycle phase (loosely tracks evidence strength).
export const DISCOVERY_PHASE = {
  DISCOVERED: 'discovered',
  OBSERVED: 'observed',
  VALIDATED: 'validated',
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  STALE: 'stale',
  DEPRECATED: 'deprecated',
};

export const TRUST_LEVELS = {
  OFFICIAL: 'official',
  CURATED: 'curated',
  COMMUNITY: 'community',
  UNKNOWN: 'unknown',
};
