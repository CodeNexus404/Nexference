// ═══════════════════════════════════════════════════════════════
//  Execution Resolver (v2.0.0)
//
//  Deterministic resolution of HOW an execution request should be
//  routed through the Unified Execution Gateway. Returns an honest
//  assessment of which bridge to use and why. Never guesses.
// ═══════════════════════════════════════════════════════════════

import { getProvider } from '../providers/registry.js';
import { getRuntime } from '../local/runtimes.js';
import { getIntegration } from '../providers/integrations/integrationStore.js';
import { isExecutable } from '../providers/integrations/integrationTypes.js';
import { getRuntimeExec, EXEC_FORMATS } from './executionRegistry.js';

export const EXEC_ROUTE = {
  LEGACY_PROVIDER_BRIDGE: 'legacy-provider-bridge',
  INTEGRATION_ADAPTER_BRIDGE: 'integration-adapter-bridge',
  RUNTIME_EXECUTION_BRIDGE: 'runtime-execution-bridge',
  UNSUPPORTED: 'unsupported',
};

export function resolveExecutionRoute(req = {}) {
  const { source, providerId, runtimeId, key } = req;
  const isLocal = source === 'local' || !!runtimeId;

  if (isLocal) return resolveLocalRoute(runtimeId);
  return resolveCloudRoute(providerId, key);
}

function resolveLocalRoute(runtimeId) {
  if (!runtimeId) {
    return { executable: false, route: EXEC_ROUTE.UNSUPPORTED, reason: 'No runtime specified.', adapterType: null };
  }
  const rt = getRuntime(runtimeId);
  if (!rt) {
    return { executable: false, route: EXEC_ROUTE.UNSUPPORTED, reason: `Unknown runtime: "${runtimeId}".`, adapterType: null };
  }
  const cfg = getRuntimeExec(runtimeId);
  if (!cfg) {
    return { executable: false, route: EXEC_ROUTE.UNSUPPORTED, reason: `${rt.name} detection is supported, but no execution adapter is implemented.`, adapterType: null };
  }
  return {
    executable: true,
    route: EXEC_ROUTE.RUNTIME_EXECUTION_BRIDGE,
    reason: `${rt.name} local runtime (${cfg.kind === 'ollama' ? 'native API' : 'OpenAI-compatible'})`,
    adapterType: cfg.kind,
  };
}

function resolveCloudRoute(providerId, key) {
  if (!providerId) {
    return { executable: false, route: EXEC_ROUTE.UNSUPPORTED, reason: 'No provider specified.', adapterType: null };
  }
  const provider = getProvider(providerId);
  if (!provider) {
    return { executable: false, route: EXEC_ROUTE.UNSUPPORTED, reason: `Unknown provider: "${providerId}".`, adapterType: null };
  }

  // Check integration status first
  const integration = getIntegration(providerId);
  if (integration && isExecutable(integration)) {
    return {
      executable: true,
      route: EXEC_ROUTE.INTEGRATION_ADAPTER_BRIDGE,
      reason: `Integration adapter: ${integration.integrationAdapterType || provider.format}`,
      adapterType: integration.integrationAdapterType || provider.format,
    };
  }

  // Fall back to legacy bridge if the format is supported
  if (EXEC_FORMATS.includes(provider.format)) {
    return {
      executable: true,
      route: EXEC_ROUTE.LEGACY_PROVIDER_BRIDGE,
      reason: `Legacy provider adapter (${provider.format} format)`,
      adapterType: provider.format,
    };
  }

  // No executable route
  const hasIntegration = !!integration;
  const integrationStatus = integration?.status || 'unknown';
  return {
    executable: false,
    route: EXEC_ROUTE.UNSUPPORTED,
    reason: hasIntegration
      ? `Integration status "${integrationStatus}" — no executable adapter available.`
      : `Provider format "${provider.format}" is not supported for execution.`,
    adapterType: null,
  };
}

export function resolveExecutionStatus(providerId, runtimeId, key) {
  const isLocal = !providerId || !!runtimeId;
  if (isLocal) {
    const rt = getRuntime(runtimeId);
    const cfg = runtimeId ? getRuntimeExec(runtimeId) : null;
    if (!rt) return { status: 'unsupported', reason: 'Unknown runtime.' };
    if (!cfg) return { status: 'unsupported', reason: `${rt.name} has no execution adapter.` };
    return { status: 'ready', reason: `${rt.name} available.`, route: EXEC_ROUTE.RUNTIME_EXECUTION_BRIDGE };
  }

  const provider = getProvider(providerId);
  if (!provider) return { status: 'unsupported', reason: 'Unknown provider.' };

  const integration = getIntegration(providerId);
  if (integration && isExecutable(integration)) {
    if (!key) return { status: 'needs_credentials', reason: 'Integration supported — API key required.', route: EXEC_ROUTE.INTEGRATION_ADAPTER_BRIDGE };
    return { status: 'ready', reason: 'Integration supported with credentials.', route: EXEC_ROUTE.INTEGRATION_ADAPTER_BRIDGE };
  }

  if (EXEC_FORMATS.includes(provider.format)) {
    if (!key) return { status: 'needs_credentials', reason: `API key required for ${provider.format} provider.`, route: EXEC_ROUTE.LEGACY_PROVIDER_BRIDGE };
    return { status: 'ready', reason: `Legacy adapter ready (${provider.format}).`, route: EXEC_ROUTE.LEGACY_PROVIDER_BRIDGE };
  }

  if (integration) {
    return { status: 'metadata_only', reason: `Integration status: ${integration.status}. No execution adapter.`, route: null };
  }

  return { status: 'unsupported', reason: `Format "${provider.format}" not supported for execution.`, route: null };
}
