import { getRuntime } from '../local/runtimes.js';
import { discoverModels } from './modelDiscoveryService.js';

// ═══════════════════════════════════════════════════
//  Runtime adapter helpers (v0.7.0). Each runtime exposes a normalized status
//  shape with the exact fields the milestone requires:
//
//    { id, name, installed, reachable, running, version, endpoint,
//      detectionMethod, error, planned, capabilities, models }
//
//  Detection priority: (1) API health probe, then (2) known-installation /
//  process detection where supported, finally (3) unknown. Runtime-specific
//  logic (Ollama) lives here — it is never sprinkled across unrelated services.
// ═══════════════════════════════════════════════════

// Intended protocol capabilities per runtime (mirrors detection intent).
export const RUNTIME_CAPS = {
  ollama: { local: true, openAICompatible: true, anthropicCompatible: false, supportsModelDiscovery: true, supportsModelDownload: true, supportsChat: true },
  lmstudio: { local: true, openAICompatible: true, anthropicCompatible: false, supportsModelDiscovery: true, supportsModelDownload: false, supportsChat: true },
  llamacpp: { local: true, openAICompatible: true, anthropicCompatible: false, supportsModelDiscovery: false, supportsModelDownload: false, supportsChat: false },
  vllm: { local: true, openAICompatible: true, anthropicCompatible: false, supportsModelDiscovery: true, supportsModelDownload: false, supportsChat: true },
  sglang: { local: true, openAICompatible: true, anthropicCompatible: false, supportsModelDiscovery: true, supportsModelDownload: false, supportsChat: true },
  koboldcpp: { local: true, openAICompatible: true, anthropicCompatible: false, supportsModelDiscovery: false, supportsModelDownload: false, supportsChat: true },
  jan: { local: true, openAICompatible: true, anthropicCompatible: false, supportsModelDiscovery: true, supportsModelDownload: true, supportsChat: true },
};

export function getRuntimeCapabilities(id) {
  return RUNTIME_CAPS[id] || { local: true, openAICompatible: true, anthropicCompatible: false, supportsModelDiscovery: false, supportsModelDownload: false, supportsChat: false };
}

async function probeOllama() {
  const endpoint = 'http://localhost:11434';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  const result = { installed: null, reachable: false, running: false, version: null, error: null, detectionMethod: 'api-health' };
  try {
    const r = await fetch(`${endpoint}/api/tags`, { signal: ctrl.signal });
    if (r.ok) {
      result.reachable = true;
      result.running = true;
      result.installed = true;
      // Version probe (separate endpoint; failures are non-fatal).
      try {
        const v = await fetch(`${endpoint}/api/version`, { signal: ctrl.signal });
        if (v.ok) result.version = (await v.json().catch(() => ({})))?.version || null;
      } catch { /* version optional */ }
    } else {
      result.error = `Ollama responded with HTTP ${r.status}`;
      result.installed = null;
    }
  } catch (err) {
    result.error = err.name === 'AbortError' ? 'Ollama did not respond within 2s' : (err.message || 'Ollama not reachable');
  } finally {
    clearTimeout(t);
  }
  result.endpoint = endpoint;
  return result;
}

// Full normalized detection for a single runtime.
export async function detectRuntime(id) {
  const meta = getRuntime(id);
  const name = meta?.name || id;
  const planned = meta?.planned ?? true;
  if (id === 'ollama') {
    const probe = await probeOllama();
    return {
      id, name,
      ...probe,
      planned: false,
      capabilities: getRuntimeCapabilities(id),
    };
  }
  // Planned / detection-only runtimes are reported honestly.
  return {
    id, name,
    installed: null,
    reachable: false,
    running: false,
    version: null,
    endpoint: meta?.detectionUrl || null,
    detectionMethod: 'none (planned)',
    error: null,
    planned,
    capabilities: getRuntimeCapabilities(id),
  };
}

export async function getRuntimeStatus(id) {
  return detectRuntime(id);
}

export async function getRuntimeVersion(id) {
  const s = await detectRuntime(id);
  return s.version;
}

// Models for a single runtime (basic shape used by the per-runtime route).
export async function listRuntimeModels(id) {
  if (id !== 'ollama') return [];
  const models = await discoverModels();
  return models
    .filter((m) => m.runtimeId === 'ollama')
    .map((m) => ({ name: m.name, runtime: 'ollama', endpoint: 'http://localhost:11434', source: 'ollama' }));
}

// Aggregate all discovered local models (normalized).
export async function aggregateLocalModels() {
  return discoverModels();
}
