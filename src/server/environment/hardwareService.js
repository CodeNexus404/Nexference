import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

// ═══════════════════════════════════════════════════
//  Hardware Capability Service (v0.7.0) — produces a normalized, honest
//  hardware profile plus conservative recommendations. We never fake GPU/VRAM
//  data: when a probe is unavailable the field is null and recommendations are
//  explicitly flagged as memory-based estimates.
// ═══════════════════════════════════════════════════

// Static hardware facts (GPU, OS name) rarely change, so cache the (slow)
// probes for a minute — the Local AI page polls every few seconds and we
// don't want to spawn system_profiler / WMI on every tick.
let _gpuCache = { key: null, ts: 0, val: null };
let _sysCache = { key: null, ts: 0, val: null };
const STATIC_TTL = 60_000;

// Worker: actually probe the GPU for a given platform. Honest best-effort —
// we only report what a probe can confirm; otherwise the field is null.
async function probeGpuNow(platform) {
  if (platform === 'linux') {
    try {
      const { stdout } = await execFileP('nvidia-smi', ['-L'], { timeout: 1500 });
      const name = stdout.split('\n')[0]?.replace(/^GPU 0: /, '').trim() || null;
      let vram = null;
      try {
        const mem = await execFileP('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { timeout: 1500 });
        const mb = parseInt(mem.stdout.trim().split('\n')[0], 10);
        if (!Number.isNaN(mb)) vram = +(mb / 1024).toFixed(1);
      } catch { /* ignore */ }
      return { available: !!name, name, vram, note: name ? 'Detected via nvidia-smi.' : 'No NVIDIA GPU detected.' };
    } catch {
      return { available: false, name: null, vram: null, note: 'No NVIDIA GPU detected (nvidia-smi unavailable).' };
    }
  }
  if (platform === 'darwin') {
    try {
      const { stdout } = await execFileP('system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 2000 });
      const displays = JSON.parse(stdout)?.SPDisplaysDataType || [];
      const model = displays.map((d) => d.sppci_model).find(Boolean) || null;
      const vram = displays[0]?.spdisplays_vram ? String(displays[0].spdisplays_vram) : null;
      return { available: !!model, name: model, vram, note: model ? 'Apple Silicon / integrated GPU (unified memory).' : 'No GPU reported.' };
    } catch {
      return { available: null, name: null, vram: null, note: 'GPU auto-detection unavailable on this platform.' };
    }
  }
  if (platform === 'win32') {
    try {
      const { stdout } = await execFileP('powershell', ['-NoProfile', '-Command',
        'Get-CimInstance Win32_VideoController | ForEach-Object { ($_.Name + \'|\' + $_.AdapterRAM) }'], { timeout: 3000 });
      let best = null, bestVram = -1;
      for (const ln of stdout.split('\n')) {
        const [n, r] = ln.trim().split('|');
        const ram = parseInt(r, 10);
        const vramGB = Number.isFinite(ram) && ram > 0 ? +(ram / 1073741824).toFixed(1) : null;
        if (n && (!best || (vramGB != null && vramGB > bestVram))) { best = n.trim(); bestVram = vramGB ?? -1; }
      }
      if (best) return { available: true, name: best, vram: bestVram < 0 ? null : bestVram, note: 'Detected via Windows Display Adapter.' };
      return { available: false, name: null, vram: null, note: 'No GPU reported via Windows Display Adapter.' };
    } catch {
      return { available: null, name: null, vram: null, note: 'GPU auto-detection unavailable on this platform.' };
    }
  }
  return { available: null, name: null, vram: null, note: 'GPU auto-detection is platform-limited; memory-based estimates are used.' };
}

export async function probeGpu(platform) {
  const now = Date.now();
  if (_gpuCache.key === platform && _gpuCache.val && now - _gpuCache.ts < STATIC_TTL) return _gpuCache.val;
  const val = await probeGpuNow(platform);
  _gpuCache = { key: platform, ts: now, val };
  return val;
}

// Worker: resolve a human-friendly OS name/version per platform.
async function getSystemVersionNow(platform) {
  try {
    if (platform === 'darwin') {
      const name = (await execFileP('sw_vers', ['-productName'], { timeout: 1500 })).stdout.trim();
      const ver = (await execFileP('sw_vers', ['-productVersion'], { timeout: 1500 })).stdout.trim();
      const out = `${name} ${ver}`.trim();
      if (out && out !== ' ') return out;
    } else if (platform === 'linux') {
      try {
        const { stdout } = await execFileP('sh', ['-c', "cat /etc/os-release 2>/dev/null | awk -F= '/^PRETTY_NAME/{print $2}' | tr -d '\"'"], { timeout: 1500 });
        const pretty = stdout.trim();
        if (pretty) return pretty;
      } catch { /* fall through */ }
      return `Linux ${os.release()}`;
    } else if (platform === 'win32') {
      try {
        const { stdout } = await execFileP('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).Caption'], { timeout: 3000 });
        const cap = stdout.trim();
        if (cap) return cap;
      } catch {
        try {
          const { stdout } = await execFileP('wmic', ['os', 'get', 'Caption', '/value'], { timeout: 3000 });
          const m = stdout.match(/Caption=(.+)/i);
          if (m && m[1].trim()) return m[1].trim();
        } catch { /* fall through */ }
      }
    }
  } catch { /* fall through */ }
  return `${platform} ${os.release()}`;
}

export async function getSystemVersion(platform) {
  const now = Date.now();
  if (_sysCache.key === platform && _sysCache.val && now - _sysCache.ts < STATIC_TTL) return _sysCache.val;
  const val = await getSystemVersionNow(platform);
  _sysCache = { key: platform, ts: now, val };
  return val;
}

export function getHardwareProfile() {
  const cpus = os.cpus() || [];
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const GB = 1073741824;
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpu: { model: cpus.length ? cpus[0].model : null, cores: cpus.length },
    memory: {
      totalBytes,
      freeBytes,
      totalGB: +(totalBytes / GB).toFixed(1),
      freeGB: +(freeBytes / GB).toFixed(1),
    },
    gpu: { available: null, name: null, vram: null, note: 'GPU auto-detection is platform-limited; memory-based estimates are used.' },
    detectedAt: new Date().toISOString(),
  };
}

// Async variant that attempts the (optional) GPU probe; safe to await.
export async function getHardwareProfileDetailed() {
  const base = getHardwareProfile();
  base.gpu = await probeGpu(base.platform);
  return base;
}

export function getHardwareCapabilities(profile = getHardwareProfile()) {
  const ramGB = profile.memory?.totalGB || 0;
  let ramTier = 'low';
  if (ramGB >= 32) ramTier = 'high';
  else if (ramGB >= 16) ramTier = 'good';
  else if (ramGB >= 8) ramTier = 'moderate';
  else ramTier = 'low';

  const gpu = profile.gpu || {};
  let gpuTier = 'unknown';
  if (gpu.available) gpuTier = (gpu.vram && gpu.vram >= 12) ? 'high' : 'moderate';

  let suggestedModelSizes = [];
  if (ramTier === 'high') suggestedModelSizes = ['70B+ (if VRAM permits)', '34B', '13B', '7B', '3B'];
  else if (ramTier === 'good') suggestedModelSizes = ['34B (may need reduced context)', '13B', '7B', '3B'];
  else if (ramTier === 'moderate') suggestedModelSizes = ['7B (quantized)', '3B', '1.5B'];
  else suggestedModelSizes = ['3B or smaller', '1.5B', '0.5B'];

  const warnings = [];
  const recommendations = [];
  if (ramTier === 'low') warnings.push('Available memory is low — only very small local models are likely to run.');
  if (gpuTier === 'unknown') warnings.push('GPU could not be auto-detected; recommendations are based on system memory only (estimates).');

  const tierWords = {
    high: 'Likely suitable for large local models',
    good: 'Good for mid-size local models',
    moderate: 'Possible with quantized/smaller models and reduced context',
    low: 'Not recommended for larger local models',
  };
  recommendations.push(`Memory tier: ${ramTier}. ${tierWords[ramTier]}.`);
  if (gpuTier === 'high') recommendations.push('A capable GPU was detected — larger models may run with adequate VRAM.');
  recommendations.push('Recommendations are conservative estimates; precise per-model requirements vary by architecture and quantisation.');

  return { ramTier, gpuTier, suggestedModelSizes, warnings, recommendations, estimate: true };
}

// ── Real-time device info (v0.8.0) — a live, re-probable snapshot of the host. ──
let prevCpu = null;

function cpuTicks(cpus) {
  let idle = 0, total = 0;
  for (const c of cpus) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

// CPU busy % since the previous call (null on the very first call).
function getCpuUsage() {
  const cpus = os.cpus() || [];
  const cur = cpuTicks(cpus);
  let usage = null;
  if (prevCpu && prevCpu.total) {
    const idleDelta = cur.idle - prevCpu.idle;
    const totalDelta = cur.total - prevCpu.total;
    if (totalDelta > 0) usage = +(100 * (1 - idleDelta / totalDelta)).toFixed(1);
  }
  prevCpu = cur;
  return usage;
}

export async function getDeviceInfo() {
  const platform = os.platform();
  const GB = 1073741824;
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const cpus = os.cpus() || [];
  return {
    hostname: os.hostname(),
    platform,
    arch: os.arch(),
    release: os.release(),
    system: await getSystemVersion(platform),
    uptimeSec: Math.floor(os.uptime()),
    cpu: {
      model: cpus.length ? cpus[0].model : null,
      cores: cpus.length,
      usagePct: getCpuUsage(),
      loadavg: os.loadavg().map((n) => +n.toFixed(2)),
    },
    memory: {
      totalGB: +(totalBytes / GB).toFixed(1),
      freeGB: +(freeBytes / GB).toFixed(1),
      usedGB: +(usedBytes / GB).toFixed(1),
      usedPct: +((usedBytes / totalBytes) * 100).toFixed(1),
    },
    gpu: await probeGpu(platform),
    process: {
      node: process.version,
      pid: process.pid,
      rssMB: +(process.memoryUsage().rss / 1048576).toFixed(1),
      uptimeSec: Math.floor(process.uptime()),
    },
    detectedAt: new Date().toISOString(),
  };
}
