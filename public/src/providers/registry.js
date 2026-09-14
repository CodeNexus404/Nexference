// Client-side provider registry — the UI metadata for every gateway card.
// Mirrored (intentionally) from the server registry; the client copy carries the
// presentation fields (logo, accent, description, signup link) the server doesn't
// need. This is the exact provider list from the original app.js.
export const PROVIDERS = [
  {
    id: 'agentrouter', name: 'Agent Router', sub: 'agentrouter.org',
    logo: '/providers/agent-router.png',
    accent: '#8b5cf6', glow: 'rgba(139,92,246,.18)',
    format: 'anthropic', claudeCode: true,
    baseUrl: 'https://agentrouter.org/v1/', needsAuthToken: true,
    desc: 'Multi-model gateway — Claude, GPT & DeepSeek. High free limits.',
    signup: 'https://agentrouter.org',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'aerolink', name: 'Aerolink', sub: 'capi.aerolink.lat',
    logo: '/providers/aerolink.ico',
    accent: '#3b82f6', glow: 'rgba(59,130,246,.18)',
    format: 'anthropic', claudeCode: true,
    baseUrl: 'https://capi.aerolink.lat/v1/',
    desc: 'Anthropic-format Claude gateway. Verify via Telegram bot to get a key.',
    signup: 'https://aerolink.lat',
    defaultKey: '', isFree: () => false,
  },
  {
    id: 'freemodel', name: 'FreeModel AI', sub: 'cc.freemodel.dev',
    logo: '/providers/freemodel.svg',
    accent: '#ec4899', glow: 'rgba(236,72,153,.18)',
    format: 'anthropic', claudeCode: true,
    baseUrl: 'https://cc.freemodel.dev/v1/',
    desc: 'Anthropic-format Claude endpoint. Paid tier.',
    signup: 'https://freemodel.dev',
    defaultKey: '', isFree: () => false,
  },
  {
    id: 'openrouter', name: 'OpenRouter', sub: 'openrouter.ai',
    logo: '/providers/openrouter.ico',
    accent: '#06b6d4', glow: 'rgba(6,182,212,.18)',
    format: 'openai', claudeCode: true,
    baseUrl: 'https://openrouter.ai/api/v1/',
    desc: 'Dozens of free open-source models (DeepSeek, Llama, Qwen…). List is public.',
    signup: 'https://openrouter.ai/keys',
    defaultKey: '', publicModels: true,
    isFree: (m) => m.id?.endsWith(':free') || (m.pricing && parseFloat(m.pricing.prompt || 0) === 0 && parseFloat(m.pricing.completion || 0) === 0),
  },
  {
    id: 'nvidia', name: 'NVIDIA NIM', sub: 'build.nvidia.com',
    logo: '/providers/nvidia.ico',
    accent: '#76b900', glow: 'rgba(118,185,0,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://integrate.api.nvidia.com/v1/',
    desc: 'Free hosted open models — Nemotron, DeepSeek, Qwen, GPT-OSS, GLM, Kimi, Llama.',
    signup: 'https://build.nvidia.com',
    defaultKey: '', isFree: (m) => !/embed|rerank|reranker|ocr|parse|nemoretriever|asr|tts|whisper|canary|parakeet|riva|magpie|conformer|megatron-1b-nmt|voicechat|studio.?voice|noise|guard|safety|jailbreak|content.?safety|gliner|topic-control|vista|molmim|genmol|diffdock|rfdiffusion|proteinmpnn|esm|alphafold|openfold|boltz|evo2|fourcastnet|cosmos|flux|stable-diffusion|sdxl|qwen-image|paligemma|trellis|bge|paddleocr|yolox|page-elements|table-structure|graphic-elements|eyecontact|lipsync|speaker|streampetr|bevformer|sparsedrive|cuopt|fastpitch|relight|synthetic-video|diffusiongemma/i.test(m.id || ''),
  },
  {
    id: 'groq', name: 'Groq', sub: 'console.groq.com',
    logo: '/providers/groq.ico',
    accent: '#f55036', glow: 'rgba(245,80,54,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://api.groq.com/openai/v1/',
    desc: 'Blazing-fast free inference — Llama, DeepSeek-R1 distill, Qwen.',
    signup: 'https://console.groq.com/keys',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'gemini', name: 'Google Gemini', sub: 'aistudio.google.com',
    logo: '/providers/gemini.ico',
    accent: '#4285f4', glow: 'rgba(66,133,244,.18)',
    format: 'gemini', claudeCode: false,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
    desc: 'Generous free tier — Gemini 2.0 Flash, 1.5 Pro & Flash.',
    signup: 'https://aistudio.google.com/apikey',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'cerebras', name: 'Cerebras', sub: 'cloud.cerebras.ai',
    logo: '/providers/cerebras.png',
    accent: '#ff6b35', glow: 'rgba(255,107,53,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://api.cerebras.ai/v1/',
    desc: 'Ultra-fast free inference on wafer-scale chips — Llama & Qwen.',
    signup: 'https://cloud.cerebras.ai',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'orcarouter', name: 'OrcaRouter', sub: 'api.orcarouter.ai',
    logo: '/providers/orcarouter.png',
    accent: '#0d9488', glow: 'rgba(13,148,136,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://api.orcarouter.ai/v1/',
    desc: 'OpenAI-compatible router across 200+ models at provider cost — orcarouter/auto picks for you.',
    signup: 'https://www.orcarouter.ai',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'mistral', name: 'Mistral', sub: 'console.mistral.ai',
    logo: '/providers/mistral.ico',
    accent: '#fa520f', glow: 'rgba(250,82,15,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://api.mistral.ai/v1/',
    desc: 'Free "La Plateforme" tier — Mistral Large, Codestral, Small.',
    signup: 'https://console.mistral.ai/api-keys',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'huggingface', name: 'Hugging Face', sub: 'router.huggingface.co',
    logo: '/providers/huggingface.ico',
    accent: '#ffd21e', glow: 'rgba(255,210,30,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://router.huggingface.co/v1/',
    desc: 'Serverless inference router — free monthly credits across Llama, Qwen, DeepSeek & more.',
    signup: 'https://huggingface.co/settings/tokens',
    defaultKey: '', isFree: (m) => !/embed|rerank|reranker|ocr|parse|nemoretriever|asr|tts|whisper|canary|parakeet|riva|magpie|conformer|megatron-1b-nmt|voicechat|studio.?voice|noise|guard|safety|jailbreak|content.?safety|gliner|topic-control|vista|molmim|genmol|diffdock|rfdiffusion|proteinmpnn|esm|alphafold|openfold|boltz|evo2|fourcastnet|cosmos|flux|stable-diffusion|sdxl|qwen-image|paligemma|trellis|bge|paddleocr|yolox|page-elements|table-structure|graphic-elements|eyecontact|lipsync|speaker|streampetr|bevformer|sparsedrive|cuopt|fastpitch|relight|synthetic-video|diffusiongemma/i.test(m.id || ''),
  },
  {
    id: 'chutes', name: 'Chutes AI', sub: 'llm.chutes.ai',
    logo: '/providers/chutes.png',
    accent: '#00d4aa', glow: 'rgba(0,212,170,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://llm.chutes.ai/v1/',
    desc: 'Decentralised free inference for open models — DeepSeek, Qwen, GLM, Kimi.',
    signup: 'https://chutes.ai',
    defaultKey: '', isFree: (m) => !/embed|rerank|reranker|ocr|parse|nemoretriever|asr|tts|whisper|canary|parakeet|riva|magpie|conformer|megatron-1b-nmt|voicechat|studio.?voice|noise|guard|safety|jailbreak|content.?safety|gliner|topic-control|vista|molmim|genmol|diffdock|rfdiffusion|proteinmpnn|esm|alphafold|openfold|boltz|evo2|fourcastnet|cosmos|flux|stable-diffusion|sdxl|qwen-image|paligemma|trellis|bge|paddleocr|yolox|page-elements|table-structure|graphic-elements|eyecontact|lipsync|speaker|streampetr|bevformer|sparsedrive|cuopt|fastpitch|relight|synthetic-video|diffusiongemma/i.test(m.id || ''),
  },
  {
     id: 'tokenrouter', name: 'TokenRouter', sub: 'tokenrouter.com',
    logo: '/providers/tokenrouter.png',
    accent: '#8b5cf6', glow: 'rgba(139,92,246,.18)',
    format: 'openai',
    baseUrl: 'https://api.tokenrouter.io/v1/',
    desc: 'Token routing service — Claude, GPT & more. Efficient key management.',
    signup: 'https://www.tokenrouter.com',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'custom', name: 'Custom Gateway', sub: 'your-endpoint.com',
    logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f59e0b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cline x1='4' y1='21' x2='4' y2='14'/%3E%3Cline x1='4' y1='10' x2='4' y2='3'/%3E%3Cline x1='12' y1='21' x2='12' y2='12'/%3E%3Cline x1='12' y1='8' x2='12' y2='3'/%3E%3Cline x1='20' y1='21' x2='20' y2='16'/%3E%3Cline x1='20' y1='12' x2='20' y2='3'/%3E%3Cline x1='1' y1='14' x2='7' y2='14'/%3E%3Cline x1='9' y1='8' x2='15' y2='8'/%3E%3Cline x1='17' y1='16' x2='23' y2='16'/%3E%3C/svg%3E",
    accent: '#f59e0b', glow: 'rgba(245,158,11,.18)',
    format: 'anthropic', claudeCode: true, hasCustomUrl: true,
    desc: 'Point at any Anthropic- or OpenAI-compatible base URL.',
    signup: '', defaultKey: '', isFree: () => true,
  },
];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || registryExtras[id] || null;
}

// ─── Non-curated provider resolution (v2.2.1) ───
// Curated `getProvider` only knows the static PROVIDERS list. Adopted ecosystem
// (dyn:*) and user-created custom (cst:*) providers live in stores, so the app
// registers their UI-safe descriptors here. Every dropdown / model picker that
// calls getProvider() then resolves them identically to curated providers.
let registryExtras = {};

export function setProviderExtras(list) {
  registryExtras = {};
  (Array.isArray(list) ? list : []).forEach((p) => { if (p && p.id) registryExtras[p.id] = p; });
}

// Register the merged, UI-safe list (from allProviders) as the fallback index.
export function registerProviderExtras({ dynamic = [], custom = [] } = {}) {
  setProviderExtras(allProviders({ dynamic, custom }));
}

export function getProviderExtras() { return registryExtras; }

// Filter tags used by the Cloud Providers explorer (All / Popular / Free /
// Anthropic Compatible / OpenAI Compatible / Google). Presentation-only.
export const PROVIDER_TAGS = {
  agentrouter: ['popular', 'anthropic', 'free'],
  aerolink: ['anthropic', 'paid'],
  freemodel: ['anthropic', 'paid'],
  openrouter: ['popular', 'openai', 'free'],
  nvidia: ['openai', 'free'],
  groq: ['popular', 'openai', 'free'],
  gemini: ['google', 'free'],
  cerebras: ['openai', 'free'],
  orcarouter: ['openai', 'free'],
  mistral: ['openai', 'free'],
  huggingface: ['openai', 'free'],
  chutes: ['openai', 'free'],
  tokenrouter: ['openai', 'free'],
  custom: ['anthropic', 'openai'],
};

export function providerTags(id) {
  return PROVIDER_TAGS[id] || [];
}

// Providers the Claude Code configuration workflow may target. Claude Code can
// consume Anthropic-format gateways directly; OpenRouter is dual-compatible and
// forced to Anthropic format by the engine. OpenAI/Gemini-only providers are
// excluded (their configs are shown copyable, not written to settings.json).
export function claudeCodeProviders() {
  return PROVIDERS.filter((p) => p.claudeCode || p.id === 'openrouter');
}

// ─── Global provider list (v2.2.1) ───
// The curated registry is static, but the app also has adopted ecosystem
// (dynamic) providers and user-created custom providers. Every provider
// dropdown in the dashboard (config wizard, playground, etc.) must reflect what
// actually exists, so this merges all three sources into one list of UI-safe
// descriptors. `logo` may be null for dynamic/custom → logoHtml falls back to a
// monogram; `format` drives compatibility via clientProviderCompatibility.
function hostFromUrl(url) {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return url; }
}

export function allProviders({ dynamic = [], custom = [] } = {}) {
  const base = PROVIDERS.filter((p) => p.id !== 'custom');
  const dyn = (Array.isArray(dynamic) ? dynamic : [])
    .filter((d) => d && typeof d === 'object' && d.id && d.status === 'active')
    .map((d) => {
      const fmt = d.integration?.adapterType || d.format || null;
      const baseUrl = d.integration?.baseUrl || d.baseUrl || '';
      return {
        id: d.id, name: d.name || d.id,
        sub: hostFromUrl(baseUrl) || 'adopted provider',
        logo: d.logo && typeof d.logo === 'object' && d.logo.url ? d.logo.url : null,
        accent: '#6366f1', glow: 'rgba(99,102,241,.2)',
        format: fmt, claudeCode: fmt === 'anthropic',
        baseUrl,
        desc: d.compatibilityNote
          || (d.modelSupport && d.modelSupport.count ? `Adopted provider with ${d.modelSupport.count} models.` : 'Adopted from ecosystem discovery.'),
        signup: '', defaultKey: '', hasCustomUrl: true, publicModels: false,
        isFree: () => false, origin: 'ecosystem',
      };
    });
  const cst = (Array.isArray(custom) ? custom : [])
    .filter((c) => c && typeof c === 'object' && c.id && c.lifecycle === 'active')
    .map((c) => {
      const fmt = c.format || null;
      const baseUrl = c.baseUrl || '';
      return {
        id: c.id, name: c.name || c.id,
        sub: hostFromUrl(baseUrl) || c.sub || 'custom gateway',
        logo: typeof c.logo === 'string' && c.logo ? c.logo : null,
        accent: '#f59e0b', glow: 'rgba(245,158,11,.2)',
        format: fmt, claudeCode: fmt === 'anthropic',
        baseUrl,
        desc: c.desc || 'Manually configured provider.',
        signup: '', defaultKey: '', hasCustomUrl: true, publicModels: false,
        isFree: () => false, origin: 'custom',
      };
    });
  return [...base, ...dyn, ...cst, ...PROVIDERS.filter((p) => p.id === 'custom')];
}

// ─── Provider capabilities (v0.4.0) ───
// Protocols a provider exposes. Derived from `format` so the existing provider
// list keeps working; the compatibility resolver consumes these rather than
// re-reading `format` everywhere. Do not treat every provider as interchangeable.
export function providerProtocols(p) {
  if (!p) return [];
  if (p.format === 'anthropic') return ['anthropic'];
  if (p.format === 'openai') return ['openai-compatible'];
  if (p.format === 'gemini') return ['gemini'];
  return [];
}
