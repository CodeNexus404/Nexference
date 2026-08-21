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

async function probeGpu(platform) {
  // Honest best-effort. Only attempt a light, time-boxed Linux nvidia probe;
  // anything else is reported as unknown rather than invented.
  if (platform !== 'linux') {
    return { available: null, name: null, vram: null, note: 'GPU auto-detection is platform-limited; memory-based estimates are used.' };
  }
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
