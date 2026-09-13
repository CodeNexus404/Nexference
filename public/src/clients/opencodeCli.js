// OpenCode CLI adapter — produces a real opencode config.json.
// opencode reads its configuration from ~/.config/opencode/opencode.json and
// does not hot-reload: a restart is required after writing.  The provider
// declaration uses the @ai-sdk/openai-compatible npm package so any OpenAI-
// compatible endpoint works; the API key is referenced via {env:VAR} so
// Nexference never persists or touches the secret.
import { ClientAdapter } from './base.js';

export class OpenCodeCliAdapter extends ClientAdapter {
  getSupportedProviders() {
    return ['openrouter', 'groq', 'cerebras', 'nvidia', 'mistral', 'huggingface', 'chutes', 'orcarouter', 'custom'];
  }
  getSupportedRuntimes() {
    return ['ollama', 'lmstudio', 'llamacpp', 'vllm', 'sglang', 'koboldcpp', 'jan'];
  }
  checkCompatibility() { return { compatible: true, level: 'verified' }; }

  generateConfig({ provider, baseUrl, model } = {}) {
    const ep = (provider && provider.baseUrl) || baseUrl || null;
    const pid = (provider && provider.id) || '';
    if (!ep || !model) {
      const lines = [
        `Point OpenCode at the OpenAI-compatible base URL: ${ep || '(provider endpoint)'}`,
        'OpenCode consumes OpenAI-compatible endpoints — use the provider’s /v1 base.',
        'Add your API key in OpenCode’s own config (Nexference never stores it there).',
      ];
      return { config: null, instructions: lines };
    }

    // Derive a short, filesystem-safe provider key for the config entry.
    const providerKey = pid.replace(/^cst:/, 'custom-').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'default';
    // The env var the user must export before running opencode.
    const envVar = `OPENCODE_${providerKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_KEY`;

    const cfg = {
      '$schema': 'https://opencode.ai/config.json',
      model: `${providerKey}/${model}`,
      provider: {
        [providerKey]: {
          npm: '@ai-sdk/openai-compatible',
          name: provider.name || providerKey,
          options: {
            baseURL: ep,
            apiKey: `{env:${envVar}}`,
          },
        },
      },
    };
    return { config: cfg, instructions: null };
  }
}
