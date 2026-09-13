// ═══════════════════════════════════════════════════════════════
//  Execution Adapter (v0.9.0)
//
//  Normalizes cloud + local model execution behind one request shape.
//  Cloud execution reuses the existing ProviderAdapter dialects; local
//  execution talks directly to each runtime's real HTTP contract. Every
//  adapter returns { content, usage } and streams deltas via onToken.
//  No token counts are invented — usage is whatever the source reports.
// ═══════════════════════════════════════════════════════════════

import { getExecutableProvider } from './executionResolver.js';
import { getProviderAdapter } from '../providers/providerAdapter.js';
import { getRuntimeExec } from './executionRegistry.js';

function mapParameters(parameters = {}) {
  return { temperature: parameters.temperature, maxTokens: parameters.maxTokens, topP: parameters.topP };
}

function buildMessages(messages, systemPrompt) {
  return [...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []), ...messages];
}

// OpenAI-compatible SSE reader (same dialect used by cloud OpenAI and
// OpenAI-compatible local servers such as LM Studio / vLLM / SGLang).
async function readOpenAISSE(res, onToken) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = ''; let content = ''; let usage = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        // LM Studio streams failures as `event: error` → `data: {error:…}`; surface
        // those honestly instead of silently yielding empty output.
        if (j.error) {
          const msg = typeof j.error === 'string' ? j.error : (j.error.message || 'Local runtime stream error');
          throw new Error('LMSTUDIO_STREAM_ERROR:' + msg);
        }
        // Captures both normal output (`content`) and reasoning-model thinking
        // (`reasoning_content` / `reasoning`), so reasoning models still surface
        // visible output instead of an empty stream.
        const delta = j.choices?.[0]?.delta || {};
        const piece = delta.content || delta.reasoning_content || delta.reasoning || '';
        if (piece) { content += piece; onToken && onToken(piece); }
        if (j.usage) usage = { inputTokens: j.usage.prompt_tokens ?? null, outputTokens: j.usage.completion_tokens ?? null };
      } catch (e) {
        if (e.message && e.message.startsWith('LMSTUDIO_STREAM_ERROR:')) throw new Error(e.message.slice('LMSTUDIO_STREAM_ERROR:'.length));
        /* ignore malformed chunk */
      }
    }
  }
  return { content, usage };
}

async function executeCloud({ providerId, model, messages, systemPrompt, parameters, stream, key, signal, onToken }) {
  const provider = getExecutableProvider(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const adapter = getProviderAdapter(provider);
  return adapter.chat({
    url: provider.baseUrl, key, model, messages, systemPrompt,
    parameters: mapParameters(parameters), stream, signal, onToken,
  });
}

async function executeOllama({ model, messages, systemPrompt, parameters, stream, signal, onToken }) {
  const endpoint = 'http://localhost:11434/api/chat';
  const body = {
    model,
    messages: buildMessages(messages, systemPrompt),
    stream: !!stream,
    options: {
      temperature: parameters?.temperature,
      top_p: parameters?.topP,
      num_predict: parameters?.maxTokens,
    },
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Ollama returned ${res.status}: ${t.slice(0, 200)}`);
  }
  if (!stream) {
    const j = await res.json();
    return {
      content: j.message?.content || '',
      usage: {
        inputTokens: j.prompt_eval_count ?? null,
        outputTokens: j.eval_count ?? null,
        latencyMs: j.total_duration ? Math.round(j.total_duration / 1e6) : null,
      },
    };
  }
  return readOllamaStream(res, onToken);
}

async function readOllamaStream(res, onToken) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = ''; let content = ''; let inputTokens = null; let outputTokens = null; let latencyMs = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const j = JSON.parse(t);
        if (j.message?.content) { content += j.message.content; onToken && onToken(j.message.content); }
        if (j.done) {
          inputTokens = j.prompt_eval_count ?? inputTokens;
          outputTokens = j.eval_count ?? outputTokens;
          latencyMs = j.total_duration ? Math.round(j.total_duration / 1e6) : latencyMs;
        }
      } catch { /* ignore */ }
    }
  }
  return { content, usage: { inputTokens, outputTokens, latencyMs } };
}

async function executeOpenAILocal({ runtimeId, model, messages, systemPrompt, parameters, stream, signal, onToken }) {
  const cfg = getRuntimeExec(runtimeId);
  if (!cfg || cfg.kind !== 'openai') throw new Error(`Runtime ${runtimeId} is not an OpenAI-compatible local server`);
  const endpoint = cfg.baseUrl + 'chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  const msgs = buildMessages(messages, systemPrompt);
  const body = JSON.stringify({
    model, messages: msgs, stream: !!stream,
    temperature: parameters?.temperature, max_tokens: parameters?.maxTokens, top_p: parameters?.topP,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  });
  const res = await fetch(endpoint, { method: 'POST', headers, body, signal });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Local runtime returned ${res.status}: ${t.slice(0, 200)}`);
  }
  if (!stream) {
    const j = await res.json();
    const msg = j.choices?.[0]?.message || {};
    let content = msg.content || '';
    if (msg.reasoning_content) content = msg.reasoning_content + (content ? '\n\n' + content : '');
    const u = j.usage || null;
    return { content, usage: u ? { inputTokens: u.prompt_tokens ?? null, outputTokens: u.completion_tokens ?? null } : null };
  }
  return readOpenAISSE(res, onToken);
}

// Dispatch to the correct underlying adapter based on source.
export async function runExecutionAdapter(req, { onToken, signal } = {}) {
  const { source, providerId, runtimeId, model, messages, systemPrompt, parameters, stream, key } = req;
  if (source === 'local' || runtimeId) {
    if (runtimeId === 'ollama') {
      return executeOllama({ model, messages, systemPrompt, parameters, stream, signal, onToken });
    }
    return executeOpenAILocal({ runtimeId, model, messages, systemPrompt, parameters, stream, signal, onToken });
  }
  return executeCloud({ providerId, model, messages, systemPrompt, parameters, stream, key, signal, onToken });
}

export { executeCloud, executeOllama, executeOpenAILocal };
