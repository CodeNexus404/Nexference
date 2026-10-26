// ═══════════════════════════════════════════════════════════════
//  Local proxy router — mounts the Anthropic-compatible local endpoint
//  (POST /v1/messages, GET /v1/models) plus its management API
//  (/api/local-proxy/*). Mounted at the app root by index.js.
//
//  Security posture:
//    • loopback-only (127.0.0.1 / ::1) — remote requests are rejected
//    • every /v1/* request must present the generated proxy token
//      (x-api-key OR Authorization: Bearer), compared in constant time
//    • the upstream provider key lives ONLY in the in-memory store
//    • nothing secret is logged or returned by this module
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { readSettings, writeSettings } from '../config/settingsStore.js';
import { recordActivity } from '../activity/activityService.js';
import { getCustomProvider } from '../providers/custom/customProviderStore.js';
import { getDynamicProvider } from '../providers/dynamic/dynamicProviderStore.js';
import { PROVIDERS as CURATED } from '../providers/registry.js';
import * as store from './proxyStore.js';
import {
  anthropicError, anthropicToOpenAIRequest, openAIToAnthropicResponse, translateOpenAIStream, ProxyCodecError,
} from './anthropicCodec.js';

// Kept deliberately short: Claude Code surfaces this inline on every retry
// ("… · Retrying in 6s · attempt 6/10"), so a long paragraph is truncated and
// unreadable exactly when the user most needs the fix. The actionable part is
// "reconnect from the provider card"; the why (in-memory session, restart clears
// it) is surfaced in the UI's own warning strip, not here.
const NOT_ARMED = 'Proxy not armed. Reconnect it in Nexference: provider card → "Use with Claude Code".';

export function isLoopbackIP(ip) {
  const clean = String(ip || '').replace(/^::ffff:/, '').toLowerCase();
  return clean === '127.0.0.1' || clean === '::1' || clean === '0:0:0:0:0:0:0:1' || clean === 'localhost';
}

function loopbackGuard(req, res, next) {
  if (!isLoopbackIP(req.ip || req.socket?.remoteAddress)) {
    return res.status(403).json(anthropicError('permission_error', 'The Nexference local proxy only accepts loopback connections (127.0.0.1 or ::1). Remote requests are rejected.'));
  }
  next();
}

function tokenSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function extractToken(req) {
  const apiKey = String(req.get('x-api-key') || '').trim();
  if (apiKey) return apiKey;
  const auth = String(req.get('authorization') || '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : '';
}

// Returns true when it has sent an error response (caller must stop), false
// when the request may proceed.
function proxyAgentGuard(req, res) {
  const supplied = extractToken(req);
  if (!store.isArmed()) {
    res.status(503).json(anthropicError('service_unavailable', NOT_ARMED));
    return true;
  }
  const active = store.getActive();
  if (!active || !tokenSafeEqual(supplied, active.token)) {
    res.status(401).json(anthropicError('authentication_error', 'Invalid or missing Nexference proxy token.'));
    return true;
  }
  return false;
}

function proxyPort(req) {
  return req.socket?.localPort || 3000;
}

function proxyUrl(req) {
  return `http://127.0.0.1:${proxyPort(req)}/v1/messages`;
}

function validHttpUrl(u) {
  try {
    const o = new URL(u);
    return o.protocol === 'http:' || o.protocol === 'https:';
  } catch { return false; }
}

// Resolve provider metadata server-side, normalising the three record shapes
// into one `{ id, name, baseUrl, format }` contract:
//   • dyn:/eco: — the adopted/ecosystem registry
//   • cst:       — user-created custom providers
//   • curated    — the hardcoded PROVIDERS registry (openai, groq, tokenrouter,
//     cerebras, openrouter, …). These ids carry no prefix, so they previously
//     fell through to getCustomProvider(), found nothing, and every arm attempt
//     failed with 404 "Unknown provider" — which is why the hardcoded cards could
//     never actually use the proxy.
function resolveProvider(providerId) {
  if (providerId.startsWith('dyn:') || providerId.startsWith('eco:')) return normalize(getDynamicProvider(providerId));
  if (providerId.startsWith('cst:')) return normalize(getCustomProvider(providerId));
    const curated = CURATED.find((p) => p.id === providerId);
    if (curated) {
      // A provider may publish a separate OpenAI-compatible surface alongside its
      // native dialect. Google Gemini is the case in point: the proxy speaks the
      // OpenAI dialect, so it must target the declared /v1beta/openai/ url and
      // translate as `openai`, NOT post OpenAI JSON at the native `contents` API.
      const compat = curated.openaiCompat;
      const baseUrl = (compat && (compat.baseUrl || compat)) || curated.baseUrl;
      const format = (compat && (compat.format || 'openai')) || curated.format;
      return {
        id: curated.id,
        name: curated.name || curated.id,
        baseUrl,
        format,
        identity: { name: curated.name || curated.id },
        api: { baseUrl, format },
      };
    }
  return null;
}

// dyn:/cst: records already expose `api`/`identity`; keep them as-is and just
// guarantee the fields the arm handler reads are present.
function normalize(rec) {
  if (!rec) return null;
  return {
    ...rec,
    identity: rec.identity || { name: rec.name || rec.id },
    api: rec.api || { baseUrl: rec.baseUrl, format: rec.format },
  };
}

// Gateways (UNO Router especially) return multi-sentence essays that repeat the
// model id and end with advice addressed to a human reading a web UI — e.g.
//   "All providers for model \"x\" are busy right now (they hit their rate
//    limit). This is not a spelling error. Please try again later or pick a
//    different model."
// Claude Code prints this verbatim in a terminal, where the only useful part is
// the cause. Condense to the first sentence and drop the model-id echo, then cap
// hard. The full text is never needed by the CLI client; the dashboard shows its
// own richer messages from the same failure separately.
function condenseUpstreamMessage(msg) {
  let s = String(msg || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!s) return '';
  // First sentence only. Guard against abbreviations/decimals by requiring the
  // period to be followed by whitespace (or end of string).
  const first = s.match(/^[\s\S]*?[.!?](?=\s|$)/);
  if (first && first[0].length < s.length) s = first[0].trim();
  s = s.replace(/^(?:error|errors)\s*[:\-]\s*/i, '');
  return s;
}

function sanitizeMessage(msg) {
  let s = condenseUpstreamMessage(msg);
  // The model id is echoed in most gateway rate-limit prose and is redundant
  // here: Claude Code already knows which model it asked for, and the echoed id is
  // frequently the longest part of the line. Drop the echo to keep the terminal
  // message short, and prefer a clean word boundary when the hard cap lands
  // mid-word (a cut like "they hit th" is harder to read than a slightly longer
  // trimmed sentence).
  s = s.replace(/\bfor (?:the )?model\s+["'`]?[^"'`]+["'`]?\s*/i, '');
  if (s.length > 110) {
    const cut = s.slice(0, 110);
    const sp = cut.lastIndexOf(' ');
    s = (sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s,;:.()-]+$/, '') + '…';
  }
  return s;
}

function joinUrl(base, path) {
  return `${String(base || '').replace(/\/+$/, '')}/${path}`;
}

async function readUpstreamError(res) {
  try {
    const text = await res.text();
    if (!text) return res.statusText || 'Upstream error';
    try {
      const j = JSON.parse(text);
      if (typeof j?.error?.message === 'string') return j.error.message;
      if (typeof j?.error === 'string') return j.error;
      if (typeof j?.message === 'string') return j.message;
      if (typeof j?.error === 'object' && j.error) return JSON.stringify(j.error);
    } catch { /* not JSON */ }
    return text.slice(0, 300);
  } catch { return res.statusText || 'Upstream error'; }
}

function mapUpstreamError(status, rawMessage) {
  const message = sanitizeMessage(rawMessage);
  if (status === 401) return { status, type: 'authentication_error', message: message || 'Upstream authentication failed (401).' };
  if (status === 403) return { status, type: 'permission_error', message: message || 'Upstream permission denied (403).' };
  if (status === 429) return { status, type: 'rate_limit_error', message: message || 'Upstream rate limit exceeded (429).' };
  if (status === 400 || status === 404 || status === 422) return { status, type: 'invalid_request_error', message: message || `Upstream rejected the request (${status}).` };
  return { status: status >= 500 ? status : 502, type: 'api_error', message: message || 'Upstream provider error.' };
}

export const proxyRouter = Router();

proxyRouter.use(loopbackGuard);

// ── Claude Code Anthropic-compatible surface ──
proxyRouter.use('/v1', (req, res, next) => {
  if (proxyAgentGuard(req, res)) return;
  next();
});

proxyRouter.post('/v1/messages', async (req, res) => {
  const active = store.getActive();
  let openaiReq;
  try {
    openaiReq = anthropicToOpenAIRequest(req.body || {});
  } catch (err) {
    const status = err instanceof ProxyCodecError ? err.status : 400;
    const type = err instanceof ProxyCodecError ? err.type : 'invalid_request_error';
    return res.status(status).json(anthropicError(type, sanitizeMessage(err.message)));
  }

  const url = joinUrl(active.baseUrl, 'chat/completions');
  // Internal marker, never part of the OpenAI contract — drop it before the
  // request leaves the process so no unknown field reaches the upstream.
  const thinkingDropped = openaiReq.__thinkingDropped === true;
  delete openaiReq.__thinkingDropped;
  const controller = new AbortController();
  // Abort the upstream call only when the CLIENT actually goes away.
  //
  // This must listen on the RESPONSE, not the request. Node emits `req`'s
  // 'close' event as soon as the request body has been fully received — which
  // for a normal POST happens before the upstream has replied. Listening there
  // aborted every proxied call almost immediately, and the AbortError branch
  // below ended the response without setting a status, so callers received a
  // silent "200 OK" with a zero-length body instead of a model response.
  // `res` 'close' fires on real client disconnect, and `writableFinished`
  // distinguishes that from our own successful completion.
  const onClose = () => { if (!res.writableFinished) controller.abort(); };
  res.on('close', onClose);

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${active.apiKey}` },
      body: JSON.stringify(openaiReq),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const raw = await readUpstreamError(upstream);
      const mapped = mapUpstreamError(upstream.status, raw);
      return res.status(mapped.status).json(anthropicError(mapped.type, mapped.message));
    }

    if (openaiReq.stream) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      try {
        await translateOpenAIStream({
          openaiResponse: upstream,
          model: req.body.model,
          // Only forward reasoning as Anthropic `thinking` blocks when the client
          // actually opted in with a `thinking` parameter.
          allowThinking: !!(req.body && req.body.thinking && typeof req.body.thinking === 'object'),
          emit: (event, payload) => {
            if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
          },
        });
      } catch (err) {
        if (!res.writableEnded) {
          res.write(`event: error\ndata: ${JSON.stringify(anthropicError('api_error', sanitizeMessage(err.message)))}\n\n`);
        }
      } finally {
        if (!res.writableEnded) res.end();
      }
      return;
    }

    const json = await upstream.json();
    // Surface the degradation as a response header rather than a body field: the
    // Anthropic Messages response shape is fixed, but headers are free, so this
    // documents that thinking was dropped without risking a schema violation.
    if (thinkingDropped) res.set('X-Nexference-Thinking', 'dropped');
    return res.json(openAIToAnthropicResponse(json, req.body.model));
  } catch (err) {
    if (err?.name === 'AbortError') {
      // Only reachable when the client really disconnected (onClose now aborts
      // exclusively on a genuine disconnect). If the response is still open we
      // must not end it with a bare 200 and no body — that reads as a successful
      // but empty reply. Answer with an explicit, honest error instead.
      if (!res.writableEnded) {
        return res.status(499).json(anthropicError('api_error', 'Request cancelled before the upstream provider responded.'));
      }
      return;
    }
    if (!res.writableEnded) {
      return res.status(502).json(anthropicError('api_error', sanitizeMessage(err.message)));
    }
  } finally {
    res.removeListener('close', onClose);
  }
});

proxyRouter.get('/v1/models', (req, res) => {
  const active = store.getActive();
  if (!active) return res.status(503).json(anthropicError('service_unavailable', NOT_ARMED));
  res.json({ object: 'list', data: [{ id: active.model, object: 'model' }] });
});

// ── Management API (dashboard-facing) ──
proxyRouter.post('/api/local-proxy/arm', (req, res) => {
  try {
    const { providerId, model, apiKey } = req.body || {};
    if (typeof providerId !== 'string' || !providerId) {
      return res.status(400).json(anthropicError('invalid_request_error', 'providerId is required'));
    }
    if (typeof model !== 'string' || !model) {
      return res.status(400).json(anthropicError('invalid_request_error', 'model is required'));
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json(anthropicError('invalid_request_error', 'API key is required'));
    }

    // Resolve provider metadata server-side — never trust client-supplied
    // name/baseUrl blindly.
    const provider = resolveProvider(providerId);
    if (!provider) {
      return res.status(404).json(anthropicError('invalid_request_error', `Unknown provider: ${providerId}`));
    }
    if (provider.api?.format !== 'openai') {
      return res.status(400).json(anthropicError('invalid_request_error', `Only OpenAI-compatible providers can be used with the Nexference local proxy (${providerId} is ${provider.api?.format || 'unknown'}).`));
    }
    const baseUrl = provider.api?.baseUrl;
    if (!validHttpUrl(baseUrl)) {
      return res.status(400).json(anthropicError('invalid_request_error', 'Provider base URL is missing or invalid.'));
    }
    const providerName = provider.identity?.name || provider.name || providerId;

    // Capture the current (pre-proxy) Claude configuration in memory so a
    // later Disconnect can restore it through the SAME safe pipeline.
    const previousConfig = readSettings();

    const token = store.arm({ providerId, providerName, baseUrl, format: 'openai', model, apiKey: apiKey.trim(), previousConfig });

    // Configure Claude Code via the existing atomic+backup+verify writer.
    // The only credential written to disk is the random Nexference token.
    const port = proxyPort(req);
    const config = {
      env: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        ANTHROPIC_MODEL: model,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
      apiKeyHelper: process.platform === 'win32' ? `echo ${token}` : `echo '${token}'`,
      model,
    };

    try {
      const result = writeSettings(config);
      recordActivity('proxy', 'arm', 'success', `Nexference local proxy armed for ${providerName}`, { providerId, model, backupPath: result.backupPath || null });
      res.json({
        armed: true,
        providerId,
        providerName,
        model,
        baseUrl,
        proxyUrl: proxyUrl(req),
        armedAt: store.publicStatus().armedAt,
      });
    } catch (err) {
      // Write failed → roll back the in-memory session entirely (never keep a
      // key armed against a settings file that does not point at the proxy).
      store.disarm();
      recordActivity('proxy', 'arm', 'error', `Proxy arm failed for ${providerName}: ${err.message}`);
      res.status(500).json(anthropicError('api_error', `Failed to write Claude Code configuration: ${sanitizeMessage(err.message)}`));
    }
  } catch (err) {
    store.disarm();
    res.status(500).json(anthropicError('api_error', `Failed to arm proxy: ${sanitizeMessage(err.message)}`));
  }
});

// Detect the orphaned-proxy state: Claude Code's settings.json points at the
// local proxy, but the in-memory proxy session is gone.
//
// This happens on every Nexference restart. The upstream key is deliberately
// never persisted (security), so the session genuinely cannot be restored
// automatically — but leaving settings.json aimed at a dead proxy makes Claude
// Code fail on every request with a bare 503, which looks like a broken app. The
// UI uses this flag to surface an actionable warning instead.
function orphanedProxySettings() {
  let cfg;
  try { cfg = readSettings(); } catch { return null; }
  const base = cfg?.env?.ANTHROPIC_BASE_URL || '';
  if (!base) return null;
  let host;
  try { host = new URL(base).hostname; } catch { host = base.replace(/^https?:\/\//, '').split(':')[0]; }
  const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]' || host === '0:0:0:0:0:0:0:1';
  if (!isLocal) return null;
  return { baseUrl: base, model: cfg?.env?.ANTHROPIC_MODEL || cfg?.model || '' };
}

proxyRouter.get('/api/local-proxy/status', (req, res) => {
  const status = store.publicStatus();
  const orphan = status.armed ? null : orphanedProxySettings();
  res.json({
    ...status,
    proxyUrl: proxyUrl(req),
    // True when Claude Code is pointed at us but we hold no session — the UI
    // turns this into a "reconnect" prompt rather than letting 503s surface.
    settingsOrphaned: !!orphan,
    orphanedModel: orphan?.model || null,
  });
});

proxyRouter.post('/api/local-proxy/disarm', (req, res) => {
  const previous = store.takePreviousConfig();
  const hadPrevious = previous !== null && typeof previous === 'object' && Object.keys(previous).length > 0;
  store.disarm();

  let restored = false;
  let error = null;
  if (hadPrevious) {
    try {
      writeSettings(previous);
      restored = true;
      recordActivity('proxy', 'disarm', 'success', 'Nexference local proxy disarmed; previous Claude configuration restored');
    } catch (err) {
      error = sanitizeMessage(err.message);
      recordActivity('proxy', 'disarm', 'error', `Proxy disarm failed to restore config: ${error}`);
    }
  } else {
    recordActivity('proxy', 'disarm', 'success', 'Nexference local proxy disarmed (no previous configuration to restore)');
  }
  res.json({ disarmed: true, restored, hadPrevious, ...(error ? { error } : {}) });
});