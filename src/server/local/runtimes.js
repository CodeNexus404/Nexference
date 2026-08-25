import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
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

// ── LM Studio model discovery (from the device) ──────────────────────
// Two sources, in priority order:
//   1. The `lms ls --json` CLI — richest data (exact Local-Server model ids,
//      real on-disk size, params, quantisation, context length). BUT invoking
//      `lms` BOOTS the LM Studio backend (packaged as "Bionic" on macOS) as a
//      side effect, so it must never run during passive detection. It is only
//      used when the Local Server is ALREADY running (see `allowCli`).
//   2. A pure filesystem scan of ~/.lmstudio/models — non-invasive, never
//      launches the app; used for passive detection and as the CLI fallback.
function getLmStudioCli() {
  const cands = [
    join(os.homedir(), '.lmstudio', 'bin', 'lms'),
    '/usr/local/bin/lms',
    '/opt/homebrew/bin/lms',
  ];
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

let _lmCache = { ts: 0, list: null, allowCli: false };
// `allowCli` gates the `lms` CLI, which launches LM Studio (Bionic). When false
// (passive detection) only the non-invasive filesystem scan runs, so the app is
// never started as a side effect of discovery.
export function getLmStudioModelList({ allowCli = false } = {}) {
  const now = Date.now();
  if (_lmCache.list && _lmCache.allowCli === allowCli && now - _lmCache.ts < 4000) return _lmCache.list;
  const list = [];
  const cli = allowCli ? getLmStudioCli() : null;
  if (cli) {
    try {
      const r = spawnSync(cli, ['ls', '--json'], { timeout: 8000, maxBuffer: 32 * 1024 * 1024 });
      if (r.status === 0 && r.stdout) {
        const parsed = JSON.parse(r.stdout.toString());
        if (Array.isArray(parsed)) {
          for (const m of parsed) {
            // Skip LM Studio's auto-bundled embedding model — it isn't a chat
            // model the user installed and doesn't belong in the Playground list.
            if (m.type === 'embedding') continue;
            list.push({
              id: m.modelKey,
              label: m.displayName || m.modelKey,
              sizeBytes: m.sizeBytes || 0,
              params: m.paramsString || null,
              quant: m.quantization?.name || null,
              contextLength: m.maxContextLength || null,
              vision: !!m.vision,
              path: m.path || null,
            });
          }
        }
      }
    } catch { /* fall through to disk scan */ }
  }
  if (!list.length) {
    const root = (() => {
      try {
        const sp = join(os.homedir(), '.lmstudio', 'apps', 'bionic', 'settings.json');
        if (existsSync(sp)) {
          const s = JSON.parse(readFileSync(sp, 'utf8'));
          if (s && typeof s.downloadsFolder === 'string' && s.downloadsFolder) return s.downloadsFolder;
        }
      } catch { /* ignore */ }
      return join(os.homedir(), '.lmstudio', 'models');
    })();
    try {
      if (existsSync(root)) {
        for (const pub of readdirSync(root)) {
          const pubPath = join(root, pub);
          let st; try { st = statSync(pubPath); } catch { continue; }
          if (!st.isDirectory()) {
            if (pub.toLowerCase().endsWith('.gguf')) {
              list.push({ id: pub.replace(/\.gguf$/i, ''), label: pub, sizeBytes: st.size, params: null, quant: null, contextLength: null, vision: false, path: pub });
            }
            continue;
          }
          for (const m of readdirSync(pubPath)) {
            const mPath = join(pubPath, m);
            let ms; try { ms = statSync(mPath); } catch { continue; }
            if (ms.isDirectory()) {
              let size = 0;
              try { for (const f of readdirSync(mPath)) { const fp = join(mPath, f); const fs2 = statSync(fp); if (fs2.isFile()) size += fs2.size; } } catch { /* ignore */ }
              list.push({ id: `${pub}/${m}`, label: m, sizeBytes: size, params: null, quant: null, contextLength: null, vision: false, path: `${pub}/${m}` });
            } else if (m.toLowerCase().endsWith('.gguf')) {
              list.push({ id: `${pub}/${m.replace(/\.gguf$/i, '')}`, label: m, sizeBytes: ms.size, params: null, quant: null, contextLength: null, vision: false, path: `${pub}/${m}` });
            }
          }
        }
      }
    } catch { /* ignore — no models discoverable */ }
  }
  _lmCache = { ts: now, list, allowCli };
  return list;
}

// id → detail map, used by validation for real compatibility scoring.
export function getLmStudioModelDetails() {
  const map = {};
  for (const m of getLmStudioModelList()) map[m.id] = m;
  return map;
}

// Installed models discoverable on this device for a runtime.
function getInstalledModels(id) {
  if (id === 'lmstudio') return getLmStudioModelList().map((m) => m.id);
  return [];
}

// Detect any OpenAI-compatible local server (LM Studio, vLLM, SGLang, llama.cpp).
// Honest: reports running:true only when the server actually answers /models.
// When it is offline we still surface models installed on the device (so the
// Playground can list them) and flag that the server must be started to run them.
async function detectOpenAICompat(rt) {
  const cfg = getRuntimeExec(rt.id);
  const probe = await probeRuntime(rt.id);
  // Only allow the `lms` CLI (which launches Bionic) when the Local Server is
  // already running — otherwise passive detection would boot the app. Offline,
  // we fall back to a pure filesystem scan. See getLmStudioModelList.
  const diskList = rt.id === 'lmstudio' ? getLmStudioModelList({ allowCli: probe.running }) : [];
  const modelDetails = Object.fromEntries(diskList.map((m) => [m.id, m]));
  if (probe.running) {
    // Live /v1/models also advertises LM Studio's bundled embedding model; keep
    // only the models we actually discovered on the device (excludes embeddings).
    const allowed = new Set(diskList.map((m) => m.id));
    const models = (probe.models.length ? probe.models : diskList.map((m) => m.id)).filter((id) => allowed.has(id));
    return {
      id: rt.id, name: rt.name, type: 'local', running: true, detected: true,
      installed: true, models, modelCount: models.length, modelDetails, note: rt.note,
    };
  }
  const models = diskList.map((m) => m.id);
  const appInstalled = isAppInstalled(rt.id) === true;
  return {
    id: rt.id, name: rt.name, type: 'local', running: false, detected: probe.reachable,
    installed: appInstalled || models.length > 0,
    models, modelCount: models.length, modelDetails,
    needsServer: appInstalled || models.length > 0,
    note: appInstalled
      ? (models.length
          ? `${models.length} model(s) installed locally — start ${rt.name}'s Local Server to run them`
          : `Installed — download a model or start ${rt.name}'s Local Server`)
      : `Not detected — install ${rt.name} and load a model`,
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
    if (id === 'lmstudio') {
      // Prefer the real server launcher so the OpenAI-compatible Local Server
      // actually comes up (opening the app alone does not start it).
      const lms = getLmStudioCli();
      if (lms) {
        try {
          spawn(lms, ['server', 'start'], { detached: true, stdio: 'ignore' }).unref();
          return { supported: true, ok: true, message: 'Starting LM Studio Local Server (lms)…', platform, app: 'lms' };
        } catch { /* fall through to opening the app */ }
      }
      if (platform === 'darwin') {
        const app = findDarwinApp('lmstudio');
        if (!app) return { supported: true, ok: false, message: 'LM Studio (Bionic) is not installed in /Applications. Install it to enable auto-start.' };
        spawn('open', ['-a', app], { detached: true, stdio: 'ignore' }).unref();
        return { supported: true, ok: true, message: `Starting ${app}…`, platform, app };
      }
      return { supported: true, ok: false, message: `Auto-start for ${rt.name} is not available on this platform (${platform}).` };
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
