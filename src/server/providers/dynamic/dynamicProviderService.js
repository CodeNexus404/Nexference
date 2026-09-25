// Dynamic Provider Service (v1.8.0) — turns an adopted Ecosystem discovery into a
// persistent, unified provider record and manages its lifecycle.
//
// Honesty rules (inherited from v1.7.0, hardened for integration):
//   • Adoption creates metadata + integration-capability only. It NEVER claims a
//     provider is "working / verified / compatible" unless evidence supports it.
//   • Integration level is derived conservatively: only a known adapter format
//     earns 'adapter-ready'; only real configuration signals earn 'configurable'.
//   • 'tested' is set ONLY after an actual connection test succeeds.
//   • Unknown stays unknown — fields are null / 'unknown', never fabricated.
//   • No secrets: we store metadata, capabilities and test OUTCOMES only.

import { loadDiscovered, saveDiscovered } from '../ecosystem/ecosystemStore.js';
import { PROVIDERS, getProvider } from '../registry.js';
import { recordChange, CHANGE_TYPES } from '../providerChangeStore.js';
import { recordActivity } from '../../activity/activityService.js';
import { getProviderAdapter } from '../providerAdapter.js';
import { fetchCustomProviderModelsList } from '../custom/customModelFetch.js';
import {
  loadDynamicProviders, getDynamicProvider, findByEcosystemId, upsertDynamicProvider,
  setDynamicProviderStatus, removeDynamicProvider,
} from './dynamicProviderStore.js';

const STORE_VERSION = '1.8.0';
const INTEGRATION = {
  METADATA_ONLY: 'metadata-only',
  CONFIGURABLE: 'configurable',
  ADAPTER_READY: 'adapter-ready',
  TESTED: 'tested',
  UNKNOWN: 'unknown',
};

function slugify(name) {
  return (name || 'provider').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'provider';
}

// Detect a generic compatibility format from explicit ecosystem compatibility data.
// We do NOT infer format from names — only from declared compatibility.
function detectFormat(eco) {
  const c = eco.compatibility || {};
  if (c.openaiCompatible) return 'openai';
  if (c.anthropicCompatible) return 'anthropic';
  if (c.geminiCompatible) return 'gemini';
  return null;
}

// Determine the integration level + adapter type from safe signals only.
function detectIntegration(eco) {
  const format = detectFormat(eco);
  const v = eco.validation || {};
  let level = INTEGRATION.UNKNOWN;
  if (format) level = INTEGRATION.ADAPTER_READY; // a known provider adapter exists
  else if (v.configurable === true) level = INTEGRATION.CONFIGURABLE;
  else if (eco.website) level = INTEGRATION.METADATA_ONLY;
  return {
    level,
    adapterType: format, // null when no known adapter dialect
    status: 'untested', // only 'tested' after a real successful test
    baseUrl: null, // unknown until the user supplies a self-hosted endpoint
    format,
  };
}

function buildCapabilities(eco) {
  const c = eco.compatibility || {};
  const gatewayLike = ['api-gateway', 'proxy-service', 'local-runtime', 'model-aggregator'].includes(eco.category);
  return {
    openaiCompatible: !!c.openaiCompatible || c.format === 'openai-compatible',
    anthropicCompatible: !!c.anthropicCompatible || c.format === 'anthropic-compatible',
    customBaseUrl: gatewayLike || !!c.openaiCompatible || !!c.anthropicCompatible,
    modelDiscovery: Array.isArray(eco.models) && eco.models.length > 0,
  };
}

function buildAccess(eco) {
  const at = eco.accessType || 'unknown';
  return {
    type: at,
    requiresApiKey: at === 'free' ? false : (at === 'paid' ? true : null),
    pricingStatus: at === 'free' ? 'free' : at === 'paid' ? 'paid' : 'unknown',
  };
}

function buildModelSupport(eco) {
  const models = Array.isArray(eco.models) ? eco.models.map((m) => ({
    modelId: m.modelId || m.id || m.name,
    name: m.name || m.modelId || m.id,
    source: m.source || eco.discoveryOrigin,
    accessType: m.accessType || 'unknown',
    availability: m.availability || 'unknown',
    // Preserve pricing from discovery (OpenRouter/HF/LiteLLM) so the Cloud
    // Providers free/paid toggle and card counts can classify models correctly.
    pricing: m.pricing || null,
    contextLength: m.contextLength || null,
  })) : [];
  return {
    status: models.length ? 'discovered' : 'unknown',
    count: models.length,
    lastUpdated: models.length ? new Date().toISOString() : null,
    models,
  };
}

function buildRecord(eco) {
  const now = new Date().toISOString();
  const slug = slugify(eco.name);
  const id = `dyn:${slug}`;
  const integration = detectIntegration(eco);
  return {
    _v: STORE_VERSION,
    id,
    slug,
    name: eco.name,
    origin: 'ecosystem',
    ecosystemId: eco.id,
    status: 'active',
    lifecycle: eco.lifecycle || 'unknown',
    adoptedAt: now,
    updatedAt: now,
    discoveredAt: eco.discoveredAt || now,
    website: eco.website || null,
    documentationUrl: eco.documentationUrl || null,
    logo: { url: eco.logo || null, source: eco.logoSource || 'fallback', status: eco.logo ? 'resolved' : 'none' },
    source: {
      type: eco.sources?.[0]?.sourceType || (eco.discoveryOrigin ? 'structured-registry' : 'unknown'),
      name: eco.sources?.[0]?.sourceName || eco.discoveryOrigin || 'unknown',
      url: eco.sources?.[0]?.sourceUrl || null,
      confidence: eco.confidence || 'OBSERVED',
    },
    capabilities: buildCapabilities(eco),
    access: buildAccess(eco),
    integration,
    modelSupport: buildModelSupport(eco),
    compatibilityNote: buildCompatibilityNote(eco, integration),
    provenance: {
      ecosystemRecordId: eco.id,
      discoveredAt: eco.discoveredAt || now,
      adoptedVia: 'ecosystem-adopt',
    },
  };
}

function buildCompatibilityNote(eco, integration) {
  if (integration.adapterType === 'openai') return 'OpenAI-compatible API (generic OpenAI adapter applies).';
  if (integration.adapterType === 'anthropic') return 'Anthropic-compatible API (generic Anthropic adapter applies).';
  if (eco.compatibility && Object.keys(eco.compatibility).length) return 'Declared compatibility present; verify before configuring.';
  return 'No proven compatibility format. Metadata-only until verified.';
}

// Does this discovered provider duplicate an existing curated provider?
function matchesCurated(eco) {
  const name = (eco.name || '').toLowerCase();
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const p of PROVIDERS) {
    if (p.id === eco.id) return p.id;
    if (norm(p.name) === norm(eco.name)) return p.id;
    if (norm(p.id) === norm(name)) return p.id;
  }
  return null;
}

export function createDynamicFromEcosystem(ecoId) {
  const store = loadDiscovered();
  const eco = store[ecoId];
  if (!eco) return { success: false, reason: 'unknown-ecosystem-provider' };

  const curatedId = matchesCurated(eco);
  if (curatedId) {
    eco.registryState = 'duplicate';
    eco.duplicateOf = curatedId;
    store[ecoId] = eco; saveDiscovered(store);
    recordChange({ providerId: ecoId, providerName: eco.name, type: CHANGE_TYPES.PROVIDER_DUPLICATE,
      summary: `${eco.name} matches curated provider ${curatedId}; not adopted as duplicate`, sourceType: 'ecosystem', confidence: 'observed' });
    return { success: false, reason: 'duplicate-of-curated', curatedId, provider: eco };
  }

  // Idempotent: re-adoption updates the existing dynamic record.
  const existing = findByEcosystemId(ecoId);
  const rec = existing || buildRecord(eco);
  rec.status = 'active';
  rec.updatedAt = new Date().toISOString();
  rec.website = rec.website || eco.website || null;
  // Always reflect the latest discovery state — models + logo refresh on
  // re-adoption too. A verified (live-probed) model list stays put: it is
  // gateway truth, newer than any discovery snapshot.
  if (rec.modelSupport?.status !== 'verified') rec.modelSupport = buildModelSupport(eco);
  if (eco.logo) rec.logo = { url: eco.logo, source: eco.logoSource || 'fallback', status: eco.logo ? 'resolved' : 'none' };
  upsertDynamicProvider(rec);

  // Link the ecosystem record to its dynamic counterpart.
  eco.dynamicId = rec.id;
  if (eco.registryState !== 'adopted') eco.registryState = 'adopted';
  store[ecoId] = eco; saveDiscovered(store);

  recordChange({ providerId: rec.id, providerName: rec.name, type: CHANGE_TYPES.PROVIDER_ADOPTED,
    summary: `Adopted ${rec.name} into the dynamic provider registry`, sourceType: 'ecosystem', confidence: 'observed' });
  try {
    recordActivity('provider', 'dynamic-adopt', 'success', `${rec.name} added to the dynamic provider registry`, { id: rec.id, origin: 'ecosystem' });
  } catch { /* non-fatal */ }

  // Kick an async live probe so the just-adopted card is upgraded from the
  // discovery snapshot to gateway truth (is_free / `:free` / zero-cost) as soon
  // as the storefront answers — without delaying the adoption response itself.
  try { discoverDynamicModels(rec.id); } catch { /* non-fatal */ }

  const warnings = [];
  if (rec.integration.level === INTEGRATION.METADATA_ONLY) warnings.push('Metadata-only: Nexference cannot configure this provider without a verified compatibility path.');
  if (rec.modelSupport.status === 'unknown') warnings.push('No model list discovered; models must be imported before use.');

  return {
    success: true,
    provider: rec,
    addedToRegistry: !existing,
    integrationStatus: rec.integration.level,
    warnings,
  };
}

const isValidHttpUrl = (s) => {
  if (!s || typeof s !== 'string') return false;
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
};

// User edit of an adopted provider's configuration. Persists ONLY non-secret
// fields from the client (name/website/description/baseUrl/format) into the
// store record so the Cloud Providers detail modal works exactly like custom
// providers. Format/baseUrl are trusted signals — a real endpoint and a known
// adapter dialect raise the integration from metadata-only to adapter-ready.
export function updateDynamicProvider(id, patch = {}) {
  const rec = getDynamicProvider(id);
  if (!rec) return null;
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const ADAPTER_FORMATS = ['openai', 'anthropic', 'gemini'];

  const name = str(patch.name);
  if (name) rec.name = name.slice(0, 100);
  if (typeof patch.website === 'string') rec.website = str(patch.website) || null;

  const desc = str(patch.description);
  if (desc) rec.compatibilityNote = desc.slice(0, 200);

  const format = str(patch.format);
  if (ADAPTER_FORMATS.includes(format)) {
    rec.integration = rec.integration || {};
    rec.integration.adapterType = format;
    rec.integration.format = format;
    if (![INTEGRATION.TESTED, INTEGRATION.ADAPTER_READY].includes(rec.integration.level)) {
      rec.integration.level = INTEGRATION.ADAPTER_READY;
    }
    rec.capabilities = rec.capabilities || {};
    rec.capabilities.openaiCompatible = format === 'openai';
    rec.capabilities.anthropicCompatible = format === 'anthropic';
    rec.capabilities.customBaseUrl = rec.capabilities.customBaseUrl !== false;
    rec.compatibilityNote = format === 'openai'
      ? 'OpenAI-compatible API (generic OpenAI adapter applies).'
      : format === 'anthropic'
        ? 'Anthropic-compatible API (generic Anthropic adapter applies).'
        : 'Gemini-compatible API (generic Gemini adapter applies).';
  }

  const baseUrl = str(patch.baseUrl);
  if (baseUrl) {
    if (!isValidHttpUrl(baseUrl)) throw new Error('baseUrl must be a valid http(s) URL');
    rec.integration = rec.integration || {};
    rec.integration.baseUrl = baseUrl;
    rec.capabilities = rec.capabilities || {};
    rec.capabilities.customBaseUrl = true;
    if (!rec.integration.adapterType && rec.integration.level === INTEGRATION.UNKNOWN) {
      rec.integration.level = INTEGRATION.CONFIGURABLE;
    }
  }

  rec.updatedAt = new Date().toISOString();
  upsertDynamicProvider(rec);
  try {
    recordActivity('provider', 'dynamic-update', 'info', `${rec.name} configuration updated`, { id });
  } catch { /* non-fatal */ }
  return rec;
}

export function deactivateDynamicProvider(id) {
  const rec = getDynamicProvider(id);
  if (!rec) return null;
  setDynamicProviderStatus(id, 'inactive');
  recordActivity('provider', 'dynamic-deactivate', 'info', `${rec.name} deactivated (hidden from active catalogue)`, { id });
  return getDynamicProvider(id);
}

export function reactivateDynamicProvider(id) {
  const rec = getDynamicProvider(id);
  if (!rec) return null;
  setDynamicProviderStatus(id, 'active');
  recordActivity('provider', 'dynamic-reactivate', 'info', `${rec.name} reactivated`, { id });
  return getDynamicProvider(id);
}

export function removeDynamicProviderRecord(id) {
  const rec = getDynamicProvider(id);
  if (!rec) return false;
  // History/provenance preserved: the ecosystem discovery record is NOT deleted.
  const ecoStore = loadDiscovered();
  const eco = ecoStore[rec.ecosystemId];
  if (eco) { eco.dynamicId = null; eco.registryState = 'discovered'; ecoStore[rec.ecosystemId] = eco; saveDiscovered(ecoStore); }
  const removed = removeDynamicProvider(id);
  recordActivity('provider', 'dynamic-remove', 'info', `${rec.name} removed from dynamic registry (provenance kept)`, { id });
  return removed;
}

// One-way sync from an Ecosystem discovery record to its adopted Dynamic provider:
// copies the discovered model list (by provenances) + logo into the dynamic record
// so the Cloud Providers "Adopted" filter reflects the latest discovery state.
export function syncEcosystemModels(ecoId) {
  if (!ecoId) return null;
  const rec = findByEcosystemId(ecoId);
  if (!rec) return null;
  const eco = loadDiscovered()[ecoId];
  if (!eco) return rec;
  // A live-probed (verified) modelSupport is gateway truth — never let a later
  // discovery snapshot clobber it. Only import the snapshot while the record's
  // model list still comes from discovery.
  if (rec.modelSupport?.status !== 'verified') rec.modelSupport = buildModelSupport(eco);
  if (eco.logo) rec.logo = { url: eco.logo, source: eco.logoSource || 'fallback', status: eco.logo ? 'resolved' : 'none' };
  rec.website = rec.website || eco.website || null;
  rec.updatedAt = new Date().toISOString();
  upsertDynamicProvider(rec);
  return rec;
}

// Re-read the source ecosystem record and recompute integration + model support.
export function refreshDynamicMetadata(id) {
  const rec = getDynamicProvider(id);
  if (!rec) return null;
  const eco = loadDiscovered()[rec.ecosystemId];
  if (!eco) return rec;
  rec.integration = detectIntegration(eco);
  rec.capabilities = buildCapabilities(eco);
  rec.access = buildAccess(eco);
  if (rec.modelSupport?.status !== 'verified') rec.modelSupport = buildModelSupport(eco);
  rec.compatibilityNote = buildCompatibilityNote(eco, rec.integration);
  rec.website = rec.website || eco.website || null;
  rec.documentationUrl = eco.documentationUrl || null;
  rec.updatedAt = new Date().toISOString();
  if (eco.logo) { rec.logo = { url: eco.logo, source: eco.logoSource || 'fallback', status: 'resolved' }; }
  upsertDynamicProvider(rec);
  return rec;
}

// Import model metadata ONLY when a real source list exists. Never invent models.
export async function discoverDynamicModels(id) {
  const rec = getDynamicProvider(id);
  if (!rec) return { status: 'not-found' };

  // Live probe FIRST — the same honest pipeline custom (cst:) providers use
  // (official /models → keyless /api/pricing → storefront sitemap → scrape).
  // Adopted records know the storefront website, and once the user supplies a
  // base URL + format the gateway itself is probed. This keeps adopted provider
  // cards on gateway truth (free count = is_free flag / `:free` marker / zero
  // cost), exactly like UNO Router — not just the discovery snapshot.
  const probe = {
    identity: { name: rec.name, website: rec.website || null },
    api: rec.integration?.baseUrl
      ? { baseUrl: rec.integration.baseUrl, format: rec.integration.adapterType || 'openai' }
      : null,
  };
  if (probe.identity.website || probe.api) {
    try {
      const live = await fetchCustomProviderModelsList(probe, '');
      // Only upgrade from the discovery snapshot when the probe reached a REAL
      // gateway signal (official /models, keyless pricing, or the storefront
      // sitemap). A bare website scrape can return a single site-title token and
      // is never a better inventory than the discovery snapshot.
      const weakLive = !live.ok || !live.models.length ||
        live.source === 'website' || /scrape/i.test(live.source);
      if (!weakLive) {
        const now = new Date().toISOString();
        rec.modelSupport = {
          status: 'verified',
          count: live.models.length,
          lastUpdated: now,
          fetchedAt: now,
          source: live.source,
          models: live.models.map((m) => {
            const zero = (m.pricing?.input === 0 && m.pricing?.output === 0) || (m.pricing?.input === 0 && m.pricing?.output == null);
            return {
              modelId: m.id,
              id: m.id,
              name: m.name || m.id,
              source: live.source,
              accessType: zero ? 'free' : 'paid',
              availability: 'live',
              pricing: m.pricing || null,
              contextLength: m.context_length || null,
            };
          }),
        };
        rec.updatedAt = now;
        upsertDynamicProvider(rec);
        return { status: 'imported', imported: rec.modelSupport.count, source: live.source };
      }
    } catch { /* fall through to discovery snapshot */ }
  }

  const eco = loadDiscovered()[rec.ecosystemId];
  if (!eco || !Array.isArray(eco.models) || !eco.models.length) {
    rec.modelSupport = { status: 'unknown', count: 0, lastUpdated: null, models: [] };
    rec.updatedAt = new Date().toISOString();
    upsertDynamicProvider(rec);
    return { status: 'no-source', imported: 0 };
  }
  rec.modelSupport = buildModelSupport(eco);
  // Touch updatedAt so the card's "· Ns/m/h ago" timestamp moves fresh after a
  // model refresh — same behaviour as custom-provider fetch-models.
  rec.updatedAt = new Date().toISOString();
  upsertDynamicProvider(rec);
  return { status: 'imported', imported: rec.modelSupport.count };
}

// Real connection test. Requires a key (never stored). Only marks 'tested' on
// genuine success. Returns the adapter outcome so the UI can show it honestly.
export async function testDynamicConnection(id, { key, model, baseUrl } = {}) {
  const rec = getDynamicProvider(id);
  if (!rec) return { status: 0, error: 'not-found' };
  if (!rec.integration.adapterType) return { status: 0, error: 'no-known-adapter', message: 'No proven compatibility format; cannot test.' };
  const url = baseUrl || rec.integration.baseUrl;
  if (!url) return { status: 0, error: 'no-base-url', message: 'No known endpoint; supply a base URL to test your instance.' };
  if (!key) return { status: 0, error: 'missing-key' };

  try {
    const adapter = getProviderAdapter({ format: rec.integration.adapterType });
    const result = await adapter.testConnection({ url, key, model, auth: rec.integration.adapterType === 'anthropic' ? 'x-api-key' : 'bearer' });
    if (result.status >= 200 && result.status < 400) {
      rec.integration.status = 'tested';
      rec.integration.level = rec.integration.adapterType ? INTEGRATION.ADAPTER_READY : rec.integration.level;
    }
    rec.updatedAt = new Date().toISOString();
    upsertDynamicProvider(rec);
    return { status: result.status, body: result.body, tested: rec.integration.status === 'tested' };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

export const DYNAMIC_INTEGRATION = INTEGRATION;
