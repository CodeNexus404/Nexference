// Codex CLI adapter — OpenAI-compatible client. Connection feasible (SUPPORTED)
// but Nexference does not auto-write Codex config in v0.4.0 → instructions only.
import { ClientAdapter } from './base.js';

export class CodexCliAdapter extends ClientAdapter {
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
      `Codex CLI reads its config from ${this.meta.configPath}.`,
      `Set the OpenAI-compatible base URL: ${ep}`,
      'Provide your API key via the OPENAI_API_KEY environment variable.',
      model ? `Select model: ${model}` : 'Choose a model when launching Codex CLI.',
    ];
    return { config: null, instructions: lines };
  }
}
