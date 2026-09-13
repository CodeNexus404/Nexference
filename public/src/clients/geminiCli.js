// Gemini CLI adapter — consumes the Gemini API. Connection feasible for Gemini
// providers (SUPPORTED) but Nexference does not auto-write Gemini CLI config in
// v2.2.x — its config file has no first-class custom-endpoint schema and the
// tool may not hot-reload it. It therefore returns precise manual guidance,
// never a fabricated config.
import { ClientAdapter } from './base.js';

export class GeminiCliAdapter extends ClientAdapter {
  getSupportedProviders() { return ['gemini', 'custom']; }
  getSupportedRuntimes() { return []; } // no Gemini-protocol local runtime yet
  checkCompatibility() { return { compatible: true, level: 'supported' }; }

  generateConfig({ provider, baseUrl, model } = {}) {
    const ep = (provider && provider.baseUrl) || baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const cfgPath = this.meta.configPath || '~/.gemini/settings.json';
    const envVar = 'GEMINI_API_KEY';
    const lines = [
      `Gemini CLI reads its config from ${cfgPath}.`,
      `Set the Gemini-compatible base URL to: ${ep}`,
      `Export your key as the ${envVar} environment variable before launching the CLI.`,
      `In ${cfgPath}, configure the model and endpoint, then restart the CLI (it does not hot-reload).`,
      model ? `Select model: ${model}` : 'Choose a Gemini model (e.g. gemini-2.0-flash) when launching Gemini CLI.',
      'Nexference leaves this file untouched — the OpenAI/Codex/OpenCode configs it does write are not consumed by Gemini CLI.',
    ];
    return { config: null, instructions: lines };
  }
}
