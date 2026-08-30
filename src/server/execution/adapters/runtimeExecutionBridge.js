// ═══════════════════════════════════════════════════════════════
//  Runtime Execution Bridge (v2.0.0)
//
//  Integrates with existing local runtime adapters (Ollama, LM
//  Studio, etc.) without creating duplicate implementations.
//  Normalizes local execution results into the same contract as
//  cloud providers.
// ═══════════════════════════════════════════════════════════════

import { getRuntime } from '../../local/runtimes.js';
import { getRuntimeExec, probeRuntime } from '../executionRegistry.js';

export const BRIDGE_TYPE = 'runtime-execution-bridge';

export function isAvailable(runtimeId) {
  if (!runtimeId) return false;
  const rt = getRuntime(runtimeId);
  const cfg = getRuntimeExec(runtimeId);
  return !!rt && !!cfg;
}

export async function execute({ runtimeId, model, messages, systemPrompt, parameters, stream, signal, onToken }) {
  const cfg = getRuntimeExec(runtimeId);
  if (!cfg) throw new Error(`Runtime ${runtimeId} has no execution configuration.`);

  const probe = await probeRuntime(runtimeId);
  if (!probe.running) throw new Error(`${cfg.label || runtimeId} is not running. Start it first.`);

  // Delegate to the existing execution adapter's local functions.
  const { runExecutionAdapter } = await import('../executionAdapter.js');
  return runExecutionAdapter({
    source: 'local',
    runtimeId,
    model,
    messages,
    systemPrompt,
    parameters,
    stream,
  }, { signal, onToken });
}

export async function getCapabilities(runtimeId) {
  const cfg = getRuntimeExec(runtimeId);
  if (!cfg) return { chat: false, streaming: false };
  return {
    chat: true,
    streaming: cfg.streaming,
    connectionTest: true,
    modelListing: cfg.kind === 'ollama',
  };
}
