// ═══════════════════════════════════════════════════════════════
//  Execution Errors (v2.0.0)
//
//  Normalized error categories for the Unified Execution Gateway.
//  Every adapter maps raw provider errors into these categories so
//  the frontend receives safe, user-facing messages without leaking
//  API keys, Authorization headers, or internal stack traces.
// ═══════════════════════════════════════════════════════════════

export const ERROR_CATEGORY = {
  AUTHENTICATION_REQUIRED: 'authentication_required',
  AUTHENTICATION_FAILED: 'authentication_failed',
  INVALID_CONFIGURATION: 'invalid_configuration',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  NETWORK_ERROR: 'network_error',
  MODEL_NOT_FOUND: 'model_not_found',
  RATE_LIMITED: 'rate_limited',
  UNSUPPORTED: 'unsupported',
  METADATA_ONLY: 'metadata_only',
  EXECUTION_FAILED: 'execution_failed',
  TIMED_OUT: 'timed_out',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown',
};

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/g,
  /sk-[A-Za-z0-9]+/gi,
  /x-api-key["'\s:]+[A-Za-z0-9\-_.]+/gi,
  /Authorization["'\s:]+[A-Za-z0-9\-_.]+/gi,
  /tr_[A-Za-z0-9]+/g,
];

function maskSecrets(text = '') {
  let masked = String(text);
  for (const pat of SECRET_PATTERNS) {
    masked = masked.replace(pat, (m) => m.slice(0, 6) + '***');
  }
  return masked;
}

function classifyError(message = '') {
  const msg = String(message).toLowerCase();
  if (/missing or malformed api key|missing.*api.*key|no api key/i.test(msg)) return ERROR_CATEGORY.AUTHENTICATION_REQUIRED;
  if (/authentication_error|unauthorized|invalid.*key|bad.*credentials|401/i.test(msg)) return ERROR_CATEGORY.AUTHENTICATION_FAILED;
  if (/invalid.*configuration|missing.*base.*url|malformed.*url/i.test(msg)) return ERROR_CATEGORY.INVALID_CONFIGURATION;
  if (/econnrefused|enotfound|fetch failed|network/i.test(msg)) return ERROR_CATEGORY.NETWORK_ERROR;
  if (/model.*not.*found|unknown.*model|does not exist|404/i.test(msg)) return ERROR_CATEGORY.MODEL_NOT_FOUND;
  if (/rate.?limit|too many requests|429/i.test(msg)) return ERROR_CATEGORY.RATE_LIMITED;
  if (/not.*implemented|unsupported|not.*supported/i.test(msg)) return ERROR_CATEGORY.UNSUPPORTED;
  if (/timed?.?out|timeout|abort/i.test(msg)) return ERROR_CATEGORY.TIMED_OUT;
  if (/cancel/i.test(msg)) return ERROR_CATEGORY.CANCELLED;
  return ERROR_CATEGORY.EXECUTION_FAILED;
}

const USER_MESSAGES = {
  [ERROR_CATEGORY.AUTHENTICATION_REQUIRED]: 'API key is required. Please add your credentials.',
  [ERROR_CATEGORY.AUTHENTICATION_FAILED]: 'Authentication failed. Please check your API key.',
  [ERROR_CATEGORY.INVALID_CONFIGURATION]: 'Provider configuration is invalid. Check the base URL.',
  [ERROR_CATEGORY.PROVIDER_UNAVAILABLE]: 'Provider is currently unavailable. Try again later.',
  [ERROR_CATEGORY.NETWORK_ERROR]: 'Network error. Check your connection and the provider URL.',
  [ERROR_CATEGORY.MODEL_NOT_FOUND]: 'Model not found. Check the model name or try another.',
  [ERROR_CATEGORY.RATE_LIMITED]: 'Rate limited. Wait a moment and try again.',
  [ERROR_CATEGORY.UNSUPPORTED]: 'This operation is not supported by this provider.',
  [ERROR_CATEGORY.METADATA_ONLY]: 'No execution adapter available for this provider.',
  [ERROR_CATEGORY.EXECUTION_FAILED]: 'Execution failed. Check your configuration and try again.',
  [ERROR_CATEGORY.TIMED_OUT]: 'Execution timed out. Try a shorter prompt or increase the timeout.',
  [ERROR_CATEGORY.CANCELLED]: 'Execution was cancelled.',
  [ERROR_CATEGORY.UNKNOWN]: 'An unexpected error occurred.',
};

export function normalizeError(error, route = 'unknown') {
  const raw = error?.message || String(error);
  const category = classifyError(raw);
  return {
    category,
    message: maskSecrets(raw).slice(0, 300),
    userMessage: USER_MESSAGES[category] || USER_MESSAGES[ERROR_CATEGORY.UNKNOWN],
    route,
    timestamp: Date.now(),
  };
}

export function maskErrorText(text = '') {
  return maskSecrets(text);
}
