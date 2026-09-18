// Adopted (dyn:) provider adapter (v2.3.0) — maps an ecosystem dynamic provider
// record onto the custom-provider presentation shape so adopted providers render
// EXACTLY like custom provider cards and open the same full detail modal (editable
// base URL, API key, model picker with paid toggle/search, test connection,
// apply-to-Claude-Code / copyable config, provider integration, edit, delete).
//
// Accepts BOTH the unified shape (from /api/providers?origin=ecosystem, used for
// the Cloud Providers grid) and the raw store record (from /api/dynamic-providers/:id,
// used by the detail modal) — the two overlap on id/name/website/integration.
// Pure client-side mapping; no secrets are touched.

const ADAPTER_DESC = {
  openai: 'OpenAI-compatible API (generic OpenAI adapter applies).',
  anthropic: 'Anthropic-compatible API (generic Anthropic adapter applies).',
  gemini: 'Gemini-compatible API (generic Gemini adapter applies).',
};

function detectFormat(d) {
  const integ = d.integration || {};
  if (integ.adapterType) return integ.adapterType;
  if (integ.format) return integ.format;
  const caps = d.capabilities || {};
  if (caps.anthropicCompatible) return 'anthropic';
  if (caps.openaiCompatible) return 'openai';
  if (caps.geminiCompatible) return 'gemini';
  return 'unknown';
}

function logoUrl(d) {
  if (typeof d.logo === 'string') return d.logo;
  return d.logo?.url || null;
}

function siteFromBaseUrl(u) {
  if (!u) return null;
  try { return new URL(u).origin; } catch { return null; }
}

export function adoptedToCustomShape(d) {
  const format = detectFormat(d);
  const baseUrl = d.integration?.baseUrl || null;
  const website = d.website || siteFromBaseUrl(baseUrl) || null;
  const logo = logoUrl(d);
  return {
    id: d.id,
    name: d.name,
    format,
    website,
    modelCount: d.modelSupport?.count || 0,
    // Pass through the discovered modelSupport (with pricing when the source
    // exposed it) so category filtering can flag adopted providers as "free".
    modelSupport: d.modelSupport || undefined,
    logo,
    lifecycle: 'active',
    origin: 'ecosystem',
    updatedAt: d.lastUpdated || d.adoptedAt || d.updatedAt || null,
    identity: {
      name: d.name,
      description: d.compatibilityNote || ADAPTER_DESC[format] || 'Ecosystem-discovered provider. Configure a base URL and API key to use it.',
      website,
    },
    api: {
      baseUrl,
      format,
    },
  };
}