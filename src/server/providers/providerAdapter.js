import { norm } from '../utils/index.js';
import { fetchModelsForProvider } from './modelService.js';

// ── Shared SSE readers (provider-specific streaming dialects) ──────────
// Each normalizes a provider's streaming response into accumulated text +
// token usage, invoking onToken for every incremental content delta.

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
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) { content += delta; onToken && onToken(delta); }
        if (j.usage) usage = { inputTokens: j.usage.prompt_tokens ?? null, outputTokens: j.usage.completion_tokens ?? null };
      } catch { /* ignore malformed chunk */ }
    }
  }
  return { content, usage };
}

async function readAnthropicSSE(res, onToken) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = ''; let content = ''; let inputTokens = null; let outputTokens = null; let event = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('event:')) { event = t.slice(6).trim(); continue; }
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (!data) continue;
      try {
        const j = JSON.parse(data);
        if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') { content += j.delta.text; onToken && onToken(j.delta.text); }
        else if (j.type === 'message_start') { inputTokens = j.usage?.input_tokens ?? inputTokens; }
        else if (j.type === 'message_delta') { outputTokens = j.usage?.output_tokens ?? outputTokens; }
      } catch { /* ignore */ }
    }
  }
  return { content, usage: { inputTokens, outputTokens } };
}

async function readGeminiSSE(res, onToken) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = ''; let content = ''; let inputTokens = null; let outputTokens = null;
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
        const parts = j.candidates?.[0]?.content?.parts || [];
        for (const p of parts) { if (p.text) { content += p.text; onToken && onToken(p.text); } }
        if (j.usageMetadata) { inputTokens = j.usageMetadata.promptTokenCount ?? inputTokens; outputTokens = j.usageMetadata.candidatesTokenCount ?? outputTokens; }
      } catch { /* ignore */ }
    }
  }
  return { content, usage: { inputTokens, outputTokens } };
}

// ═══════════════════════════════════════════════════════════════
//  Provider Adapter interface
//
//  Abstraction over a gateway's server-side behaviours: pulling its model
//  list and probing a connection. Concrete adapters vary only by API dialect
//  (Anthropic / OpenAI / Gemini). The original monolithic fetch + test logic
//  is preserved verbatim inside each adapter — this layer only gives it a
//  named, swappable interface for future milestones (new dialects, new
//  gateways) without rewriting the working code.
// ═══════════════════════════════════════════════════════════════

export class ProviderAdapter {
  constructor(provider) {
    this.provider = provider;
  }

  // Resolve the provider's model list (delegates to the shared model service).
  fetchModels(key = '') {
    return fetchModelsForProvider(this.provider, key);
  }

  // Probe a connection. Subclasses implement the dialect-specific request.
  // Returns { status, body } — mirroring the original /api/test contract.
  async testConnection(/* { url, key, model, auth } */) {
    throw new Error('testConnection() must be implemented by a concrete ProviderAdapter');
  }
}

class OpenAIProviderAdapter extends ProviderAdapter {
  async testConnection({ url, key, model } = {}) {
    const base = norm(url);
    const endpoint = `${base}chat/completions`;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    const body = JSON.stringify({
      model: model || 'gpt-4o-mini',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const response = await fetch(endpoint, { method: 'POST', headers, body });
    const data = await response.text();
    return { status: response.status, body: data };
  }

  // Honest chat completion. Returns { content, usage } and streams deltas
  // via onToken when stream:true. Throws on non-2xx (the caller masks it).
  async chat({ url, key, model, messages, systemPrompt, parameters = {}, stream = false, signal, onToken } = {}) {
    const base = norm(url);
    const endpoint = `${base}chat/completions`;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    const msgs = [...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []), ...messages];
    const body = JSON.stringify({
      model,
      messages: msgs,
      stream: !!stream,
      temperature: parameters.temperature,
      max_tokens: parameters.maxTokens,
      top_p: parameters.topP,
    });
    const res = await fetch(endpoint, { method: 'POST', headers, body, signal });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Provider returned ${res.status}: ${t.slice(0, 300)}`);
    }
    if (!stream) {
      const j = await res.json();
      const content = j.choices?.[0]?.message?.content || '';
      const u = j.usage || null;
      return { content, usage: u ? { inputTokens: u.prompt_tokens ?? null, outputTokens: u.completion_tokens ?? null } : null };
    }
    return readOpenAISSE(res, onToken);
  }
}

class GeminiProviderAdapter extends ProviderAdapter {
  async testConnection({ url, key, model } = {}) {
    const base = norm(url);
    const endpoint = `${base}models/${model || 'gemini-2.0-flash'}:generateContent?key=${encodeURIComponent(key)}`;
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] });
    const response = await fetch(endpoint, { method: 'POST', headers, body });
    const data = await response.text();
    return { status: response.status, body: data };
  }

  async chat({ url, key, model, messages, systemPrompt, parameters = {}, stream = false, signal, onToken } = {}) {
    const base = norm(url);
    const endpoint = `${base}models/${model}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}?key=${encodeURIComponent(key)}`;
    const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] }));
    const body = JSON.stringify({ contents, systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined });
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Provider returned ${res.status}: ${t.slice(0, 300)}`);
    }
    if (!stream) {
      const j = await res.json();
      const content = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      const u = j.usageMetadata || null;
      return { content, usage: u ? { inputTokens: u.promptTokenCount ?? null, outputTokens: u.candidatesTokenCount ?? null } : null };
    }
    return readGeminiSSE(res, onToken);
  }
}

class AnthropicProviderAdapter extends ProviderAdapter {
  async testConnection({ url, key, model, auth = 'x-api-key' } = {}) {
    const base = norm(url);
    const msgPath = base.endsWith('/v1/') ? 'messages' : 'v1/messages';
    const endpoint = `${base}${msgPath}`;
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    // Send both auth styles: gateways like TokenRouter require `Authorization:
    // Bearer`, while others expect `x-api-key`.
    if (key) {
      headers['x-api-key'] = key;
      headers['Authorization'] = `Bearer ${key}`;
    }
    const body = JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const response = await fetch(endpoint, { method: 'POST', headers, body });
    const data = await response.text();
    return { status: response.status, body: data };
  }

  async chat({ url, key, model, messages, systemPrompt, parameters = {}, stream = false, signal, onToken } = {}) {
    const base = norm(url);
    const msgPath = base.endsWith('/v1/') ? 'messages' : 'v1/messages';
    const endpoint = `${base}${msgPath}`;
    const headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (key) { headers['x-api-key'] = key; headers['Authorization'] = `Bearer ${key}`; }
    const body = JSON.stringify({
      model,
      max_tokens: parameters.maxTokens || 1024,
      system: systemPrompt || undefined,
      messages,
      stream: !!stream,
    });
    const res = await fetch(endpoint, { method: 'POST', headers, body, signal });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Provider returned ${res.status}: ${t.slice(0, 300)}`);
    }
    if (!stream) {
      const j = await res.json();
      const content = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const u = j.usage || null;
      return { content, usage: u ? { inputTokens: u.input_tokens ?? null, outputTokens: u.output_tokens ?? null } : null };
    }
    return readAnthropicSSE(res, onToken);
  }
}

export function getProviderAdapter(provider) {
  if (provider.format === 'anthropic') return new AnthropicProviderAdapter(provider);
  if (provider.format === 'gemini') return new GeminiProviderAdapter(provider);
  return new OpenAIProviderAdapter(provider);
}
