// ═══════════════════════════════════════════════════════════════
//  Execution Registry (v0.9.0)
//
//  Single source of truth for *which* sources can actually execute and
//  *how*. Cloud execution is driven by provider API dialect; local
//  execution is driven by a runtime's real HTTP contract. Anything we
//  have not honestly implemented is reported as unsupported rather than
//  faked.
// ═══════════════════════════════════════════════════════════════

import { RUNTIMES } from '../local/runtimes.js';
import { PROVIDERS, getProvider } from '../providers/registry.js';

// API dialects we can genuinely execute against today.
export const EXEC_FORMATS = ['openai', 'anthropic', 'gemini'];

// Local runtimes with a real, implemented execution contract.
// `kind: 'ollama'`  -> native /api/chat (newline-JSON streaming)
// `kind: 'openai'`  -> OpenAI-compatible /v1/chat/completions (SSE)
// Ports are the tools' well-known defaults; reachability is verified at
// request time, so an unstarted runtime is reported honestly as offline.
export const RUNTIME_EXEC = {
  ollama: { kind: 'ollama', baseUrl: 'http://localhost:11434/api/', label: 'Ollama', streaming: true },
  lmstudio: { kind: 'openai', baseUrl: 'http://localhost:1234/v1/', label: 'LM Studio', streaming: true },
  vllm: { kind: 'openai', baseUrl: 'http://localhost:8000/v1/', label: 'vLLM', streaming: true },
  sglang: { kind: 'openai', baseUrl: 'http://localhost:30000/v1/', label: 'SGLang', streaming: true },
  llamacpp: { kind: 'openai', baseUrl: 'http://localhost:8080/v1/', label: 'llama.cpp', streaming: true },
};

export function getRuntimeExec(id) {
  return RUNTIME_EXEC[id] || null;
}

// Probe a local runtime for reachability + installed models (honest check).
export async function probeRuntime(id) {
  const cfg = RUNTIME_EXEC[id];
  if (!cfg) return { reachable: false, running: false, models: [] };
  try {
    if (cfg.kind === 'ollama') {
      const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return { reachable: true, running: false, models: [] };
      const j = await r.json();
      return { reachable: true, running: true, models: (j.models || []).map((m) => m.name) };
    }
    const r = await fetch(cfg.baseUrl + 'models', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { reachable: true, running: false, models: [] };
    const j = await r.json();
    return { reachable: true, running: true, models: (j.data || []).map((m) => m.id) };
  } catch {
    return { reachable: false, running: false, models: [] };
  }
}

// Honest support matrix consumed by the UI and the capabilities endpoint.
export function getExecutionCapabilities() {
  const cloud = PROVIDERS.map((p) => {
    const executable = EXEC_FORMATS.includes(p.format);
    return {
      id: p.id,
      name: p.name || p.id,
      format: p.format,
      supportsExecution: executable,
      streaming: executable,
      requiresKey: true,
      note: executable
        ? null
        : 'Model discovery supported; execution not yet implemented for this API format.',
    };
  });
  const local = RUNTIMES.map((rt) => {
    const cfg = RUNTIME_EXEC[rt.id];
    if (!cfg) {
      return {
        id: rt.id,
        name: rt.name,
        supportsExecution: false,
        streaming: false,
        note: 'Detection supported; execution adapter not implemented yet.',
      };
    }
    return {
      id: rt.id,
      name: cfg.label || rt.name,
      supportsExecution: true,
      streaming: cfg.streaming,
      baseUrl: cfg.baseUrl,
      note: cfg.kind === 'ollama'
        ? 'Full local execution (chat + streaming) via native API.'
        : 'OpenAI-compatible local server (chat + streaming) when running.',
    };
  });
  return { cloud, local };
}

export function providerSupportsExecution(providerId) {
  const p = getProvider(providerId);
  return !!p && EXEC_FORMATS.includes(p.format);
}
