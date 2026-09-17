// AI Client registry — the catalogue of applications that consume AI.
// v0.4.0 makes the distinction explicit: a Client (Claude Code, OpenCode CLI,
// …) is NOT a Provider (Anthropic, OpenRouter, …) and NOT a Runtime (Ollama).
//
// IMPORTANT — OpenCode clash resolution:
//   The OpenCode *application* is registered here as `opencode-cli`. If OpenCode
//   ever exposes a genuine provider API endpoint, that would be a separate
//   provider id (e.g. `opencode-api`) and must NOT reuse this identifier. Clients
//   and providers never share ids.
export const CLIENTS = [
  {
    id: 'claude-code', name: 'Claude Code', monogram: 'CC', color: '#d97757', logo: '/clients/claude-code.svg',
    configPath: '~/.claude/settings.json',
    support: 'verified',
    capabilities: { detect: true, generateConfig: true, applyConfig: true, backup: true, launch: true, openFolder: true },
    connectionTypes: ['cloud', 'local'],
    adapter: 'claude-code',
    note: 'Fully supported — generate, preview, validate, backup & apply.',
  },
  {
    id: 'opencode-cli', name: 'OpenCode', monogram: 'OC', color: '#7c3aed', logo: '/clients/opencode-cli.png',
    configPath: '~/.config/opencode/opencode.json',
    support: 'manual',
    capabilities: { detect: true, generateConfig: false, applyConfig: false, backup: false, launch: true, openFolder: true },
    connectionTypes: ['cloud', 'local'],
    adapter: 'opencode-cli',
    note: 'OpenCode consumes OpenAI-compatible endpoints. Auto-configure support is not implemented — guidance only.',
  },
  {
    id: 'codex', name: 'Codex CLI', monogram: 'CX', color: '#10a37f', logo: '/clients/codex.svg',
    configPath: '~/.codex/config.json',
    support: 'manual',
    capabilities: { detect: true, generateConfig: false, applyConfig: false, backup: false, launch: true, openFolder: true },
    connectionTypes: ['cloud'],
    adapter: 'codex',
    note: 'Codex CLI uses the OpenAI-compatible API. Auto-configure guidance only.',
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', monogram: 'GC', color: '#4285f4', logo: '/clients/gemini-cli.svg',
    configPath: '~/.gemini/settings.json',
    support: 'manual',
    capabilities: { detect: true, generateConfig: false, applyConfig: false, backup: false, launch: true, openFolder: true },
    connectionTypes: ['cloud', 'local'],
    adapter: 'gemini-cli',
    note: 'Gemini CLI uses the Gemini API. Auto-configure guidance only.',
  },
  {
    id: 'cursor', name: 'Cursor', monogram: 'CU', color: '#111827', logo: '/clients/cursor.svg',
    configPath: '~/.cursor/config.json',
    support: 'unsupported',
    capabilities: { detect: true, generateConfig: false, applyConfig: false, backup: false, launch: false, openFolder: true },
    connectionTypes: [],
    adapter: null,
    note: 'Detected · configuration support coming soon',
  },
];

export function getClient(id) {
  return CLIENTS.find((c) => c.id === id) || CLIENTS[0];
}

export function isClientSupported(id) {
  // Auto-apply is only available for the fully verified adapter.
  return getClient(id).support === 'verified';
}

export function isClientAutoApply(id) {
  return getClient(id).support === 'verified';
}

// Legacy alias mapping (older stored states may reference `opencode`).
export function normalizeClientId(id) {
  if (id === 'opencode') return 'opencode-cli';
  return id;
}

export function clientsForConnectionType(type) {
  return CLIENTS.filter((c) => c.connectionTypes.includes(type));
}
