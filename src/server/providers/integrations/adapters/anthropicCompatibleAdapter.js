// Anthropic-compatible adapter (v1.9.0) — wraps the existing Anthropic Provider
// Adapter for connection testing and execution. Only selected by the resolver when
// explicit evidence indicates an Anthropic Messages API surface.
//
// IMPORTANT: Anthropic compatibility does NOT imply Claude Code configuration
// support by itself. That decision remains owned by the Client Compatibility
// system (claudeCodeAdapter / configurationEngine), which is untouched here.
import { BaseProviderAdapter } from './baseAdapter.js';
import { getProviderAdapter } from '../../providerAdapter.js';

export class AnthropicCompatibleAdapter extends BaseProviderAdapter {
  static adapterType = 'anthropic-compatible';

  getCapabilities() {
    return {
      chat: true,
      streaming: true,
      modelListing: false, // model listing uses a separate catalogue; not asserted here
      connectionTest: true,
      customHeaders: true,
      environmentVariables: true,
    };
  }

  validateConfiguration(config = {}) {
    if (!config.baseUrl) return { supported: true, valid: false, reason: 'A base URL is required for an Anthropic-compatible provider.' };
    return { supported: true, valid: true, adapterType: 'anthropic-compatible' };
  }

  async testConnection(config = {}) {
    if (!config.baseUrl) return { supported: false, reason: 'Missing base URL for connection test.' };
    try {
      const adapter = getProviderAdapter({ format: 'anthropic' });
      const r = await adapter.testConnection({ url: config.baseUrl, key: config.key, model: config.model, auth: 'x-api-key' });
      return { supported: true, status: r.status, body: r.body };
    } catch (err) {
      return { supported: false, reason: err.message || 'connection test failed' };
    }
  }

  buildExecutionRequest(config = {}, request = {}) {
    if (!config.baseUrl) return { supported: false, reason: 'Missing base URL.' };
    return {
      supported: true,
      adapterType: 'anthropic-compatible',
      endpoint: `${config.baseUrl.replace(/\/$/, '')}/v1/messages`,
      auth: config.key ? `x-api-key` : null,
      body: request,
    };
  }

  normalizeResponse(response) {
    try {
      const content = (response?.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const usage = response?.usage
        ? { inputTokens: response.usage.input_tokens ?? null, outputTokens: response.usage.output_tokens ?? null }
        : null;
      return { supported: true, content, usage };
    } catch {
      return { supported: false, reason: 'Could not normalize Anthropic response.' };
    }
  }
}
