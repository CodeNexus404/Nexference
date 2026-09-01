// ═══════════════════════════════════════════════════════════════
//  Custom Provider Registry (v2.1.0)
//
//  Extends the Unified Provider Catalogue to include custom
//  providers alongside curated and ecosystem-adopted providers.
//  Custom providers are normalized into the same shape as
//  existing unified providers so the card renderer and filters
//  work without modification.
// ═══════════════════════════════════════════════════════════════

import { listCustomProviders, getCustomProvider } from './customProviderStore.js';

export function toCustomUnified(rec) {
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.identity?.name || rec.id,
    origin: 'custom',
    registryType: 'custom',
    sub: rec.identity?.website ? (() => { try { return new URL(rec.identity.website).hostname; } catch { return rec.identity.website; } })() : null,
    logo: rec.logo?.url || null,
    accent: '#6366f1',
    glow: 'rgba(99,102,241,.18)',
    format: rec.api?.format || 'unknown',
    baseUrl: rec.api?.baseUrl || null,
    desc: rec.identity?.description || 'Custom provider',
    lifecycle: rec.lifecycle || 'active',
    status: rec.lifecycle === 'active' ? 'active' : 'inactive',
    integration: rec.integration?.status || 'unverified',
    connection: rec.connection?.status || 'not-tested',
    modelSupport: rec.modelSupport?.status || 'unknown',
    modelCount: rec.modelSupport?.count || 0,
    provenance: rec.provenance || {},
    hasCustomUrl: !!rec.api?.baseUrl,
    requiresKey: rec.authentication?.required !== false,
    claudeCode: rec.api?.format === 'anthropic',
  };
}

export function getActiveCustomProviders() {
  return listCustomProviders({ lifecycle: 'active' }).map(toCustomUnified);
}

export function getAllCustomProviders() {
  return listCustomProviders().map(toCustomUnified);
}

export function getCustomUnifiedProvider(id) {
  if (!id?.startsWith('cst:')) return null;
  return toCustomUnified(getCustomProvider(id));
}
