// Server-side model cache with timestamps. Keyed by provider id; values carry
// the resolved model list plus metadata about where it came from (startup /
// proxy / refresh / website / static) so the cache summary can report provenance.
export const modelCache = {};

// Tuning constants carried over verbatim from the original server.
export const FETCH_INTERVAL = 30 * 60 * 1000; // 30 minutes
export const FETCH_TIMEOUT = 15000;
