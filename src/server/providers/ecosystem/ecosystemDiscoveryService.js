// Ecosystem Discovery Service (v1.7.0) — the new, SEPARATE layer that finds AI
// providers / gateways / aggregators / catalogues from configured external
// sources, with full provenance and evidence. It does NOT modify the curated
// provider registry and discovered providers never enter the configuration flow
// unless explicitly adopted AND validation supports it.
//
// Honesty rules:
//   • Every field is either sourced or null/unknown. We never invent values.
//   • Provenance + evidence are first-class: each fact links back to its source.
//   • Duplicate detection is conservative — similar names are flagged, not merged.
//   • Manual refresh only. One failing source never fails the whole discovery.

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import {
  loadDiscovered, saveDiscovered, loadHistory, appendHistory, loadSourceState, saveSourceState,
} from './ecosystemStore.js';
import { recordChange, CHANGE_TYPES } from '../providerChangeStore.js';
import { recordActivity } from '../../activity/activityService.js';
import {
  PROVIDER_CATEGORIES, REGISTRY_STATES, DUPLICATE_STATES, VALIDATION_IDENTITY, LOGO_SOURCE, DISCOVERY_PHASE, TRUST_LEVELS,
} from './constants.js';
import {
  tokenize, normalizeName, domainOf, siteKey, makeId, identitySignals, inferCategory, matchDuplicates,
} from './normalization.js';
import { resolveLogo, validateLogoUrl } from './logoResolver.js';
import { createStructuredRegistrySource } from './sources/structuredRegistrySource.js';
import { providerDiscoveryService } from '../providerDiscoveryService.js';
import { createDynamicFromEcosystem } from '../dynamic/dynamicProviderService.js';

const BASE_DIR = process.cwd();
const SOURCES_FILE = join(BASE_DIR, 'data', 'discovery-sources.json');
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

function confidenceForTrust(trust) {
  if (trust === 'official') return 'MEASURED';
  if (trust === 'curated') return 'CURATED';
  if (trust === 'community') return 'OBSERVED';
  return 'OBSERVED';
}

// ── Source registry (controlled, not scraped) ──
export function loadSourcesConfig() {
  try {
    if (!existsSync(SOURCES_FILE)) return { sources: [] };
    const obj = JSON.parse(readFileSync(SOURCES_FILE, 'utf8'));
    return obj && Array.isArray(obj.sources) ? obj : { sources: [] };
  } catch {
    return { sources: [] };
  }
}

function buildAdapters() {
  const { sources } = loadSourcesConfig();
  return sources
    .filter((s) => s.enabled !== false)
    .map((cfg) => createStructuredRegistrySource(cfg, { baseDir: BASE_DIR }));
}

export function getSources() {
  const { sources } = loadSourcesConfig();
  const state = loadSourceState();
  return sources.map((s) => {
    const st = state[s.id] || {};
    const stale = st.lastRefresh && (Date.now() - new Date(st.lastRefresh).getTime() > FRESH_MS);
    return {
      id: s.id,
      name: s.name || s.id,
      type: s.type || 'open-source-registry',
      url: s.homepage || s.repository || (Array.isArray(s.rawUrls) ? s.rawUrls[0] : null),
      trustLevel: s.trustLevel || 'community',
      enabled: s.enabled !== false,
      requiresManualRefresh: s.requiresManualRefresh !== false,
      lastRefresh: st.lastRefresh || null,
      status: st.status || 'never',
      failureReason: st.failureReason || null,
      candidatesFound: st.candidatesFound || 0,
      stale: !!stale,
    };
  });
}

// ── Evidence building ──
function buildEvidence(candidate, sourceMeta, observedAt) {
  const conf = confidenceForTrust(sourceMeta.trustLevel);
  const ev = [];
  const push = (field, value) => {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value) && !value.length) return;
    ev.push({
      sourceId: sourceMeta.id, sourceType: sourceMeta.type, sourceUrl: sourceMeta.url,
      observedAt, field, value: Array.isArray(value) ? `${value.length} item(s)` : String(value), confidence: conf,
    });
  };
  push('name', candidate.name);
  push('website', candidate.website);
  push('description', candidate.description);
  push('category', candidate.category || inferCategory(candidate));
  if (candidate.compatibility) push('compatibility', JSON.stringify(candidate.compatibility));
  push('repository', candidate.repository);
  push('endpoints', candidate.endpoints);
  push('models', candidate.models);
  push('logo', candidate.logo);
  return ev;
}

function buildClaimedBySource(evidence) {
  const out = {};
  for (const e of evidence) {
    (out[e.field] = out[e.field] || []).push(e.sourceId);
  }
  return out;
}

// Merge one normalized candidate (with its source) into a partial record shell.
function recordFromCandidate(candidate, sourceMeta, observedAt, fp) {
  const id = makeId(sourceMeta.id, fp);
  const category = inferCategory(candidate);
  const record = {
    id,
    _v: '1.7.0',
    name: normalizeName(candidate.name),
    normalizedName: candidate.normalizedName || normalizeName(candidate.name),
    category,
    description: candidate.description || null,
    website: candidate.website || null,
    documentationUrl: candidate.documentationUrl || null,
    apiDocumentationUrl: candidate.apiDocumentationUrl || null,
    repository: candidate.repository || null,
    logo: null,
    logoSource: null,
    endpoints: Array.isArray(candidate.endpoints) ? candidate.endpoints : [],
    compatibility: candidate.compatibility || null,
    modelSource: candidate.modelSource || null,
    accessType: candidate.accessType || 'unknown',
    availability: candidate.availability || 'unknown',
    lifecycle: candidate.lifecycle || 'unknown',
    discoveryStatus: DISCOVERY_PHASE.DISCOVERED,
    confidence: confidenceForTrust(sourceMeta.trustLevel),
    discoveredAt: null,
    lastSeenAt: observedAt,
    lastCheckedAt: observedAt,
    sources: [],
    evidence: [],
    claimedBySource: {},
    validation: {
      identity: VALIDATION_IDENTITY.UNKNOWN, websiteReachable: null, apiDocumented: null,
      endpointPubliclyKnown: null, modelsObserved: null, configurable: null, lastValidatedAt: null,
    },
    duplicateOf: null,
    duplicateState: DUPLICATE_STATES.UNIQUE,
    registryState: REGISTRY_STATES.DISCOVERED,
    discoveryOrigin: sourceMeta.id,
    models: Array.isArray(candidate.models) ? candidate.models.map((m) => normalizeModel(m, sourceMeta)) : [],
    missingFromSource: false,
    lastMissingAt: null,
  };
  const logo = resolveLogo({ website: record.website, logo: candidate.logo, logoSource: candidate.logoSource, repository: record.repository });
  if (logo) { record.logo = logo.url; record.logoSource = logo.source; }
  return record;
}

function normalizeModel(m, sourceMeta) {
  if (typeof m === 'string') m = { id: m, name: m };
  return {
    providerId: null, modelId: m.id || m.name, name: m.name || m.id,
    source: sourceMeta.id, observedAt: new Date().toISOString(),
    accessType: m.accessType || 'unknown', availability: m.availability || 'unknown',
    capabilities: m.capabilities || null, pricing: m.pricing || null,
  };
}

// Merge evidence/sources from one candidate into an existing record shell.
function mergeCandidate(record, candidate, sourceMeta, observedAt, fp) {
  const ev = buildEvidence(candidate, sourceMeta, observedAt);
  record.evidence = [...record.evidence, ...ev];
  record.claimedBySource = buildClaimedBySource(record.evidence);
  const srcEntry = { sourceId: sourceMeta.id, sourceName: sourceMeta.name, sourceType: sourceMeta.type, sourceUrl: sourceMeta.url, trustLevel: sourceMeta.trustLevel, found: true, lastCheckedAt: observedAt };
  const existing = record.sources.find((s) => s.sourceId === sourceMeta.id);
  if (existing) Object.assign(existing, srcEntry);
  else record.sources.push(srcEntry);
  // Strengthen discovery status only with real observations.
  if (record.models && record.models.length) record.discoveryStatus = DISCOVERY_PHASE.VALIDATED;
  else if (record.website) record.discoveryStatus = DISCOVERY_PHASE.OBSERVED;
  record.lastSeenAt = observedAt;
  record.lastCheckedAt = observedAt;
  // Keep best logo.
  const logo = resolveLogo({ website: record.website, logo: candidate.logo, logoSource: candidate.logoSource, repository: record.repository });
  if (logo && !record.logo) { record.logo = logo.url; record.logoSource = logo.source; }
}

// ── Main discovery orchestration ──
let discovering = false;

export async function discoverEcosystem({ force = false } = {}) {
  if (discovering) return { ok: false, error: 'already_running' };
  discovering = true;
  const t0 = Date.now();
  const sourceState = loadSourceState();
  const existing = loadDiscovered();
  const observedAt = new Date().toISOString();
  try {
    const adapters = buildAdapters();
    const working = {}; // id -> record (new this run)
    const foundBySource = {}; // sourceId -> Set(id)
    const sourceSummaries = [];

    for (const adapter of adapters) {
      const meta = adapter.getSourceMetadata();
      foundBySource[meta.id] = new Set();
      try {
        const res = await adapter.discover();
        if (!res.supported) {
          sourceState[meta.id] = { lastRefresh: observedAt, status: 'skipped', failureReason: res.reason || null, candidatesFound: 0 };
          sourceSummaries.push({ id: meta.id, status: 'skipped', reason: res.reason });
          continue;
        }
        // Group candidates by a stable fingerprint (host/owner > name token).
        const groups = new Map();
        for (const cand of res.candidates) {
          const fp = siteKey(cand.website) || tokenize(cand.name);
          const rec = recordFromCandidate(cand, meta, observedAt, fp);
          if (!groups.has(fp)) groups.set(fp, []);
          groups.get(fp).push({ cand, rec });
        }
        // Merge candidates that share a fingerprint into one record.
        for (const [, items] of groups) {
          const primary = items[0];
          const id = primary.rec.id;
          if (!working[id]) working[id] = primary.rec;
          for (const it of items) mergeCandidate(working[id], it.cand, meta, observedAt, fpKey(it.cand));
          foundBySource[meta.id].add(id);
        }
        sourceState[meta.id] = { lastRefresh: observedAt, status: 'ok', failureReason: res.errors && res.errors.length ? res.errors.join('; ') : null, candidatesFound: res.candidates.length };
        sourceSummaries.push({ id: meta.id, status: 'ok', candidates: res.candidates.length, errors: res.errors || [] });
      } catch (e) {
        sourceState[meta.id] = { lastRefresh: observedAt, status: 'failed', failureReason: String(e.message || e), candidatesFound: 0 };
        sourceSummaries.push({ id: meta.id, status: 'failed', reason: String(e.message || e) });
      }
    }

    // Conservative cross-fingerprint duplicate detection (do not merge uncertain).
    const ids = Object.keys(working);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = working[ids[i]], b = working[ids[j]];
        const m = matchDuplicates(a, b);
        if (m === 'confirmed') {
          // Strong match → fold b into a, keep a.
          for (const ev of b.evidence) a.evidence.push(ev);
          a.claimedBySource = buildClaimedBySource(a.evidence);
          for (const s of b.sources) if (!a.sources.find((x) => x.sourceId === s.sourceId)) a.sources.push(s);
          a.duplicateState = DUPLICATE_STATES.CONFIRMED;
          delete working[ids[j]];
          ids.splice(j, 1); j--;
        } else if (m === 'likely') {
          b.duplicateOf = a.id;
          b.duplicateState = DUPLICATE_STATES.LIKELY;
        }
      }
    }

    // Reconcile with the persisted store (preserve discoveredAt / adoption / validation).
    const next = {};
    const newlyDiscovered = [];
    const seenAgain = [];
    for (const id of Object.keys(working)) {
      const rec = working[id];
      const prev = existing[id];
      if (prev) {
        rec.discoveredAt = prev.discoveredAt || observedAt;
        rec.registryState = prev.registryState || REGISTRY_STATES.DISCOVERED;
        rec.validation = prev.validation || rec.validation;
        rec.duplicateOf = prev.duplicateOf || rec.duplicateOf;
        rec.missingFromSource = false;
        rec.lastMissingAt = null;
        if (prev.missingFromSource && !prev.discoveredAt) { /* not applicable */ }
        if (prev.missingFromSource) seenAgain.push(rec);
      } else {
        rec.discoveredAt = observedAt;
        newlyDiscovered.push(rec);
        if (rec.duplicateState === DUPLICATE_STATES.LIKELY) rec.registryState = REGISTRY_STATES.REVIEW;
      }
      next[id] = rec;
    }
    // Records that vanished from every source this run → mark missing (keep data).
    for (const [id, prev] of Object.entries(existing)) {
      if (!next[id]) {
        prev.missingFromSource = true;
        prev.lastMissingAt = observedAt;
        next[id] = prev;
      }
    }

    saveDiscovered(next);
    saveSourceState(sourceState);

    // Honest change records (providerChangeStore de-dupes repeats within 24h).
    for (const rec of newlyDiscovered) {
      recordChange({ providerId: rec.id, providerName: rec.name, type: CHANGE_TYPES.PROVIDER_DISCOVERED,
        summary: `${rec.name} discovered via ${rec.discoveryOrigin}`, previousValue: null,
        newValue: { category: rec.category, source: rec.discoveryOrigin }, sourceType: 'ecosystem', confidence: 'observed' });
    }
    for (const rec of seenAgain) {
      recordChange({ providerId: rec.id, providerName: rec.name, type: CHANGE_TYPES.PROVIDER_SEEN_AGAIN,
        summary: `${rec.name} seen again after being missing`, sourceType: 'ecosystem', confidence: 'observed' });
    }
    for (const [id, prev] of Object.entries(existing)) {
      if (!working[id] && !prev.missingFromSource) {
        recordChange({ providerId: id, providerName: prev.name, type: CHANGE_TYPES.PROVIDER_MISSING,
          summary: `${prev.name} no longer reported by its source`, sourceType: 'ecosystem', confidence: 'observed' });
      }
    }

    const summary = {
      ok: true, elapsedMs: Date.now() - t0, sources: sourceSummaries,
      discovered: Object.keys(next).length,
      newlyDiscovered: newlyDiscovered.length,
      withErrors: sourceSummaries.filter((s) => s.status === 'failed' || s.status === 'skipped').length,
    };
    appendHistory({ at: observedAt, ...summary });
    try {
      recordActivity('discovery', 'ecosystem-discover', 'success',
        `Ecosystem discovery: ${summary.newlyDiscovered} new, ${summary.discovered} total across ${sourceSummaries.length} source(s)`,
        { sources: sourceSummaries.length, newlyDiscovered: summary.newlyDiscovered });
    } catch { /* non-fatal */ }
    return summary;
  } finally {
    discovering = false;
  }
}

function fpKey(cand) { return siteKey(cand.website) || tokenize(cand.name); }

// ── Read APIs ──
export function listEcosystemProviders({ registryState, category, search, missing } = {}) {
  let list = Object.values(loadDiscovered());
  if (registryState) list = list.filter((p) => p.registryState === registryState);
  if (category) list = list.filter((p) => p.category === category);
  if (missing === true) list = list.filter((p) => p.missingFromSource);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.website || '').toLowerCase().includes(q));
  }
  return list.sort((a, b) => new Date(b.discoveredAt || 0) - new Date(a.discoveredAt || 0));
}

export function getEcosystemProvider(id) {
  return loadDiscovered()[id] || null;
}

// ── Validation pipeline ──
export async function validateProvider(id) {
  const store = loadDiscovered();
  const rec = store[id];
  if (!rec) return null;
  const v = rec.validation || {};
  v.identity = rec.website || rec.repository ? VALIDATION_IDENTITY.LIKELY : VALIDATION_IDENTITY.UNKNOWN;
  if (rec.apiDocumentationUrl) v.apiDocumented = true;
  v.endpointPubliclyKnown = Array.isArray(rec.endpoints) && rec.endpoints.length > 0;
  v.modelsObserved = Array.isArray(rec.models) && rec.models.length > 0;
  if (rec.website) {
    const ok = await checkReachable(rec.website);
    v.websiteReachable = ok;
  } else v.websiteReachable = null;
  // Configurable only when every positive signal is present; otherwise null (unknown).
  const signals = [v.websiteReachable, v.apiDocumented, v.endpointPubliclyKnown, v.identity !== VALIDATION_IDENTITY.UNKNOWN];
  if (signals.some((s) => s === false)) v.configurable = false;
  else if (signals.every((s) => s === true)) v.configurable = true;
  else v.configurable = null;
  v.lastValidatedAt = new Date().toISOString();
  rec.validation = v;
  rec.discoveryStatus = v.websiteReachable ? DISCOVERY_PHASE.OBSERVED : rec.discoveryStatus;
  store[id] = rec;
  saveDiscovered(store);
  return rec;
}

async function checkReachable(url) {
  const v = validateLogoUrl(url); // only https validated
  if (!v.ok) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    if (r.url && !validateLogoUrl(r.url).ok) return false; // redirected to unsafe host
    return r.ok || r.status === 405 || r.status === 403; // 403/405 still means host exists
  } catch {
    return false;
  }
}

// ── Adoption workflow (explicit only) ──
function setRegistryState(id, state, changeType, summary) {
  const store = loadDiscovered();
  const rec = store[id];
  if (!rec) return null;
  rec.registryState = state;
  store[id] = rec;
  saveDiscovered(store);
  recordChange({ providerId: id, providerName: rec.name, type: changeType, summary, sourceType: 'ecosystem', confidence: 'observed' });
  return rec;
}

export function adoptProvider(id) {
  const rec = setRegistryState(id, REGISTRY_STATES.ADOPTED, CHANGE_TYPES.PROVIDER_ADOPTED, `Adopted ${getEcosystemProvider(id)?.name || id} into local registry`);
  // Promotion pipeline (v1.8.0): adoption creates a persistent Dynamic Provider
  // Record so the provider can appear in the unified catalogue. Idempotent and
  // refuses to duplicate a curated provider.
  const dyn = createDynamicFromEcosystem(id);
  if (dyn && dyn.success && dyn.provider) {
    rec.dynamicId = dyn.provider.id;
    const store = loadDiscovered();
    store[id] = rec;
    saveDiscovered(store);
  }
  // Return both the ecosystem record and the adoption outcome so the UI can show
  // exactly what happened (success / integration level / warnings / curated-dup).
  return { provider: rec, adoption: dyn };
}
export function ignoreProvider(id) {
  return setRegistryState(id, REGISTRY_STATES.IGNORED, CHANGE_TYPES.PROVIDER_IGNORED, `Ignored ${getEcosystemProvider(id)?.name || id}`);
}
export function markForReview(id) {
  return setRegistryState(id, REGISTRY_STATES.REVIEW, CHANGE_TYPES.PROVIDER_REVIEW, `Marked ${getEcosystemProvider(id)?.name || id} for review`);
}
export function restoreProvider(id) {
  const rec = getEcosystemProvider(id);
  const state = rec && rec.duplicateState === DUPLICATE_STATES.LIKELY ? REGISTRY_STATES.REVIEW : REGISTRY_STATES.DISCOVERED;
  return setRegistryState(id, state, CHANGE_TYPES.PROVIDER_RESTORED, `Restored ${rec?.name || id}`);
}

// ── Summary for the Ecosystem page + Intelligence Center ──
export function getEcosystemSummary() {
  const store = loadDiscovered();
  const all = Object.values(store);
  const curatedCount = safeCount(() => providerDiscoveryService.getAllProviderIntelligence().length);
  const now = Date.now();
  const byRegistryState = {};
  const byCategory = {};
  let newlyDiscovered = 0, needsReview = 0, adopted = 0, ignored = 0;
  for (const p of all) {
    byRegistryState[p.registryState] = (byRegistryState[p.registryState] || 0) + 1;
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    if (p.discoveredAt && now - new Date(p.discoveredAt).getTime() < FRESH_MS) newlyDiscovered++;
    if (p.registryState === REGISTRY_STATES.REVIEW || p.duplicateState === DUPLICATE_STATES.LIKELY) needsReview++;
    if (p.registryState === REGISTRY_STATES.ADOPTED) adopted++;
    if (p.registryState === REGISTRY_STATES.IGNORED) ignored++;
  }
  const sources = getSources();
  const staleSources = sources.filter((s) => s.stale || s.status === 'failed' || s.status === 'never').length;
  return {
    curatedProviders: curatedCount,
    discoveredProviders: all.length,
    newlyDiscovered,
    needsReview,
    adopted,
    ignored,
    staleSources,
    sources: sources.length,
    byRegistryState,
    byCategory,
    generatedAt: new Date().toISOString(),
  };
}

function safeCount(fn) { try { return fn(); } catch { return 0; } }
