// Integration Registry (v1.9.0) — maps adapter protocol types to their concrete
// adapter implementations. Adding a new provider protocol later means registering
// one class here; nothing else in the resolver/service needs to change.
import { ADAPTER_TYPE } from './integrationTypes.js';
import { BaseProviderAdapter } from './adapters/baseAdapter.js';
import { OpenAICompatibleAdapter } from './adapters/openAICompatibleAdapter.js';
import { AnthropicCompatibleAdapter } from './adapters/anthropicCompatibleAdapter.js';
import { GeminiCompatibleAdapter } from './adapters/geminiCompatibleAdapter.js';
import { UnsupportedAdapter } from './adapters/unsupportedAdapter.js';

const REGISTRY = {
  [ADAPTER_TYPE.OPENAI_COMPATIBLE]: OpenAICompatibleAdapter,
  [ADAPTER_TYPE.ANTHROPIC_COMPATIBLE]: AnthropicCompatibleAdapter,
  [ADAPTER_TYPE.GEMINI_COMPATIBLE]: GeminiCompatibleAdapter,
  [ADAPTER_TYPE.NONE]: UnsupportedAdapter,
  [ADAPTER_TYPE.UNKNOWN]: UnsupportedAdapter,
  [ADAPTER_TYPE.CUSTOM]: UnsupportedAdapter, // reserved; not implemented in v1.9.0
};

export function getAdapterClass(type) {
  return REGISTRY[type] || UnsupportedAdapter;
}

export function getAdapter(type, meta) {
  return new (getAdapterClass(type))(meta);
}

export function listAdapterTypes() {
  return Object.keys(REGISTRY);
}

export { BaseProviderAdapter };
