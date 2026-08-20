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
