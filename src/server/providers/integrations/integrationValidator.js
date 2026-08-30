// Integration Validator (v1.9.0) — validates a provider configuration draft
// against the chosen adapter. Drafts never contain secrets; they carry baseUrl,
// model, customHeaders (names only) and environmentVariableNames. Credential
// values are supplied transiently per action and never persisted here.
import { getAdapter } from './integrationRegistry.js';
import { ADAPTER_TYPE } from './integrationTypes.js';

// Validate a configuration draft for a given adapter type.
// Returns { supported, valid, adapterType, reason? }.
export function validateIntegrationConfiguration(adapterType, draft = {}) {
  if (!adapterType || adapterType === ADAPTER_TYPE.NONE || adapterType === ADAPTER_TYPE.UNKNOWN) {
    return { supported: false, valid: false, reason: 'No verified adapter is available for this provider.' };
  }
  const adapter = getAdapter(adapterType);
  return adapter.validateConfiguration(draft);
}

// Validate the normalized integration record shape (no secrets allowed).
export function validateIntegrationRecord(rec) {
  if (!rec || typeof rec !== 'object' || typeof rec.providerId !== 'string') {
    return { valid: false, reason: 'Integration record requires a providerId.' };
  }
  const json = JSON.stringify(rec);
  if (/(apiKey|secret|token|authorization|bearer|password)/i.test(json)) {
    return { valid: false, reason: 'Integration record must not contain secrets.' };
  }
  return { valid: true };
}
