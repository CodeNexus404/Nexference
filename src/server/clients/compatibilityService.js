import { getClient } from './registry.js';
import { getProvider } from '../providers/registry.js';
import { getRuntime } from '../local/runtimes.js';

// ═══════════════════════════════════════════════════
//  Compatibility engine (v0.6.0) — server-side evaluation of a proposed
//  workspace selection. The wizard and the client adapters both consult this
//  before allowing Apply; an incompatible combination is never silently
//  generated. Rules mirror the frontend capability resolver and stay honest
//  about what Claude Code can actually consume.
//
//  Output: { compatible, mode, level, reasons[], warnings[], adapterMethod }
// ═══════════════════════════════════════════════════

export function checkCompatibility({ clientId, providerId, runtimeId, model }) {
  const client = getClient(clientId);
  if (!client) return { compatible: false, mode: providerId ? 'cloud' : 'local', level: 'unsupported', reasons: ['Unknown client'], warnings: [], adapterMethod: null };

  const mode = providerId ? 'cloud' : (runtimeId ? 'local' : null);
  const reasons = [];
  const warnings = [];

  // Level 3 — detection only: never present as configurable.
  if (client.level === 3) {
    return { compatible: false, mode, level: 'unsupported', reasons: [`${client.name} is detection-only — configuration not supported yet`], warnings: [], adapterMethod: null };
  }

  // ── Cloud provider path ──
  if (providerId) {
    const provider = getProvider(providerId);
    if (!provider) return { compatible: false, mode: 'cloud', level: 'unsupported', reasons: ['Unknown provider'], warnings: [], adapterMethod: null };

    if (client.id === 'claude-code') {
      if (provider.id === 'anthropic' || provider.format === 'anthropic') {
        return { compatible: true, mode: 'cloud', level: 'verified', reasons: [`${client.name} natively uses ${provider.name}`], warnings: [], adapterMethod: 'buildClaudeSettings' };
      }
      if (provider.id === 'openrouter') {
        return { compatible: true, mode: 'cloud', level: 'supported', reasons: [`${client.name} can use ${provider.name} via its Anthropic-compatible endpoint`], warnings: ['Set the OpenRouter Anthropic base URL'], adapterMethod: 'buildClaudeSettings' };
      }
      // OPENAI_*/GOOGLE_* env vars are ignored by Claude Code.
      return { compatible: false, mode: 'cloud', level: 'unsupported', reasons: [`${client.name} requires an Anthropic-compatible API; ${provider.name} exposes a ${provider.format} API that Claude Code does not consume`], warnings: [], adapterMethod: null };
    }

    // Assisted-setup clients (OpenCode / Codex / Gemini CLI).
    if (client.id === 'gemini-cli' && provider.format !== 'gemini') {
      return { compatible: false, mode: 'cloud', level: 'unsupported', reasons: [`${client.name} requires a Gemini API; ${provider.name} is ${provider.format}`], warnings: [], adapterMethod: null };
    }
    if (provider.format === 'openai' || provider.format === 'anthropic' || provider.id === 'openrouter') {
      if (!client.capabilities.autoConfigure) {
        return { compatible: true, mode: 'cloud', level: 'manual', reasons: [`${client.name} can use ${provider.name}`], warnings: ['Auto-apply not implemented — generate instructions and apply manually'], adapterMethod: 'generateInstructions' };
      }
      return { compatible: true, mode: 'cloud', level: 'supported', reasons: [`${client.name} can use ${provider.name}`], warnings: [], adapterMethod: 'buildConfig' };
    }
    return { compatible: false, mode: 'cloud', level: 'unsupported', reasons: [`${provider.name} (${provider.format}) is not compatible with ${client.name}`], warnings: [], adapterMethod: null };
  }

  // ── Local runtime path ──
  if (runtimeId) {
    const runtime = getRuntime(runtimeId);
    if (!runtime) return { compatible: false, mode: 'local', level: 'unsupported', reasons: ['Unknown runtime'], warnings: [], adapterMethod: null };
    if (!client.capabilities.supportsLocalRuntimes) {
      return { compatible: false, mode: 'local', level: 'unsupported', reasons: [`${client.name} does not support local runtimes`], warnings: [], adapterMethod: null };
    }

    if (client.id === 'claude-code') {
      if (runtimeId === 'ollama') {
        return { compatible: true, mode: 'local', level: 'experimental', reasons: [`${client.name} + ${runtime.name} is possible`], warnings: ['Requires an Anthropic-compatible proxy in front of Ollama (e.g. a gateway that translates to /v1/messages)'], adapterMethod: 'buildClaudeSettings' };
      }
      return { compatible: false, mode: 'local', level: 'unsupported', reasons: [`${client.name} cannot consume ${runtime.name} directly; it requires an Anthropic-compatible API`], warnings: [], adapterMethod: null };
    }

    // Assisted clients with OpenAI-compatible runtimes.
    return { compatible: true, mode: 'local', level: 'manual', reasons: [`${client.name} can use ${runtime.name} (OpenAI-compatible)`], warnings: ['Auto-apply not implemented — apply the generated endpoint manually'], adapterMethod: 'generateInstructions' };
  }

  return { compatible: false, mode: null, level: 'unsupported', reasons: ['Select a provider or runtime'], warnings: [], adapterMethod: null };
}
