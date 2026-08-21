import { getRuntime, detectRuntimes } from '../local/runtimes.js';

// ═══════════════════════════════════════════════════
//  Runtime adapter additions (v0.6.0). The detection engine lives in
//  local/runtimes.js; this module layers the protocol capability matrix +
//  per-runtime status/models helpers the wizard and workspace need. Only Ollama
//  is live; every other runtime reports honestly as planned/detection-only.
// ═══════════════════════════════════════════════════

// Intended protocol capabilities per runtime. `openAICompatible` reflects what
// the runtime exposes; detection (in local/runtimes.js) decides if it's running.
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

export async function getRuntimeStatus(id) {
  const meta = getRuntime(id);
  const all = await detectRuntimes();
  const found = all.find((r) => r.id === id) || { id, name: meta?.name || id, planned: meta?.planned ?? true };
  return { ...found, capabilities: getRuntimeCapabilities(id) };
}

export async function listRuntimeModels(id) {
  if (id !== 'ollama') return [];
  const all = await detectRuntimes();
  const o = all.find((r) => r.id === 'ollama');
  return (o?.models || []).map((m) => ({ name: m, runtime: 'ollama', endpoint: 'http://localhost:11434', source: 'ollama' }));
}

// Aggregate local models from all detected runtimes, each retaining its source.
export async function aggregateLocalModels() {
  const all = await detectRuntimes();
  const out = [];
  for (const r of all) {
    if (r.id === 'ollama' && r.running && Array.isArray(r.models)) {
      r.models.forEach((m) => out.push({ name: m, runtime: r.id, runtimeName: r.name, endpoint: 'http://localhost:11434', installed: true }));
    }
  }
  return out;
}
