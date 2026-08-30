// OpenAI-compatible adapter (v1.9.0) — the first fully implemented integration
// adapter, because an OpenAI-compatible surface unlocks many legitimate provider
// integrations. It deliberately does NOT auto-classify a provider as OpenAI-
// compatible; the resolver only selects this adapter when explicit evidence
// exists. Execution reuses the existing Provider Adapter's tested request/stream
// patterns rather than spawning a second execution system.
//
// No credentials are stored: testConnection/listModels receive a transient config.
import { BaseProviderAdapter } from './baseAdapter.js';
import { getProviderAdapter } from '../../providerAdapter.js';

export class OpenAICompatibleAdapter extends BaseProviderAdapter {
  static adapterType = 'openai-compatible';

  getCapabilities() {
    return {
      chat: true,
      streaming: true,
      modelListing: true,
      connectionTest: true,
      customHeaders: true,
      environmentVariables: true,
    };
  }

  validateConfiguration(config = {}) {
    if (!config.baseUrl) return { supported: true, valid: false, reason: 'A base URL is required for an OpenAI-compatible provider.' };
    return { supported: true, valid: true, adapterType: 'openai-compatible' };
  }

  async testConnection(config = {}) {
    if (!config.baseUrl || !config.key) {
      return { supported: false, reason: 'Missing base URL or API key for connection test.' };
    }
    try {
      const adapter = getProviderAdapter({ format: 'openai' });
      const r = await adapter.testConnection({ url: config.baseUrl, key: config.key, model: config.model });
      return { supported: true, status: r.status, body: r.body };
    } catch (err) {
      return { supported: false, reason: err.message || 'connection test failed' };
    }
  }

  async listModels(config = {}) {
    if (!config.baseUrl || !config.key) {
      return { supported: false, reason: 'Missing base URL or API key for model listing.' };
    }
    try {
      const adapter = getProviderAdapter({ format: 'openai' });
      // Reuse the shared model fetcher via a synthetic provider object.
      const probe = new adapter.constructor({ id: config.providerId || 'openai', format: 'openai', baseUrl: config.baseUrl });
      const models = await probe.fetchModels(config.key);
      return { supported: true, models: Array.isArray(models) ? models : [] };
    } catch (err) {
      return { supported: false, reason: err.message || 'model listing failed' };
    }
  }

  buildExecutionRequest(config = {}, request = {}) {
    if (!config.baseUrl) return { supported: false, reason: 'Missing base URL.' };
    return {
      supported: true,
      adapterType: 'openai-compatible',
      endpoint: `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
      auth: `Bearer ${config.key}`,
      body: request,
    };
  }

  normalizeResponse(response) {
    // OpenAI chat/completions shape.
    try {
      const content = response?.choices?.[0]?.message?.content || '';
      const usage = response?.usage
        ? { inputTokens: response.usage.prompt_tokens ?? null, outputTokens: response.usage.completion_tokens ?? null }
        : null;
      return { supported: true, content, usage };
    } catch {
      return { supported: false, reason: 'Could not normalize OpenAI response.' };
    }
  }
}
