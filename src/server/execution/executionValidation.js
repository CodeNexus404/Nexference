// ═══════════════════════════════════════════════════════════════
//  Execution Validation (v0.9.0)
//
//  Honest pre-flight check performed BEFORE any request is sent. It never
//  lets the user discover a trivial misconfiguration only after sending a
//  prompt. Returns an explicit, explainable result the UI renders verbatim.
// ═══════════════════════════════════════════════════════════════

import os from 'os';
import { getProvider } from '../providers/registry.js';
import { getRuntime, getLmStudioModelDetails } from '../local/runtimes.js';
import { getModelDetails } from '../models/modelIntelligenceService.js';
import { getRuntimeExec, probeRuntime, EXEC_FORMATS } from './executionRegistry.js';

// Registry providers expose `id` (not `name`); resolve a display label safely.
const pname = (p) => (p && (p.name || p.id)) || 'provider';

function empty() {
  return {
    executable: false,
    level: 'unsupported',
    score: 0,
    reasons: [],
    warnings: [],
    limitations: [],
    requiredConfiguration: [],
    capabilities: { chat: null, streaming: null, tools: null, vision: null },
    sourceStatus: 'unknown',
  };
}

// ── Real local-model compatibility scoring ────────────────────────────
// Score is derived from the device's actual memory versus the model's real
// on-disk footprint — never a fixed constant. We estimate the model's RAM
// footprint from the actual file size (GGUF / safetensors) and compare it to
// the memory the OS can realistically make available.
function getSystemMemory() {
  const totalBytes = os.totalmem();
  // macOS/Linux report "free" memory unreliably (aggressive caching), so we
  // estimate available as total minus a realistic OS + app reserve.
  const reserve = Math.max(2 * 1024 ** 3, totalBytes * 0.2);
  const freeBytes = os.freemem();
  const availableBytes = Math.max(freeBytes, totalBytes - reserve);
  return { totalBytes, freeBytes, availableBytes };
}

// Real memory footprint of a local model in bytes, or null if unknown.
async function getLocalModelFootprint(runtimeId, model) {
  if (!model) return null;
  try {
    if (runtimeId === 'lmstudio') {
      const d = getLmStudioModelDetails()[model];
      return d && d.sizeBytes ? d.sizeBytes : null;
    }
    if (runtimeId === 'ollama') {
      const r = await fetch('http://localhost:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) return null;
      const j = await r.json().catch(() => ({}));
      const size = j?.model_info?.size ?? j?.size ?? null;
      return typeof size === 'number' ? size : null;
    }
  } catch { return null; }
  return null;
}

async function computeLocalScore(runtimeId, model) {
  const gb = (b) => (b / 1e9).toFixed(1);
  const mem = getSystemMemory();
  const footprint = await getLocalModelFootprint(runtimeId, model);
  if (!footprint) {
    return {
      score: 85, level: 'native',
      reasons: [`Model memory requirement could not be auto-detected — verify your device has enough RAM (rule of thumb: ~model size × 1.2 for context).`],
      warnings: ['Compatibility is estimated; confirm RAM headroom manually before running large models.'],
    };
  }
  const avail = mem.availableBytes;
  if (footprint <= avail * 0.85) {
    return {
      score: 95, level: 'native',
      reasons: [`Fits comfortably: needs ~${gb(footprint)} GB; device has ~${gb(avail)} GB available (of ${gb(mem.totalBytes)} GB total).`],
      warnings: [],
    };
  }
  if (footprint <= avail) {
    return {
      score: 78, level: 'native',
      reasons: [`Fits available memory (~${gb(footprint)} GB vs ~${gb(avail)} GB available), but headroom is tight.`],
      warnings: ['Close memory-heavy apps for best throughput.'],
    };
  }
  if (footprint <= mem.totalBytes) {
    return {
      score: 58, level: 'native',
      reasons: [`Exceeds comfortably-available memory (~${gb(footprint)} GB vs ~${gb(avail)} GB available).`],
      warnings: ['Will likely rely on swap — expect slower inference.'],
    };
  }
  return {
    score: 22, level: 'blocked',
    reasons: [`Won't fit in RAM: needs ~${gb(footprint)} GB but device has only ${gb(mem.totalBytes)} GB total.`],
    warnings: ['Use a smaller or more aggressively quantised model, or a device with more memory.'],
  };
}

export async function validateExecution(req = {}) {
  const {
    source, providerId, runtimeId, model,
    stream = false, key, requestedCapabilities = [],
  } = req;

  const r = empty();
  const isLocal = source === 'local' || runtimeId;

  if (isLocal) {
    const rt = getRuntime(runtimeId);
    if (!rt) { r.reasons.push(`Unknown runtime: "${runtimeId}".`); return r; }
    const cfg = getRuntimeExec(runtimeId);
    if (!cfg) {
      r.reasons.push(`${rt.name} detection is supported, but an execution adapter is not implemented yet.`);
      r.requiredConfiguration.push(`Wait for ${rt.name} execution support, or use a supported runtime such as Ollama.`);
      r.sourceStatus = 'unsupported';
      return r;
    }
    const probe = await probeRuntime(runtimeId);
    const lmInstalled = runtimeId === 'lmstudio' ? Object.keys(getLmStudioModelDetails()) : [];
    const isInstalled = (m) => probe.models.includes(m) || lmInstalled.includes(m);
    r.sourceStatus = probe.running ? 'reachable' : (probe.reachable ? 'offline' : 'unreachable');
    if (!probe.running) {
      if (model && !isInstalled(model)) {
        r.reasons.push(`The selected model ("${model}") is not installed in ${rt.name}.`);
        r.requiredConfiguration.push(`Install "${model}" via ${rt.name} (e.g. \`lms pull ${model}\` for LM Studio).`);
      } else {
        r.reasons.push(`${rt.name} is installed but its Local Server is not currently running.`);
        r.requiredConfiguration.push(`Start ${rt.name}'s Local Server (e.g. \`lms server start\` for LM Studio).`);
      }
      r.level = 'blocked';
      return r;
    }
    if (model && !isInstalled(model)) {
      r.reasons.push(`Model "${model}" is not installed on ${rt.name}.`);
      r.requiredConfiguration.push(`Install "${model}" via ${rt.name} (e.g. \`ollama pull ${model}\`).`);
      r.score = 60;
      r.level = 'blocked';
      r.sourceStatus = 'missing-model';
      return r;
    }
    r.capabilities = { chat: true, streaming: cfg.streaming, tools: null, vision: null };
    // Real compatibility score derived from the device's actual specifications
    // (RAM vs the model's real memory footprint) rather than a fixed constant.
    const sc = await computeLocalScore(runtimeId, model);
    r.score = sc.score;
    r.level = sc.level;
    if (model) r.reasons.push(`${rt.name} is reachable and "${model}" is available.`);
    else r.warnings.push('No model selected yet.');
    (sc.reasons || []).forEach((x) => r.reasons.push(x));
    (sc.warnings || []).forEach((x) => r.warnings.push(x));
    r.executable = !!model;
    return r;
  }

  // ── Cloud ──
  const provider = getProvider(providerId);
  if (!provider) { r.reasons.push(`Unknown provider: "${providerId}".`); return r; }
  if (!EXEC_FORMATS.includes(provider.format)) {
    r.reasons.push(`${pname(provider)} supports model discovery, but execution is not yet implemented for its ${provider.format} API format.`);
    r.limitations.push('Model discovery supported; execution not yet supported.');
    r.sourceStatus = 'unsupported';
    return r;
  }
  r.capabilities.streaming = true;
  if (!key) {
    r.reasons.push(`No API key provided for ${pname(provider)}.`);
    r.requiredConfiguration.push(`Provide an API key for ${pname(provider)}.`);
    r.level = 'native';
    r.score = 60;
    r.sourceStatus = 'needs-key';
    // Still surface model checks below so the user sees everything at once.
  } else {
    r.sourceStatus = 'configured';
  }

  let record = null;
  if (model) {
    try { record = await getModelDetails(providerId, model); } catch { record = null; }
    if (record) {
      r.capabilities.chat = record.capabilities?.chat ?? null;
      if (record.capabilities?.chat === false) {
        r.reasons.push(`"${model}" is not a chat-capable model.`);
        r.requiredConfiguration.push(`Select a chat-capable model from ${pname(provider)}.`);
        r.executable = false;
        r.score = 40;
        return r;
      }
      for (const cap of requestedCapabilities) {
        if (record.capabilities?.[cap] === false) {
          r.limitations.push(`"${model}" does not support ${cap}.`);
        }
      }
    } else {
      r.warnings.push(`"${model}" is not in the ${pname(provider)} catalogue; chat capability could not be verified.`);
    }
  } else {
    r.warnings.push('No model selected yet.');
  }

  const keyOk = !!key;
  if (keyOk && model) {
    r.executable = true;
    r.level = 'native';
    r.score = 100;
    r.reasons.push(`${pname(provider)} can execute "${model}" via its ${provider.format} API.`);
  } else if (keyOk && !model) {
    r.executable = false;
    r.level = 'native';
    r.score = 80;
  }
  return r;
}
