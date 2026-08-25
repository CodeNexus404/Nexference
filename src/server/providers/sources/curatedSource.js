import { ProviderDiscoveryAdapter } from './baseSource.js';
import { SOURCE_TYPES, CONFIDENCE } from '../discoveryStatus.js';

// Curated-registry discovery source (v1.4.0).
//
// The single source of truth for provider *identity* and *baseline metadata*
// when no live signal is available. This is a trusted, hand-maintained mapping
// (kept in sync with the client provider registry) — never scraped, never
// inferred. It provides name + website + format + whether a key is required, and
// explicitly does NOT claim live availability.
//
// Excludes 'custom' (a user endpoint, not a discoverable provider).

const PROVIDER_META = {
  agentrouter: { name: 'Agent Router', website: 'https://agentrouter.org', description: 'Multi-model gateway — Claude, GPT & DeepSeek.' },
  aerolink: { name: 'Aerolink', website: 'https://aerolink.lat', description: 'Free Claude Code gateway.' },
  freemodel: { name: 'FreeModel AI', website: 'https://freemodel.dev', description: 'Anthropic-format Claude endpoint.' },
  openrouter: { name: 'OpenRouter', website: 'https://openrouter.ai', description: 'Hundreds of models via a public API.' },
  nvidia: { name: 'NVIDIA NIM', website: 'https://build.nvidia.com', description: 'Free hosted open models.' },
  groq: { name: 'Groq', website: 'https://console.groq.com', description: 'Fast free inference.' },
  gemini: { name: 'Google Gemini', website: 'https://aistudio.google.com', description: 'Generous free tier.' },
  cerebras: { name: 'Cerebras', website: 'https://cloud.cerebras.ai', description: 'Ultra-fast free inference.' },
  orcarouter: { name: 'OrcaRouter', website: 'https://www.orcarouter.ai', description: 'OpenAI-compatible router across 200+ models.' },
  mistral: { name: 'Mistral', website: 'https://console.mistral.ai', description: 'Free "La Plateforme" tier.' },
  huggingface: { name: 'Hugging Face', website: 'https://huggingface.co', description: 'Serverless inference router.' },
  chutes: { name: 'Chutes AI', website: 'https://chutes.ai', description: 'Decentralised free inference.' },
  tokenrouter: { name: 'TokenRouter', website: 'https://www.tokenrouter.com', description: 'Token routing service.' },
};

export class CuratedSource extends ProviderDiscoveryAdapter {
  get name() { return 'curated-registry'; }
  get sourceType() { return SOURCE_TYPES.CURATED_REGISTRY; }

  supports(provider) {
    return !!provider && provider.id !== 'custom' && !!PROVIDER_META[provider.id];
  }

  discoverProvider(provider) {
    const meta = PROVIDER_META[provider.id];
    if (!meta) return { supported: false, reason: 'no curated entry' };
    return {
      supported: true,
      confidence: CONFIDENCE.MEDIUM,
      facts: {
        identity: { name: meta.name, website: meta.website, description: meta.description },
        requiresApiKey: !provider.publicModels,
        formats: provider.format ? [provider.format] : [],
        // Curated does not assert live availability — only that the provider is
        // a known, catalogued entity.
        availabilityClaim: null,
      },
    };
  }
}

export const curatedSource = new CuratedSource();
