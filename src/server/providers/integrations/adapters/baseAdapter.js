// Base Provider Adapter (v1.9.0) — the interface every integration adapter
// implements. The goal is a clean, swappable adapter architecture that can grow
// to support additional provider protocols later without rewriting the registry.
//
// Key safety rule: adapters NEVER receive or return credentials. They accept a
// transient `config` ({ baseUrl, key, model, ... }) for a single action only and
// return normalized results. Any capability a concrete adapter does not implement
// MUST return { supported: false, reason } — never a fake implementation.

export class BaseProviderAdapter {
  // Adapter protocol type (one of ADAPTER_TYPE). Override in subclasses.
  static adapterType = 'unknown';

  constructor(meta = {}) {
    this.meta = meta || {};
  }

  // What this adapter can actually do. Override per protocol.
  getCapabilities() {
    return {
      chat: false,
      streaming: false,
      modelListing: false,
      connectionTest: false,
      customHeaders: false,
      environmentVariables: false,
    };
  }

  // Validate a configuration draft (no execution). Honest about what's missing.
  validateConfiguration(/* config */) {
    return { supported: false, valid: false, reason: 'This adapter does not implement configuration validation.' };
  }

  // Probe a connection with credentials supplied transiently.
  async testConnection(/* config */) {
    return { supported: false, reason: 'No executable adapter is available for this provider.' };
  }

  // List models (when the protocol supports it).
  async listModels(/* config */) {
    return { supported: false, reason: 'Model listing is not supported by this adapter.' };
  }

  // Build an execution request for the existing playground/execution path.
  buildExecutionRequest(/* config, request */) {
    return { supported: false, reason: 'Execution is not supported by this adapter.' };
  }

  // Normalize a raw provider response into the shared shape.
  normalizeResponse(/* response */) {
    return { supported: false, reason: 'Response normalization is not supported by this adapter.' };
  }
}
