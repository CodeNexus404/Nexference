// Local AI runtime registry (frontend mirror) — the catalogue of software that
// runs models locally. Distinct from Providers (cloud) and Clients (apps). Each
// runtime explicitly declares the protocol(s) it exposes so the compatibility
// resolver never assumes all runtimes behave identically.
export const RUNTIMES = [
  { id: 'ollama', name: 'Ollama', protocols: ['ollama', 'openai-compatible'], supportsModels: true, planned: false, note: 'Local models served at http://localhost:11434' },
  { id: 'lmstudio', name: 'LM Studio', protocols: ['openai-compatible'], supportsModels: true, planned: true, note: 'Configuration support coming soon' },
  { id: 'llamacpp', name: 'llama.cpp', protocols: ['openai-compatible'], supportsModels: true, planned: true, note: 'Configuration support coming soon' },
  { id: 'vllm', name: 'vLLM', protocols: ['openai-compatible'], supportsModels: true, planned: true, note: 'Configuration support coming soon' },
  { id: 'sglang', name: 'SGLang', protocols: ['openai-compatible'], supportsModels: true, planned: true, note: 'Configuration support coming soon' },
  { id: 'koboldcpp', name: 'KoboldCpp', protocols: ['openai-compatible'], supportsModels: true, planned: true, note: 'Configuration support coming soon' },
  { id: 'jan', name: 'Jan', protocols: ['openai-compatible'], supportsModels: true, planned: true, note: 'Configuration support coming soon' },
];

export function getRuntime(id) {
  return RUNTIMES.find((r) => r.id === id);
}

export function runtimeProtocols(id) {
  return getRuntime(id)?.protocols || [];
}
