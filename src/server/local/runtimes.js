import os from 'os';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { norm } from '../utils/index.js';
import { getRuntimeExec, probeRuntime } from '../execution/executionRegistry.js';

// ═══════════════════════════════════════════════════════════════
//  Local AI runtime adapters — the server-side view of local model
//  runtimes (Ollama, LM Studio, llama.cpp, vLLM, …).
//
//  Nexference v0.2.0 treats cloud providers and local runtimes as
//  distinct concepts. Cloud providers live in providers/registry.js;
//  local runtimes live here. Only Ollama has a real, non-faked
//  adapter (detect + status + models). Every other runtime is
//  reported honestly as "planned" so the UI never pretends to
//  support an operation it cannot perform.
// ═══════════════════════════════════════════════════════════════

// Static catalogue of runtimes Nexference knows about. `planned: true`
// means detection/config support is not implemented yet — the UI shows
// it as "coming soon" rather than faking functionality.
export const RUNTIMES = [
  {
    id: 'ollama', name: 'Ollama', type: 'local',
    detectionUrl: 'http://localhost:11434/api/tags',
    supportsModels: true, supportsStart: true, supportsStop: false,
    planned: false, site: 'https://ollama.com',
    note: 'Local models served at http://localhost:11434',
  },
  {
    id: 'lmstudio', name: 'LM Studio', type: 'local',
    supportsModels: true, supportsStart: true, supportsStop: false,
    planned: false, site: 'https://lmstudio.ai',
    note: 'OpenAI-compatible local server (http://localhost:1234)',
  },
  {
    id: 'llamacpp', name: 'llama.cpp', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: false, site: 'https://github.com/ggml-org/llama.cpp',
    note: 'OpenAI-compatible local server (http://localhost:8080)',
  },
  {
    id: 'vllm', name: 'vLLM', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: false, site: 'https://vllm.ai',
    note: 'OpenAI-compatible local server (http://localhost:8000)',
  },
  {
    id: 'sglang', name: 'SGLang', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: false, site: 'https://sglang.ai',
    note: 'OpenAI-compatible local server (http://localhost:30000)',
  },
  {
    id: 'koboldcpp', name: 'KoboldCpp', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: true, site: 'https://koboldcpp.com',
    note: 'Configuration support coming soon',
  },
  {
    id: 'jan', name: 'Jan', type: 'local',
    supportsModels: true, supportsStart: false, supportsStop: false,
    planned: true, site: 'https://jan.ai',
    note: 'Configuration support coming soon',
  },
];

export function getRuntime(id) {
  return RUNTIMES.find((r) => r.id === id);
}

// ── Brand logo resolution ──────────────────────────────────────────
// Real logos are sourced from each runtime's official site: GitHub-hosted
// projects use their org avatar; everything else has its favicon scraped
// from the homepage (preferring apple-touch-icon / SVG, else /favicon.ico).
// Results are cached for an hour so the dashboard never re-scrapes on
// every request. If a logo can't be fetched, null is returned and the UI
// falls back to a monogram.
const logoCache = new Map();
const LOGO_TTL = 3600_000;

function registrable(host) {
  return host.split('.').slice(-2).join('.');
}

async function scrapeFavicon(site) {
  try {
    const r = await fetch(site, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Nexference)' },
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const finalUrl = r.url;
    // Re-base a discovered icon onto the site's final (redirected) host so
    // e.g. sglang.ai -> www.sglang.io resolves to the asset that actually exists.
    const norm = (href) => {
      try {
        const u = new URL(href, finalUrl);
        const f = new URL(finalUrl);
        if (u.hostname !== f.hostname && registrable(u.hostname) === registrable(f.hostname)) u.hostname = f.hostname;
        return u.href;
      } catch { return null; }
    };
    let fallback = null;
    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0];
      const rel = (tag.match(/rel=["']([^"']*)["']/i) || [])[1] || '';
      const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
      if (!href) continue;
      const abs = norm(href);
      if (!abs) continue;
      if (/apple-touch-icon/i.test(rel)) return abs;
      if (/\.svg(\?|$)/i.test(abs)) return abs;
      if (/icon/i.test(rel)) fallback = fallback || abs;
    }
    return fallback || norm('/favicon.ico');
  } catch {
    try { return new URL('/favicon.ico', site).href; } catch { return null; }
  }
}

function resolveLogo(runtime) {
  if (runtime.logo) return runtime.logo;
  const site = runtime.site;
  if (!site) return null;
  try {
    const u = new URL(site);
    if (u.hostname === 'github.com') {
      const owner = u.pathname.split('/').filter(Boolean)[0];
      if (owner) return `https://github.com/${owner}.png`;
    }
    return scrapeFavicon(site);
  } catch {
    return null;
  }
}

export async function getRuntimeLogo(id, force = false) {
  const rt = getRuntime(id);
  if (!rt) return null;
  const cached = logoCache.get(id);
  if (!force && cached && Date.now() - cached.ts < LOGO_TTL) return cached.url;
  const url = await resolveLogo(rt);
  logoCache.set(id, { url, ts: Date.now() });
  return url;
}

// Detect a single runtime. Ollama is probed over HTTP; everything else
// is reported as planned. Returns a status object, never throws.
async function detectOllama() {
  const meta = getRuntime('ollama');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const r = await fetch(meta.detectionUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) return { id: 'ollama', name: 'Ollama', type: 'local', running: false, detected: true, models: [], note: `Reachable but returned HTTP ${r.status}` };
    const data = await r.json().catch(() => ({}));
    const models = Array.isArray(data.models) ? data.models.map((m) => m.name).filter(Boolean) : [];
    return { id: 'ollama', name: 'Ollama', type: 'local', running: true, detected: true, models, modelCount: models.length, note: meta.note };
  } catch {
    clearTimeout(timeout);
    return { id: 'ollama', name: 'Ollama', type: 'local', running: false, detected: false, models: [], note: 'Not detected — start Ollama to use local models' };
  }
}

export async function detectRuntimes() {
  const results = [];
  for (const r of RUNTIMES) {
    if (r.id === 'ollama') {
      results.push(await detectOllama());
    } else if (getRuntimeExec(r.id)) {
      results.push(await detectOpenAICompat(r));
    } else {
      results.push({ id: r.id, name: r.name, type: 'local', planned: true, supportsModels: r.supportsModels, note: r.note });
    }
  }
  await Promise.all(results.map(async (rt) => {
    const meta = getRuntime(rt.id);
    rt.site = meta?.site || null;
    rt.logo = await getRuntimeLogo(rt.id);
    rt.supportsStart = !!meta?.supportsStart;
    rt.installed = isAppInstalled(rt.id);
  }));
  return results;
}

// Detect any OpenAI-compatible local server (LM Studio, vLLM, SGLang, llama.cpp).
// Honest: only reports running:true when the server actually answers /models.
async function detectOpenAICompat(rt) {
  const cfg = getRuntimeExec(rt.id);
  const probe = await probeRuntime(rt.id);
  if (!probe.running) {
    return {
      id: rt.id, name: rt.name, type: 'local', running: false,
      detected: probe.reachable, models: [], modelCount: 0,
      note: probe.reachable ? `Reachable but not serving models (${cfg.baseUrl})` : `Not detected — start ${rt.name} and load a model`,
    };
  }
  return {
    id: rt.id, name: rt.name, type: 'local', running: true, detected: true,
    models: probe.models, modelCount: probe.models.length, note: rt.note,
  };
}

// ── Safe, allowlisted runtime startup ─────────────────────────────────
// Starts a local runtime that is offline. Only runtimes with an explicit,
// fixed start command are supported — no arbitrary shell input is ever
// accepted, so this cannot be coerced into unsafe command execution.
//
// On macOS, LM Studio ships under the app name "Bionic" (also "LM Studio").
// We detect which is actually installed and open that specific app, and
// report honestly when neither is present.

// Candidate .app display names to look for, per runtime (macOS only).
const DARWIN_APP_CANDIDATES = {
  ollama: ['Ollama'],
  lmstudio: ['Bionic', 'LM Studio'],
};

// Returns the installed app name (e.g. "Bionic") or null if not found.
function findDarwinApp(id) {
  const cands = DARWIN_APP_CANDIDATES[id];
  if (!cands) return null;
  const bases = ['/Applications', join(process.env.HOME || '', 'Applications')].filter(Boolean);
  for (const name of cands) {
    for (const base of bases) {
      if (existsSync(join(base, `${name}.app`))) return name;
    }
  }
  return null;
}

// Whether the runtime's desktop app is installed on this device (macOS only).
// Returns true/false on darwin, or null when not applicable (e.g. Linux).
export function isAppInstalled(id) {
  if (os.platform() !== 'darwin') return null;
  const cands = DARWIN_APP_CANDIDATES[id];
  if (!cands) return null;
  return findDarwinApp(id) != null;
}

export function startRuntime(id) {
  const rt = getRuntime(id);
  if (!rt) return { supported: false, ok: false, message: `Unknown runtime: ${id}` };
  if (!rt.supportsStart) {
    return { supported: false, ok: false, message: `${rt.name} auto-start is not implemented. Start it manually via its application.` };
  }
  const platform = os.platform();
  try {
    if (id === 'ollama') {
      if (platform === 'darwin') { spawn('open', ['-a', 'Ollama'], { detached: true, stdio: 'ignore' }).unref(); return { supported: true, ok: true, message: 'Starting Ollama…', platform }; }
      if (platform === 'linux') { spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref(); return { supported: true, ok: true, message: 'Starting Ollama server…', platform }; }
      return { supported: true, ok: false, message: `Auto-start for Ollama is not available on this platform (${platform}).` };
    }
    if (id === 'lmstudio' && platform === 'darwin') {
      const app = findDarwinApp('lmstudio');
      if (!app) return { supported: true, ok: false, message: 'LM Studio (Bionic) is not installed in /Applications. Install it to enable auto-start.' };
      spawn('open', ['-a', app], { detached: true, stdio: 'ignore' }).unref();
      return { supported: true, ok: true, message: `Starting ${app}…`, platform, app };
    }
    return { supported: true, ok: false, message: `Auto-start for ${rt.name} is not available on this platform (${platform}).` };
  } catch (err) {
    return { supported: true, ok: false, message: `Failed to start ${rt.name}: ${err.message}` };
  }
}

// Runtime adapter interface — mirrors the conceptual contract from the
// milestone. Only Ollama implements detect/status/models for real.
export class RuntimeAdapter {
  constructor(meta) { this.meta = meta; }
  async detect() { return detectRuntimes(); }
  async getStatus() { return detectRuntimes(); }
  async getModels() {
    const s = await detectOllama();
    return s.models || [];
  }
  async testConnection() {
    const s = await detectOllama();
    return { ok: s.running, running: s.running };
  }
}

export function getRuntimeAdapter(id) {
  const meta = getRuntime(id) || { id, name: id, type: 'local' };
  return new RuntimeAdapter(meta);
}
