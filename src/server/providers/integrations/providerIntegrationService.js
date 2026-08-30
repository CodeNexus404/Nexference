// Provider Integration Service (v1.9.0) — assesses a provider's real integration
// status by combining its metadata, ecosystem evidence and explicit integration
// evidence, resolves the best adapter, and persists an honest Provider Integration
// Record.
//
// Honesty rules (inherited from the whole Nexference lineage):
//   • DISCOVERY ≠ INTEGRATION. Adoption ≠ compatibility. A provider in the registry
//     is NEVER assumed configurable/executable.
//   • An adapter is assigned ONLY with explicit evidence (compatibility flags,
//     integration-evidence claims, or curated provider truth).
//   • Never infer compatibility from name, website, repository or marketing.
//   • No secrets: records hold metadata + capabilities + evidence + OUTCOMES only.
//   • Assessment is manual (POST). No background polling. In-flight guard per id.
//
// This module does NOT touch Claude Code configuration generation (that stays in
// the untouched configurationEngine / claudeCodeAdapter path).
import { PROVIDERS, getProvider } from '../registry.js';
import { loadDynamicProviders, getDynamicProvider } from '../dynamic/dynamicProviderStore.js';
import { loadDiscovered } from '../ecosystem/ecosystemStore.js';
import {
  getIntegration, upsertIntegration, loadIntegrations,
} from './integrationStore.js';
import { resolveAdapter, formatToAdapter } from './integrationResolver.js';
import { getAdapter } from './integrationRegistry.js';
import { normalizeEvidence, claimToAdapterType, bestConfidence } from './evidence/integrationEvidence.js';
import { INTEGRATION_STATUS, ADAPTER_TYPE, CONFIDENCE, EVIDENCE_CLAIM } from './integrationTypes.js';
import { recordChange, CHANGE_TYPES } from '../providerChangeStore.js';
import { recordActivity } from '../../activity/activityService.js';

const STORE_VERSION = '1.9.0';
const assessing = new Set();

function buildEvidenceFromEco(eco) {
  const ev = [];
  const cap = eco.compatibility || {};
  const src = (eco.sources && eco.sources[0]) || {};
  const url = src.sourceUrl || eco.website || eco.documentationUrl || null;
  const push = (claim, confidence) => {
    const e = normalizeEvidence({ sourceType: src.sourceType || 'provider-metadata', sourceUrl: url, claim, confidence });
    if (e) ev.push(e);
  };
  if (cap.openaiCompatible) push(EVIDENCE_CLAIM.OPENAI_COMPATIBLE_API, CONFIDENCE.MEDIUM);
  if (cap.anthropicCompatible) push(EVIDENCE_CLAIM.ANTHROPIC_COMPATIBLE_API, CONFIDENCE.MEDIUM);
  if (cap.geminiCompatible) push(EVIDENCE_CLAIM.GEMINI_COMPATIBLE_API, CONFIDENCE.MEDIUM);
  if (Array.isArray(eco.models) && eco.models.length) push(EVIDENCE_CLAIM.MODEL_LISTING_SUPPORTED, CONFIDENCE.LOW);
  if (eco.accessType === 'paid') push(EVIDENCE_CLAIM.API_KEY_REQUIRED, CONFIDENCE.MEDIUM);
  return ev;
}

function gatherContext(providerId) {
  const curated = getProvider(providerId);
  if (curated) {
    return {
      providerId, origin: 'curated', name: curated.name, curated: true,
      format: curated.format,
      compatibility: {
        openaiCompatible: curated.format === 'openai',
        anthropicCompatible: curated.format === 'anthropic',
        geminiCompatible: curated.format === 'gemini',
        customProtocol: false,
      },
      integrationAdapterType: curated.format ? formatToAdapter(curated.format) : null,
      evidence: [],
    };
  }
  const dyn = getDynamicProvider(providerId);
  if (dyn) {
    const integ = dyn.integration || {};
    const cap = dyn.capabilities || {};
    const fmt = integ.adapterType || null;
    const eco = (dyn.ecosystemId && loadDiscovered()[dyn.ecosystemId]) || {};
    return {
      providerId, origin: 'ecosystem', name: dyn.name, curated: false,
      format: fmt,
      compatibility: {
        openaiCompatible: !!cap.openaiCompatible,
        anthropicCompatible: !!cap.anthropicCompatible,
        geminiCompatible: fmt === 'gemini',
        customProtocol: false,
      },
      integrationAdapterType: fmt
        ? (Object.values(ADAPTER_TYPE).includes(fmt) ? fmt : formatToAdapter(fmt))
        : null,
      evidence: buildEvidenceFromEco(eco),
    };
  }
  return null;
}

function deriveWarnings(context, resolution) {
  const w = [];
  if (resolution.status === INTEGRATION_STATUS.METADATA_ONLY) {
    w.push('No verified adapter is available; Nexference cannot configure or execute against this provider yet.');
  }
  if (resolution.status === INTEGRATION_STATUS.UNSUPPORTED) {
    w.push('Provider protocol is known but not supported by an adapter in v1.9.0.');
  }
  if (resolution.status === INTEGRATION_STATUS.INTEGRATED && context.origin === 'ecosystem') {
    w.push('Adapter is available; actual execution still requires a real connection test with your credentials.');
  }
  return w;
}

function buildRecord(context, resolution) {
  const adapter = getAdapter(resolution.adapterType);
  const caps = adapter.getCapabilities();
  const none = resolution.adapterType === ADAPTER_TYPE.NONE || resolution.adapterType === ADAPTER_TYPE.UNKNOWN;
  return {
    _v: STORE_VERSION,
    providerId: context.providerId,
    name: context.name,
    origin: context.origin,
    integrationStatus: resolution.status,
    adapterType: resolution.adapterType,
    confidence: resolution.confidence,
    compatibility: {
      openaiCompatible: !!context.compatibility.openaiCompatible,
      anthropicCompatible: !!context.compatibility.anthropicCompatible,
      geminiCompatible: !!context.compatibility.geminiCompatible,
      customProtocol: !!context.compatibility.customProtocol,
    },
    configuration: {
      supportsApiKey: !none,
      supportsBaseUrl: !none,
      supportsModelSelection: !none,
      supportsCustomHeaders: caps.customHeaders,
      supportsEnvironmentVariables: caps.environmentVariables,
    },
    execution: {
      supportsChat: caps.chat,
      supportsStreaming: caps.streaming,
      supportsModelListing: caps.modelListing,
      supportsConnectionTest: caps.connectionTest,
    },
    evidence: context.evidence || [],
    warnings: deriveWarnings(context, resolution),
    assessedBy: 'manual',
    lastAssessedAt: new Date().toISOString(),
    providerActive: true,
  };
}

// Compute an integration record WITHOUT persisting (used for read paths / summaries).
function computeIntegration(providerId, context) {
  const resolution = resolveAdapter(context);
  return buildRecord(context, resolution);
}

function recordIntegrationChange(prev, rec) {
  try {
    if (!prev) {
      recordChange({
        providerId: rec.providerId, providerName: rec.name, type: CHANGE_TYPES.INTEGRATION_ASSESSED,
        summary: `Integration assessed for ${rec.name}: ${rec.integrationStatus} (${rec.adapterType})`,
        sourceType: 'integration', confidence: 'medium',
        details: { status: rec.integrationStatus, adapterType: rec.adapterType },
      });
      return;
    }
    if (prev.integrationStatus !== rec.integrationStatus) {
      recordChange({
        providerId: rec.providerId, providerName: rec.name, type: CHANGE_TYPES.INTEGRATION_STATUS_CHANGED,
        summary: `Integration status for ${rec.name} changed: ${prev.integrationStatus} → ${rec.integrationStatus}`,
        sourceType: 'integration', confidence: 'medium',
        details: { before: prev.integrationStatus, after: rec.integrationStatus },
      });
    }
    if (prev.adapterType !== rec.adapterType) {
      recordChange({
        providerId: rec.providerId, providerName: rec.name, type: CHANGE_TYPES.ADAPTER_CHANGED,
        summary: `Adapter for ${rec.name} changed: ${prev.adapterType} → ${rec.adapterType}`,
        sourceType: 'integration', confidence: 'medium',
        details: { before: prev.adapterType, after: rec.adapterType },
      });
    }
  } catch { /* non-fatal */ }
}

export function assessProviderIntegration(providerId, { evidence: extraEvidence = [], force = false } = {}) {
  if (assessing.has(providerId)) return { success: false, reason: 'already_assessing', message: 'An assessment is already in progress for this provider.' };
  const context = gatherContext(providerId);
  if (!context) return { success: false, reason: 'unknown-provider' };
  assessing.add(providerId);
  try {
    if (extraEvidence.length) {
      const norm = extraEvidence.map(normalizeEvidence).filter(Boolean);
      context.evidence = [...context.evidence, ...norm];
    }
    const resolution = resolveAdapter(context);
    const prev = getIntegration(providerId);
    const record = buildRecord(context, resolution);
    upsertIntegration(record);
    recordIntegrationChange(prev, record);
    try {
      recordActivity('integration', 'provider-integration-assessed', 'info',
        `Assessed ${record.name}: ${record.integrationStatus} (${record.adapterType})`, { id: providerId, status: record.integrationStatus });
    } catch { /* non-fatal */ }
    return { success: true, integration: record, resolution };
  } finally {
    assessing.delete(providerId);
  }
}

// Stored record, or a computed (not persisted) honest assessment for read paths.
export function getProviderIntegration(providerId) {
  const stored = getIntegration(providerId);
  if (stored) return stored;
  const context = gatherContext(providerId);
  if (!context) return null;
  return computeIntegration(providerId, context);
}

export function listProviderIntegrations() {
  const stored = loadIntegrations().integrations;
  const out = {};
  const seen = new Set();
  // Curated providers (authoritative) — computed on read, not persisted unless assessed.
  for (const p of PROVIDERS) {
    if (stored[p.id]) { out[p.id] = stored[p.id]; }
    else {
      const ctx = gatherContext(p.id);
      if (ctx) out[p.id] = computeIntegration(p.id, ctx);
    }
    seen.add(p.id);
  }
  // Dynamic providers.
  for (const d of loadDynamicProviders().providers) {
    if (stored[d.id]) out[d.id] = { ...stored[d.id], providerActive: d.status === 'active' };
    else {
      const ctx = gatherContext(d.id);
      if (ctx) out[d.id] = { ...computeIntegration(d.id, ctx), providerActive: d.status === 'active' };
    }
    seen.add(d.id);
  }
  return out;
}

export function getIntegrationCapabilities(providerId) {
  const rec = getProviderIntegration(providerId);
  if (!rec) return { supported: false, reason: 'unknown provider' };
  const adapter = getAdapter(rec.adapterType);
  return {
    providerId,
    adapterType: rec.adapterType,
    status: rec.integrationStatus,
    capabilities: adapter.getCapabilities(),
    configuration: rec.configuration,
    execution: rec.execution,
  };
}

export async function testProviderIntegration(providerId, config = {}) {
  const rec = getProviderIntegration(providerId);
  if (!rec) return { supported: false, reason: 'unknown provider' };
  if (rec.adapterType === ADAPTER_TYPE.NONE || rec.adapterType === ADAPTER_TYPE.UNKNOWN) {
    return { supported: false, reason: 'No verified adapter is available for this provider.' };
  }
  const adapter = getAdapter(rec.adapterType);
  return adapter.testConnection({ ...config, providerId });
}

export async function listProviderModels(providerId, config = {}) {
  const rec = getProviderIntegration(providerId);
  if (!rec) return { supported: false, reason: 'unknown provider' };
  if (rec.adapterType === ADAPTER_TYPE.NONE || rec.adapterType === ADAPTER_TYPE.UNKNOWN) {
    return { supported: false, status: 'unsupported', reason: 'No verified adapter is available for this provider.' };
  }
  const adapter = getAdapter(rec.adapterType);
  return adapter.listModels({ ...config, providerId });
}

// Coverage summary for the Intelligence Center / dashboard.
export function getIntegrationCoverage() {
  const all = listProviderIntegrations();
  const counts = {};
  let usable = 0;
  for (const rec of Object.values(all)) {
    counts[rec.integrationStatus] = (counts[rec.integrationStatus] || 0) + 1;
    const s = rec.integrationStatus;
    if (s === INTEGRATION_STATUS.INTEGRATED || s === INTEGRATION_STATUS.SUPPORTED || s === INTEGRATION_STATUS.PARTIAL) usable += 1;
  }
  const needsAssessment = (counts[INTEGRATION_STATUS.METADATA_ONLY] || 0) + (counts[INTEGRATION_STATUS.UNKNOWN] || 0);
  return {
    total: Object.keys(all).length,
    counts,
    usable,
    needsAssessment,
    generatedAt: new Date().toISOString(),
  };
}
