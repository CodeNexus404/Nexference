// Benchmark Service (v1.5.0) — runs provider benchmarks on demand.
//
// Honesty-first: benchmarks only ever perform real network probes and never
// fabricate scores. Public providers are tested without a key; keyed providers
// are reported as "not-tested" (we have no key and must not invent one). When a
// key is genuinely required (e.g. generation on a keyed endpoint) the result is
// reported as auth-required, never as a fake failure or success. No secrets
// (keys, tokens, headers) are ever stored in the result.

import { getProvider } from '../providers/registry.js';
import { fetchModelsForProvider } from '../providers/modelService.js';
import { modelCache } from '../providers/modelCache.js';
import { recordResult } from './benchmarkStore.js';
import { getProfile } from './benchmarkProfiles.js';
import { recordActivity } from '../activity/activityService.js';

async function runConnectionBenchmark(provider, profileId) {
  if (provider.publicModels) {
    const t0 = Date.now();
    let res;
    try {
      res = await fetchModelsForProvider(provider, '');
    } catch (e) {
      return { providerId: provider.id, profileId, ok: false, reachable: false, latencyMs: Date.now() - t0, connectionState: 'unreachable', errorCategory: 'network', note: 'Model list request failed: ' + (e?.message || 'unknown') };
    }
    const latencyMs = Date.now() - t0;
    const ok = !!(res && res.ok);
    return {
      providerId: provider.id,
      profileId,
      ok,
      reachable: ok,
      latencyMs,
      connectionState: ok ? 'reachable' : 'unreachable',
      errorCategory: ok ? null : 'unreachable',
      note: ok ? 'Reachable (public model list fetched).' : 'Model list not reachable right now.',
    };
  }
  return {
    providerId: provider.id,
    profileId,
    ok: false,
    reachable: false,
    latencyMs: null,
    connectionState: 'not-tested',
    errorCategory: null,
    note: 'Keyed provider — connection not tested without a configured API key.',
  };
}

async function runGenerationBenchmark(provider, profileId) {
  const isOpenAi = provider.format === 'openai' || (Array.isArray(provider.formats) && provider.formats.includes('openai'));
  if (!provider.publicModels || !isOpenAi || !provider.baseUrl) {
    return {
      providerId: provider.id,
      profileId,
      ok: false,
      reachable: false,
      latencyMs: null,
      connectionState: 'not-tested',
      errorCategory: null,
      note: 'Generation benchmark requires a public, OpenAI-compatible provider. Skipped honestly.',
    };
  }
  const entry = modelCache[provider.id];
  const model = Array.isArray(entry?.models) && entry.models[0]?.id;
  const url = provider.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: model || 'unknown', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
    });
    const latencyMs = Date.now() - t0;
    if (resp.status === 401 || resp.status === 403) {
      return { providerId: provider.id, profileId, ok: false, reachable: true, latencyMs, connectionState: 'auth-required', errorCategory: 'auth', note: 'Provider reachable but requires an API key for generation.' };
    }
    const ok = resp.ok;
    return {
      providerId: provider.id,
      profileId,
      ok,
      reachable: true,
      latencyMs,
      connectionState: ok ? 'reachable' : 'unreachable',
      errorCategory: ok ? null : String(resp.status),
      note: ok ? 'Completion returned successfully.' : 'Generation failed: HTTP ' + resp.status,
    };
  } catch (e) {
    return { providerId: provider.id, profileId, ok: false, reachable: false, latencyMs: Date.now() - t0, connectionState: 'unreachable', errorCategory: 'network', note: 'Generation request failed: ' + (e?.message || 'unknown') };
  }
}

export async function runBenchmark(providerId, profileId) {
  const provider = getProvider(providerId);
  const profile = getProfile(profileId);
  if (!provider) throw new Error('Unknown provider: ' + providerId);
  if (!profile) throw new Error('Unknown benchmark profile: ' + profileId);

  let result;
  if (profileId === 'connection' || profileId === 'latency') {
    result = await runConnectionBenchmark(provider, profileId);
  } else if (profileId === 'basic-generation') {
    result = await runGenerationBenchmark(provider, profileId);
  } else {
    result = { providerId, profileId, ok: false, reachable: false, latencyMs: null, connectionState: 'not-tested', errorCategory: null, note: 'Profile not supported.' };
  }

  recordResult(result);
  recordActivity('profile', 'benchmark-run', result.ok ? 'success' : result.connectionState === 'not-tested' ? 'info' : 'warning',
    `Benchmark ${profileId} for ${providerId}: ${result.connectionState}`,
    { providerId, profileId, connectionState: result.connectionState, latencyMs: result.latencyMs });
  return result;
}

export const benchmarkService = {
  runBenchmark,
};
