// Client ↔ Provider compatibility — the single source of truth for whether an
// AI client can consume a given cloud provider, and how Nexference would
// configure it. All compatibility logic lives here, not scattered through the UI.
//
// Claude Code is the only fully VERIFIED, auto-applied adapter. Other clients
// may be SUPPORTED/EXPERIMENTAL at the connection level but remain MANUAL for
// automatic configuration — Nexference is honest about that.
import { getProvider, providerProtocols } from '../providers/registry.js';
import { verified, supported, experimental, unsupported } from './result.js';

// The API/protocol each client natively understands for configuration.
const CLIENT_PROTOCOLS = {
  'claude-code': ['anthropic'],
  'opencode-cli': ['openai-compatible'],
  'codex': ['openai-compatible'],
  'gemini-cli': ['gemini'],
};

export function checkClientProvider(clientId, providerId) {
  const provider = typeof providerId === 'string' ? getProvider(providerId) : providerId;
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
    if (provider.format === 'openai') {
      return unsupported(
        'Claude Code expects the Anthropic Messages API; OpenAI providers are not directly compatible.',
        ['You can export an OpenAI config for an OpenAI-compatible client instead.']
      );
    }
    if (provider.format === 'gemini') {
      return unsupported(
        'Claude Code expects the Anthropic Messages API; Gemini providers are not directly compatible.',
        ['You can export a Gemini config for the Gemini CLI instead.']
      );
    }
    return unsupported('This provider has no known compatibility path with Claude Code.');
  }

  const clientProtocols = CLIENT_PROTOCOLS[clientId] || [];
  const providerProtocolsList = providerProtocols(provider);
  const overlap = providerProtocolsList.filter((p) => clientProtocols.includes(p));

  if (overlap.length) {
    if (clientId === 'opencode-cli' || clientId === 'codex') {
      return supported('openai-compatible', clientId, [
        'OpenCode/Codex consume OpenAI-compatible endpoints.',
        'Auto-apply guidance only — Nexference does not write this client config yet.',
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
