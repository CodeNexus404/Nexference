// Claude Code adapter — the fully VERIFIED client adapter. It does NOT reinvent
// configuration generation: it delegates to the proven Configuration Engine
// (buildClaudeSettings), whose output is byte-compatible with Claude Code and
// must remain unchanged. This adapter only wraps detection, compatibility, and
// the apply/backup hand-off that already exists in the runtime adapter.
import { ClientAdapter } from './base.js';
import { configEngine } from '../config/engine.js';
import { getProvider, claudeCodeProviders } from '../providers/registry.js';

export class ClaudeCodeAdapter extends ClientAdapter {
  getSupportedProviders() { return claudeCodeProviders().map((p) => p.id); }
  getSupportedRuntimes() { return []; } // only via an external proxy (documented, not auto-applied)

  checkCompatibility() { return { compatible: true, level: 'verified' }; }

  // Exact, unchanged generation path. Provider must be the provider object.
  generateConfig({ provider, baseUrl, model, apiKey }) {
    const p = typeof provider === 'string' ? getProvider(provider) : provider;
    if (!p) return { config: null, instructions: ['Unknown provider'] };
    const cfg = configEngine.buildClaudeSettings(p, baseUrl || p.baseUrl, model, apiKey);
    return { config: cfg, instructions: null };
  }
}
