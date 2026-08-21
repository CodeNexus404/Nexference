import { getClient } from './registry.js';
import { getProvider } from '../providers/registry.js';
import { getRuntime } from '../local/runtimes.js';

// ═══════════════════════════════════════════════════
//  Compatibility engine (v0.6.0 → v0.7.0) — server-side evaluation of a
//  proposed workspace selection. The wizard, the compatibility explorer, and the
//  profile validator all consult this before allowing Apply; an incompatible
//  combination is never silently generated.
//
//  Output (extended): {
//    compatible, mode, level, reasons[], warnings[],
//    adapterMethod, tier, score, limitations[], requiredConfiguration[]
//  }
//  The original fields (compatible/level/reasons/warnings/adapterMethod) are
//  preserved for backward compatibility; the new fields describe HOW compatible
//  the combination is and what it requires.
// ═══════════════════════════════════════════════════

const TIER_MAP = { verified: 'native', supported: 'adapter', manual: 'adapter', experimental: 'experimental', unsupported: 'unsupported' };
const SCORE_MAP = { verified: 100, supported: 85, manual: 70, experimental: 55, unsupported: 5 };

function enrich(r, ctx) {
  const tier = TIER_MAP[r.level] || 'unsupported';
  const score = SCORE_MAP[r.level] ?? 0;
  const limitations = [];
  if (r.level === 'experimental') limitations.push('Experimental path — likely requires additional tooling (e.g. an Anthropic-compatible proxy) and is not guaranteed to work.');
  if (r.level === 'manual') limitations.push('Automatic apply is not implemented for this client; generated configuration must be applied manually.');
  if (r.level === 'unsupported') limitations.push('This combination is not supported by the selected client.');

  const required = [];
  if (ctx.client?.id === 'claude-code' && ctx.provider?.id === 'openrouter') {
    required.push('ANTHROPIC_BASE_URL = https://openrouter.ai/api/v1');
    required.push('ANTHROPIC_MODEL = <model>');
    required.push('apiKeyHelper returning your OpenRouter key');
  }
  if (r.level === 'experimental' && ctx.runtime?.id === 'ollama') {
    required.push('An Anthropic-compatible proxy in front of Ollama (translating to /v1/messages)');
  }
  return { ...r, tier, score, limitations, requiredConfiguration: required };
}

export function checkCompatibility({ clientId, providerId, runtimeId, model }) {
  const client = getClient(clientId);
  if (!client) return enrich({ compatible: false, mode: providerId ? 'cloud' : 'local', level: 'unsupported', reasons: ['Unknown client'], warnings: [], adapterMethod: null }, { client });

  const mode = providerId ? 'cloud' : (runtimeId ? 'local' : null);
  const ctx = { client };

  // Level 3 — detection only: never present as configurable.
  if (client.level === 3) {
    return enrich({ compatible: false, mode, level: 'unsupported', reasons: [`${client.name} is detection-only — configuration not supported yet`], warnings: [], adapterMethod: null }, ctx);
  }

  // ── Cloud provider path ──
  if (providerId) {
    const provider = getProvider(providerId);
    if (!provider) return enrich({ compatible: false, mode: 'cloud', level: 'unsupported', reasons: ['Unknown provider'], warnings: [], adapterMethod: null }, ctx);
    ctx.provider = provider;

    if (client.id === 'claude-code') {
      if (provider.id === 'anthropic' || provider.format === 'anthropic') {
        return enrich({ compatible: true, mode: 'cloud', level: 'verified', reasons: [`${client.name} natively uses ${provider.name}`], warnings: [], adapterMethod: 'buildClaudeSettings' }, ctx);
      }
      if (provider.id === 'openrouter') {
        return enrich({ compatible: true, mode: 'cloud', level: 'supported', reasons: [`${client.name} can use ${provider.name} via its Anthropic-compatible endpoint`], warnings: ['Set the OpenRouter Anthropic base URL'], adapterMethod: 'buildClaudeSettings' }, ctx);
      }
      return enrich({ compatible: false, mode: 'cloud', level: 'unsupported', reasons: [`${client.name} requires an Anthropic-compatible API; ${provider.name} exposes a ${provider.format} API that Claude Code does not consume`], warnings: [], adapterMethod: null }, ctx);
    }

    if (client.id === 'gemini-cli' && provider.format !== 'gemini') {
      return enrich({ compatible: false, mode: 'cloud', level: 'unsupported', reasons: [`${client.name} requires a Gemini API; ${provider.name} is ${provider.format}`], warnings: [], adapterMethod: null }, ctx);
    }
    if (provider.format === 'openai' || provider.format === 'anthropic' || provider.id === 'openrouter') {
      if (!client.capabilities.autoConfigure) {
        return enrich({ compatible: true, mode: 'cloud', level: 'manual', reasons: [`${client.name} can use ${provider.name}`], warnings: ['Auto-apply not implemented — generate instructions and apply manually'], adapterMethod: 'generateInstructions' }, ctx);
      }
      return enrich({ compatible: true, mode: 'cloud', level: 'supported', reasons: [`${client.name} can use ${provider.name}`], warnings: [], adapterMethod: 'buildConfig' }, ctx);
    }
    return enrich({ compatible: false, mode: 'cloud', level: 'unsupported', reasons: [`${provider.name} (${provider.format}) is not compatible with ${client.name}`], warnings: [], adapterMethod: null }, ctx);
  }

  // ── Local runtime path ──
  if (runtimeId) {
    const runtime = getRuntime(runtimeId);
    if (!runtime) return enrich({ compatible: false, mode: 'local', level: 'unsupported', reasons: ['Unknown runtime'], warnings: [], adapterMethod: null }, ctx);
    ctx.runtime = runtime;
    if (!client.capabilities.supportsLocalRuntimes) {
      return enrich({ compatible: false, mode: 'local', level: 'unsupported', reasons: [`${client.name} does not support local runtimes`], warnings: [], adapterMethod: null }, ctx);
    }

    if (client.id === 'claude-code') {
      if (runtimeId === 'ollama') {
        return enrich({ compatible: true, mode: 'local', level: 'experimental', reasons: [`${client.name} + ${runtime.name} is possible`], warnings: ['Requires an Anthropic-compatible proxy in front of Ollama'], adapterMethod: 'buildClaudeSettings' }, ctx);
      }
      return enrich({ compatible: false, mode: 'local', level: 'unsupported', reasons: [`${client.name} cannot consume ${runtime.name} directly; it requires an Anthropic-compatible API`], warnings: [], adapterMethod: null }, ctx);
    }

    return enrich({ compatible: true, mode: 'local', level: 'manual', reasons: [`${client.name} can use ${runtime.name} (OpenAI-compatible)`], warnings: ['Auto-apply not implemented — apply the generated endpoint manually'], adapterMethod: 'generateInstructions' }, ctx);
  }

  return enrich({ compatible: false, mode: null, level: 'unsupported', reasons: ['Select a provider or runtime'], warnings: [], adapterMethod: null }, ctx);
}
