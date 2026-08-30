// Provider Integration & Adapter Framework — shared types (v1.9.0).
//
// Strict, honest vocabularies for provider integration status, adapter types,
// capability classification and evidence confidence. These vocabularies are the
// single source of truth consumed by the resolver, the adapters, the store and
// the UI. No provider is ever assumed compatible: status is derived from evidence.

// Integration status — what Nexference actually knows about a provider.
export const INTEGRATION_STATUS = {
  INTEGRATED: 'integrated', // a working adapter implementation + known config format
  SUPPORTED: 'supported', // known adapter format, not necessarily tested with user creds
  PARTIAL: 'partial', // some features supported, important limitations exist
  ASSESSING: 'assessing', // evidence present but not safely classifiable yet
  METADATA_ONLY: 'metadata-only', // in the registry, no executable/config adapter
  UNSUPPORTED: 'unsupported', // known protocol but not supported by Nexference
  BLOCKED: 'blocked', // cannot proceed — missing required info/requirements
  UNKNOWN: 'unknown', // insufficient evidence
};

// Adapter protocol types. Only assign when backed by explicit evidence.
export const ADAPTER_TYPE = {
  OPENAI_COMPATIBLE: 'openai-compatible',
  ANTHROPIC_COMPATIBLE: 'anthropic-compatible',
  GEMINI_COMPATIBLE: 'gemini-compatible',
  CUSTOM: 'custom',
  NONE: 'none',
  UNKNOWN: 'unknown',
};

// Evidence confidence — kept separate from discovery status.
export const CONFIDENCE = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INSUFFICIENT: 'insufficient',
  UNKNOWN: 'unknown',
};

// Evidence claim types a source can make.
export const EVIDENCE_CLAIM = {
  OPENAI_COMPATIBLE_API: 'openai_compatible_api',
  ANTHROPIC_COMPATIBLE_API: 'anthropic_compatible_api',
  GEMINI_COMPATIBLE_API: 'gemini_compatible_api',
  API_KEY_REQUIRED: 'api_key_required',
  MODEL_LISTING_SUPPORTED: 'model_listing_supported',
  STREAMING_SUPPORTED: 'streaming_supported',
  CUSTOM_BASE_URL_SUPPORTED: 'custom_base_url_supported',
};

// Honest human-readable status labels (do not rely on colour alone).
export const STATUS_LABEL = {
  [INTEGRATION_STATUS.INTEGRATED]: 'Integrated',
  [INTEGRATION_STATUS.SUPPORTED]: 'Supported',
  [INTEGRATION_STATUS.PARTIAL]: 'Partial',
  [INTEGRATION_STATUS.ASSESSING]: 'Assessing',
  [INTEGRATION_STATUS.METADATA_ONLY]: 'Metadata only',
  [INTEGRATION_STATUS.UNSUPPORTED]: 'Unsupported',
  [INTEGRATION_STATUS.BLOCKED]: 'Blocked',
  [INTEGRATION_STATUS.UNKNOWN]: 'Unknown',
};

// Whether a status implies Nexference can (in principle) configure/execute.
export function isExecutable(status) {
  return status === INTEGRATION_STATUS.INTEGRATED || status === INTEGRATION_STATUS.SUPPORTED || status === INTEGRATION_STATUS.PARTIAL;
}

export function isUsableForClaudeCode(adapterType) {
  return adapterType === ADAPTER_TYPE.ANTHROPIC_COMPATIBLE;
}
