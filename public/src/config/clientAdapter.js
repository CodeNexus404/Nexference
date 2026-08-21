// Client Adapter (format branch) — abstracts the client-specific env/config
// shape each gateway produces. This is the legacy format-keyed adapter used by
// the Configuration Engine (buildClaudeSettings) to know which env vars a given
// provider format needs. It is distinct from the v0.4.0 client catalogue in
// ../clients/registry.js (which describes AI *applications*, not formats).
//
// Logic preserved exactly from the original app.js.
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

// ─── Re-export the v0.4.0 client catalogue so existing importers
// (app.js, workflow.js) keep working without code changes. The catalogue itself
// now lives in ../clients/registry.js. ───
export {
  CLIENTS,
  getClient,
  isClientSupported,
  isClientAutoApply,
  normalizeClientId,
  clientsForConnectionType,
} from '../clients/registry.js';
