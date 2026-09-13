import { execSync } from 'node:child_process';

// Server-side mirror of the AI client catalogue. v0.6.0 extends each client with
// an explicit CAPABILITY MATRIX and an integration LEVEL so the UI can adapt
// dynamically instead of hardcoding special cases.
//
//   Level 1 — Native Managed:  read / generate / apply / backup all supported.
//   Level 2 — Assisted Setup:  generate instructions or a config snippet, but
//                               Nexference does not auto-write it.
//   Level 3 — Detection Only:  we can detect the client and show info, but do
//                               not configure it.
//
// The frontend registry (public/src/clients/registry.js) is the same data; this
// file is the server source of truth surfaced via /api/clients.
const CAP = {
  claudeCodeFull: {
    autoConfigure: true, supportsCloudProviders: true, supportsLocalRuntimes: true,
    supportsCustomBaseUrl: true, supportsEnvironmentVariables: true, supportsModelSelection: true,
    supportsLaunch: true, supportsReadConfig: true, supportsBackup: true,
  },
  assisted: {
    autoConfigure: false, supportsCloudProviders: true, supportsLocalRuntimes: true,
    supportsCustomBaseUrl: true, supportsEnvironmentVariables: true, supportsModelSelection: true,
    supportsLaunch: true, supportsReadConfig: false, supportsBackup: false,
  },
  cloudOnly: {
    autoConfigure: false, supportsCloudProviders: true, supportsLocalRuntimes: false,
    supportsCustomBaseUrl: true, supportsEnvironmentVariables: true, supportsModelSelection: true,
    supportsLaunch: true, supportsReadConfig: false, supportsBackup: false,
  },
  detectOnly: {
    autoConfigure: false, supportsCloudProviders: false, supportsLocalRuntimes: false,
    supportsCustomBaseUrl: false, supportsEnvironmentVariables: false, supportsModelSelection: false,
    supportsLaunch: false, supportsReadConfig: false, supportsBackup: false,
  },
};

export const CLIENTS = [
  {
    id: 'claude-code', name: 'Claude Code', logo: '/clients/claude-code.png', support: 'verified', level: 1, adapter: 'claude-code',
    connectionTypes: ['cloud', 'local'], configPath: '~/.claude/settings.json',
    capabilities: CAP.claudeCodeFull,
    note: 'Fully supported — generate, preview, validate, backup & apply.',
  },
  {
    id: 'opencode-cli', name: 'OpenCode', logo: '/clients/opencode-cli.png', support: 'manual', level: 2, adapter: 'opencode-cli',
    connectionTypes: ['cloud', 'local'], configPath: '~/.config/opencode/opencode.json',
    capabilities: CAP.assisted,
    note: 'OpenCode consumes OpenAI-compatible endpoints. Auto-configure guidance only.',
  },
  {
    id: 'codex', name: 'Codex CLI', logo: '/clients/codex.svg', support: 'manual', level: 2, adapter: 'codex',
    connectionTypes: ['cloud'], configPath: '~/.codex/config.json',
    capabilities: CAP.cloudOnly,
    note: 'Codex CLI uses the OpenAI-compatible API. Auto-configure guidance only.',
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', logo: '/clients/gemini-cli.svg', support: 'manual', level: 2, adapter: 'gemini-cli',
    connectionTypes: ['cloud', 'local'], configPath: '~/.gemini/settings.json',
    capabilities: CAP.assisted,
    note: 'Gemini CLI uses the Gemini API. Auto-configure guidance only.',
  },
  {
    id: 'cursor', name: 'Cursor', logo: '/clients/cursor.svg', support: 'unsupported', level: 3, adapter: null,
    connectionTypes: [], configPath: '~/.cursor/config.json',
    capabilities: CAP.detectOnly, note: 'Detected · configuration support coming soon',
  },
];

export function getClient(id) {
  return CLIENTS.find((c) => c.id === id) || null;
}

export function getClientCapabilities(id) {
  const c = getClient(id);
  return c ? c.capabilities : null;
}

// Best-effort process detection (no secrets). Returns a hint, not a guarantee.
const DETECT = {
  'claude-code': ['claude'],
  'opencode-cli': ['opencode'],
  'codex': ['codex'],
  'gemini-cli': ['gemini'],
};

export function detectClient(id) {
  const names = DETECT[id];
  if (!names) return { id, detected: null, note: 'Detection not implemented for this client' };
  for (const n of names) {
    try {
      execSync(`command -v ${n} >/dev/null 2>&1`);
      return { id, detected: true, note: `Detected on PATH: ${n}` };
    } catch { /* not found */ }
  }
  return { id, detected: false, note: 'Not found on PATH' };
}
