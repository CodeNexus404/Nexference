// Provider Discovery Service (v1.4.0) — the intelligence layer that turns raw
// provider facts (from trusted sources) into a single, normalised, honest
// provider-intelligence record per provider, tracks changes over time, and
// exposes it for the UI.
//
// Honesty rules enforced here:
//   • A provider is only marked AVAILABLE/VERIFIED when a real, public source
//     confirmed it. Otherwise it is CURATED (known) or UNKNOWN (we can't tell).
//   • We never probe keyed providers (no key, no guessing). They stay CURATED.
//   • On a failed refresh we keep the last-known-good data and mark it STALE
//     rather than hiding the gap.
//   • Change records never contain secrets, headers, or raw pricing.
//   • Discovery is on-demand / manual. Nothing auto-polls in a loop.
//
// Cache: in-memory map with a TTL, de-duplicated in-flight requests, and a
// disk mirror under ~/.nexference so firstSeenAt and change baselines survive
// restarts and a failed refresh preserves last-good data.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { PROVIDERS, getProvider } from './registry.js';
import { modelCache } from './modelCache.js';
import { isFreeModel } from '../models/modelIntelligenceService.js';
import { curatedSource } from './sources/curatedSource.js';
import { officialApiSource } from './sources/officialApiSource.js';
import { recordChange, listChanges, CHANGE_TYPES } from './providerChangeStore.js';
import { recordActivity } from '../activity/activityService.js';
import {
  DISCOVERY_STATUS, AVAILABILITY, CONFIDENCE, SOURCE_TYPES,
} from './discoveryStatus.js';

const DATA_DIR = join(homedir(), '.nexference');
const FILE = join(DATA_DIR, 'provider-intelligence.json');
const TTL_MS = 15 * 60 * 1000;

const SOURCES = [curatedSource, officialApiSource];
const DISCOVERABLE = PROVIDERS.filter((p) => p.id !== 'custom');

// id -> normalised intelligence record (with an internal _fetchedAt timestamp).
const intel = {};
const inflight = new Set();

function readDisk() {
  try {
    if (!existsSync(FILE)) return null;
    const raw = readFileSync(FILE, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function writeDisk() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const out = {};
    for (const [id, rec] of Object.entries(intel)) {
      const { _fetchedAt, ...rest } = rec;
      out[id] = rest;
    }
    writeFileSync(FILE, JSON.stringify(out, null, 2));
  } catch { /* best-effort persistence */ }
}

function cacheSourceToStatus(src) {
  if (!src) return 'unknown';
  if (['proxy', 'manual', 'startup', 'periodic'].includes(src)) return 'live';
  if (src === 'website') return 'fallback-website';
  if (src === 'static') return 'fallback-static';
  return 'cached';
}

// Count free/paid/total + sorted id list from the existing model cache. The
// cache is already populated by the model-fetch pipeline; we only read it.
function modelSnapshot(providerId) {
  const entry = modelCache[providerId];
  const models = (entry && Array.isArray(entry.models)) ? entry.models : [];
  let free = 0;
  let paid = 0;
  for (const m of models) {
    if (isFreeModel(providerId, m)) free++;
    else paid++;
  }
  return {
    total: models.length,
    free,
    paid,
    unknown: 0,
    modelIds: models.map((m) => m.id).filter(Boolean).sort(),
    sourceStatus: cacheSourceToStatus(entry && entry.source),
  };
}

// Build a baseline record (no live check) so the UI has honest data immediately.
function buildBaseline(provider) {
  const curated = curatedSource.discoverProvider(provider);
  const snap = modelSnapshot(provider.id);
  const identity = curated.supported ? curated.facts.identity : { name: provider.id, website: null, description: null };
  const formats = curated.supported ? curated.facts.formats : (provider.format ? [provider.format] : []);
  const now = new Date().toISOString();
  return {
    id: provider.id,
    identity,
    status: {
      availability: AVAILABILITY.UNKNOWN,
      discoveryStatus: DISCOVERY_STATUS.CURATED,
      sourceStatus: snap.sourceStatus,
    },
    access: {
      requiresApiKey: curated.supported ? curated.facts.requiresApiKey : !provider.publicModels,
      supportsFreeModels: snap.free > 0,
      supportsPaidModels: snap.paid > 0,
      accessType: deriveAccessType(snap.free, snap.paid),
    },
    compatibility: compatFromFormat(provider.format, formats),
    source: {
      type: SOURCE_TYPES.CURATED_REGISTRY,
      url: provider.baseUrl,
      confidence: CONFIDENCE.MEDIUM,
      verifiedAt: null,
      lastCheckedAt: null,
    },
    models: { total: snap.total, free: snap.free, paid: snap.paid, unknown: snap.unknown, modelIds: snap.modelIds },
    timestamps: { firstSeenAt: now, lastSeenAt: null, lastCheckedAt: null, lastChangedAt: null },
    discovered: false,
    _baseline: true,
    _fetchedAt: Date.now(),
  };
}

function compatFromFormat(format, formats) {
  const list = formats && formats.length ? formats : (format ? [format] : []);
  return {
    openaiCompatible: list.includes('openai'),
    anthropicCompatible: list.includes('anthropic'),
    geminiCompatible: list.includes('gemini'),
    formats: list,
  };
}

function deriveAccessType(free, paid) {
  if (free > 0 && paid > 0) return 'freemium';
  if (free > 0) return 'free';
  if (paid > 0) return 'paid';
  return 'unknown';
}

function ensureBaseline(providerId) {
  if (intel[providerId]) return intel[providerId];
  const p = getProvider(providerId);
  if (!p) return null;
  const rec = buildBaseline(p);
  intel[providerId] = rec;
  writeDisk();
  return rec;
}

// Full discovery for one provider: run every supported source, merge into a
// normalised record, diff against the previous record, and record changes.
async function discoverProvider(provider, { force = false } = {}) {
  if (inflight.has(provider.id)) {
    return { skipped: true, provider: provider.id, record: intel[provider.id] || null };
  }
  inflight.add(provider.id);
  try {
    const previous = intel[provider.id] ? { ...intel[provider.id] } : null;
    const curated = curatedSource.discoverProvider(provider);
    const official = await officialApiSource.discoverProvider(provider);

    const snap = modelSnapshot(provider.id);
    const now = new Date().toISOString();

    // ── Merge sources into status/source ──
    let discoveryStatus = DISCOVERY_STATUS.CURATED;
    let availability = AVAILABILITY.UNKNOWN;
    let sourceType = SOURCE_TYPES.CURATED_REGISTRY;
    let confidence = CONFIDENCE.MEDIUM;
    let verifiedAt = null;
    const identity = curated.supported ? curated.facts.identity : { name: provider.id, website: null, description: null };
    const requiresApiKey = curated.supported ? curated.facts.requiresApiKey : !provider.publicModels;
    const formats = curated.supported ? curated.facts.formats : (provider.format ? [provider.format] : []);

    if (official.supported) {
      sourceType = SOURCE_TYPES.OFFICIAL_API;
      confidence = CONFIDENCE.HIGH;
      verifiedAt = now;
      if (official.facts.availabilityClaim === 'available') {
        discoveryStatus = DISCOVERY_STATUS.VERIFIED;
        availability = AVAILABILITY.AVAILABLE;
      } else {
        discoveryStatus = DISCOVERY_STATUS.UNAVAILABLE;
        availability = AVAILABILITY.UNAVAILABLE;
      }
    }

    // Stale logic: previously available, now not → keep last-good data, mark STALE.
    if (previous && previous.status.availability === AVAILABILITY.AVAILABLE
        && availability === AVAILABILITY.UNAVAILABLE) {
      discoveryStatus = DISCOVERY_STATUS.STALE;
    }

    const firstSeenAt = previous?.timestamps?.firstSeenAt || now;
    const lastSeenAt = availability === AVAILABILITY.AVAILABLE ? now : (previous?.timestamps?.lastSeenAt || null);

    const record = {
      id: provider.id,
      identity,
      status: { availability, discoveryStatus, sourceStatus: snap.sourceStatus },
      access: {
        requiresApiKey,
        supportsFreeModels: snap.free > 0,
        supportsPaidModels: snap.paid > 0,
        accessType: deriveAccessType(snap.free, snap.paid),
      },
      compatibility: compatFromFormat(provider.format, formats),
      source: { type: sourceType, url: provider.baseUrl, confidence, verifiedAt, lastCheckedAt: now },
      models: { total: snap.total, free: snap.free, paid: snap.paid, unknown: snap.unknown, modelIds: snap.modelIds },
      timestamps: { firstSeenAt, lastSeenAt, lastCheckedAt: now, lastChangedAt: previous?.timestamps?.lastChangedAt || null },
      discovered: true,
      _baseline: false,
      _fetchedAt: Date.now(),
    };

    const changes = diffRecords(provider, previous, record);
    for (const c of changes) {
      recordChange(c);
      record.timestamps.lastChangedAt = now;
    }

    intel[provider.id] = record;
    writeDisk();
    return { skipped: false, provider: provider.id, record, changes };
  } finally {
    inflight.delete(provider.id);
  }
}

// Compare previous and next records, emit typed change records (secret-free).
function diffRecords(provider, prev, next) {
  const changes = [];
  if (!prev) {
    // First time we actively discovered this provider.
    if (next.status.availability === AVAILABILITY.AVAILABLE) {
      changes.push(mk(provider, CHANGE_TYPES.PROVIDER_DISCOVERED,
        `${next.identity.name} discovered and reachable`,
        { availability: next.status.availability, modelCount: next.models.total }));
    }
    return changes;
  }

  // Transition from a baseline (never actively discovered) to a real record is a
  // first discovery, not a "restore". Avoids mislabelling on the very first
  // refresh.
  if (prev.discovered === false) {
    if (next.status.availability === AVAILABILITY.AVAILABLE) {
      changes.push(mk(provider, CHANGE_TYPES.PROVIDER_DISCOVERED,
        `${next.identity.name} discovered and reachable`,
        { availability: next.status.availability, modelCount: next.models.total }));
    } else if (next.status.availability === AVAILABILITY.UNAVAILABLE) {
      changes.push(mk(provider, CHANGE_TYPES.PROVIDER_UNAVAILABLE,
        `${next.identity.name} marked unavailable`,
        { before: prev.status?.availability, after: next.status.availability }));
    }
    return changes;
  }

  const prevAvail = prev.status?.availability;
  const nextAvail = next.status?.availability;
  if (prevAvail !== nextAvail) {
    if (prevAvail === AVAILABILITY.AVAILABLE && nextAvail === AVAILABILITY.UNAVAILABLE) {
      changes.push(mk(provider, CHANGE_TYPES.PROVIDER_DOWN, `${next.identity.name} is no longer reachable`, { before: prevAvail, after: nextAvail }));
    } else if (prevAvail !== AVAILABILITY.AVAILABLE && nextAvail === AVAILABILITY.AVAILABLE) {
      changes.push(mk(provider, CHANGE_TYPES.PROVIDER_RESTORED, `${next.identity.name} is reachable again`, { before: prevAvail, after: nextAvail }));
    } else if (nextAvail === AVAILABILITY.AVAILABLE) {
      changes.push(mk(provider, CHANGE_TYPES.PROVIDER_AVAILABLE, `${next.identity.name} marked available`, { before: prevAvail, after: nextAvail }));
    } else if (nextAvail === AVAILABILITY.UNAVAILABLE) {
      changes.push(mk(provider, CHANGE_TYPES.PROVIDER_UNAVAILABLE, `${next.identity.name} marked unavailable`, { before: prevAvail, after: nextAvail }));
    }
  }

  const prevIds = new Set(prev.models?.modelIds || []);
  const nextIds = new Set(next.models?.modelIds || []);
  if (prevIds.size && nextIds.size) {
    const added = [...nextIds].filter((id) => !prevIds.has(id));
    const removed = [...prevIds].filter((id) => !nextIds.has(id));
    if (added.length) changes.push(mk(provider, CHANGE_TYPES.MODELS_ADDED, `${added.length} new model(s) on ${next.identity.name}`, { added, count: added.length }));
    if (removed.length) changes.push(mk(provider, CHANGE_TYPES.MODELS_REMOVED, `${removed.length} model(s) removed from ${next.identity.name}`, { removed, count: removed.length }));
  }

  const prevFree = prev.models?.free || 0;
  const prevPaid = prev.models?.paid || 0;
  if (prevFree !== next.models.free || prevPaid !== next.models.paid) {
    changes.push(mk(provider, CHANGE_TYPES.FREE_MODELS_CHANGED, `Free/paid mix changed on ${next.identity.name}`,
      { before: { free: prevFree, paid: prevPaid }, after: { free: next.models.free, paid: next.models.paid } }));
  }

  if (prev.source?.type !== next.source.type) {
    changes.push(mk(provider, CHANGE_TYPES.SOURCE_CHANGED, `Discovery source changed for ${next.identity.name}`,
      { before: prev.source?.type, after: next.source.type }));
  }

  if (prev.identity?.name !== next.identity?.name || prev.identity?.website !== next.identity?.website) {
    changes.push(mk(provider, CHANGE_TYPES.METADATA_CHANGED, `Provider metadata changed for ${next.identity.name}`,
      { before: { name: prev.identity?.name, website: prev.identity?.website }, after: { name: next.identity?.name, website: next.identity?.website } }));
  }

  return changes;
}

function mk(provider, type, summary, details) {
  return {
    providerId: provider.id,
    providerName: provider.id,
    type,
    summary,
    details: details || {},
  };
}

// Run discovery for every discoverable provider (in parallel, de-duplicated).
async function discoverAllProviders({ force = false } = {}) {
  const t0 = Date.now();
  const results = await Promise.allSettled(DISCOVERABLE.map((p) => discoverProvider(p, { force })));
  const summary = { checked: 0, updated: 0, unchanged: 0, failed: 0, partial: 0, elapsedMs: Date.now() - t0, providers: [] };
  for (const r of results) {
    if (r.status === 'rejected') { summary.failed++; continue; }
    const v = r.value;
    if (v.skipped) { summary.unchanged++; continue; }
    summary.checked++;
    const rec = v.record;
    if (v.changes && v.changes.length) summary.updated++;
    else summary.unchanged++;
    summary.providers.push({
      id: rec.id,
      discoveryStatus: rec.status.discoveryStatus,
      availability: rec.status.availability,
      modelCount: rec.models.total,
      changeCount: (v.changes || []).length,
    });
  }
  try {
    const s = getDiscoverySummary();
    recordActivity('discovery', 'refresh', 'info',
      `Provider intelligence refreshed — ${s.available} available, ${s.stale} stale of ${s.providers} providers`,
      { available: s.available, stale: s.stale, unavailable: s.unavailable });
  } catch { /* non-fatal */ }
  return summary;
}

function getProviderIntelligence(id) {
  if (!id) return null;
  const r = ensureBaseline(id);
  if (!r) return null;
  return { ...r, changes: listChanges({ provider: id, limit: 5 }) };
}

function getAllProviderIntelligence() {
  for (const p of DISCOVERABLE) ensureBaseline(p.id);
  return DISCOVERABLE.map((p) => {
    const r = intel[p.id];
    return r ? { ...r, changes: listChanges({ provider: p.id, limit: 5 }) } : null;
  }).filter(Boolean);
}

function getDiscoverySummary() {
  const all = getAllProviderIntelligence();
  const byStatus = {};
  let available = 0, unavailable = 0, curated = 0, stale = 0, unknown = 0;
  let totalModels = 0, freeModels = 0, paidModels = 0, requiresKey = 0, noKey = 0;
  for (const r of all) {
    const ds = r.status.discoveryStatus;
    byStatus[ds] = (byStatus[ds] || 0) + 1;
    if (r.status.availability === AVAILABILITY.AVAILABLE) available++;
    else if (r.status.availability === AVAILABILITY.UNAVAILABLE) unavailable++;
    else unknown++;
    if (ds === DISCOVERY_STATUS.STALE) stale++;
    if (ds === DISCOVERY_STATUS.CURATED) curated++;
    totalModels += r.models.total;
    freeModels += r.models.free;
    paidModels += r.models.paid;
    if (r.access.requiresApiKey) requiresKey++; else noKey++;
  }
  return {
    providers: all.length,
    byStatus,
    available,
    unavailable,
    curated,
    stale,
    unknown,
    models: { total: totalModels, free: freeModels, paid: paidModels },
    access: { requiresKey, noKey },
  };
}

// Load any persisted intelligence at module init so firstSeenAt + baselines
// survive restarts (and a failed refresh keeps last-good data).
function init() {
  const saved = readDisk();
  if (saved) {
    for (const [id, rec] of Object.entries(saved)) {
      if (!getProvider(id)) continue;
      intel[id] = { ...rec, _fetchedAt: Date.now() };
    }
  }
}
init();

export const providerDiscoveryService = {
  discoverProvider,
  discoverAllProviders,
  getProviderIntelligence,
  getAllProviderIntelligence,
  getDiscoverySummary,
  getChangesForProvider: (id, limit = 30) => listChanges({ provider: id, limit }),
  isSupported: (id) => DISCOVERABLE.some((p) => p.id === id),
};
