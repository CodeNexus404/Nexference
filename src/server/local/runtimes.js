import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
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
// Resolve an executable on PATH without a shell. Windows honours PATHEXT (so
// `ollama` finds ollama.exe) and prefers real executables over .cmd shims;
// POSIX scans each PATH directory for the bare name. Returns the first match
// or null.
function findOnPath(name) {
  const pathVar = process.env.PATH || '';
  const isWin = os.platform() === 'win32';
  const dirs = pathVar.split(isWin ? ';' : ':').filter(Boolean);
  if (isWin) {
    const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
    for (const d of dirs) for (const ext of exts) {
      const p = join(d, `${name}${ext.toLowerCase()}`);
      if (existsSync(p)) return p;
    }
    // Bare-name probe (some tools register as `name.exe` in a PATH directory
    // without the PATHEXT suffix matching).
    for (const d of dirs) {
      const p = join(d, name);
      if (existsSync(p) && /\.(exe|cmd|bat|com)$/i.test(p.split(/[\\/]/).pop() || '')) return p;
    }
  } else {
    for (const d of dirs) if (existsSync(join(d, name))) return join(d, name);
  }
  return null;
}

function getLmStudioCli() {
  // Windows ships `lms.exe` (LM Studio bundles it next to the app); macOS puts
  // `lms` in a few standard CLI locations. `allowCli` gates booting Bionic, so
  // this list is only consulted when the Local Server is already running.
  const cands = [];
  if (process.platform === 'win32') {
    const loc = process.env.LOCALAPPDATA;
    if (loc) {
      cands.push(join(loc, 'Programs', 'LM Studio', 'lms.exe'));
      cands.push(join(loc, 'LM Studio', 'lms.exe'));
    }
    cands.push(join(os.homedir(), '.lmstudio', 'bin', 'lms.exe'));
    const onPath = findOnPath('lms');
    if (onPath) cands.push(onPath);
  } else {
    cands.push(join(os.homedir(), '.lmstudio', 'bin', 'lms'));
    cands.push('/usr/local/bin/lms');
    cands.push('/opt/homebrew/bin/lms');
  }
  for (const c of cands) if (c && existsSync(c)) return c;
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
      // `lms` on Windows may be a `.cmd`/`.bat` shim on PATH — pairing them
      // without a shell throws EINVAL on Windows (CVE-2024-27980 hardening), so
      // only shims need a shell (plain lms.exe launches directly).
      const r = spawnSync(cli, ['ls', '--json'], { timeout: 8000, maxBuffer: 32 * 1024 * 1024, shell: /\.(cmd|bat)$/i.test(cli) });
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
              list.push({ id: pub.replace(/\.gguf$/i, ''), label: pub, sizeBytes: st.size, params: null, quant: null, contextLength: null, vision: false, path: pubPath });
            }
            continue;
          }
          for (const m of readdirSync(pubPath)) {
            const mPath = join(pubPath, m);
            let ms; try { ms = statSync(mPath); } catch { continue; }
            if (ms.isDirectory()) {
              let size = 0;
              try { for (const f of readdirSync(mPath)) { const fp = join(mPath, f); const fs2 = statSync(fp); if (fs2.isFile()) size += fs2.size; } } catch { /* ignore */ }
              list.push({ id: `${pub}/${m}`, label: m, sizeBytes: size, params: null, quant: null, contextLength: null, vision: false, path: mPath });
            } else if (m.toLowerCase().endsWith('.gguf')) {
              list.push({ id: `${pub}/${m.replace(/\.gguf$/i, '')}`, label: m, sizeBytes: ms.size, params: null, quant: null, contextLength: null, vision: false, path: mPath });
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
  // `detected` must mean "this runtime is actually present on the device", NOT
  // "something answered on the port". probeRuntime() sets reachable:true for ANY
  // HTTP response, and these runtimes default to localhost:8000-ish ports that
  // other local services routinely occupy — an unrelated uvicorn app on :8000 was
  // enough to make vLLM report "Detected" on a machine with no vLLM installed.
  //
  // Installed and detected are also different questions: a runtime can be fully
  // installed with zero models downloaded, which is "Installed, nothing to run
  // yet" rather than "Not detected". So require corroboration — the app or
  // binary present, or models found on disk.
  const detected = appInstalled || models.length > 0;
  return {
    id: rt.id, name: rt.name, type: 'local', running: false, detected,
    // portReachable is diagnostic only: it explains why nothing was found when the
    // user DOES have the runtime installed but its local server is stopped.
    portReachable: !!probe.reachable,
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

// Resolve a runtime's headless server binary without launching its GUI.
//
// Auto-start previously shelled out to `open -a <App>` on macOS, which boots the
// desktop application — a visible window the user did not ask for, and on a
// headless/SSH session `open` has no window server to talk to and silently does
// nothing. Both the GUI app and a plain CLI serve the same API, so prefer the
// binary and fall back to `open` only as a last resort.
//
// macOS GUI apps bundle the real CLI at Contents/MacOS/<Name>, and the Ollama /
// LM Studio installers also symlink onto PATH, so check both.
// Launch a headless server and CONFIRM it actually came up.
//
// The previous implementation spawned with `stdio:'ignore'` and a no-op error
// handler, then immediately returned ok:true. That reported success for a process
// that could have died a millisecond later — e.g. `ollama serve` exits at once
// with "bind: address already in use" when something else already owns the port.
// The user sees a success toast, a live "Starting… 0.0s" counter, and then
// nothing ever happens.
//
// So: capture the child's output, watch for an early exit, and confirm the port
// actually answers before reporting success. Never blocks the HTTP response for
// long — this is a bounded ~1.2s check.
// The Windows Ollama GUI executable. The installer places the app under
// %LOCALAPPDATA%\Programs\Ollama; `ollama.exe` in the same folder is the CLI, so
// prefer the GUI entry point to get a taskbar presence, and only fall back to the
// CLI when the GUI build is absent.
function windowsOllamaApp() {
  if (os.platform() !== 'win32') return null;
  const loc = process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local');
  const gui = [
    join(loc, 'Programs', 'Ollama', 'Ollama.exe'),
    join(loc, 'Programs', 'Ollama', 'Ollama', 'Ollama.exe'),
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Ollama', 'Ollama.exe'),
  ];
  for (const p of gui) if (existsSync(p)) return p;
  return windowsRuntimeInstall('ollama') || null;
}

// Confirm a freshly launched app is genuinely serving, rather than reporting
// success for a process that died or never bound. Ollama's /api/tags returning
// its models array is the only trustworthy signal that the runtime is up.
function verifyStarted(label, port, platform) {
  const startedAt = Date.now();
  const probe = () => new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/tags', timeout: 900 }, (res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 2048) body += c; });
      res.on('end', () => resolve(res.statusCode === 200 && /"models"\s*:/.test(body)));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
  return (async () => {
    for (;;) {
      if (await probe()) {
        return { supported: true, ok: true, headless: false, platform, port,
          message: `${label} is up and serving on port ${port}.` };
      }
      if (Date.now() - startedAt >= STARTUP_TIMEOUT_MS) {
        return { supported: true, ok: false, platform, port,
          message: `${label} was launched but is not answering on port ${port} after 6s. It may still be starting — try again in a moment.` };
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  })();
}

const STARTUP_TIMEOUT_MS = 6000;

function spawnHeadless(bin, args, { label, port, platform }) {
  let out = '';
  let spawnError = null;
  let exited = null;
  const child = spawn(bin, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const capture = (buf) => { if (buf) out += buf.toString().slice(0, 400); };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.on('error', (e) => { spawnError = e; });
  child.on('exit', (code) => { exited = code; });
  child.unref();
  child.stdout?.unref?.();
  child.stderr?.unref?.();

  const done = (ok, message, extra = {}) => ({
    supported: true, ok, message, platform, headless: true, ...extra,
  });

  // Synchronous best-effort wait. The event loop cannot advance while this
  // blocks, so child events cannot fire during it — hence also probing the port
  // directly, which is the real signal we care about.
    // A bare TCP connect is NOT proof Ollama started: any other process holding
    // the port (a dev server, a leftover squatter) satisfies net.connect(), and a
    // start that failed for exactly that reason was reported as success. Hit
    // Ollama's own API and require its characteristic JSON shape instead.
    const runtimeUp = (probePath) => new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: probePath, timeout: 900 }, (res) => {
        let body = '';
        res.on('data', (c) => { if (body.length < 2048) body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    const isOllamaUp = async () => {
      const r = await runtimeUp('/api/tags');
      return !!(r && r.status === 200 && /"models"\s*:/.test(r.body));
    };

  // Fire the port check and return; the HTTP route resolves this promise.
  const startedAt = Date.now();
  const poll = async () => {
    for (;;) {
      if (await isOllamaUp()) return true;
      if (Date.now() - startedAt >= STARTUP_TIMEOUT_MS) return false;
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  return poll().then((up) => {
    if (up) return done(true, `${label} is up and serving on port ${port}.`, { port });
    if (spawnError) return done(false, `Could not launch ${label}: ${spawnError.message}`);
    if (exited !== null) {
      const why = out.trim().split('\n').filter(Boolean).slice(-1)[0] || `exit code ${exited}`;
      return done(false, `${label} exited immediately — ${why}`);
    }
    return done(true, `${label} start requested; it may still be initialising.`, { starting: true });
  });
}

function headlessBinary(id) {
  if (process.platform === 'win32') return windowsRuntimeInstall(id) || findOnPath(id);
  if (process.platform === 'darwin') {
    const onPath = findOnPath(id === 'lmstudio' ? 'lms' : 'ollama');
    if (onPath) return onPath;
    const app = findDarwinApp(id);
    if (app) {
      const p = join('/Applications', `${app}.app`, 'Contents', 'MacOS', app === 'Bionic' ? 'lmstudio' : 'ollama');
      if (existsSync(p)) return p;
      const home = join(os.homedir(), 'Applications', `${app}.app`, 'Contents', 'MacOS', 'ollama');
      if (existsSync(home)) return home;
    }
  }
  return findOnPath(id === 'lmstudio' ? 'lms' : 'ollama');
}

// Returns the installed app name (e.g. "Bionic") or null if not found.
function findDarwinApp(id) {
  const cands = DARWIN_APP_CANDIDATES[id];
  if (!cands) return null;
  const bases = ['/Applications', join(os.homedir(), 'Applications')].filter(Boolean);
  for (const name of cands) {
    for (const base of bases) {
      if (existsSync(join(base, `${name}.app`))) return name;
    }
  }
  return null;
}

// Whether the runtime's desktop app / executable is installed on this device.
// Windows installers drop real executables in LocalAppData (Ollama → ollama.exe,
// LM Studio → LM Studio.exe + lms.exe); both are also commonly on PATH.
function windowsRuntimeInstall(id) {
  const loc = process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local');
  const candidates = [];
  if (id === 'ollama') {
    candidates.push(
      join(loc, 'Programs', 'Ollama', 'ollama.exe'),
      join(loc, 'Ollama', 'ollama.exe'),
      join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Ollama', 'ollama.exe'),
      findOnPath('ollama'),
    );
  } else if (id === 'lmstudio') {
    candidates.push(
      join(loc, 'Programs', 'LM Studio', 'LM Studio.exe'),
      join(loc, 'Programs', 'LM Studio', 'LM Studio', 'LM Studio.exe'),
      join(loc, 'LM Studio', 'LM Studio.exe'),
      getLmStudioCli(),
      findOnPath('lms'),
    );
  } else {
    return null;
  }
  return candidates.filter(Boolean).some((c) => existsSync(c));
}

// Whether the runtime's desktop app is installed on this device. true/false on
// macOS and Windows (so the UI can withhold the Start button until installed),
// plus the ollama CLI on POSIX/Linux; null when detection is not applicable.
export function isAppInstalled(id) {
  const platform = os.platform();
  if (platform === 'darwin') {
    const cands = DARWIN_APP_CANDIDATES[id];
    if (!cands) return null;
    if (findDarwinApp(id) != null) return true;
    // A headless / CLI-only install leaves no .app bundle but still works:
    // LM Studio keeps `lms` under ~/.lmstudio/bin, and Ollama symlinks onto
    // PATH. Without this, a correct install was reported as "Not detected".
    if (id === 'lmstudio' && (getLmStudioCli() || existsSync(join(os.homedir(), '.lmstudio')))) return true;
    if (id === 'ollama' && findOnPath('ollama')) return true;
    return false;
  }
  if (platform === 'win32') return windowsRuntimeInstall(id);
  if (platform === 'linux') {
    if (id === 'ollama') return findOnPath('ollama') != null;
    if (id === 'lmstudio') return !!(getLmStudioCli() || existsSync(join(os.homedir(), '.lmstudio')));
  }
  return null;
}

export async function startRuntime(id) {
  const rt = getRuntime(id);
  if (!rt) return { supported: false, ok: false, message: `Unknown runtime: ${id}` };
  if (!rt.supportsStart) {
    return { supported: false, ok: false, message: `${rt.name} auto-start is not implemented. Start it manually via its application.` };
  }
  const platform = os.platform();
  try {
    if (id === 'ollama') {
      // Run `ollama serve` directly on every platform. The macOS branch used to
      // spawn `open -a Ollama`, which boots the desktop app and shows a window the
      // user did not ask for — and on a headless/SSH login `open` has no window
      // server to talk to, so it silently did nothing. The bundled binary serves
      // the identical API with no UI.
      // Launch the real Ollama APPLICATION, not the bare CLI.
      //
      // `ollama serve` runs fine but is completely invisible: no Dock icon, no
      // menu-bar entry, nothing to see or quit. The ask is for the local runtime
      // to actually appear, so start the app bundle / executable — which also
      // supervises its own server on :11434 — and confirm below that it really
      // came up rather than assuming the spawn worked.
      let launchedApp = null;
      if (platform === 'darwin' && findDarwinApp('ollama')) {
        spawn('open', ['-a', 'Ollama'], { detached: true, stdio: 'ignore' }).unref();
        launchedApp = 'Ollama';
      } else if (platform === 'win32') {
        const app = windowsOllamaApp();
        if (app) {
          // Only a .cmd/.bat shim needs a shell (spawning one without a shell
          // throws EINVAL on modern Windows). windowsHide stays false so the app
          // appears in the taskbar instead of starting invisibly.
          const isShim = /\.(cmd|bat)$/i.test(app);
          spawn(app, [], { detached: true, stdio: 'ignore', windowsHide: false, shell: isShim }).unref();
          launchedApp = 'Ollama';
        }
      }
      if (launchedApp) return verifyStarted(launchedApp, 11434, platform);

      // No desktop app available (Linux, or an unusual install): fall back to the
      // CLI so the feature still works, just without a window.
      const bin = headlessBinary('ollama');
      if (!bin) {
        return { supported: true, ok: false, message: 'Ollama is not installed — download it from https://ollama.com/download', platform };
      }
      return spawnHeadless(bin, ['serve'], { label: 'Ollama server', port: 11434, platform });
    }
    if (id === 'lmstudio') {
      // `lms server start` launches the OpenAI-compatible Local Server headlessly —
      // no GUI window. Preferred over opening the app, which would show a window and
      // still require a manual toggle before any model is served.
      const lms = getLmStudioCli();
      if (lms) {
        try {
          // On Windows `lms` may be a .cmd shim — only those need a shell; a real
          // .exe launches directly. windowsHide keeps a console from flashing.
          const needsShell = platform === 'win32' && /\.(cmd|bat)$/i.test(lms);
          spawn(lms, ['server', 'start'], {
            detached: true, stdio: 'ignore', windowsHide: true, shell: needsShell,
          }).unref();
          return {
            supported: true, ok: true, headless: true,
            message: 'Starting LM Studio Local Server in the background…', platform, app: 'lms',
          };
        } catch { /* fall through to the no-CLI message */ }
      }
      // No usable CLI. LM Studio's GUI cannot start its own Local Server without a
      // manual toggle, so opening the app would show a window and STILL serve
      // nothing. Report that honestly instead of appearing to succeed.
      if (platform === 'darwin') {
        const app = findDarwinApp('lmstudio');
        if (!app) {
          return { supported: true, ok: false, message: 'LM Studio (Bionic) is not installed in /Applications — install it from https://lmstudio.ai', platform };
        }
        return {
          supported: true, ok: false,
          message: 'The lms CLI was not found. Open LM Studio → Developer → Local Server and start it there.',
          platform, app,
        };
      }
      if (platform === 'win32') {
        const installed = windowsRuntimeInstall('lmstudio');
        return {
          supported: true, ok: false,
          message: installed
            ? 'LM Studio is installed but its lms CLI was not found — open the app and enable its Local Server to run models.'
            : 'LM Studio is not installed — install it from https://lmstudio.ai to enable auto-start.',
          platform,
        };
      }
      return { supported: true, ok: false, message: `Auto-start for ${rt.name} is not available on this platform (${platform}).`, platform };
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
