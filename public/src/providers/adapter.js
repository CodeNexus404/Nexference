import { getProvider } from './registry.js';

// Client-side Provider Adapter interface.
//
// On the client, a provider adapter describes how a gateway is presented and
// which clients it can target. The concrete behaviour (config generation, test
// request shape) is delegated to the Configuration Engine + Client/Runtime
// adapters; this layer gives future milestones a single place to extend a
// provider's UI semantics (badges, supported clients) without editing the card
// or the engine. Behaviour unchanged for v0.1.0.
export class ProviderAdapter {
  constructor(provider) {
    this.provider = provider;
  }

  // Client labels shown on the card (Anthropic / OpenAI / Gemini).
  clientLabels() {
    const { provider } = this;
    if (provider.id === 'openrouter' || provider.id === 'custom') return ['Anthropic', 'OpenAI'];
    if (provider.format === 'anthropic') return ['Anthropic'];
    if (provider.format === 'openai') return ['OpenAI'];
    return ['Gemini'];
  }

  isClaudeCode() {
    return !!this.provider.claudeCode;
  }

  format() {
    return this.provider.format;
  }
}

export function getProviderAdapter(provider) {
  return new ProviderAdapter(provider);
}

export { getProvider };
