// Codex CLI adapter — OpenAI-compatible client. Codex reads ~/.codex/config.json
// at startup. Nexference generates and writes a real config (backup + atomic +
// verified) using an env-key reference so the actual API key never lands in
// the file or the store.
import { ClientAdapter } from './base.js';

const ENV_KEY_BY_PROVIDER = {
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  huggingface: 'HUGGINGFACE_API_KEY',
  openai: 'OPENAI_API_KEY',
  chutes: 'CHUTES_API_KEY',
};

export class CodexCliAdapter extends ClientAdapter {
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
        `Codex CLI reads its config from ${this.meta.configPath}.`,
        `Set the OpenAI-compatible base URL: ${ep || '(provider endpoint)'}`,
        'Provide your API key via the configured env var (Nexference never stores it).',
        model ? `Select model: ${model}` : 'Choose a model when launching Codex CLI.',
      ];
      return { config: null, instructions: lines };
    }

    // Provider key: strip the cst:/dyn: prefixes to get a filesystem-safe id.
    const providerKey = pid.replace(/^cst:/, 'custom-').replace(/^dyn:/, 'dynamic-').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'default';
    const envKey = ENV_KEY_BY_PROVIDER[pid]
      || `CODEX_${providerKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_KEY`;

    const cfg = {
      model,
      model_provider: providerKey,
      model_providers: {
        [providerKey]: {
          name: (provider.name) || providerKey,
          base_url: ep,
          env_key: envKey,
          wire_api: 'chat',
        },
      },
    };
    return { config: cfg, instructions: null };
  }
}
