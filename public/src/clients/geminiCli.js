// Gemini CLI adapter — consumes the Gemini API. Connection feasible for Gemini
// providers (SUPPORTED) but Nexference does not auto-write Gemini CLI config in
// v0.4.0 → instructions only.
import { ClientAdapter } from './base.js';

export class GeminiCliAdapter extends ClientAdapter {
  getSupportedProviders() { return ['gemini', 'custom']; }
  getSupportedRuntimes() { return []; } // no Gemini-protocol local runtime yet
  checkCompatibility() { return { compatible: true, level: 'supported' }; }

  generateConfig({ provider, baseUrl, model } = {}) {
    const ep = (provider && provider.baseUrl) || baseUrl || 'https://generativelanguage.googleapis.com/v1beta/';
    const lines = [
      `Gemini CLI reads its config from ${this.meta.configPath}.`,
      `Set the Gemini base URL: ${ep}`,
      'Provide your API key via the GOOGLE_API_KEY environment variable.',
      model ? `Select model: ${model}` : 'Choose a model (e.g. gemini-2.0-flash) when launching Gemini CLI.',
    ];
    return { config: null, instructions: lines };
  }
}
