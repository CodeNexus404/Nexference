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
//
// Two auth shapes exist, matching how each gateway actually authenticates:
// •  default — apiKeyHelper echo: Claude Code resolves the helper and sends
  //    the result as `x-api-key` (Anthropic's native header). Correct for
  //    anthropic, agentrouter, aerolink, freemodel, custom.
  //
  // The apiKeyHelper is executed through the OS shell — /bin/sh on macOS/Linux
  // (strips the single quotes) but cmd.exe on Windows, where single quotes are
  // literal characters that would ship inside the actual key and break auth.
  // So the quoted form is emitted only on POSIX; on Windows the key is echoed
  // bare (API keys are alphanumeric, so no cmd metacharacter risk).
//  • bearerAuth — TokenRouter-style gateways reject `x-api-key` and demand
//    `Authorization: Bearer <key>` (their own error message says so). For
//    these we emit ANTHROPIC_AUTH_TOKEN only (no apiKeyHelper): Claude Code
//    treats the helper as the preferred source for x-api-key, and with no
//    helper present it sends ANTHROPIC_AUTH_TOKEN as a Bearer token instead.
export class ClaudeCodeAdapter extends ClientAdapter {
  buildConfig(provider, baseUrl, model, apiKey) {
    const ccBase = (baseUrl || '').replace(/\/v1\/?$/, '/').replace(/\/v1beta\/?$/, '/');
    if (provider && provider.bearerAuth) {
      return {
        env: {
          ANTHROPIC_BASE_URL: ccBase,
          ANTHROPIC_MODEL: model,
          ANTHROPIC_AUTH_TOKEN: apiKey,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
        ...(model && { model }),
      };
    }
    return {
      env: {
        ANTHROPIC_BASE_URL: ccBase,
        ANTHROPIC_MODEL: model,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
      apiKeyHelper: isWindowsPlatform() ? `echo ${apiKey}` : `echo '${apiKey}'`,
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

// True when the dashboard is running on Windows. Claude Code executes
// `apiKeyHelper` through the system shell: /bin/sh (macOS/Linux) strips the
// single quotes around the key, but cmd.exe (Windows) treats them as literal
// characters — so we only emit the quoted form on POSIX and keep it
// un-quoted on Windows. Probing the browser keeps the Mac output byte-identical.
export function isWindowsPlatform() {
  const ua = navigator.userAgent || '';
  const pl = navigator.platform || '';
  return /win/i.test(pl) || /Windows|Win64|Win32/i.test(ua);
}
