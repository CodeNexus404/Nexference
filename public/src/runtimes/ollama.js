// Ollama adapter — the one fully-supported local runtime. It exposes both the
// native Ollama protocol and an OpenAI-compatible /v1 surface; the adapter
// reports Ollama as its primary protocol. Status/models come from the server,
// which actually probes http://localhost:11434.
import { RuntimeAdapter } from './base.js';

export class OllamaAdapter extends RuntimeAdapter {
  getProtocol() { return 'ollama'; }

  async listModels() {
    const s = await this.fetchStatus();
    if (!s || !s.running) return [];
    return s.models || [];
  }
}
