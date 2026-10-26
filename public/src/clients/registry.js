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
    id: 'opencode-cli',
    // Hidden while the client has no fallback integration. It stays in the
    // catalogue on purpose: getClient() falls back to CLIENTS[0] for an unknown id,
    // so deleting these would silently resolve a stored 'codex' selection to Claude
    // Code and write the wrong client's config. Only the UI is filtered out.
    hidden: true, name: 'OpenCode', monogram: 'OC', color: '#7c3aed', logo: '/clients/opencode-cli.png',
    configPath: '~/.config/opencode/opencode.json',
    support: 'manual',
    capabilities: { detect: true, generateConfig: false, applyConfig: false, backup: false, launch: true, openFolder: true },
    connectionTypes: ['cloud', 'local'],
    adapter: 'opencode-cli',
    note: 'OpenCode reads OpenAI-compatible endpoints. Configuration support coming soon.',
  },
  {
    id: 'codex',
    // Hidden while the client has no fallback integration. It stays in the
    // catalogue on purpose: getClient() falls back to CLIENTS[0] for an unknown id,
    // so deleting these would silently resolve a stored 'codex' selection to Claude
    // Code and write the wrong client's config. Only the UI is filtered out.
    hidden: true, name: 'Codex CLI', monogram: 'CX', color: '#10a37f', logo: '/clients/codex.svg',
    configPath: '~/.codex/config.json',
    support: 'manual',
    capabilities: { detect: true, generateConfig: false, applyConfig: false, backup: false, launch: true, openFolder: true },
    connectionTypes: ['cloud'],
    adapter: 'codex',
    note: 'Codex CLI uses the OpenAI-compatible API. Configuration support coming soon.',
  },
  {
    id: 'antigravity-cli',
    // Hidden like the other coming-soon clients: no config write or fallback
    // support exists yet. The Clients page has its own display list, so this
    // entry never leaks into the configuration/fallback pickers.
    hidden: true, name: 'Antigravity CLI', monogram: 'AG', color: '#3186ff', logo: '/clients/antigravity-cli.svg',
    configPath: '~/.gemini/antigravity-cli/settings.json',
    support: 'unsupported',
    capabilities: { detect: false, generateConfig: false, applyConfig: false, backup: false, launch: false, openFolder: false },
    connectionTypes: ['cloud'],
    adapter: null,
    note: 'Antigravity CLI runs on Gemini models. Configuration support coming soon.',
  },
  {
    id: 'gemini-cli',
    // Hidden while the client has no fallback integration. It stays in the
    // catalogue on purpose: getClient() falls back to CLIENTS[0] for an unknown id,
    // so deleting these would silently resolve a stored 'codex' selection to Claude
    // Code and write the wrong client's config. Only the UI is filtered out.
    hidden: true, name: 'Gemini CLI', monogram: 'GC', color: '#4285f4', logo: '/clients/gemini-cli.svg',
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
    note: 'Configuration support coming soon',
  },
];

// Clients currently offered in the UI. The three manual-setup clients are hidden
// until the fallback monitor can actually drive them: switching a tier for a client
// with no working config write would leave it pointed at the old provider, which
// is the exact failure the fallback is meant to prevent.
export function visibleClients() {
  return CLIENTS.filter((c) => !c.hidden);
}

// The Clients page is informational, so it also introduces clients that are not
// yet configurable. They stay `hidden` in the catalogue (and therefore out of the
// fallback/configuration pickers) but are listed here in display order.
const CLIENTS_PAGE_ORDER = ['claude-code', 'opencode-cli', 'codex', 'antigravity-cli', 'cursor'];

export function clientsForPage() {
  return CLIENTS_PAGE_ORDER.map((id) => CLIENTS.find((c) => c.id === id)).filter(Boolean);
}

export function isClientVisible(id) {
  const c = CLIENTS.find((x) => x.id === id);
  return !!c && !c.hidden;
}

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
