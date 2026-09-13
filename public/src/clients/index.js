// Client adapter factory — returns the concrete adapter for a client id.
// Unknown / unsupported clients fall back to the honest base adapter.
import { getClient } from './registry.js';
import { ClientAdapter } from './base.js';
import { ClaudeCodeAdapter } from './claudeCode.js';
import { OpenCodeCliAdapter } from './opencodeCli.js';
import { CodexCliAdapter } from './codexCli.js';
import { GeminiCliAdapter } from './geminiCli.js';
import { CursorAdapter } from './cursor.js';

const MAP = {
  'claude-code': ClaudeCodeAdapter,
  'opencode-cli': OpenCodeCliAdapter,
  'codex': CodexCliAdapter,
  'gemini-cli': GeminiCliAdapter,
  'cursor': CursorAdapter,
};

export function getClientAdapter(id) {
  const client = getClient(id);
  const Cls = MAP[id] || ClientAdapter;
  return new Cls(client);
}

export { ClientAdapter } from './base.js';
export { ClaudeCodeAdapter } from './claudeCode.js';
export { OpenCodeCliAdapter } from './opencodeCli.js';
export { CodexCliAdapter } from './codexCli.js';
export { GeminiCliAdapter } from './geminiCli.js';
export { CursorAdapter } from './cursor.js';
