// ═══════════════════════════════════════════════════════════════
//  Unified Execution Gateway (v2.0.0)
//
//  Central orchestration layer for ALL execution in Nexference.
//  Receives normalized execution input, resolves the execution
//  route, delegates to the appropriate bridge, normalizes the
//  result, and returns honest errors. This is the ONE entry point
//  for all execution — cloud, local, integration, or legacy.
//
//  The gateway does NOT replace the existing executionService; it
//  wraps it. The existing service continues to manage execution
//  lifecycle, SSE streaming, history, and benchmarks. The gateway
//  adds resolution intelligence on top.
// ═══════════════════════════════════════════════════════════════

import { resolveExecutionRoute, resolveExecutionStatus, EXEC_ROUTE } from './executionResolver.js';
import { normalizeError, ERROR_CATEGORY } from './executionErrors.js';
import { createNormalizedResult, EXEC_STATUS } from './executionNormalizer.js';
import { isAvailable as legacyAvailable, execute as legacyExecute, BRIDGE_TYPE as LEGACY_BRIDGE } from './adapters/legacyProviderBridge.js';
import { isAvailable as integrationAvailable, execute as integrationExecute, BRIDGE_TYPE as INTEGRATION_BRIDGE } from './adapters/integrationAdapterBridge.js';
import { isAvailable as runtimeAvailable, execute as runtimeExecute, BRIDGE_TYPE as RUNTIME_BRIDGE } from './adapters/runtimeExecutionBridge.js';

export function resolveGateway(req) {
  return resolveExecutionRoute(req);
}

export function resolveStatus(providerId, runtimeId, key) {
  return resolveExecutionStatus(providerId, runtimeId, key);
}

export async function gatewayExecute(req, { signal, onToken } = {}) {
  const resolution = resolveExecutionRoute(req);
  if (!resolution.executable) {
    return {
      ok: false,
      resolution,
      error: normalizeError(resolution.reason, resolution.route),
      result: null,
    };
  }

  try {
    let result;
    const { route } = resolution;

    if (route === EXEC_ROUTE.RUNTIME_EXECUTION_BRIDGE) {
      if (!runtimeAvailable(req.runtimeId)) {
        throw new Error(`Runtime bridge not available for ${req.runtimeId}`);
      }
      result = await runtimeExecute({
        runtimeId: req.runtimeId,
        model: req.model,
        messages: req.messages,
        systemPrompt: req.systemPrompt,
        parameters: req.parameters,
        stream: req.stream,
        signal,
        onToken,
      });
    } else if (route === EXEC_ROUTE.INTEGRATION_ADAPTER_BRIDGE) {
      if (!integrationAvailable(req.providerId)) {
        throw new Error(`Integration bridge not available for ${req.providerId}`);
      }
      result = await integrationExecute({
        providerId: req.providerId,
        model: req.model,
        messages: req.messages,
        systemPrompt: req.systemPrompt,
        parameters: req.parameters,
        stream: req.stream,
        key: req.key,
        signal,
        onToken,
      });
    } else if (route === EXEC_ROUTE.LEGACY_PROVIDER_BRIDGE) {
      if (!legacyAvailable(req.providerId)) {
        throw new Error(`Legacy bridge not available for ${req.providerId}`);
      }
      result = await legacyExecute({
        providerId: req.providerId,
        model: req.model,
        messages: req.messages,
        systemPrompt: req.systemPrompt,
        parameters: req.parameters,
        stream: req.stream,
        key: req.key,
        signal,
        onToken,
      });
    } else {
      throw new Error(`Unknown execution route: ${route}`);
    }

    return {
      ok: true,
      resolution,
      error: null,
      result,
    };
  } catch (err) {
    return {
      ok: false,
      resolution,
      error: normalizeError(err, resolution.route),
      result: null,
    };
  }
}

export async function getGatewayCapabilities() {
  const mod = await import('./executionCapabilities.js');
  return mod.getExecutionCapabilitiesFull();
}

export async function getGatewayCoverage() {
  const mod = await import('./executionCapabilities.js');
  return mod.getExecutionCoverage();
}
