// ═══════════════════════════════════════════════════════════════
//  Execution Validation (v0.9.0)
//
//  Honest pre-flight check performed BEFORE any request is sent. It never
//  lets the user discover a trivial misconfiguration only after sending a
//  prompt. Returns an explicit, explainable result the UI renders verbatim.
// ═══════════════════════════════════════════════════════════════

import { getProvider } from '../providers/registry.js';
import { getRuntime } from '../local/runtimes.js';
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
    r.sourceStatus = probe.running ? 'reachable' : (probe.reachable ? 'offline' : 'unreachable');
    if (!probe.running) {
      r.reasons.push(`The selected runtime (${rt.name}) is not currently reachable.`);
      r.requiredConfiguration.push(`Start ${rt.name} and ensure it is listening on its port (${cfg.baseUrl}).`);
      r.level = 'blocked';
      return r;
    }
    if (model && !probe.models.includes(model)) {
      r.reasons.push(`Model "${model}" is not installed on ${rt.name}.`);
      r.requiredConfiguration.push(`Install "${model}" via ${rt.name} (e.g. \`ollama pull ${model}\`).`);
      r.score = 60;
      r.level = 'blocked';
      r.sourceStatus = 'missing-model';
      return r;
    }
    r.capabilities = { chat: true, streaming: cfg.streaming, tools: null, vision: null };
    if (model) r.reasons.push(`${rt.name} is reachable and "${model}" is installed.`);
    else r.warnings.push('No model selected yet.');
    r.executable = !!model;
    r.level = 'native';
    r.score = 100;
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
