// OpenCode CLI adapter — capability-aware but HONEST. OpenCode can consume
// OpenAI-compatible endpoints, so the connection is feasible, but Nexference
// does not auto-generate or write OpenCode's config in v0.4.0. It therefore
// returns instructions, never a fabricated config.
import { ClientAdapter } from './base.js';

export class OpenCodeCliAdapter extends ClientAdapter {
  getSupportedProviders() {
    return ['openrouter', 'groq', 'cerebras', 'nvidia', 'mistral', 'huggingface', 'chutes', 'orcarouter', 'custom'];
  }
  getSupportedRuntimes() {
    return ['ollama', 'lmstudio', 'llamacpp', 'vllm', 'sglang', 'koboldcpp', 'jan'];
  }
  checkCompatibility() { return { compatible: true, level: 'supported' }; }

  generateConfig({ provider, baseUrl, model } = {}) {
    const ep = (provider && provider.baseUrl) || baseUrl || '(provider endpoint)';
    const lines = [
      `OpenCode reads its config from ${this.meta.configPath}.`,
      `Point OpenCode at the OpenAI-compatible base URL: ${ep}`,
      'OpenCode consumes OpenAI-compatible endpoints — use the provider’s /v1 base.',
      'Add your API key in OpenCode’s own config (Nexference never stores it there).',
      model ? `Select model: ${model}` : 'Choose a model inside OpenCode.',
    ];
    return { config: null, instructions: lines };
  }
}
