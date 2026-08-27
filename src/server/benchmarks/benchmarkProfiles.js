// Benchmark Profiles (v1.5.0) — textual, secret-free definitions of the
// provider benchmark catalogue. Implementation details live in benchmarkService;
// this file is the source of truth for what profiles exist and how the UI
// should present them.

export const BENCHMARK_PROFILES = {
  connection: {
    id: 'connection',
    name: 'Connection Check',
    description: 'Validates endpoint reachability and measures baseline latency. Runs without an API key for public providers.',
    requiresModel: false,
    key: 'provider-monitor',
  },
  basicGeneration: {
    id: 'basic-generation',
    name: 'Basic Generation',
    description: 'Sends a tiny prompt to confirm the provider can return a completion. Best-effort without a key; reports auth-required honestly when one is needed.',
    requiresModel: true,
    key: 'provider-monitor',
  },
  latency: {
    id: 'latency',
    name: 'Latency Probe',
    description: 'Measures round-trip latency for a short completion request.',
    requiresModel: true,
    key: 'provider-monitor',
  },
};

export function listProfiles() {
  return Object.values(BENCHMARK_PROFILES);
}

export function getProfile(id) {
  return BENCHMARK_PROFILES[id] || null;
}
