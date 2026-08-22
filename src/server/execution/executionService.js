// ═══════════════════════════════════════════════════════════════
//  Execution Service (v0.9.0)
//
//  Orchestrates an execution end-to-end: validate -> create -> stream
//  events -> measure -> persist history. Secrets (API keys) are NEVER
//  stored in records or history. Streaming is delivered over SSE; a
//  per-execution EventEmitter buffers events so late SSE subscribers
//  still receive the full transcript.
// ═══════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { computeMetrics } from './executionMetrics.js';
import { validateExecution } from './executionValidation.js';
import { runExecutionAdapter } from './executionAdapter.js';
import { getExecutionCapabilities } from './executionRegistry.js';

const HISTORY_DIR = join(homedir(), '.nexference');
const HISTORY_PATH = join(HISTORY_DIR, 'executions.json');
const MAX_HISTORY = 100;

const executions = new Map();
let history = loadHistory();

function loadHistory() {
  try { return JSON.parse(readFileSync(HISTORY_PATH, 'utf8')) || []; } catch { return []; }
}
function saveHistory() {
  try { mkdirSync(HISTORY_DIR, { recursive: true }); writeFileSync(HISTORY_PATH, JSON.stringify(history.slice(0, MAX_HISTORY), null, 2)); } catch { /* best effort */ }
}

export function getCapabilities() { return getExecutionCapabilities(); }

function maskSecrets(text = '') {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9\-_.]+/g, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9]+/gi, 'sk-***')
    .replace(/x-api-key["'\s:]+[A-Za-z0-9\-_.]+/gi, 'x-api-key: ***');
}

function normalizeMessages(req) {
  if (Array.isArray(req.messages) && req.messages.length) return req.messages;
  if (req.prompt) return [{ role: 'user', content: req.prompt }];
  return [];
}

function makeRecord(id, req) {
  const messages = normalizeMessages(req);
  const preview = (req.prompt || messages.filter((m) => m.role === 'user').pop()?.content || '').slice(0, 200);
  return {
    id,
    source: req.source,
    providerId: req.providerId || null,
    runtimeId: req.runtimeId || null,
    model: req.model || null,
    systemPrompt: req.systemPrompt || null,
    parameters: req.parameters || null,
    createdAt: new Date().toISOString(),
    status: 'queued',
    success: false,
    content: '',
    usage: null,
    metrics: null,
    error: null,
    sourceStatus: null,
    promptPreview: preview,
  };
}

function emit(rec, event) {
  rec.buffered.push(event);
  if (rec.buffered.length > 5000) rec.buffered.shift();
  rec.emitter.emit('event', event);
}

// ── Sequential runner: guarantees compare requests don't fire all at once ──
const runQueue = [];
let pumping = false;
function enqueue(id, req) { runQueue.push({ id, req }); pump(); }
async function pump() {
  if (pumping) return;
  pumping = true;
  while (runQueue.length) {
    const { id, req } = runQueue.shift();
    try { await startRun(id, req); } catch { /* never break the queue */ }
  }
  pumping = false;
}

async function startRun(id, req) {
  const rec = executions.get(id);
  if (!rec) return;
  rec.controller = new AbortController();
  const signal = rec.controller.signal;
  const startTime = Date.now();
  let firstTokenAt = null;
  const timeoutMs = req.execTimeoutMs || 180_000;
  const timeout = setTimeout(() => { rec.aborted = true; rec.timeout = true; rec.controller && rec.controller.abort(); }, timeoutMs);
  rec.record.status = 'running';
  emit(rec, { type: 'start', executionId: id, data: { model: req.model, source: req.source, providerId: req.providerId, runtimeId: req.runtimeId } });
  try {
    const result = await runExecutionAdapter(req, {
      signal,
      onToken: (delta) => {
        if (!firstTokenAt) firstTokenAt = Date.now();
        rec.record.content += delta;
        emit(rec, { type: 'token', executionId: id, data: { delta } });
      },
    });
    const endTime = Date.now();
    const metrics = computeMetrics({
      startTime,
      firstTokenAt,
      endTime,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      providerReportedLatencyMs: result.usage?.latencyMs ?? null,
    });
    rec.record.content = result.content;
    rec.record.usage = result.usage;
    rec.record.metrics = metrics;
    rec.record.status = 'complete';
    rec.record.success = true;
    rec.record.sourceStatus = 'ok';
    emit(rec, { type: 'complete', executionId: id, data: { content: result.content, usage: result.usage, metrics } });
  } catch (err) {
    const aborted = rec.aborted || signal.aborted;
    rec.record.status = aborted ? (rec.timeout ? 'error' : 'cancelled') : 'error';
    rec.record.success = false;
    rec.record.error = maskSecrets(aborted ? (rec.timeout ? 'Execution timed out.' : 'Execution cancelled.') : (err?.message || 'Execution failed.'));
    emit(rec, { type: 'error', executionId: id, data: { message: rec.record.error, cancelled: !!aborted && !rec.timeout } });
  } finally {
    clearTimeout(timeout);
    rec.done = true;
    finalize(rec, req);
  }
}

function finalize(rec, req) {
  const r = rec.record;
  const summary = {
    id: r.id,
    createdAt: r.createdAt,
    source: r.source,
    providerId: r.providerId,
    runtimeId: r.runtimeId,
    model: r.model,
    status: r.status,
    success: r.success,
    durationMs: r.metrics?.totalDurationMs ?? null,
    metrics: r.metrics,
    usage: r.usage,
    error: r.error ? maskSecrets(r.error) : null,
    promptPreview: r.promptPreview,
    contentPreview: (r.content || '').slice(0, 400),
    parameters: r.parameters,
    systemPrompt: r.systemPrompt,
  };
  history.unshift(summary);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  saveHistory();
}

export async function createExecution(req) {
  const validation = await validateExecution(req);
  if (!validation.executable) return { executable: false, validation };
  const id = randomUUID();
  const rec = { id, emitter: new EventEmitter(), buffered: [], done: false, aborted: false, controller: null, record: makeRecord(id, req) };
  executions.set(id, rec);
  enqueue(id, req);
  return { executable: true, executionId: id, status: 'queued', validation };
}

export async function compareExecutions(req) {
  const { prompt, systemPrompt, modelRefs = [], parameters = {}, key, stream = false } = req;
  const out = [];
  for (const ref of modelRefs) {
    const single = {
      source: ref.source, providerId: ref.providerId, runtimeId: ref.runtimeId, model: ref.model,
      systemPrompt, prompt, messages: prompt ? [{ role: 'user', content: prompt }] : [],
      parameters, key, stream,
    };
    const validation = await validateExecution(single);
    if (!validation.executable) { out.push({ ref, validation, executionId: null }); continue; }
    const id = randomUUID();
    executions.set(id, { id, emitter: new EventEmitter(), buffered: [], done: false, aborted: false, controller: null, record: makeRecord(id, single) });
    out.push({ ref, validation, executionId: id });
    enqueue(id, single);
  }
  return { executions: out };
}

// Run a fixed, honest benchmark against a local model: generate a substantial
// reply and measure real throughput. Reuses the same adapter + metrics as a
// normal execution, so numbers are never fabricated.
const DEFAULT_BENCH_PROMPT = 'Explain how a transformer language model works. Cover self-attention, positional encoding, feed-forward layers, and the training objective. Be thorough and precise.';

export async function benchmarkRuntime(req = {}) {
  const {
    runtimeId, model,
    prompt = DEFAULT_BENCH_PROMPT,
    parameters = { temperature: 0.7, maxTokens: 320, topP: 1 },
  } = req;
  if (!runtimeId || !model) return { ok: false, error: 'runtimeId and model are required' };
  const validation = await validateExecution({ source: 'local', runtimeId, model, stream: false });
  if (!validation.executable) return { ok: false, validation };
  const startTime = Date.now();
  let firstTokenAt = null;
  try {
    const result = await runExecutionAdapter(
      {
        source: 'local', runtimeId, model,
        systemPrompt: '', prompt,
        messages: [{ role: 'user', content: prompt }],
        parameters, stream: false,
      },
      { signal: undefined, onToken: () => { if (!firstTokenAt) firstTokenAt = Date.now(); } }
    );
    const endTime = Date.now();
    const metrics = computeMetrics({
      startTime, firstTokenAt, endTime,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      providerReportedLatencyMs: result.usage?.latencyMs ?? null,
    });
    return { ok: true, runtimeId, model, metrics, usage: result.usage };
  } catch (err) {
    return { ok: false, error: maskSecrets(err?.message || 'Benchmark failed') };
  }
}

export function getExecution(id) {
  const rec = executions.get(id);
  if (rec) return sanitize(rec.record);
  const h = history.find((x) => x.id === id);
  return h || null;
}

export function listExecutions() {
  return history.map((h) => ({ ...h, content: undefined }));
}

export function streamExecution(id, req, res) {
  const rec = executions.get(id);
  if (!rec) { res.status(404).json({ error: 'Unknown execution' }); return; }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  const send = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* ignore */ } };
  for (const ev of rec.buffered) send(ev);
  const handler = (ev) => send(ev);
  rec.emitter.on('event', handler);
  const cleanup = () => { rec.emitter.removeListener('event', handler); try { res.end(); } catch { /* ignore */ } };
  req.on('close', cleanup);
  if (rec.done) cleanup();
}

export function cancelExecution(id) {
  const rec = executions.get(id);
  if (!rec) return { ok: false };
  rec.aborted = true;
  rec.controller && rec.controller.abort();
  return { ok: true };
}

function sanitize(record) {
  // Nothing secret is ever stored; return a clean copy.
  return { ...record };
}
