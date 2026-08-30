// ═══════════════════════════════════════════════════════════════
//  Execution Capabilities (v2.0.0)
//
//  Central capability service for the Unified Execution Gateway.
//  Exposes per-provider/runtime execution capabilities including
//  route, adapter, status, and limitations. Used by the frontend
//  to render honest execution information without hardcoding
//  provider assumptions.
// ═══════════════════════════════════════════════════════════════

import { PROVIDERS, getProvider } from '../providers/registry.js';
import { RUNTIMES } from '../local/runtimes.js';
import { getIntegration } from '../providers/integrations/integrationStore.js';
import { isExecutable, ADAPTER_TYPE } from '../providers/integrations/integrationTypes.js';
import { EXEC_FORMATS, getRuntimeExec, probeRuntime } from './executionRegistry.js';
import { resolveExecutionRoute, resolveExecutionStatus, EXEC_ROUTE } from './executionResolver.js';
import { isAvailable as legacyAvailable, getCapabilities as legacyCaps } from './adapters/legacyProviderBridge.js';
import { isAvailable as integrationAvailable, getCapabilities as integrationCaps } from './adapters/integrationAdapterBridge.js';
import { isAvailable as runtimeAvailable, getCapabilities as runtimeCaps } from './adapters/runtimeExecutionBridge.js';

export function getExecutionCapabilitiesFull() {
  const cloud = PROVIDERS.map((p) => {
    const status = resolveExecutionStatus(p.id, null, null);
    const integration = getIntegration(p.id);
    const hasIntegration = !!integration;
    const isIntegExec = hasIntegration && isExecutable(integration);
    const adapterType = isIntegExec ? integration.integrationAdapterType : (EXEC_FORMATS.includes(p.format) ? p.format : null);
    const route = status.route;
    const caps = route === EXEC_ROUTE.INTEGRATION_ADAPTER_BRIDGE ? integrationCaps()
      : route === EXEC_ROUTE.LEGACY_PROVIDER_BRIDGE ? legacyCaps()
      : { chat: false, streaming: false, connectionTest: false, modelListing: false };

    return {
      id: p.id,
      name: p.name || p.id,
      format: p.format,
      executable: status.status === 'ready',
      status: status.status,
      statusReason: status.reason,
      route,
      adapterType,
      capabilities: caps,
      integrationStatus: integration?.status || null,
      note: status.status === 'metadata_only'
        ? 'Provider has integration support but no execution adapter.'
        : status.status === 'unsupported'
        ? `Format "${p.format}" is not supported for execution.`
        : null,
    };
  });

  const local = RUNTIMES.map((rt) => {
    const cfg = getRuntimeExec(rt.id);
    const caps = cfg ? runtimeCaps(rt.id) : { chat: false, streaming: false };
    return {
      id: rt.id,
      name: rt.name,
      executable: !!cfg,
      status: cfg ? 'ready' : 'unsupported',
      statusReason: cfg ? `${rt.name} local runtime` : `${rt.name} has no execution adapter.`,
      route: cfg ? EXEC_ROUTE.RUNTIME_EXECUTION_BRIDGE : EXEC_ROUTE.UNSUPPORTED,
      adapterType: cfg?.kind || null,
      capabilities: caps,
      note: cfg ? null : 'Detection supported; execution adapter not implemented.',
    };
  });

  return { cloud, local };
}

export function getExecutionCoverage() {
  const all = getExecutionCapabilitiesFull();
  const cloudExec = all.cloud.filter((c) => c.executable);
  const cloudNeedsSetup = all.cloud.filter((c) => c.status === 'needs_credentials');
  const cloudMetaOnly = all.cloud.filter((c) => c.status === 'metadata_only');
  const cloudUnsupported = all.cloud.filter((c) => c.status === 'unsupported');
  const localExec = all.local.filter((c) => c.executable);

  return {
    totalProviders: all.cloud.length,
    executable: cloudExec.length,
    needsCredentials: cloudNeedsSetup.length,
    metadataOnly: cloudMetaOnly.length,
    unsupported: cloudUnsupported.length,
    localRuntimes: all.local.length,
    localExecutable: localExec.length,
    executableProviders: cloudExec.map((c) => ({ id: c.id, name: c.name, route: c.route, adapterType: c.adapterType })),
    needsSetupProviders: cloudNeedsSetup.map((c) => ({ id: c.id, name: c.name, route: c.route })),
    metadataOnlyProviders: cloudMetaOnly.map((c) => ({ id: c.id, name: c.name })),
  };
}

export async function getExecutionDiagnostics(executionId) {
  return {
    executionId,
    note: 'Diagnostics available for live executions via the execution record.',
  };
}
