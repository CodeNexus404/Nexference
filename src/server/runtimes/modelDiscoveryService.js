import { getRuntime, RUNTIMES } from '../local/runtimes.js';

// ═══════════════════════════════════════════════════
//  Unified local model discovery (v0.7.0). Aggregates installed models from
//  supported, currently-running runtimes into a normalized shape. Metadata that
//  a runtime does not expose is left null/"unknown" — never invented. Duplicate
//  logical models (same name across runtimes) are preserved per-runtime so the
//  UI can group them; we only de-dupe exact runtime+name collisions.
// ═══════════════════════════════════════════════════

async function fetchOllamaTags() {
  const url = 'http://localhost:11434/api/tags';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    return Array.isArray(data?.models) ? data.models : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function normalizeOllama(models) {
  if (!Array.isArray(models)) return [];
  return models.map((m) => {
    const fams = m.details?.families || (m.details?.family ? [m.details.family] : []);
    const detCaps = m.details?.capabilities || [];
    const capabilities = [...new Set([...fams, ...detCaps].map((c) => String(c).toLowerCase()))];
    return {
      id: m.name,
      name: m.name,
      runtimeId: 'ollama',
      source: 'ollama',
      installed: true,
      size: m.size ?? null,
      parameterCount: m.details?.parameter_size ?? null,
      quantization: m.details?.quantization_level ?? null,
      contextLength: null,
      modifiedAt: m.modified_at ?? null,
      capabilities,
    };
  });
}

// Full discovery across all supported running runtimes.
export async function discoverModels() {
  const out = [];
  const seen = new Set();
  const tags = await fetchOllamaTags();
  if (tags) {
    for (const m of normalizeOllama(tags)) {
      const key = `${m.runtimeId}:${m.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}
