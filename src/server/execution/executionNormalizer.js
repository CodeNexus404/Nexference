// ═══════════════════════════════════════════════════════════════
//  Execution Normalizer (v2.0.0)
//
//  Produces a single normalized execution result contract used by
//  the Unified Execution Gateway. Internal adapters may stream
//  differently; this layer normalizes the event lifecycle so the
//  frontend receives a consistent shape regardless of source.
// ═══════════════════════════════════════════════════════════════

export const EXEC_STATUS = {
  CREATED: 'created',
  VALIDATING: 'validating',
  RUNNING: 'running',
  STREAMING: 'streaming',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed-out',
  INTERRUPTED: 'interrupted',
};

export const EXEC_EVENT = {
  CREATED: 'created',
  VALIDATING: 'validating',
  RUNNING: 'running',
  STREAMING: 'streaming',
  DELTA: 'delta',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed-out',
  INTERRUPTED: 'interrupted',
};

export function createNormalizedResult(overrides = {}) {
  return {
    executionId: null,
    status: EXEC_STATUS.CREATED,
    sourceType: null,
    providerId: null,
    runtimeId: null,
    model: null,
    route: null,
    adapterType: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    usage: null,
    output: null,
    error: null,
    ...overrides,
  };
}

export function normalizeLifecycleEvent(type, data = {}) {
  return {
    type,
    executionId: data.executionId || null,
    data,
    timestamp: Date.now(),
  };
}

export function finalizeResult(rec, startTime, endTime) {
  return {
    durationMs: endTime - startTime,
    completedAt: new Date(endTime).toISOString(),
  };
}
