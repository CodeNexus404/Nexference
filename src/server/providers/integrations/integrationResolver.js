// Integration Resolver (v1.9.0) — given a provider's metadata, declared
// compatibility, prior assessment and accumulated evidence, decide the best adapter
// type and an honest integration status.
//
// Core principle: DISCOVERY IS NOT INTEGRATION. An adapter is only assigned when
// supported by explicit evidence (compatibility flags, integration evidence claims,
// or curated provider truth). Never inferred from name, website or marketing.
import { INTEGRATION_STATUS, ADAPTER_TYPE, CONFIDENCE } from './integrationTypes.js';
import { claimToAdapterType, confidenceRank, bestConfidence } from './evidence/integrationEvidence.js';

function addCandidate(map, type, confidence) {
  if (!map.has(type)) map.set(type, { count: 0, conf: [] });
  map.get(type).count += 1;
  map.get(type).conf.push(confidence);
}

function formatToAdapter(format) {
  if (format === 'openai') return ADAPTER_TYPE.OPENAI_COMPATIBLE;
  if (format === 'anthropic') return ADAPTER_TYPE.ANTHROPIC_COMPATIBLE;
  if (format === 'gemini') return ADAPTER_TYPE.GEMINI_COMPATIBLE;
  return null;
}

const IMPLEMENTED = [ADAPTER_TYPE.OPENAI_COMPATIBLE, ADAPTER_TYPE.ANTHROPIC_COMPATIBLE, ADAPTER_TYPE.GEMINI_COMPATIBLE];

// context: {
//   format,                      // curated/known protocol ('openai'|'anthropic'|'gemini'|...)
//   compatibility: { openaiCompatible, anthropicCompatible, geminiCompatible, customProtocol },
//   integrationAdapterType,      // previously assessed adapterType (if any)
//   evidence: [ { claim, confidence, sourceType, ... } ],
//   curated                     // boolean — curated providers are authoritative truth
// }
export function resolveAdapter(context = {}) {
  const evidence = Array.isArray(context.evidence) ? context.evidence : [];
  const candidates = new Map();

  // 1) Explicit integration evidence claims.
  for (const e of evidence) {
    const at = claimToAdapterType(e.claim);
    if (at) addCandidate(candidates, at, e.confidence || CONFIDENCE.LOW);
  }

  // 2) Declared compatibility flags (treated as supporting evidence, not proof).
  const cap = context.compatibility || {};
  if (cap.openaiCompatible) addCandidate(candidates, ADAPTER_TYPE.OPENAI_COMPATIBLE, CONFIDENCE.MEDIUM);
  if (cap.anthropicCompatible) addCandidate(candidates, ADAPTER_TYPE.ANTHROPIC_COMPATIBLE, CONFIDENCE.MEDIUM);
  if (cap.geminiCompatible) addCandidate(candidates, ADAPTER_TYPE.GEMINI_COMPATIBLE, CONFIDENCE.MEDIUM);

  // 3) Previously assessed adapter type (sticky unless contradicted by stronger evidence).
  if (context.integrationAdapterType && Object.values(ADAPTER_TYPE).includes(context.integrationAdapterType)) {
    addCandidate(candidates, context.integrationAdapterType, CONFIDENCE.MEDIUM);
  }

  // 4) Curated provider format is trusted truth (not "evidence", but authoritative).
  if (context.curated) {
    const at = formatToAdapter(context.format);
    if (at) addCandidate(candidates, at, CONFIDENCE.HIGH);
  }

  if (candidates.size === 0) {
    // A known but unsupported protocol → unsupported; otherwise metadata-only.
    if (context.format && !formatToAdapter(context.format) && context.format !== 'unknown') {
      return {
        adapterType: ADAPTER_TYPE.NONE,
        status: INTEGRATION_STATUS.UNSUPPORTED,
        confidence: CONFIDENCE.INSUFFICIENT,
        reasons: ['Provider protocol is known but not supported by an adapter in v1.9.0.'],
      };
    }
    return {
      adapterType: ADAPTER_TYPE.NONE,
      status: INTEGRATION_STATUS.METADATA_ONLY,
      confidence: CONFIDENCE.INSUFFICIENT,
      reasons: ['No compatibility evidence or known format; metadata-only until assessed.'],
    };
  }

  const best = [...candidates.entries()].sort(
    (a, b) => confidenceRank(bestConfidence(b[1].conf)) - confidenceRank(bestConfidence(a[1].conf))
      || b[1].count - a[1].count,
  )[0];
  const adapterType = best[0];
  const conf = bestConfidence(best[1].conf);
  const implemented = IMPLEMENTED.includes(adapterType);
  const status = implemented ? INTEGRATION_STATUS.INTEGRATED : INTEGRATION_STATUS.SUPPORTED;

  return {
    adapterType,
    status,
    confidence: conf,
    reasons: [`Resolved ${adapterType} from ${best[1].count} signal(s); confidence ${conf}.`],
  };
}

export { formatToAdapter };
