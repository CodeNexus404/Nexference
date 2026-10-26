// ═══════════════════════════════════════════════════════════════
//  Anthropic ⇄ OpenAI codec for the Nexference local proxy (v0).
//
//  Translates Anthropic Messages API requests into OpenAI Chat
//  Completions requests and back — for both non-streaming JSON
//  responses and OpenAI-style SSE → Anthropic event streams.
//
//  SCOPE (v0): the common fields Claude Code sends.
//
//  Extended thinking is DEGRADED, not rejected. Claude Code enables it by
//  default, so hard-failing with a 400 made the proxy unusable for every
//  request ("API Error: 400 Extended thinking is not supported…"). The
//  OpenAI Chat Completions dialect has no Anthropic-style `thinking` block,
//  and `reasoning_effort` is not portable across the heterogeneous gateways
//  this proxy fronts (most reject it), so the parameter and any
//  thinking/redacted_thinking content blocks are dropped and the request
//  proceeds normally. Dropping thinking changes only the quality of the
//  answer, never its shape, so this is strictly better than failing.
//
//  /v1/messages/count_tokens and model aliasing remain out of scope and still
//  return a clear structured error rather than corrupting the request. This
//  module claims no complete Anthropic compatibility.
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';

export class ProxyCodecError extends Error {
  constructor(message, { status = 400, type = 'invalid_request_error' } = {}) {
    super(message);
    this.name = 'ProxyCodecError';
    this.status = status;
    this.type = type;
  }
}

export function anthropicError(type, message) {
  return { type: 'error', error: { type, message } };
}

function rndId(prefix) {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

// ─────────────────────────── Request ───────────────────────────

function normalizeSystem(system) {
  if (system === undefined || system === null) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .filter((b) => b && typeof b === 'object' && b.type === 'text')
      .map((b) => (typeof b.text === 'string' ? b.text : ''))
      .join('\n');
  }
  return '';
}

function normalizeToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => {
      if (typeof p === 'string') return p;
      if (p && p.type === 'text' && typeof p.text === 'string') return p.text;
      try { return JSON.stringify(p); } catch { return ''; }
    })
    .join('\n');
}

function normalizeContentBlocks(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    switch (block.type) {
      case 'text':
        out.push({ text: typeof block.text === 'string' ? block.text : '' });
        break;
      case 'image': {
        const src = block.source || {};
        let dataUrl = null;
        if (src.type === 'base64' && src.data && src.media_type) {
          dataUrl = `data:${src.media_type};base64,${src.data}`;
        } else if (src.type === 'url' && src.url) {
          dataUrl = src.url;
        }
        out.push({ image: dataUrl ? { dataUrl } : empty });
        break;
      }
      case 'tool_use':
        out.push({ tool_use: { id: block.id || '', name: block.name || '', input: block.input } });
        break;
      case 'tool_result':
        out.push({ tool_result: { tool_use_id: block.tool_use_id || '', text: normalizeToolResultContent(block.content) } });
        break;
      default:
        break;
    }
  }
  return out;
}
const empty = { dataUrl: '' };

function safeJsonArgs(input) {
  if (input === undefined || input === null) return '{}';
  if (typeof input === 'string') {
    try { JSON.parse(input); return input; } catch { return input; }
  }
  try { return JSON.stringify(input); } catch { return '{}'; }
}

function mapToolChoice(tc) {
  if (!tc || typeof tc !== 'object') return null;
  if (tc.type === 'auto') return { type: 'auto' };
  if (tc.type === 'any') return { type: 'required' };
  if (tc.type === 'tool' && tc.name) return { type: 'function', function: { name: tc.name } };
  return null;
}

// Anthropic Messages request → OpenAI /chat/completions request.
// Throws ProxyCodecError on anything unsupported instead of mangling it.
export function anthropicToOpenAIRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProxyCodecError('Request body must be a JSON object');
  }
  if (typeof body.model !== 'string' || !body.model) {
    throw new ProxyCodecError('"model" is required');
  }
  if (body.messages !== undefined && !Array.isArray(body.messages)) {
    throw new ProxyCodecError('"messages" must be an array');
  }

  const messages = [];

  const systemText = normalizeSystem(body.system);
  if (systemText) messages.push({ role: 'system', content: systemText });

  for (const msg of body.messages || []) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role === 'user') {
      for (const part of normalizeContentBlocks(msg.content)) {
        if (part.tool_result) {
          messages.push({ role: 'tool', tool_call_id: part.tool_result.tool_use_id, content: part.tool_result.text });
        } else if (part.image && part.image.dataUrl) {
          messages.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: part.image.dataUrl } }] });
        } else {
          messages.push({ role: 'user', content: part.text || '' });
        }
      }
    } else if (msg.role === 'assistant') {
      const parts = normalizeContentBlocks(msg.content);
      const text = parts.filter((p) => p.text).map((p) => p.text).join('');
      const tools = parts.filter((p) => p.tool_use).map((p) => p.tool_use);
      if (tools.length) {
        messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: tools.map((t) => ({
            id: t.id || rndId('call_'),
            type: 'function',
            function: { name: t.name, arguments: safeJsonArgs(t.input) },
          })),
        });
      } else {
        messages.push({ role: 'assistant', content: text || '' });
      }
    } else if (msg.role === 'system') {
      messages.push({ role: 'system', content: typeof msg.content === 'string' ? msg.content : normalizeSystem(msg.content) });
    } else {
      // Defensive: never drop a message on the floor — send it as user.
      messages.push({ role: 'user', content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '') });
    }
  }

  const out = { model: body.model, messages, stream: !!body.stream };
  // Ask OpenAI-compatible gateways to include usage in the final stream chunk.
  // Without this they omit it entirely, so prompt/completion tokens always read
  // as 0 and the client cannot show a real cost.
  if (out.stream) out.stream_options = { include_usage: true };
  if (typeof body.max_tokens === 'number') out.max_tokens = body.max_tokens;
  if (typeof body.temperature === 'number') out.temperature = body.temperature;
  if (typeof body.top_p === 'number') out.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) out.stop = body.stop_sequences;
  // `thinking` is intentionally not forwarded — see the SCOPE note above. The
  // translated request is assembled field by field, so nothing from the
  // Anthropic body can leak through to the OpenAI-shaped upstream.
  if (body.thinking && typeof body.thinking === 'object') {
    out.__thinkingDropped = true;
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || { type: 'object', properties: {} },
      },
    }));
    const tc = mapToolChoice(body.tool_choice);
    if (tc) out.tool_choice = tc;
  }

  return out;
}

// ───────────────────────── Response ─────────────────────────

export function mapFinishReason(reason) {
  switch (reason) {
    case 'length': return 'max_tokens';
    case 'tool_calls':
    case 'function_call': return 'tool_use';
    case 'content_filter': return 'end_turn';
    case 'stop':
    default: return 'end_turn';
  }
}

// OpenAI non-streaming JSON → Anthropic Messages response.
export function openAIToAnthropicResponse(json, requestedModel) {
  const choice = json && json.choices && json.choices[0] ? json.choices[0] : {};
  const message = choice.message || {};
  const content = [];
  if (typeof message.content === 'string' && message.content) {
    content.push({ type: 'text', text: message.content });
  }
  for (const tc of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    let input = {};
    try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { input = {}; }
    content.push({ type: 'tool_use', id: tc.id || rndId('toolu_'), name: tc.function?.name || '', input });
  }
  if (!content.length) content.push({ type: 'text', text: '' });
  const usage = json?.usage || {};
  return {
    id: typeof json?.id === 'string' && json.id ? json.id : rndId('msg_'),
    type: 'message',
    role: 'assistant',
    model: json?.model || requestedModel,
    content,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
      output_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    },
  };
}

// ────────────────── Streaming (OpenAI SSE → Anthropic) ──────────────────
// Consumes the upstream OpenAI SSE response incrementally and emits Anthropic
// events via emit(eventName, payload) as they arrive. Never buffers the whole
// body. Resolves with the final { inputTokens, outputTokens, stopReason }.
export async function translateOpenAIStream({ openaiResponse, model, emit, allowThinking = false }) {
  const reader = openaiResponse.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let inputTokens = null;
  let outputTokens = null;
  let stopReason = 'end_turn';
  let nextIdx = 0;
  const openOrder = [];
  let textBlock = -1;
  let thinkBlock = -1;
  const toolBlocks = new Map();
  let messageStarted = false;

  function ensureStarted() {
    if (messageStarted) return;
    emit('message_start', {
      type: 'message_start',
      message: {
        id: rndId('msg_'),
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    messageStarted = true;
  }

  function openBlock(emitStart) {
    ensureStarted();
    const idx = nextIdx++;
    openOrder.push(idx);
    emitStart(idx);
    return idx;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) {
          nl = buf.indexOf('\n');
          continue;
        }
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let j;
        try { j = JSON.parse(payload); } catch { continue; }
        if (j.error) {
          const messageText = typeof j.error === 'string' ? j.error : (j.error.message || 'Upstream stream error');
          throw new ProxyCodecError(messageText, { status: 500, type: 'api_error' });
        }
        ensureStarted();
        const choice = (j.choices && j.choices[0]) || {};
        const delta = choice.delta || {};
        if (choice.finish_reason) stopReason = mapFinishReason(choice.finish_reason);
        if (j.usage) {
          if (typeof j.usage.prompt_tokens === 'number') inputTokens = j.usage.prompt_tokens;
          if (typeof j.usage.completion_tokens === 'number') outputTokens = j.usage.completion_tokens;
        }

        // Reasoning is opt-in in the Anthropic Messages contract: a client only
        // receives `thinking` blocks when it asked for them. Since this proxy
        // strips `thinking` from the outgoing request (OpenAI has no such field),
        // a client that never enabled it would otherwise get unsolicited
        // thinking blocks back — so gate the translation on that intent and keep
        // the two directions consistent.
        const thinkRaw = allowThinking ? (delta.reasoning_content ?? delta.reasoning) : null;
        const think = typeof thinkRaw === 'string' ? thinkRaw : '';
        const text = typeof delta.content === 'string' ? delta.content : '';
        const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];

        if (think) {
          if (thinkBlock === -1) {
            thinkBlock = openBlock((idx) => emit('content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'thinking', thinking: '' } }));
          }
          emit('content_block_delta', { type: 'content_block_delta', index: thinkBlock, delta: { type: 'thinking_delta', thinking: think } });
        }
        if (text) {
          if (textBlock === -1) {
            textBlock = openBlock((idx) => emit('content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } }));
          }
          emit('content_block_delta', { type: 'content_block_delta', index: textBlock, delta: { type: 'text_delta', text } });
        }
        for (const tc of toolCalls) {
          const ti = typeof tc.index === 'number' ? tc.index : 0;
          if (!toolBlocks.has(ti)) {
            const blockIdx = openBlock((idx) => emit('content_block_start', {
              type: 'content_block_start',
              index: idx,
              content_block: { type: 'tool_use', id: tc.id || rndId('toolu_'), name: tc.function?.name || '' },
            }));
            toolBlocks.set(ti, blockIdx);
          }
          const frag = typeof tc.function?.arguments === 'string' ? tc.function.arguments : '';
          if (frag) {
            emit('content_block_delta', { type: 'content_block_delta', index: toolBlocks.get(ti), delta: { type: 'input_json_delta', partial_json: frag } });
          }
        }
        nl = buf.indexOf('\n');
      }
    }
  } catch (err) {
    throw err;
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  // Close blocks in reverse open order, then finalize the message.
  for (const idx of [...openOrder].reverse()) {
    emit('content_block_stop', { type: 'content_block_stop', index: idx });
  }
  emit('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    // OpenAI-compatible gateways only report usage in the FINAL chunk (and only
    // when asked), so message_start necessarily carries zeros. Repeating the
    // real input_tokens here gives the client an accurate final tally instead of
    // a permanently-zero prompt count.
    usage: {
      input_tokens: typeof inputTokens === 'number' ? inputTokens : 0,
      output_tokens: typeof outputTokens === 'number' ? outputTokens : 0,
    },
  });
  emit('message_stop', { type: 'message_stop' });
  return { inputTokens, outputTokens, stopReason };
}