// ═══════════════════════════════════════════════════════════════
//  Legacy Provider Bridge (v2.0.0)
//
//  Safely wraps the existing ProviderAdapter architecture so the
//  Unified Execution Gateway can delegate cloud execution to the
//  proven, tested adapters without rewriting them. This bridge
//  adapts the old contract into the gateway's normalized shape.
//
//  Why the legacy route is selected:
//  - Provider has a supported format (openai/anthropic/gemini)
//  - Provider is registered in the static PROVIDERS list
//  - Integration status may be unknown or not yet assessed
//  - The existing ProviderAdapter is the safest execution path
// ═══════════════════════════════════════════════════════════════

import { getExecutableProvider } from '../executionResolver.js';
import { getProviderAdapter } from '../../providers/providerAdapter.js';

export const BRIDGE_TYPE = 'legacy-provider-bridge';

export function isAvailable(providerId) {
  const provider = getExecutableProvider(providerId);
  return !!provider && ['openai', 'anthropic', 'gemini'].includes(provider.format);
}

export async function execute({ providerId, model, messages, systemPrompt, parameters, stream, key, signal, onToken }) {
  const provider = getExecutableProvider(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const adapter = getProviderAdapter(provider);
  return adapter.chat({
    url: provider.baseUrl,
    key,
    model,
    messages,
    systemPrompt,
    parameters: {
      temperature: parameters?.temperature,
      maxTokens: parameters?.maxTokens,
      topP: parameters?.topP,
    },
    stream,
    signal,
    onToken,
  });
}

export function getCapabilities() {
  return {
    chat: true,
    streaming: true,
    connectionTest: true,
    modelListing: true,
  };
}
