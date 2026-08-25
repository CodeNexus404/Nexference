// Health vocabulary — explicit, non-misleading states used across the Workspace
// Health report and the provider/runtime/client status badges. Centralising the
// constants prevents pages from inventing their own "offline vs unavailable"
// terminology and keeps the UI consistent.

// Workspace-level overall states.
export const HEALTH = {
  HEALTHY: 'healthy',
  ATTENTION: 'attention',
  CONFIG_REQUIRED: 'config-required',
  PARTIAL: 'partial',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
};

const SEVERITY = {
  [HEALTH.HEALTHY]: 0,
  [HEALTH.PARTIAL]: 1,
  [HEALTH.ATTENTION]: 2,
  [HEALTH.CONFIG_REQUIRED]: 2,
  [HEALTH.OFFLINE]: 3,
  [HEALTH.UNKNOWN]: 1,
};

// Combine two overall states, keeping the more severe one.
export function combineHealth(a, b) {
  const sa = SEVERITY[a] ?? 1;
  const sb = SEVERITY[b] ?? 1;
  return sa >= sb ? a : b;
}

// Convert a category "state" into a contribution to the overall score (0-100).
export function scoreState(state) {
  switch (state) {
    case HEALTH.HEALTHY: return 100;
    case HEALTH.PARTIAL: return 70;
    case HEALTH.ATTENTION: return 50;
    case HEALTH.CONFIG_REQUIRED: return 40;
    case HEALTH.OFFLINE: return 15;
    case HEALTH.UNKNOWN: return 55;
    default: return 55;
  }
}
