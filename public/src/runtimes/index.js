// Runtime adapter factory.
import { getRuntime } from './registry.js';
import { RuntimeAdapter } from './base.js';
import { OllamaAdapter } from './ollama.js';

export function getRuntimeAdapter(id) {
  const meta = getRuntime(id) || { id, name: id, protocols: [] };
  return id === 'ollama' ? new OllamaAdapter(meta) : new RuntimeAdapter(meta);
}

export { RuntimeAdapter } from './base.js';
export { OllamaAdapter } from './ollama.js';
