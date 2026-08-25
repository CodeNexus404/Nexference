// Provider Discovery status vocabulary (v1.4.0) — a small, honest, closed set
// of states a provider can be in after discovery. Mirrors the disciplined
// status model used by healthRules.js so the whole platform speaks one language.
//
//   VERIFIED     — confirmed reachable through an official source (e.g. the
//                  provider's own public model API returned data).
//   OBSERVED     — seen live but not via an authoritative official source
//                  (e.g. a curated list that is currently returning models).
//   CURATED      — known only from the trusted static registry; not yet
//                  verified live.
//   STALE        — was available before, but the last check failed. We keep the
//                  last-known-good data and mark it honestly rather than hiding.
//   UNAVAILABLE  — the source was reachable/checkable but returned nothing
//                  (e.g. a keyed API we cannot probe returns no public models).
//   DEPRECATED   — an official source explicitly marked the provider retired.
//   UNKNOWN      — no signal either way; never invent a status.
//
// Discovery SOURCE classification (which channel produced the intel):
//   official-api, official-documentation, official-model-catalog,
//   official-status-page, official-github, curated-registry,
//   community-source, unknown.

export const DISCOVERY_STATUS = {
  VERIFIED: 'verified',
  OBSERVED: 'observed',
  CURATED: 'curated',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
  DEPRECATED: 'deprecated',
  UNKNOWN: 'unknown',
};

export const SOURCE_TYPES = {
  OFFICIAL_API: 'official-api',
  OFFICIAL_DOCUMENTATION: 'official-documentation',
  OFFICIAL_MODEL_CATALOG: 'official-model-catalog',
  OFFICIAL_STATUS_PAGE: 'official-status-page',
  OFFICIAL_GITHUB: 'official-github',
  CURATED_REGISTRY: 'curated-registry',
  COMMUNITY_SOURCE: 'community-source',
  UNKNOWN: 'unknown',
};

export const CONFIDENCE = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  UNKNOWN: 'unknown',
};

// Availability of the provider's model service (distinct from discovery status).
export const AVAILABILITY = {
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
};

// A model's access type — only ever set from an explicit signal.
export const ACCESS_TYPE = {
  FREE: 'free',
  PAID: 'paid',
  FREEMIUM: 'freemium',
  TRIAL: 'trial',
  UNKNOWN: 'unknown',
};

// A model's lifecycle status.
export const LIFECYCLE = {
  NEW: 'new',
  ACTIVE: 'active',
  DEPRECATED: 'deprecated',
  REMOVED: 'removed',
  UNKNOWN: 'unknown',
};

const STATUS_ORDER = {
  verified: 0, observed: 1, curated: 2, unknown: 3, stale: 4, unavailable: 5, deprecated: 6,
};

// Rank two discovery statuses; the more "concrete" one wins (used when merging
// sources). Higher order = weaker signal.
export function strongerStatus(a, b) {
  const ra = STATUS_ORDER[a] ?? 99;
  const rb = STATUS_ORDER[b] ?? 99;
  return ra <= rb ? a : b;
}

export function isHonestStatus(s) {
  return Object.values(DISCOVERY_STATUS).includes(s);
}
