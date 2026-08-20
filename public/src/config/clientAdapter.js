// Client Adapter interface — abstracts the client-specific env/config shape each
// gateway produces. The original app.js encoded this with format branches inside
// buildClaudeSettings; here each branch becomes a named, swappable adapter so a
// future client (e.g. a new SDK) is a new class, not a new if-branch.
//
// Logic preserved exactly from buildClaudeSettings.
export class ClientAdapter {
  // Returns the config fragment this client expects: { env, apiKeyHelper?, model? }.
  buildConfig(/* provider, baseUrl, model, apiKey */) {
    throw new Error('buildConfig() must be implemented by a concrete ClientAdapter');
  }
}

// Anthropic-compatible → Claude Code config (unchanged behaviour).
// Claude Code appends `/v1/messages` to ANTHROPIC_BASE_URL, so we strip any
// trailing `/v1/` from the gateway base (present for OpenAI-style calls).
export class ClaudeCodeAdapter extends ClientAdapter {
  buildConfig(provider, baseUrl, model, apiKey) {
    const ccBase = (baseUrl || '').replace(/\/v1\/?$/, '/').replace(/\/v1beta\/?$/, '/');
    return {
      env: {
        ANTHROPIC_BASE_URL: ccBase,
        ANTHROPIC_MODEL: model,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
      apiKeyHelper: `echo '${apiKey}'`,
      ...(model && { model }),
    };
  }
}

// OpenAI-compatible → OpenAI client config. The OpenAI SDK appends
// `/chat/completions` to OPENAI_BASE_URL, so keep the `/v1/` segment as-is.
export class OpenAIClientAdapter extends ClientAdapter {
  buildConfig(provider, baseUrl, model, apiKey) {
    return {
      env: {
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_KEY: apiKey,
      },
      model,
    };
  }
}

// Google Gemini → Gemini client config (GOOGLE_API_KEY + base URL).
export class GeminiClientAdapter extends ClientAdapter {
  buildConfig(provider, baseUrl, model, apiKey) {
    return {
      env: {
        GOOGLE_API_KEY: apiKey,
        GOOGLE_GENAI_BASE_URL: baseUrl,
      },
      model,
    };
  }
}

export function getClientAdapter(format) {
  if (format === 'gemini') return new GeminiClientAdapter();
  if (format === 'openai') return new OpenAIClientAdapter();
  return new ClaudeCodeAdapter();
}

// ─── Client catalogue (v0.2.0) ───
// Nexference supports multiple AI coding clients. Claude Code is fully supported
// (detect + read + generate + validate + backup + write). Every other client is
// reported honestly: detected/known, but its configuration support is "coming
// soon" — we never pretend to generate a config we can't.
export const CLIENTS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    supported: true,
    configPath: '~/.claude/settings.json',
    note: 'Full support — generate, preview, validate, backup & apply.',
  },
  { id: 'opencode', name: 'OpenCode', supported: false, note: 'Detected · configuration support coming soon' },
  { id: 'codex', name: 'Codex CLI', supported: false, note: 'Detected · configuration support coming soon' },
  { id: 'gemini-cli', name: 'Gemini CLI', supported: false, note: 'Detected · configuration support coming soon' },
  { id: 'aider', name: 'Aider', supported: false, note: 'Detected · configuration support coming soon' },
  { id: 'cline', name: 'Cline', supported: false, note: 'Detected · configuration support coming soon' },
  { id: 'continue', name: 'Continue', supported: false, note: 'Detected · configuration support coming soon' },
  { id: 'roo', name: 'Roo Code', supported: false, note: 'Detected · configuration support coming soon' },
  { id: 'cursor', name: 'Cursor', supported: false, note: 'Detected · configuration support coming soon' },
];

export function getClient(id) {
  return CLIENTS.find((c) => c.id === id) || CLIENTS[0];
}

export function isClientSupported(id) {
  return !!getClient(id).supported;
}
