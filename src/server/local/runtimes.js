import { norm } from '../utils/index.js';

// ═══════════════════════════════════════════════════════════════
//  Local AI runtime adapters — the server-side view of local model
//  runtimes (Ollama, LM Studio, llama.cpp, vLLM, …).
//
//  Nexference v0.2.0 treats cloud providers and local runtimes as
//  distinct concepts. Cloud providers live in providers/registry.js;
//  local runtimes live here. Only Ollama has a real, non-faked
//  adapter (detect + status + models). Every other runtime is
//  reported honestly as "planned" so the UI never pretends to
//  support an operation it cannot perform.
// ═══════════════════════════════════════════════════════════════

// Static catalogue of runtimes Nexference knows about. `planned: true`
// means detection/config support is not implemented yet — the UI shows
// it as "coming soon" rather than faking functionality.
export const RUNTIMES = [
  {
    id: 'ollama', name: 'Ollama', type: 'local',
    detectionUrl: 'http://localhost:11434/api/tags',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: false, note: 'Local models served at http://localhost:11434',
  },
  {
    id: 'lmstudio', name: 'LM Studio', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: true, note: 'Configuration support coming soon',
  },
  {
    id: 'llamacpp', name: 'llama.cpp', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: true, note: 'Configuration support coming soon',
  },
  {
    id: 'vllm', name: 'vLLM', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: true, note: 'Configuration support coming soon',
  },
  {
    id: 'sglang', name: 'SGLang', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: true, note: 'Configuration support coming soon',
  },
  {
    id: 'koboldcpp', name: 'KoboldCpp', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: true, note: 'Configuration support coming soon',
  },
  {
    id: 'jan', name: 'Jan', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: true, note: 'Configuration support coming soon',
  },
];

export function getRuntime(id) {
  return RUNTIMES.find((r) => r.id === id);
}

// Detect a single runtime. Ollama is probed over HTTP; everything else
// is reported as planned. Returns a status object, never throws.
async function detectOllama() {
  const meta = getRuntime('ollama');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const r = await fetch(meta.detectionUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) return { id: 'ollama', name: 'Ollama', type: 'local', running: false, detected: true, models: [], note: `Reachable but returned HTTP ${r.status}` };
    const data = await r.json().catch(() => ({}));
    const models = Array.isArray(data.models) ? data.models.map((m) => m.name).filter(Boolean) : [];
    return { id: 'ollama', name: 'Ollama', type: 'local', running: true, detected: true, models, modelCount: models.length, note: meta.note };
  } catch {
    clearTimeout(timeout);
    return { id: 'ollama', name: 'Ollama', type: 'local', running: false, detected: false, models: [], note: 'Not detected — start Ollama to use local models' };
  }
}

export async function detectRuntimes() {
  const results = [];
  for (const r of RUNTIMES) {
    if (r.planned) {
      results.push({ id: r.id, name: r.name, type: 'local', planned: true, supportsModels: r.supportsModels, note: r.note });
    } else if (r.id === 'ollama') {
      results.push(await detectOllama());
    } else {
      results.push({ id: r.id, name: r.name, type: 'local', planned: true, note: r.note });
    }
  }
  return results;
}

// Runtime adapter interface — mirrors the conceptual contract from the
// milestone. Only Ollama implements detect/status/models for real.
export class RuntimeAdapter {
  constructor(meta) { this.meta = meta; }
  async detect() { return detectRuntimes(); }
  async getStatus() { return detectRuntimes(); }
  async getModels() {
    const s = await detectOllama();
    return s.models || [];
  }
  async testConnection() {
    const s = await detectOllama();
    return { ok: s.running, running: s.running };
  }
}

export function getRuntimeAdapter(id) {
  const meta = getRuntime(id) || { id, name: id, type: 'local' };
  return new RuntimeAdapter(meta);
}
