import os from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { existsSync, readFileSync, rmSync, realpathSync } from 'fs';
import { getLmStudioModelList, getRuntime } from './runtimes.js';
import { discoverModels } from '../runtimes/modelDiscoveryService.js';
import { getHardwareProfile, probeGpu } from '../environment/hardwareService.js';

// ═══════════════════════════════════════════════════
//  Local model catalog + device-aware recommendation engine (v1.4.0).
//
//  A small, curated catalogue of popular local models with honest, static
//  facts (size, minimum RAM, capability). Nothing here is probed or faked —
//  the recommendation rating is computed from the user's real device specs
//  (RAM + GPU) against these facts. Each model links to its provider's
//  website so the user can download it there, and Ollama models can be
//  pulled/removed directly from the device via the API.
// ═══════════════════════════════════════════════════

// `capability`: 1–5 subjective "how capable is this model" score used only to
// break ties between models that fit the device equally well.
// `minRamGB`: comfortable RAM to run with a usable context window.
// `sizeGB`: approximate on-disk download size.
// `match`: candidate installed-model names (Ollama tags / LM Studio keys) used
//   to detect whether the model is already on the device.
const MODEL_CATALOG = [
  // ── Ollama ──────────────────────────────────────────────
  { id: 'llama3.1:70b', name: 'Llama 3.1 70B', runtime: 'ollama', family: 'Llama', sizeGB: 40, minRamGB: 64, params: '70B', quant: 'Q4_K_M', capability: 5,
    description: 'Flagship open model — strongest general reasoning in this list.', tags: ['chat', 'general', 'reasoning'],
    downloadUrl: 'https://ollama.com/library/llama3.1', match: ['llama3.1:70b', 'llama3.1:70b-instruct-q4_K_M', 'llama3.1'] },
  { id: 'qwen2.5:32b', name: 'Qwen2.5 32B', runtime: 'ollama', family: 'Qwen', sizeGB: 20, minRamGB: 32, params: '32B', quant: 'Q4_K_M', capability: 4.5,
    description: 'Large multilingual model with strong coding and math.', tags: ['chat', 'coding', 'multilingual'],
    downloadUrl: 'https://ollama.com/library/qwen2.5', match: ['qwen2.5:32b', 'qwen2.5:32b-instruct-q4_K_M', 'qwen2.5'] },
  { id: 'mixtral:8x7b', name: 'Mixtral 8x7B', runtime: 'ollama', family: 'Mixtral', sizeGB: 26, minRamGB: 32, params: '47B MoE', quant: 'Q4_K_M', capability: 4.2,
    description: 'Mixture-of-experts model — high quality at a manageable footprint.', tags: ['chat', 'general', 'multilingual'],
    downloadUrl: 'https://ollama.com/library/mixtral', match: ['mixtral:8x7b', 'mixtral:8x7b-instruct-v0.1-q4_K_M', 'mixtral'] },
  { id: 'qwen2.5:14b', name: 'Qwen2.5 14B', runtime: 'ollama', family: 'Qwen', sizeGB: 9, minRamGB: 16, params: '14B', quant: 'Q4_K_M', capability: 4,
    description: 'Balanced model — great coding and instruction following.', tags: ['chat', 'coding', 'multilingual'],
    downloadUrl: 'https://ollama.com/library/qwen2.5', match: ['qwen2.5:14b', 'qwen2.5:14b-instruct-q4_K_M', 'qwen2.5'] },
  { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B', runtime: 'ollama', family: 'DeepSeek', sizeGB: 9, minRamGB: 16, params: '14B', quant: 'Q4_K_M', capability: 4,
    description: 'Reasoning model — strong step-by-step problem solving.', tags: ['reasoning', 'coding', 'math'],
    downloadUrl: 'https://ollama.com/library/deepseek-r1', match: ['deepseek-r1:14b', 'deepseek-r1:14b-qwen-distill-q4_K_M', 'deepseek-r1'] },
  { id: 'gemma2:9b', name: 'Gemma 2 9B', runtime: 'ollama', family: 'Gemma', sizeGB: 5.5, minRamGB: 12, params: '9B', quant: 'Q4_K_M', capability: 3.6,
    description: 'Google’s open model — efficient and capable for its size.', tags: ['chat', 'general'],
    downloadUrl: 'https://ollama.com/library/gemma2', match: ['gemma2:9b', 'gemma2:9b-instruct-q4_K_M', 'gemma2'] },
  { id: 'qwen2.5:7b', name: 'Qwen2.5 7B', runtime: 'ollama', family: 'Qwen', sizeGB: 4.4, minRamGB: 8, params: '7B', quant: 'Q4_K_M', capability: 3.5,
    description: 'Compact all-rounder with solid coding and multilingual chops.', tags: ['chat', 'coding', 'multilingual'],
    downloadUrl: 'https://ollama.com/library/qwen2.5', match: ['qwen2.5:7b', 'qwen2.5:7b-instruct-q4_K_M', 'qwen2.5'] },
  { id: 'qwen2.5-coder:7b', name: 'Qwen2.5 Coder 7B', runtime: 'ollama', family: 'Qwen', sizeGB: 4.4, minRamGB: 8, params: '7B', quant: 'Q4_K_M', capability: 3.7,
    description: 'Code-specialised 7B — excellent for local agentic workflows.', tags: ['coding', 'agentic'],
    downloadUrl: 'https://ollama.com/library/qwen2.5-coder', match: ['qwen2.5-coder:7b', 'qwen2.5-coder:7b-instruct-q4_K_M', 'qwen2.5-coder'] },
  { id: 'deepseek-r1:7b', name: 'DeepSeek R1 7B', runtime: 'ollama', family: 'DeepSeek', sizeGB: 4.7, minRamGB: 8, params: '7B', quant: 'Q4_K_M', capability: 3.8,
    description: 'Distilled reasoning model — surprisingly strong for 7B.', tags: ['reasoning', 'coding', 'math'],
    downloadUrl: 'https://ollama.com/library/deepseek-r1', match: ['deepseek-r1:7b', 'deepseek-r1:7b-qwen-distill-q4_K_M', 'deepseek-r1'] },
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B', runtime: 'ollama', family: 'Llama', sizeGB: 4.7, minRamGB: 8, params: '8B', quant: 'Q4_K_M', capability: 3.5,
    description: 'The dependable 8B default — fast, capable, widely supported.', tags: ['chat', 'general', 'multilingual'],
    downloadUrl: 'https://ollama.com/library/llama3.1', match: ['llama3.1:8b', 'llama3.1:latest', 'llama3.1', 'llama3.1:8b-instruct-q4_K_M'] },
  { id: 'codellama:7b', name: 'Code Llama 7B', runtime: 'ollama', family: 'Llama', sizeGB: 3.8, minRamGB: 8, params: '7B', quant: 'Q4_K_M', capability: 3.3,
    description: 'Meta’s code model — good for completion and script tasks.', tags: ['coding'],
    downloadUrl: 'https://ollama.com/library/codellama', match: ['codellama:7b', 'codellama:7b-instruct-q4_K_M', 'codellama'] },
  { id: 'mistral:7b', name: 'Mistral 7B', runtime: 'ollama', family: 'Mistral', sizeGB: 4.1, minRamGB: 8, params: '7B', quant: 'Q4_K_M', capability: 3.4,
    description: 'Classic efficient 7B — a solid lightweight general model.', tags: ['chat', 'general'],
    downloadUrl: 'https://ollama.com/library/mistral', match: ['mistral:7b', 'mistral:latest', 'mistral', 'mistral:7b-instruct-q4_K_M'] },
  { id: 'phi3:mini', name: 'Phi-3 Mini', runtime: 'ollama', family: 'Phi', sizeGB: 2.3, minRamGB: 4, params: '3.8B', quant: 'Q4_K_M', capability: 3,
    description: 'Microsoft’s tiny-but-mighty model — great on modest hardware.', tags: ['chat', 'general'],
    downloadUrl: 'https://ollama.com/library/phi3', match: ['phi3:mini', 'phi3:latest', 'phi3', 'phi3:mini-4k-instruct-q4_K_M'] },
  { id: 'llama3.2:3b', name: 'Llama 3.2 3B', runtime: 'ollama', family: 'Llama', sizeGB: 2, minRamGB: 4, params: '3B', quant: 'Q4_K_M', capability: 3,
    description: 'Small and snappy — ideal for low-RAM laptops.', tags: ['chat', 'general'],
    downloadUrl: 'https://ollama.com/library/llama3.2', match: ['llama3.2:3b', 'llama3.2:latest', 'llama3.2', 'llama3.2:3b-instruct-q4_K_M'] },
  { id: 'llama3.2:1b', name: 'Llama 3.2 1B', runtime: 'ollama', family: 'Llama', sizeGB: 1.3, minRamGB: 2, params: '1B', quant: 'Q4_K_M', capability: 2.5,
    description: 'Tiny model for the most constrained devices.', tags: ['chat', 'edge'],
    downloadUrl: 'https://ollama.com/library/llama3.2', match: ['llama3.2:1b', 'llama3.2:1b-instruct-q4_K_M', 'llama3.2'] },
  { id: 'gemma2:2b', name: 'Gemma 2 2B', runtime: 'ollama', family: 'Gemma', sizeGB: 1.6, minRamGB: 4, params: '2B', quant: 'Q4_K_M', capability: 2.8,
    description: 'Google’s compact 2B — surprisingly capable for its size.', tags: ['chat', 'general', 'edge'],
    downloadUrl: 'https://ollama.com/library/gemma2', match: ['gemma2:2b', 'gemma2:2b-instruct-q4_K_M', 'gemma2'] },

  // ── LM Studio (OpenAI-compatible local server) ──────────
  { id: 'lmstudio-community/Llama-3.1-8B-Instruct-GGUF', name: 'Llama 3.1 8B (LM Studio)', runtime: 'lmstudio', family: 'Llama', sizeGB: 4.7, minRamGB: 8, params: '8B', quant: 'Q4_K_M', capability: 3.5,
    description: 'LM Studio build of Llama 3.1 8B — pulled via the LM Studio app.', tags: ['chat', 'general'],
    downloadUrl: 'https://lmstudio.ai/models', match: ['Llama-3.1-8B', 'llama-3.1-8b', 'llama3.1:8b', 'llama3.1'] },
  { id: 'lmstudio-community/Qwen2.5-7B-Instruct-GGUF', name: 'Qwen2.5 7B (LM Studio)', runtime: 'lmstudio', family: 'Qwen', sizeGB: 4.4, minRamGB: 8, params: '7B', quant: 'Q4_K_M', capability: 3.5,
    description: 'LM Studio build of Qwen2.5 7B — pulled via the LM Studio app.', tags: ['chat', 'coding'],
    downloadUrl: 'https://lmstudio.ai/models', match: ['Qwen2.5-7B', 'qwen2.5-7b', 'qwen2.5:7b', 'qwen2.5'] },
  { id: 'lmstudio-community/Mistral-7B-Instruct-v0.3-GGUF', name: 'Mistral 7B (LM Studio)', runtime: 'lmstudio', family: 'Mistral', sizeGB: 4.1, minRamGB: 8, params: '7B', quant: 'Q4_K_M', capability: 3.4,
    description: 'LM Studio build of Mistral 7B — pulled via the LM Studio app.', tags: ['chat', 'general'],
    downloadUrl: 'https://lmstudio.ai/models', match: ['Mistral-7B', 'mistral-7b', 'mistral:7b', 'mistral'] },
];

// Normalize a model name for loose matching (lowercase, keep alnum + . : / -).
function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9.:/-]/g, '');
}

// Gather installed model descriptors (with on-disk size) + a normalized set
// per runtime, straight from the device. The set is a Map of normalized→
// original name so deletions target the exact installed identifier.
async function getInstalledModels() {
  const set = { ollama: new Map(), lmstudio: new Map() };
  const list = [];
  try {
    const found = await discoverModels();
    for (const m of found) {
      if (m.runtimeId === 'ollama' && m.name) {
        const n = normName(m.name);
        set.ollama.set(n, m.name);
        const sizeGB = m.size ? Math.max(0.1, +(m.size / 1073741824).toFixed(1)) : null;
        list.push({ runtime: 'ollama', name: m.name, sizeGB });
      }
    }
  } catch { /* ignore */ }
  try {
    for (const m of getLmStudioModelList()) {
      const id = m.id || m.label;
      if (!id) continue;
      const n = normName(id);
      set.lmstudio.set(n, id);
      const sizeGB = m.sizeBytes ? Math.max(0.1, +(m.sizeBytes / 1073741824).toFixed(1)) : null;
      list.push({ runtime: 'lmstudio', name: id, sizeGB });
    }
  } catch { /* ignore */ }
  return { set, list };
}

function isInstalled(entry, installedMap) {
  const map = installedMap[entry.runtime];
  if (!map) return false;
  for (const cand of entry.match || [entry.id]) {
    const n = normName(cand);
    if (map.has(n)) return map.get(n);
    for (const [normInst, origInst] of map) {
      if (normInst.includes(n) || n.includes(normInst)) return origInst;
    }
  }
  return false;
}

// Compute a 1–5 star rating from the device profile for a single model.
function rateModel(entry, profile) {
  const ramGB = profile.memory?.totalGB || 0;
  const gpu = profile.gpu || {};
  const headroom = ramGB - entry.minRamGB;

  let fit;
  let reason;
  if (headroom < 0) {
    fit = 1;
    reason = `Needs ~${entry.minRamGB} GB RAM — exceeds your ${ramGB} GB`;
  } else if (headroom >= 24) {
    fit = 5; reason = `Comfortable fit in your ${ramGB} GB RAM`;
  } else if (headroom >= 12) {
    fit = 4; reason = `Good fit in your ${ramGB} GB RAM`;
  } else if (headroom >= 6) {
    fit = 3; reason = `Runs in your ${ramGB} GB RAM`;
  } else {
    fit = 2; reason = `Tight fit — lower the context window`;
  }

  // GPU note (honest: only when a GPU/vRAM is actually detected).
  if (gpu.available && gpu.vram && entry.sizeGB <= gpu.vram) {
    reason += ' · runs on your GPU';
  } else if (gpu.available && gpu.vram && entry.sizeGB > gpu.vram) {
    reason += ' · uses unified/CPU memory';
  }

  const cap = entry.capability || 3;
  const raw = Math.round((fit * 0.6 + cap * 0.4) * 10) / 10;
  const stars = Math.max(1, Math.min(5, Math.round(raw)));
  return { stars, reason, fits: headroom >= 0, fit };
}

// Public: build the recommended-models payload for the current device.
// Includes both curated recommendations and any models already installed on
// the device (so they can be removed), even if not in the curated catalogue.
export async function buildRecommendations() {
  const base = getHardwareProfile();
  const profile = { ...base, gpu: await probeGpu(base.platform) };
  const { set: installedSet, list: installedList } = await getInstalledModels();

  const models = MODEL_CATALOG.map((entry) => {
    const { stars, reason, fits } = rateModel(entry, profile);
    const installedName = isInstalled(entry, installedSet);
    return {
      id: entry.id,
      name: entry.name,
      runtime: entry.runtime,
      family: entry.family,
      sizeGB: entry.sizeGB,
      minRamGB: entry.minRamGB,
      params: entry.params,
      quant: entry.quant,
      description: entry.description,
      tags: entry.tags,
      downloadUrl: entry.downloadUrl,
      rating: stars,
      reason,
      fits,
      installed: !!installedName,
      installedName: installedName || null,
    };
  });

  // Any installed model not covered by a catalogue entry still gets a card so
  // the user can delete it from the device. Rating is estimated from its size.
  const covered = new Set();
  for (const m of models) if (m.installed) covered.add(normName(m.installedName || m.id));
  const isCovered = (n) => {
    for (const c of covered) if (c === n || c.includes(n) || n.includes(c)) return true;
    return false;
  };
  for (const inst of installedList) {
    const n = normName(inst.name);
    if (isCovered(n)) continue;
    const sizeGB = inst.sizeGB || 4;
    const minRamGB = Math.max(2, Math.ceil(sizeGB * 1.5));
    const { stars, reason, fits } = rateModel({ minRamGB, sizeGB }, profile);
    models.push({
      id: inst.name,
      name: inst.name,
      runtime: inst.runtime,
      family: null,
      sizeGB,
      minRamGB,
      params: null,
      quant: null,
      description: 'Installed on this device.',
      tags: ['installed'],
      downloadUrl: getRuntime(inst.runtime)?.site || '#',
      rating: stars,
      reason,
      fits,
      installed: true,
      installedName: inst.name,
    });
  }

  // Recommended first (by rating desc), then by size ascending.
  models.sort((a, b) => (b.rating - a.rating) || (a.sizeGB - b.sizeGB));

  const ramGB = profile.memory?.totalGB || 0;
  let ramTier = 'low';
  if (ramGB >= 32) ramTier = 'high';
  else if (ramGB >= 16) ramTier = 'good';
  else if (ramGB >= 8) ramTier = 'moderate';

  return {
    models,
    device: {
      ramGB,
      gpuName: profile.gpu?.name || null,
      gpuVram: profile.gpu?.vram ?? null,
      ramTier,
      estimate: true,
    },
  };
}

export function findCatalogEntry(runtime, name) {
  const n = normName(name);
  return MODEL_CATALOG.find((e) => e.runtime === runtime && (normName(e.id) === n || (e.match || []).some((m) => normName(m) === n)));
}

// ── Device actions: download (pull) and delete ──────────
function isValidModelName(name) {
  return typeof name === 'string'
    && name.length > 0 && name.length <= 120
    && /^[a-zA-Z0-9._:/()-]+$/.test(name);
}

function runSpawn(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    try {
      const cp = spawn(cmd, args, { detached: false, stdio: 'ignore' });
      const t = setTimeout(() => finish({ ok: true, timedOut: true }), timeoutMs);
      cp.on('exit', (code) => { clearTimeout(t); finish({ ok: code === 0 || code == null, code: code ?? null }); });
      cp.on('error', (err) => { clearTimeout(t); finish({ ok: false, error: err.message }); });
    } catch (err) {
      finish({ ok: false, error: err.message });
    }
  });
}

// Download (pull) a model onto the device. Ollama can pull directly; other
// runtimes must be downloaded from the provider's website, so we return the
// URL and let the UI open it.
export async function downloadLocalModel(runtime, name) {
  if (!isValidModelName(name)) return { accepted: false, error: 'Invalid model name.' };
  const entry = findCatalogEntry(runtime, name) || { downloadUrl: getRuntime(runtime)?.site || null };
  if (runtime === 'ollama') {
    // Fire-and-forget pull so large downloads don't block the request.
    try {
      const cp = spawn('ollama', ['pull', name], { detached: true, stdio: 'ignore' });
      cp.unref();
    } catch { /* ignore start failure; surface via status */ }
    return { accepted: true, method: 'pull', downloadUrl: entry.downloadUrl, message: `Pulling ${name} via Ollama…` };
  }
  return { accepted: false, method: 'website', downloadUrl: entry.downloadUrl, message: 'Open the provider page to download this model.' };
}

// Delete a model from the device. Ollama uses `ollama rm`; LM Studio models
// are removed from the on-disk models directory (path validated to stay inside
// the LM Studio models root — no traversal possible).
export async function deleteLocalModel(runtime, name) {
  if (!isValidModelName(name)) return { deleted: false, error: 'Invalid model name.' };
  if (runtime === 'ollama') {
    const r = await runSpawn('ollama', ['rm', name], 30000);
    return { deleted: !!r.ok, method: 'rm', ...r };
  }
  if (runtime === 'lmstudio') {
    const n = normName(name);
    let target = null;
    for (const m of getLmStudioModelList()) {
      if (normName(m.id) === n || normName(m.label) === n) { target = m.path; break; }
    }
    if (!target) return { deleted: false, error: 'Model not found on device.' };
    // Resolve and confine to the LM Studio models root.
    const root = (() => {
      try {
        const sp = join(os.homedir(), '.lmstudio', 'apps', 'bionic', 'settings.json');
        if (existsSync(sp)) {
          try {
            const s = JSON.parse(readFileSync(sp, 'utf8'));
            if (s && typeof s.downloadsFolder === 'string' && s.downloadsFolder) return s.downloadsFolder;
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      return join(os.homedir(), '.lmstudio', 'models');
    })();
    let realRoot;
    let realTarget;
    try { realRoot = realpathSync(root); } catch { realRoot = root; }
    try { realTarget = realpathSync(target); } catch { realTarget = target; }
    if (!realTarget.startsWith(realRoot)) {
      return { deleted: false, error: 'Refusing to delete a path outside the models directory.' };
    }
    try {
      rmSync(realTarget, { recursive: true, force: true });
      return { deleted: true, method: 'file' };
    } catch (err) {
      return { deleted: false, error: err.message };
    }
  }
  return { deleted: false, supported: false, message: `${runtime} model deletion is not supported.` };
}
