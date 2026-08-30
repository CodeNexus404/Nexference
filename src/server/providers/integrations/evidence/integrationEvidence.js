// Integration Evidence (v1.9.0) — normalized, traceable evidence records that
// justify every integration classification. Evidence is separate from discovery
// status: a provider can be "discovered" without any integration evidence, and an
// integration classification must be traceable to concrete evidence.
//
// Preferred sources: official documentation, official API docs, official GitHub
// repos, explicit provider metadata. Community speculation may be recorded but
// never auto-activates an adapter.
import { EVIDENCE_CLAIM, CONFIDENCE, ADAPTER_TYPE } from '../integrationTypes.js';

export function normalizeEvidence(e) {
  if (!e || typeof e !== 'object') return null;
  const claim = Object.values(EVIDENCE_CLAIM).includes(e.claim) ? e.claim : null;
  const confidence = Object.values(CONFIDENCE).includes(e.confidence) ? e.confidence : CONFIDENCE.UNKNOWN;
  return {
    sourceType: typeof e.sourceType === 'string' ? e.sourceType : 'unknown',
    sourceUrl: e.sourceUrl || null,
    observedAt: e.observedAt || new Date().toISOString(),
    claim,
    confidence,
    note: typeof e.note === 'string' ? e.note : null,
  };
}

// Map an evidence claim to the adapter type it implies.
export function claimToAdapterType(claim) {
  if (claim === EVIDENCE_CLAIM.OPENAI_COMPATIBLE_API) return ADAPTER_TYPE.OPENAI_COMPATIBLE;
  if (claim === EVIDENCE_CLAIM.ANTHROPIC_COMPATIBLE_API) return ADAPTER_TYPE.ANTHROPIC_COMPATIBLE;
  if (claim === EVIDENCE_CLAIM.GEMINI_COMPATIBLE_API) return ADAPTER_TYPE.GEMINI_COMPATIBLE;
  return null;
}

// A community-only evidence source is recorded but never alone activates an adapter.
export function isAuthoritative(sourceType) {
  return ['official-documentation', 'official-api-docs', 'official-github', 'provider-metadata', 'verified-probe'].includes(sourceType);
}

export function confidenceRank(c) {
  return { high: 4, medium: 3, low: 2, insufficient: 1, unknown: 1 }[c] ?? 1;
}

export function bestConfidence(list = []) {
  if (!list.length) return CONFIDENCE.INSUFFICIENT;
  return list.reduce((a, b) => (confidenceRank(b) > confidenceRank(a) ? b : a), 'insufficient');
}
