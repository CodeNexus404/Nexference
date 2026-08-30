// Unsupported / metadata-only adapter (v1.9.0) — the default when no executable
// adapter is available. Every method explicitly reports unsupported with a reason,
// so the UI never implies functionality that does not exist.
import { BaseProviderAdapter } from './baseAdapter.js';

export class UnsupportedAdapter extends BaseProviderAdapter {
  static adapterType = 'none';

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

  validateConfiguration() {
    return { supported: false, valid: false, reason: 'No verified adapter is available for this provider.' };
  }

  async testConnection() {
    return { supported: false, reason: 'No verified adapter is available for this provider.' };
  }

  async listModels() {
    return { supported: false, reason: 'No verified adapter is available for this provider.' };
  }

  buildExecutionRequest() {
    return { supported: false, reason: 'No verified adapter is available for this provider.' };
  }

  normalizeResponse() {
    return { supported: false, reason: 'No verified adapter is available for this provider.' };
  }
}
