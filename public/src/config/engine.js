import { workspace } from '../core/state.js';
import { getClientAdapter } from './clientAdapter.js';

// Configuration Engine — the interface that turns a provider + credentials into
// a valid client config, and decides how that config is applied. It wraps the
// original buildClaudeSettings logic exactly (no change to Claude Code generation)
// and delegates delivery to the Runtime Adapters.
export class ConfigurationEngine {
  // Mirrors the original buildClaudeSettings: uses the custom card's selected
  // format, otherwise the provider's native format. OpenRouter is dual-compatible
  // but always emitted in Anthropic (Claude Code) format.
  buildClaudeSettings(provider, baseUrl, model, apiKey) {
    let fmt = provider.id === 'custom' ? workspace.customFormat : provider.format;
    if (provider.id === 'openrouter') fmt = 'anthropic';

    return getClientAdapter(fmt).buildConfig(provider, baseUrl, model, apiKey);
  }

  // Build + deliver. Returns the chosen runtime name for callers that log it.
  async apply(provider, baseUrl, model, apiKey) {
    const config = this.buildClaudeSettings(provider, baseUrl, model, apiKey);

    // OpenAI/Gemini providers: Claude Code can't consume these configs, so show
    // them as copyable text for the user's own client instead of writing them
    // into Claude Code's settings.json.
    if (config.env.OPENAI_BASE_URL || config.env.GOOGLE_API_KEY) {
      return 'copyable';
    }
    return 'local';
  }
}

export const configEngine = new ConfigurationEngine();
