// Server-side mirror of the AI client catalogue. Kept separate from the frontend
// module on purpose (no cross-imports between public/ and src/), but the data is
// the same source of truth surfaced via /api/clients. v0.4.0 distinguishes
// Client (app) from Provider (gateway) and Runtime (local model server).
export const CLIENTS = [
  { id: 'claude-code', name: 'Claude Code', support: 'verified', connectionTypes: ['cloud', 'local'], configPath: '~/.claude/settings.json', note: 'Fully supported.' },
  { id: 'opencode-cli', name: 'OpenCode', support: 'manual', connectionTypes: ['cloud', 'local'], configPath: '~/.config/opencode/config.json', note: 'OpenAI-compatible; guidance only.' },
  { id: 'codex', name: 'Codex CLI', support: 'manual', connectionTypes: ['cloud'], configPath: '~/.codex/config.json', note: 'OpenAI-compatible; guidance only.' },
  { id: 'gemini-cli', name: 'Gemini CLI', support: 'manual', connectionTypes: ['cloud', 'local'], configPath: '~/.gemini/settings.json', note: 'Gemini API; guidance only.' },
  { id: 'aider', name: 'Aider', support: 'unsupported', connectionTypes: [], configPath: '~/.aider.conf.yml', note: 'Coming soon.' },
  { id: 'cline', name: 'Cline', support: 'unsupported', connectionTypes: [], configPath: 'VS Code settings', note: 'Coming soon.' },
  { id: 'continue', name: 'Continue', support: 'unsupported', connectionTypes: [], configPath: '~/.continue/config.json', note: 'Coming soon.' },
  { id: 'roo', name: 'Roo Code', support: 'unsupported', connectionTypes: [], configPath: 'VS Code settings', note: 'Coming soon.' },
  { id: 'cursor', name: 'Cursor', support: 'unsupported', connectionTypes: [], configPath: '~/.cursor/config.json', note: 'Coming soon.' },
];

export function getClient(id) {
  return CLIENTS.find((c) => c.id === id) || null;
}
