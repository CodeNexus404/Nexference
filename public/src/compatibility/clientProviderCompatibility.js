// Client ↔ Provider compatibility — the single source of truth for whether an
// AI client can consume a given cloud provider, and how Nexference would
// configure it. All compatibility logic lives here, not scattered through the UI.
//
// Claude Code is the fully VERIFIED auto-applied adapter for Anthropic-format
// gateways. OpenCode and Codex are VERIFIED for OpenAI-compatible endpoints
// (their config files are well-defined and Nexference writes them via the
// same safe pipeline). Gemini CLI has no written-config path yet — it stays
// MANUAL/SUPPORTED. Nexference remains honest about that distinction.
import { getProvider, providerProtocols, claudeCodeCompatibility } from '../providers/registry.js';
import { verified, supported, experimental, unsupported } from './result.js';

// The API/protocol each client natively understands for configuration.
const CLIENT_PROTOCOLS = {
  'claude-code': ['anthropic'],
  'opencode-cli': ['openai-compatible'],
  'codex': ['openai-compatible'],
  'gemini-cli': ['gemini'],
};

// Dynamic (adopted/ecosystem) providers are not in the curated registry. The app
// populates this index from the integration API (id → { adapterType, name }) so the
// compatibility matrix can reason about them honestly using their integration
// metadata. Claude Code compatibility remains gated: only an anthropic-compatible
// dynamic provider may be verified; OpenAI/Gemini dynamic providers are unsupported
// by Claude Code (the configuration adapter does not consume those protocols).
let dynamicIndex = {};

export function setDynamicProviderIndex(map) {
  dynamicIndex = map && typeof map === 'object' ? map : {};
}

function resolveProvider(providerId) {
  if (typeof providerId !== 'string') return providerId;
  const curated = getProvider(providerId);
  if (curated) return curated;
  const d = dynamicIndex[providerId];
  if (!d) return null;
  const format = d.adapterType === 'anthropic-compatible' ? 'anthropic'
    : d.adapterType === 'openai-compatible' ? 'openai'
      : d.adapterType === 'gemini-compatible' ? 'gemini' : null;
  return { id: providerId, name: d.name || providerId, format, claudeCode: format === 'anthropic' };
}

export function checkClientProvider(clientId, providerId) {
  const provider = resolveProvider(providerId);
  if (!provider) return unsupported('Unknown provider');

  if (clientId === 'claude-code') {
    if (provider.id === 'openrouter') {
      return verified('anthropic-proxy', 'claude-code', [
        'OpenRouter is forced to the Anthropic Messages API by the configuration engine.',
      ]);
    }
    if (provider.claudeCode) {
      return verified('native', 'claude-code', [
        'Anthropic-format gateway — consumed directly by Claude Code.',
      ]);
    }
    // Decide from claudeCodeCompatibility() rather than the raw `format` field.
    // That keeps one source of truth and, crucially, handles DUAL-surface
    // providers whose top-level format understates what they can do: Gemini
    // reports format 'gemini' but also exposes an OpenAI-compatible endpoint, so
    // the old format checks rejected it even though the proxy can drive it.
    const compat = claudeCodeCompatibility(provider);
    if (compat.proxy && !compat.anthropic) {
      // Previously "unsupported" — true before the Nexference proxy existed, but it
      // silently hid every OpenAI-compatible provider from Claude Code, including
      // the fallback tier picker, even though the proxy translates OpenAI <-> Anthropic
      // in both directions.
      return supported('openai-proxy', 'claude-code', [
        `Routed through the Nexference proxy, which translates ${String(compat.proxyFormat || 'openai')} chat completions to the Anthropic Messages API.`,
        'The proxy runs on 127.0.0.1 and holds the API key in memory only — it is never written to your settings file.',
      ]);
    }
    if (compat.proxy && compat.anthropic) {
      return supported('anthropic-proxy', 'claude-code', [
        'Prefer the native Anthropic surface; the proxy is kept as a fallback path.',
      ]);
    }
    return unsupported(
      'Claude Code expects the Anthropic Messages API, and this provider exposes no Anthropic or OpenAI-compatible surface.',
      ['You can export a config for a client that speaks this provider\u2019s native protocol instead.']
    );
  }

  const clientProtocols = CLIENT_PROTOCOLS[clientId] || [];
  const providerProtocolsList = providerProtocols(provider);
  const overlap = providerProtocolsList.filter((p) => clientProtocols.includes(p));

  if (overlap.length) {
    if (clientId === 'opencode-cli' || clientId === 'codex') {
      return verified('openai-compatible', clientId, [
        'OpenCode/Codex consume OpenAI-compatible endpoints — the config format is well-defined.',
        'Nexference can write the client config file automatically.',
      ]);
    }
    if (clientId === 'gemini-cli') {
      return supported('gemini', clientId, [
        'Gemini CLI consumes the Gemini API.',
        'Auto-apply guidance only — Nexference does not write this client config yet.',
      ]);
    }
  }

  if (clientId === 'opencode-cli' && provider.claudeCode) {
    return experimental('anthropic-to-openai', clientId, [
      'OpenCode would need to translate the Anthropic endpoint to OpenAI-compatible.',
      'Manual configuration required.',
    ]);
  }
  if (clientId === 'gemini-cli' && provider.format === 'openai') {
    return experimental('openai-to-gemini', clientId, [
      'Gemini CLI would need an OpenAI → Gemini bridge.',
      'Manual configuration required.',
    ]);
  }
  return unsupported(`No known compatibility path between ${clientId} and ${provider.name}.`);
}
