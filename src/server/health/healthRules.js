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

// Provider status vocabulary (Phase 4).
export const PROVIDER_STATE = {
  CONFIGURED: 'configured',
  AUTH_REQUIRED: 'auth-required',
  REACHABLE: 'reachable',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
  EXECUTION_SUPPORTED: 'execution-supported',
  DISCOVERY_ONLY: 'discovery-only',
};

// Runtime status vocabulary (Phase 4).
export const RUNTIME_STATE = {
  INSTALLED: 'installed',
  REACHABLE: 'reachable',
  RUNNING: 'running',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
  EXECUTION_SUPPORTED: 'execution-supported',
  DETECTION_ONLY: 'detection-only',
};

// Client status vocabulary (Phase 4).
export const CLIENT_STATE = {
  DETECTED: 'detected',
  NOT_DETECTED: 'not-detected',
  CONFIG_SUPPORTED: 'config-supported',
  CONFIG_UNKNOWN: 'config-unknown',
  LAUNCH_SUPPORTED: 'launch-supported',
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
