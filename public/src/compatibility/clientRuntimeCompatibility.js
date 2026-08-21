// Client ↔ Runtime compatibility — whether a client can use a local model
// runtime, and what (if any) bridge is required. This is where the important
// honesty rule lives: Claude Code does NOT directly speak the Ollama API, so
// that combination is EXPERIMENTAL and explicitly requires a proxy layer. It is
// never presented as directly compatible.
import { getRuntime } from '../runtimes/registry.js';
import { experimental, supported, manual, unsupported } from './result.js';

// Protocols a runtime exposes. Ollama also ships an OpenAI-compatible /v1 surface.
const RUNTIME_PROTOCOLS = {
  ollama: ['ollama', 'openai-compatible'],
  lmstudio: ['openai-compatible'],
  llamacpp: ['openai-compatible'],
  vllm: ['openai-compatible'],
  sglang: ['openai-compatible'],
  koboldcpp: ['openai-compatible'],
  jan: ['openai-compatible'],
};

export function checkClientRuntime(clientId, runtimeId) {
  const runtime = typeof runtimeId === 'string' ? getRuntime(runtimeId) : runtimeId;
  if (!runtime) return unsupported('Unknown runtime');
  const protocols = RUNTIME_PROTOCOLS[runtime.id] || runtime.protocols || ['unknown'];

  if (clientId === 'claude-code') {
    // Claude Code only speaks the Anthropic Messages API. Any local runtime —
    // even Ollama's OpenAI-compatible surface — needs an Anthropic bridge first.
    return experimental('proxy-required', 'anthropic-proxy', [
      'Claude Code expects the Anthropic Messages API.',
      'A local runtime must be bridged through an Anthropic-compatible proxy (e.g. LiteLLM) before it can be used.',
      'Nexference documents this requirement; it does not install or configure the proxy in v0.4.0.',
    ]);
  }

  const speaksOpenAI = protocols.includes('openai-compatible');
  if (clientId === 'opencode-cli' || clientId === 'codex') {
    return speaksOpenAI
      ? supported('openai-compatible', clientId, [
          'OpenCode/Codex consume OpenAI-compatible endpoints; most local runtimes expose one.',
          'Auto-apply guidance only — Nexference does not write this client config yet.',
        ])
      : manual('unknown', clientId, [`${runtime.name} protocol is not recognised as OpenAI-compatible.`]);
  }

  if (clientId === 'gemini-cli') {
    return unsupported(
      'Gemini CLI expects the Gemini API; local runtimes expose Ollama/OpenAI protocols, not Gemini.',
      ['A Gemini bridge would be required for local models.']
    );
  }

  return unsupported(`No known compatibility path between ${clientId} and ${runtime.name}.`);
}
