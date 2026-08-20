import { norm } from '../utils/index.js';
import { fetchModelsForProvider } from './modelService.js';

// ═══════════════════════════════════════════════════════════════
//  Provider Adapter interface
//
//  Abstraction over a gateway's server-side behaviours: pulling its model
//  list and probing a connection. Concrete adapters vary only by API dialect
//  (Anthropic / OpenAI / Gemini). The original monolithic fetch + test logic
//  is preserved verbatim inside each adapter — this layer only gives it a
//  named, swappable interface for future milestones (new dialects, new
//  gateways) without rewriting the working code.
// ═══════════════════════════════════════════════════════════════

export class ProviderAdapter {
  constructor(provider) {
    this.provider = provider;
  }

  // Resolve the provider's model list (delegates to the shared model service).
  fetchModels(key = '') {
    return fetchModelsForProvider(this.provider, key);
  }

  // Probe a connection. Subclasses implement the dialect-specific request.
  // Returns { status, body } — mirroring the original /api/test contract.
  async testConnection(/* { url, key, model, auth } */) {
    throw new Error('testConnection() must be implemented by a concrete ProviderAdapter');
  }
}

class OpenAIProviderAdapter extends ProviderAdapter {
  async testConnection({ url, key, model } = {}) {
    const base = norm(url);
    const endpoint = `${base}chat/completions`;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    const body = JSON.stringify({
      model: model || 'gpt-4o-mini',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const response = await fetch(endpoint, { method: 'POST', headers, body });
    const data = await response.text();
    return { status: response.status, body: data };
  }
}

class GeminiProviderAdapter extends ProviderAdapter {
  async testConnection({ url, key, model } = {}) {
    const base = norm(url);
    const endpoint = `${base}models/${model || 'gemini-2.0-flash'}:generateContent?key=${encodeURIComponent(key)}`;
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] });
    const response = await fetch(endpoint, { method: 'POST', headers, body });
    const data = await response.text();
    return { status: response.status, body: data };
  }
}

class AnthropicProviderAdapter extends ProviderAdapter {
  async testConnection({ url, key, model, auth = 'x-api-key' } = {}) {
    const base = norm(url);
    const msgPath = base.endsWith('/v1/') ? 'messages' : 'v1/messages';
    const endpoint = `${base}${msgPath}`;
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    // Send both auth styles: gateways like TokenRouter require `Authorization:
    // Bearer`, while others expect `x-api-key`.
    if (key) {
      headers['x-api-key'] = key;
      headers['Authorization'] = `Bearer ${key}`;
    }
    const body = JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const response = await fetch(endpoint, { method: 'POST', headers, body });
    const data = await response.text();
    return { status: response.status, body: data };
  }
}

export function getProviderAdapter(provider) {
  if (provider.format === 'anthropic') return new AnthropicProviderAdapter(provider);
  if (provider.format === 'gemini') return new GeminiProviderAdapter(provider);
  return new OpenAIProviderAdapter(provider);
}
