// Gemini-compatible adapter (v1.9.0) — wraps the existing Gemini Provider Adapter
// for connection testing and execution. Limited capabilities are acceptable for
// v1.9.0; we do not fabricate model-listing support.
import { BaseProviderAdapter } from './baseAdapter.js';
import { getProviderAdapter } from '../../providerAdapter.js';

export class GeminiCompatibleAdapter extends BaseProviderAdapter {
  static adapterType = 'gemini-compatible';

  getCapabilities() {
    return {
      chat: true,
      streaming: true,
      modelListing: false,
      connectionTest: true,
      customHeaders: false,
      environmentVariables: false,
    };
  }

  validateConfiguration(config = {}) {
    if (!config.baseUrl) return { supported: true, valid: false, reason: 'A base URL is required for a Gemini-compatible provider.' };
    return { supported: true, valid: true, adapterType: 'gemini-compatible' };
  }

  async testConnection(config = {}) {
    if (!config.baseUrl || !config.key) {
      return { supported: false, reason: 'Missing base URL or API key for connection test.' };
    }
    try {
      const adapter = getProviderAdapter({ format: 'gemini' });
      const r = await adapter.testConnection({ url: config.baseUrl, key: config.key, model: config.model });
      return { supported: true, status: r.status, body: r.body };
    } catch (err) {
      return { supported: false, reason: err.message || 'connection test failed' };
    }
  }

  buildExecutionRequest(config = {}, request = {}) {
    if (!config.baseUrl) return { supported: false, reason: 'Missing base URL.' };
    return {
      supported: true,
      adapterType: 'gemini-compatible',
      endpoint: `${config.baseUrl.replace(/\/$/, '')}/models/${config.model || 'gemini-2.0-flash'}:generateContent`,
      auth: null,
      body: request,
    };
  }

  normalizeResponse(response) {
    try {
      const content = (response?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      return { supported: true, content };
    } catch {
      return { supported: false, reason: 'Could not normalize Gemini response.' };
    }
  }
}
