// ═══════════════════════════════════════════════════════════════
//  Custom Provider Service (v2.1.0)
//
//  CRUD operations, validation, duplicate detection, and lifecycle
//  management for user-created custom providers. Integrates with
//  the existing provider change store, activity service, and
//  integration assessment systems.
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import {
  loadCustomProviders, getCustomProvider, upsertCustomProvider,
  setCustomProviderStatus, removeCustomProvider, findByHostname,
  findByName, listCustomProviders,
} from './customProviderStore.js';
import { getProvider, PROVIDERS } from '../registry.js';
import { recordChange, CHANGE_TYPES } from '../providerChangeStore.js';
import { recordActivity } from '../../activity/activityService.js';

const SUPPORTED_FORMATS = ['openai', 'anthropic', 'gemini', 'unknown'];
const SAFE_URL_PROTOCOLS = ['https:'];
const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.'];

function slugify(name) {
  return (name || 'custom')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'custom';
}

function generateId(name) {
  return `cst:${slugify(name)}-${Date.now().toString(36)}`;
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (!SAFE_URL_PROTOCOLS.includes(u.protocol)) return null;
    for (const blocked of BLOCKED_HOSTS) {
      if (u.hostname === blocked || u.hostname.startsWith(blocked)) return null;
    }
    return u.href;
  } catch { return null; }
}

function hasSecrets(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const secretPatterns = /key|secret|token|password|authorization|auth|bearer/i;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && secretPatterns.test(k) && v.length > 8) return true;
    if (typeof v === 'object' && hasSecrets(v)) return true;
  }
  return false;
}

export function validateCustomProvider(input) {
  const errors = [];
  const warnings = [];

  if (!input.name || typeof input.name !== 'string' || input.name.trim().length < 2) {
    errors.push('Provider name is required (minimum 2 characters).');
  }
  if (input.name && input.name.length > 100) {
    errors.push('Provider name must be 100 characters or fewer.');
  }
  if (input.website) {
    const u = sanitizeUrl(input.website);
    if (!u) warnings.push('Website URL is not a valid HTTPS URL. It will be ignored.');
  }
  if (input.baseUrl) {
    const u = sanitizeUrl(input.baseUrl);
    if (!u) errors.push('Base URL must be a valid HTTPS URL.');
  }
  if (input.format && !SUPPORTED_FORMATS.includes(input.format)) {
    errors.push(`API format must be one of: ${SUPPORTED_FORMATS.join(', ')}`);
  }
  if (hasSecrets(input)) {
    errors.push('Provider definition must not contain API keys, tokens, or secrets.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function detectDuplicates(input) {
  const duplicates = [];
  const name = (input.name || '').toLowerCase().trim();
  const website = input.website || '';
  const baseUrl = input.baseUrl || '';

  // Check curated providers
  for (const p of PROVIDERS) {
    const pName = (p.name || p.id || '').toLowerCase();
    const pWebsite = p.website || '';
    if (name && pName && name === pName) {
      duplicates.push({ type: 'curated', id: p.id, name: p.name || p.id, reason: 'Name matches curated provider.' });
    }
    if (website) {
      try {
        const h1 = new URL(website).hostname.replace(/^www\./, '');
        const h2 = new URL(pWebsite || `https://${p.id}.com`).hostname.replace(/^www\./, '');
        if (h1 === h2) duplicates.push({ type: 'curated', id: p.id, name: p.name || p.id, reason: 'Website hostname matches curated provider.' });
      } catch { /* ignore */ }
    }
  }

  // Check custom providers
  const existingName = findByName(name);
  if (existingName) duplicates.push({ type: 'custom', id: existingName.id, name: existingName.identity?.name, reason: 'Name matches existing custom provider.' });
  if (website) {
    const existingHost = findByHostname(website);
    if (existingHost) duplicates.push({ type: 'custom', id: existingHost.id, name: existingHost.identity?.name, reason: 'Website hostname matches existing custom provider.' });
  }

  return duplicates;
}

export function buildCustomProviderRecord(input) {
  const name = (input.name || '').trim();
  const id = input.id || generateId(name);
  const now = new Date().toISOString();

  return {
    id,
    origin: 'custom',
    registryType: 'custom',
    identity: {
      name,
      website: sanitizeUrl(input.website) || null,
      description: (input.description || '').trim() || null,
    },
    api: {
      baseUrl: sanitizeUrl(input.baseUrl) || null,
      format: input.format || 'unknown',
    },
    authentication: {
      required: true,
      type: 'api-key',
    },
    logo: input.logo || { url: null, source: 'generated', status: 'available' },
    modelSupport: {
      status: 'unknown',
      models: [],
      count: 0,
    },
    integration: {
      status: 'unverified',
    },
    connection: {
      status: 'not-tested',
      lastTestedAt: null,
    },
    provenance: {
      source: 'user-created',
      createdAt: now,
      updatedAt: now,
    },
    lifecycle: 'active',
  };
}

export function createCustomProvider(input) {
  const validation = validateCustomProvider(input);
  if (!validation.valid) return { success: false, errors: validation.errors, warnings: validation.warnings };

  const duplicates = detectDuplicates(input);
  if (duplicates.length > 0) {
    return { success: false, errors: ['Possible duplicate detected.'], warnings: duplicates.map((d) => `${d.reason} (${d.type}: ${d.name})`), duplicates };
  }

  const record = buildCustomProviderRecord(input);
  const saved = upsertCustomProvider(record);
  if (!saved) return { success: false, errors: ['Failed to save custom provider (store full or error).'] };

  recordChange({
    providerId: record.id,
    providerName: record.identity.name,
    type: CHANGE_TYPES.PROVIDER_DISCOVERED || 'METADATA_CHANGED',
    summary: `Custom provider "${record.identity.name}" created.`,
    details: { origin: 'custom', format: record.api.format },
  });
  recordActivity('provider', 'custom-created', 'success', `Custom provider "${record.identity.name}" created.`, { providerId: record.id });

  return { success: true, provider: record, warnings: validation.warnings };
}

export function updateCustomProvider(id, input) {
  const existing = getCustomProvider(id);
  if (!existing) return { success: false, errors: ['Custom provider not found.'] };

  const validation = validateCustomProvider({ ...existing.identity, ...input });
  if (!validation.valid) return { success: false, errors: validation.errors, warnings: validation.warnings };

  const updated = {
    ...existing,
    identity: {
      ...existing.identity,
      name: (input.name || existing.identity.name || '').trim(),
      website: input.website !== undefined ? (sanitizeUrl(input.website) || existing.identity.website) : existing.identity.website,
      description: input.description !== undefined ? (input.description || '').trim() : existing.identity.description,
    },
    api: {
      ...existing.api,
      baseUrl: input.baseUrl !== undefined ? (sanitizeUrl(input.baseUrl) || existing.api.baseUrl) : existing.api.baseUrl,
      format: input.format || existing.api.format,
    },
    logo: input.logo || existing.logo,
    provenance: {
      ...existing.provenance,
      updatedAt: new Date().toISOString(),
    },
  };

  // Invalidate stale connection assumptions if API config changed
  if (input.baseUrl || input.format) {
    updated.connection = { status: 'not-tested', lastTestedAt: null };
    updated.integration = { status: 'unverified' };
  }

  const saved = upsertCustomProvider(updated);
  if (!saved) return { success: false, errors: ['Failed to update custom provider.'] };

  recordChange({
    providerId: id,
    providerName: updated.identity.name,
    type: 'METADATA_CHANGED',
    summary: `Custom provider "${updated.identity.name}" updated.`,
    details: { origin: 'custom', changes: Object.keys(input) },
  });
  recordActivity('provider', 'custom-updated', 'info', `Custom provider "${updated.identity.name}" updated.`, { providerId: id });

  return { success: true, provider: updated, warnings: validation.warnings };
}

export function deactivateCustomProvider(id) {
  const rec = getCustomProvider(id);
  if (!rec) return { success: false, errors: ['Custom provider not found.'] };
  if (rec.lifecycle === 'inactive') return { success: true, provider: rec };

  setCustomProviderStatus(id, 'inactive');
  recordActivity('provider', 'custom-deactivated', 'info', `Custom provider "${rec.identity.name}" deactivated.`, { providerId: id });
  return { success: true, provider: getCustomProvider(id) };
}

export function reactivateCustomProvider(id) {
  const rec = getCustomProvider(id);
  if (!rec) return { success: false, errors: ['Custom provider not found.'] };
  if (rec.lifecycle === 'active') return { success: true, provider: rec };

  setCustomProviderStatus(id, 'active');
  recordActivity('provider', 'custom-reactivated', 'success', `Custom provider "${rec.identity.name}" reactivated.`, { providerId: id });
  return { success: true, provider: getCustomProvider(id) };
}

export function deleteCustomProvider(id) {
  const rec = getCustomProvider(id);
  if (!rec) return { success: false, errors: ['Custom provider not found.'] };

  removeCustomProvider(id);
  recordActivity('provider', 'custom-deleted', 'warning', `Custom provider "${rec.identity.name}" deleted.`, { providerId: id });
  return { success: true };
}

export function duplicateCustomProvider(id) {
  const rec = getCustomProvider(id);
  if (!rec) return { success: false, errors: ['Custom provider not found.'] };

  const dup = {
    name: `${rec.identity.name} (Copy)`,
    website: rec.identity.website,
    description: rec.identity.description,
    baseUrl: rec.api.baseUrl,
    format: rec.api.format,
  };

  return createCustomProvider(dup);
}
