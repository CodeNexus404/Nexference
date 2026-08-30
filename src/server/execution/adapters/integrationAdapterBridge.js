// ═══════════════════════════════════════════════════════════════
//  Integration Adapter Bridge (v2.0.0)
//
//  Routes execution through the Provider Integration Framework's
//  adapters. Only executes when integration status permits and the
//  adapter explicitly supports execution. Never executes metadata-
//  only providers.
// ═══════════════════════════════════════════════════════════════

import { getProvider } from '../../providers/registry.js';
import { getIntegration } from '../../providers/integrations/integrationStore.js';
import { isExecutable, ADAPTER_TYPE } from '../../providers/integrations/integrationTypes.js';
import { getAdapter } from '../../providers/integrations/integrationRegistry.js';

export const BRIDGE_TYPE = 'integration-adapter-bridge';

export function isAvailable(providerId) {
  const integration = getIntegration(providerId);
  if (!integration) return false;
  if (!isExecutable(integration)) return false;
  const adapterType = integration.integrationAdapterType;
  if (!adapterType || adapterType === ADAPTER_TYPE.NONE || adapterType === ADAPTER_TYPE.UNKNOWN) return false;
  const adapter = getAdapter(adapterType, integration);
  const caps = adapter.getCapabilities();
  return caps.chat === true;
}

export async function execute({ providerId, model, messages, systemPrompt, parameters, stream, key, signal, onToken }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const integration = getIntegration(providerId);
  if (!integration) throw new Error(`No integration record for ${providerId}`);
  if (!isExecutable(integration)) throw new Error(`Provider ${providerId} is not executable (status: ${integration.status})`);

  const adapterType = integration.integrationAdapterType;
  const adapter = getAdapter(adapterType, integration);
  const caps = adapter.getCapabilities();
  if (!caps.chat) throw new Error(`Integration adapter ${adapterType} does not support chat execution.`);

  // Use the existing ProviderAdapter for actual HTTP calls — the integration
  // adapter validated the route; the legacy adapter does the real work.
  const { getProviderAdapter } = await import('../../providers/providerAdapter.js');
  const legacyAdapter = getProviderAdapter(provider);
  return legacyAdapter.chat({
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
    modelListing: false,
  };
}
