// Structured Registry Source adapter (v1.7.0).
//
// Reads configured discovery sources from the controlled source registry
// (data/discovery-sources.json). Each source may point at:
//   • local structured files (paths) — JSON arrays or { providers: [...] }
//   • remote raw URLs (rawUrls) — fetched over https with a timeout
//
// This is deliberately conservative: no GitHub search scraping, no recursive
// crawling. New trusted sources are added by editing the source registry, not the
// core. Each adapter exposes the common interface: getSourceMetadata / supports /
// discover / normalize.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PROVIDER_CATEGORIES } from '../constants.js';

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { redirect: 'error', signal: ctrl.signal });
    if (!r.ok) throw new Error(`http ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function coerceCandidates(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.providers)) return json.providers;
  if (json && Array.isArray(json.candidates)) return json.candidates;
  if (json && Array.isArray(json.items)) return json.items;
  return [];
}

// A structured entry from a registry file becomes a raw candidate. We keep exactly
// the fields the source supplied — never inventing missing ones.
function normalizeRaw(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = raw.name || raw.title || raw.id;
  if (!name) return null;
  return {
    name,
    normalizedName: raw.normalizedName || name,
    category: raw.category || null,
    description: raw.description || null,
    website: raw.website || raw.url || raw.homepage || null,
    documentationUrl: raw.documentationUrl || raw.docs || null,
    apiDocumentationUrl: raw.apiDocumentationUrl || raw.apiDocs || null,
    repository: raw.repository || raw.repo || raw.github || null,
    logo: raw.logo || null,
    logoSource: raw.logo ? 'source-provided' : null,
    endpoints: Array.isArray(raw.endpoints) ? raw.endpoints : (raw.endpoint ? [raw.endpoint] : []),
    compatibility: raw.compatibility || null,
    accessType: raw.accessType || 'unknown',
    availability: raw.availability || 'unknown',
    lifecycle: raw.lifecycle || 'unknown',
    modelSource: raw.modelSource || null,
    models: Array.isArray(raw.models) ? raw.models : [],
  };
}

export function createStructuredRegistrySource(config, { baseDir }) {
  const meta = {
    id: config.id,
    name: config.name || config.id,
    type: config.type || 'open-source-registry',
    url: config.homepage || config.repository || (Array.isArray(config.rawUrls) ? config.rawUrls[0] : null),
    trustLevel: config.trustLevel || 'community',
    enabled: config.enabled !== false,
    requiresManualRefresh: config.requiresManualRefresh !== false,
  };

  async function loadRawCandidates() {
    let raw = [];
    const errors = [];
    for (const p of config.paths || []) {
      try {
        const file = join(baseDir, p);
        if (!existsSync(file)) { errors.push(`missing file ${p}`); continue; }
        raw.push(...coerceCandidates(JSON.parse(readFileSync(file, 'utf8'))));
      } catch (e) { errors.push(`file ${p}: ${e.message}`); }
    }
    for (const u of config.rawUrls || []) {
      try {
        raw.push(...coerceCandidates(await fetchWithTimeout(u, FETCH_TIMEOUT_MS)));
      } catch (e) { errors.push(`url ${u}: ${e.message}`); }
    }
    return { raw, errors };
  }

  return {
    getSourceMetadata: () => meta,
    supports: () => meta.enabled,
    // discover() returns normalized raw candidates + any fetch errors (for isolation).
    async discover() {
      if (!meta.enabled) return { supported: false, reason: 'disabled' };
      const { raw, errors } = await loadRawCandidates();
      const candidates = raw.map(normalizeRaw).filter(Boolean);
      return { supported: true, candidates, errors };
    },
    // Normalize one raw candidate into a partial record (service adds id/evidence/dedup).
    normalize(candidate, observedAt) {
      return {
        name: candidate.name,
        normalizedName: candidate.normalizedName,
        category: candidate.category,
        description: candidate.description,
        website: candidate.website,
        documentationUrl: candidate.documentationUrl,
        apiDocumentationUrl: candidate.apiDocumentationUrl,
        repository: candidate.repository,
        logo: candidate.logo,
        logoSource: candidate.logoSource,
        endpoints: candidate.endpoints,
        compatibility: candidate.compatibility,
        accessType: candidate.accessType,
        availability: candidate.availability,
        lifecycle: candidate.lifecycle,
        modelSource: candidate.modelSource,
        models: candidate.models,
        _observedAt: observedAt,
      };
    },
  };
}

export { PROVIDER_CATEGORIES };
