const PROVIDERS = [
  {
    id: 'agentrouter', name: 'Agent Router', sub: 'agentrouter.org',
    logo: '/providers/agent-router.png',
    accent: '#8b5cf6', glow: 'rgba(139,92,246,.18)',
    format: 'anthropic', claudeCode: true,
    baseUrl: 'https://agentrouter.org/v1/', needsAuthToken: true,
    desc: 'Multi-model gateway — Claude, GPT & DeepSeek. High free limits.',
    signup: 'https://agentrouter.org',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'aerolink', name: 'Aerolink', sub: 'capi.aerolink.lat',
    logo: '/providers/aerolink.ico',
    accent: '#3b82f6', glow: 'rgba(59,130,246,.18)',
    format: 'anthropic', claudeCode: true,
    baseUrl: 'https://capi.aerolink.lat/v1/',
    desc: 'Free Claude Code gateway. Verify via Telegram bot to get a key.',
    signup: 'https://aerolink.lat',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'freemodel', name: 'FreeModel AI', sub: 'cc.freemodel.dev',
    logo: '/providers/freemodel.svg',
    accent: '#ec4899', glow: 'rgba(236,72,153,.18)',
    format: 'anthropic', claudeCode: true,
    baseUrl: 'https://cc.freemodel.dev/v1/',
    desc: 'Anthropic-format Claude endpoint. Free tier, no card needed.',
    signup: 'https://freemodel.dev',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'openrouter', name: 'OpenRouter', sub: 'openrouter.ai',
    logo: '/providers/openrouter.ico',
    accent: '#06b6d4', glow: 'rgba(6,182,212,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://openrouter.ai/api/v1/',
    desc: 'Dozens of free open-source models (DeepSeek, Llama, Qwen…). List is public.',
    signup: 'https://openrouter.ai/keys',
    defaultKey: '', publicModels: true,
    isFree: (m) => m.id?.endsWith(':free') || (m.pricing && parseFloat(m.pricing.prompt || 0) === 0 && parseFloat(m.pricing.completion || 0) === 0),
  },
  {
    id: 'nvidia', name: 'NVIDIA NIM', sub: 'build.nvidia.com',
    logo: '/providers/nvidia.ico',
    accent: '#76b900', glow: 'rgba(118,185,0,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://integrate.api.nvidia.com/v1/',
    desc: 'Free hosted open models — Nemotron, DeepSeek, Qwen, GPT-OSS, GLM, Kimi, Llama.',
    signup: 'https://build.nvidia.com',
    defaultKey: '', isFree: (m) => !/embed|rerank|reranker|ocr|parse|nemoretriever|asr|tts|whisper|canary|parakeet|riva|magpie|conformer|megatron-1b-nmt|voicechat|studio.?voice|noise|guard|safety|jailbreak|content.?safety|gliner|topic-control|vista|molmim|genmol|diffdock|rfdiffusion|proteinmpnn|esm|alphafold|openfold|boltz|evo2|fourcastnet|cosmos|flux|stable-diffusion|sdxl|qwen-image|paligemma|trellis|bge|paddleocr|yolox|page-elements|table-structure|graphic-elements|eyecontact|lipsync|speaker|streampetr|bevformer|sparsedrive|cuopt|fastpitch|relight|synthetic-video|diffusiongemma/i.test(m.id || ''),
  },
  {
    id: 'groq', name: 'Groq', sub: 'console.groq.com',
    logo: '/providers/groq.ico',
    accent: '#f55036', glow: 'rgba(245,80,54,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://api.groq.com/openai/v1/',
    desc: 'Blazing-fast free inference — Llama, DeepSeek-R1 distill, Qwen.',
    signup: 'https://console.groq.com/keys',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'gemini', name: 'Google Gemini', sub: 'aistudio.google.com',
    logo: '/providers/gemini.ico',
    accent: '#4285f4', glow: 'rgba(66,133,244,.18)',
    format: 'gemini', claudeCode: false,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
    desc: 'Generous free tier — Gemini 2.0 Flash, 1.5 Pro & Flash.',
    signup: 'https://aistudio.google.com/apikey',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'cerebras', name: 'Cerebras', sub: 'cloud.cerebras.ai',
    logo: '/providers/cerebras.png',
    accent: '#ff6b35', glow: 'rgba(255,107,53,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://api.cerebras.ai/v1/',
    desc: 'Ultra-fast free inference on wafer-scale chips — Llama & Qwen.',
    signup: 'https://cloud.cerebras.ai',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'orcarouter', name: 'OrcaRouter', sub: 'api.orcarouter.ai',
    logo: '/providers/orcarouter.png',
    accent: '#0d9488', glow: 'rgba(13,148,136,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://api.orcarouter.ai/v1/',
    desc: 'OpenAI-compatible router across 200+ models at provider cost — orcarouter/auto picks for you.',
    signup: 'https://www.orcarouter.ai',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'mistral', name: 'Mistral', sub: 'console.mistral.ai',
    logo: '/providers/mistral.ico',
    accent: '#fa520f', glow: 'rgba(250,82,15,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://api.mistral.ai/v1/',
    desc: 'Free "La Plateforme" tier — Mistral Large, Codestral, Small.',
    signup: 'https://console.mistral.ai/api-keys',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'huggingface', name: 'Hugging Face', sub: 'router.huggingface.co',
    logo: '/providers/huggingface.ico',
    accent: '#ffd21e', glow: 'rgba(255,210,30,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://router.huggingface.co/v1/',
    desc: 'Serverless inference router — free monthly credits across Llama, Qwen, DeepSeek & more.',
    signup: 'https://huggingface.co/settings/tokens',
    defaultKey: '', isFree: (m) => !/embed|rerank|reranker|ocr|parse|nemoretriever|asr|tts|whisper|canary|parakeet|riva|magpie|conformer|megatron-1b-nmt|voicechat|studio.?voice|noise|guard|safety|jailbreak|content.?safety|gliner|topic-control|vista|molmim|genmol|diffdock|rfdiffusion|proteinmpnn|esm|alphafold|openfold|boltz|evo2|fourcastnet|cosmos|flux|stable-diffusion|sdxl|qwen-image|paligemma|trellis|bge|paddleocr|yolox|page-elements|table-structure|graphic-elements|eyecontact|lipsync|speaker|streampetr|bevformer|sparsedrive|cuopt|fastpitch|relight|synthetic-video|diffusiongemma/i.test(m.id || ''),
  },
  {
    id: 'chutes', name: 'Chutes AI', sub: 'llm.chutes.ai',
    logo: '/providers/chutes.png',
    accent: '#00d4aa', glow: 'rgba(0,212,170,.18)',
    format: 'openai', claudeCode: false,
    baseUrl: 'https://llm.chutes.ai/v1/',
    desc: 'Decentralised free inference for open models — DeepSeek, Qwen, GLM, Kimi.',
    signup: 'https://chutes.ai',
    defaultKey: '', isFree: (m) => !/embed|rerank|reranker|ocr|parse|nemoretriever|asr|tts|whisper|canary|parakeet|riva|magpie|conformer|megatron-1b-nmt|voicechat|studio.?voice|noise|guard|safety|jailbreak|content.?safety|gliner|topic-control|vista|molmim|genmol|diffdock|rfdiffusion|proteinmpnn|esm|alphafold|openfold|boltz|evo2|fourcastnet|cosmos|flux|stable-diffusion|sdxl|qwen-image|paligemma|trellis|bge|paddleocr|yolox|page-elements|table-structure|graphic-elements|eyecontact|lipsync|speaker|streampetr|bevformer|sparsedrive|cuopt|fastpitch|relight|synthetic-video|diffusiongemma/i.test(m.id || ''),
  },
  {
    id: 'tokenrouter', name: 'TokenRouter', sub: 'tokenrouter.com',
    logo: '/providers/tokenrouter.png',
    accent: '#8b5cf6', glow: 'rgba(139,92,246,.18)',
    format: 'anthropic', claudeCode: true,
    baseUrl: 'https://api.tokenrouter.io/v1/',
    desc: 'Token routing service — Claude, GPT & more. Efficient key management.',
    signup: 'https://www.tokenrouter.com',
    defaultKey: '', isFree: () => true,
  },
  {
    id: 'custom', name: 'Custom Gateway', sub: 'your-endpoint.com',
    logo: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f59e0b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cline x1='4' y1='21' x2='4' y2='14'/%3E%3Cline x1='4' y1='10' x2='4' y2='3'/%3E%3Cline x1='12' y1='21' x2='12' y2='12'/%3E%3Cline x1='12' y1='8' x2='12' y2='3'/%3E%3Cline x1='20' y1='21' x2='20' y2='16'/%3E%3Cline x1='20' y1='12' x2='20' y2='3'/%3E%3Cline x1='1' y1='14' x2='7' y2='14'/%3E%3Cline x1='9' y1='8' x2='15' y2='8'/%3E%3Cline x1='17' y1='16' x2='23' y2='16'/%3E%3C/svg%3E",
    accent: '#f59e0b', glow: 'rgba(245,158,11,.18)',
    format: 'anthropic', claudeCode: true, hasCustomUrl: true,
    baseUrl: 'https://your-gateway.com/v1/',
    desc: 'Point at any Anthropic- or OpenAI-compatible base URL.',
    signup: '', defaultKey: '', isFree: () => true,
  },
];

let customUrl = '';
let customModel = '';
let customFormat = localStorage.getItem('gw_custom_format') || 'anthropic';

PROVIDERS.forEach((p) => {
  if (!localStorage.getItem(`gw_key_${p.id}`)) {
    localStorage.setItem(`gw_key_${p.id}`, p.defaultKey);
  }
  if (!localStorage.getItem(`gw_model_${p.id}`)) {
    localStorage.setItem(`gw_model_${p.id}`, '');
  }
});

let liveModels = {};
let selectedProviderId = null;
let appliedProviderId = null;
let filterText = '';

function esc(s) {
  return String(s)
    .replace(/&/g, '\u0026amp;')
    .replace(/</g, '\u0026lt;')
    .replace(/>/g, '\u0026gt;')
    .replace(/"/g, '\u0026quot;');
}

function norm(u) {
  return u && u.endsWith('/') ? u : (u || '') + '/';
}

function svgLogo(p) {
  const mono = esc(monoOf(p));
  const a = p.accent || '#5b8def';
  return `<svg viewBox="0 0 48 48" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(p.name)}">
    <rect x="3" y="3" width="42" height="42" rx="13" fill="${a}16" stroke="${a}" stroke-opacity=".55" stroke-width="1.5"/>
    <text x="24" y="25.5" dominant-baseline="central" text-anchor="middle" font-family="Sora, system-ui, sans-serif" font-weight="800" font-size="17" letter-spacing="-.5" fill="${a}">${mono}</text>
  </svg>`;
}

function logoHtml(p) {
  if (p.logo) {
    return `<img src="${p.logo}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display=''" /><span class="mono-fallback" style="display:none">${svgLogo(p)}</span>`;
  }
  return `<span class="mono-fallback">${svgLogo(p)}</span>`;
}

function monoOf(p) {
  const parts = p.name.replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/);
  return parts.length > 1
    ? parts[0][0] + parts[1][0]
    : p.name.replace(/[^A-Za-z]/g, '').slice(0, 2);
}

function buildClaudeSettings(provider, baseUrl, model, apiKey) {
  // Use the custom card's selected format; otherwise the provider's native format.
  // OpenRouter is dual-compatible but we always emit the Anthropic (Claude Code) config.
  let fmt = provider.id === 'custom' ? customFormat : provider.format;
  if (provider.id === 'openrouter') fmt = 'anthropic';

  // OpenAI-compatible providers -> OpenAI client config. The OpenAI SDK appends
  // `/chat/completions` to OPENAI_BASE_URL, so keep the `/v1/` segment as-is.
  if (fmt === 'openai') {
    return {
      env: {
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_KEY: apiKey
      },
      model: model
    };
  }

  // Google Gemini providers -> Gemini client config (GOOGLE_API_KEY + base URL).
  // Gemini is not Anthropic-compatible, so we surface this as copyable text for
  // the user's own Gemini client rather than writing a Claude Code config.
  if (fmt === 'gemini') {
    return {
      env: {
        GOOGLE_API_KEY: apiKey,
        GOOGLE_GENAI_BASE_URL: baseUrl
      },
      model: model
    };
  }

  // Anthropic-compatible providers -> Claude Code config (unchanged behaviour).
  // Claude Code appends `/v1/messages` to ANTHROPIC_BASE_URL, so strip any
  // trailing `/v1/` from the gateway base (present for OpenAI-style calls).
  const ccBase = (baseUrl || '').replace(/\/v1\/?$/, '/').replace(/\/v1beta\/?$/, '/');
  return {
    env: {
      ANTHROPIC_BASE_URL: ccBase,
      ANTHROPIC_MODEL: model,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
    },
    apiKeyHelper: `echo '${apiKey}'`,
    ...(model && { model })
  };
}

async function fetchCachedModels() {
  try {
    const res = await fetch('/api/cached-models');
    const data = await res.json();
    liveModels = data.providers || {};
    return true;
  } catch (err) {
    console.warn('Failed to fetch cached models:', err);
    return false;
  }
}

async function refreshAllModels() {
  const btn = document.getElementById('refreshAllBtn');
  btn.classList.add('spinning');
  btn.disabled = true;
  
  try {
    const res = await fetch('/api/refresh-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    await fetchCachedModels();
    renderGateways();
    showToast('Models refreshed from all providers', 'success');
    log('Refreshed all providers', 't-ok');
  } catch (err) {
    showToast('Failed to refresh models', 'error');
    log('Refresh failed', 't-err');
  } finally {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
}

function replaceCard(providerId) {
  const old = document.querySelector(`.card[data-id="${providerId}"]`);
  if (!old) return;
  const provider = PROVIDERS.find(p => p.id === providerId);
  if (!provider) return;
  const idx = PROVIDERS.indexOf(provider);
  const nc = createGatewayCard(provider);
  nc.style.animation = 'none';
  if (selectedProviderId === providerId) nc.classList.add('on');
  if (appliedProviderId === providerId) nc.classList.add('applied');
  old.replaceWith(nc);
}

const _fetching = new Set();

async function fetchProviderSilent(providerId) {
  if (_fetching.has(providerId)) return;
  _fetching.add(providerId);
  const provider = PROVIDERS.find(p => p.id === providerId);
  if (!provider) { _fetching.delete(providerId); return; }
  const key = localStorage.getItem(`gw_key_${providerId}`) || '';
  try {
    const res = await fetch('/api/refresh-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, key })
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const reason = (data.error || `HTTP ${res.status}`).toString().slice(0, 90);
      if (/unauthorized client detected|unauthorized_client_error/i.test(reason)) {
        log(`Models · ${provider.name}: WAF blocks app-side fetch (works in Claude Code). Using fallback list.`, 't-ok');
      } else {
        log(`Models not loaded · ${provider.name}: ${reason}`, 't-err');
      }
    }
    await fetchCachedModels();
    replaceCard(providerId);
  } catch (err) {
    log(`Models fetch error · ${provider.name}: ${err.message}`, 't-err');
  } finally { _fetching.delete(providerId); }
}

async function refreshProviderModels(providerId) {
  const provider = PROVIDERS.find(p => p.id === providerId);
  if (!provider) return;
  
  const btn = document.querySelector(`.refresh-${providerId}`);
  if (btn) {
    btn.classList.add('spinning');
    btn.disabled = true;
  }
  
  const key = localStorage.getItem(`gw_key_${providerId}`) || '';
  
  try {
    const res = await fetch('/api/refresh-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, key })
    });
    const data = await res.json();
    await fetchCachedModels();
    replaceCard(providerId);
    if (data.ok) {
      showToast(`Refreshed ${provider.name}`, 'success');
      log(`Refreshed ${provider.name} — ${data.count ?? 0} models`, 't-ok');
    } else {
      showToast(`No models for ${provider.name}${data.error ? ': ' + data.error.slice(0, 80) : ''}`, 'warning');
    }
  } catch (err) {
    showToast(`Failed to refresh ${provider.name}`, 'error');
  } finally {
    if (btn) {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
  }
}

async function testConnection(providerId, baseUrl) {
  const provider = PROVIDERS.find(p => p.id === providerId);
  const apiKeyInput = document.querySelector(`.api-key-${providerId}`);
  const apiKey = apiKeyInput?.value;

  if (!apiKey) {
    showToast('Please enter an API key', 'error');
    return;
  }

  const urlToTest = providerId === 'custom'
    ? document.querySelector(`.base-url-${providerId}`).value
    : baseUrl;

  const format = providerId === 'custom' ? customFormat : (provider?.format || 'anthropic');
  const modelEl = document.querySelector(`.model-${providerId}`);
  const model = modelEl?.value || '';

  const btn = document.querySelector(`.test-btn-${providerId}`);
  if (btn) { btn.disabled = true; btn.classList.add('spinning'); }

  try {
    const qs = new URLSearchParams({ url: urlToTest, key: apiKey || '', format });
    if (model) qs.set('model', model);
    const res = await fetch(`/api/test?${qs.toString()}`);
    const result = await res.json();

    if (result.status && result.status >= 200 && result.status < 300) {
      showToast('Connection successful!', 'success');
      log(`Test OK · ${provider.name}`, 't-ok');
    } else {
      const raw = (result.body || result.error || 'Unknown error').toString();
      // Agent Router (and similar) run a WAF that only accepts Claude Code-shaped
      // clients, so app-side probes are rejected. The saved config is still valid
      // for Claude Code itself, so surface a clear note instead of a scary failure.
      if (/unauthorized client detected|unauthorized_client_error/i.test(raw)) {
        showToast(`${provider.name}: WAF allows only Claude Code — Apply & use in Claude Code`, 'info');
        log(`Test note · ${provider.name}: provider WAF blocks app-side probes; the saved config works in Claude Code.`, 't-ok');
      } else {
        const msg = raw.slice(0, 160);
        showToast(`Failed: ${msg}`, 'error');
        log(`Test failed · ${provider.name}: ${msg}`, 't-err');
      }
    }
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
    log(`Test error · ${provider.name}: ${error.message}`, 't-err');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
  }
}

async function handleApply(event, providerId) {
  event.preventDefault();

  const provider = PROVIDERS.find(p => p.id === providerId);
  const apiKey = document.querySelector(`.api-key-${providerId}`).value;
  const model = document.querySelector(`.model-${providerId}`).value;

  if (!apiKey) {
    showToast('Please enter an API key', 'error');
    return;
  }

  if (!model) {
    showToast('Please select a model', 'error');
    return;
  }

  let baseUrl = PROVIDERS.find(p => p.id === providerId).baseUrl;
  if (providerId === 'custom') {
    baseUrl = document.querySelector(`.base-url-${providerId}`).value;
    if (!baseUrl) {
      showToast('Please enter a base URL', 'error');
      return;
    }
  }

  const newConfig = buildClaudeSettings(provider, baseUrl, model, apiKey);

  // OpenAI/Gemini providers: Claude Code can't consume these configs, so show
  // them as copyable text for the user's own client instead of writing them
  // into Claude Code's settings.json.
  if (newConfig.env.OPENAI_BASE_URL || newConfig.env.GOOGLE_API_KEY) {
    showConfigModal(newConfig, provider.name);
    log(`Prepared config · ${provider.name} · model ${model}`, 't-ok');
    return;
  }

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    });

    if (response.ok) {
      appliedProviderId = providerId;
      showToast(`Applied ${PROVIDERS.find(p => p.id === providerId).name} to Claude Code!`, 'success');
      log(`Applied ${PROVIDERS.find(p => p.id === providerId).name} · model ${model}`, 't-ok');
      await loadConfig();
      renderGateways();
    } else {
      let msg = `Failed to save config (HTTP ${response.status})`;
      try { const d = await response.json(); if (d && d.error) msg += `: ${d.error}`; } catch {}
      showToast(msg, 'error');
      log(msg, 't-err');
    }
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  }
}

function configClientMeta(config) {
  if (config.env?.GOOGLE_API_KEY) {
    return {
      title: 'Google Gemini config',
      sub: 'Gemini is not Anthropic-compatible, so copy this into your Gemini client (e.g. the Google Generative Language SDK) config or a <code>.env</code> file:',
    };
  }
  if (config.env?.OPENAI_BASE_URL) {
    return {
      title: 'OpenAI client config',
      sub: 'Claude Code ignores <code>OPENAI_*</code> env vars, so copy this into your OpenAI‑compatible client’s config (or a <code>.env</code> file):',
    };
  }
  return { title: 'Client config', sub: 'Copy this into your client’s config (or a <code>.env</code> file):' };
}

function showConfigModal(config, name) {
  const { title, sub } = configClientMeta(config);
  document.getElementById('configText').textContent = JSON.stringify(config, null, 2);
  document.getElementById('configModalTitle').textContent = `${name} — ${title}`;
  const subEl = document.getElementById('configModalSub');
  if (subEl) subEl.innerHTML = sub;
  document.getElementById('configModal').hidden = false;
}

function closeConfigModal() {
  document.getElementById('configModal').hidden = true;
}

function copyConfigText() {
  const text = document.getElementById('configText').textContent;
  const done = () => showToast('Config copied to clipboard', 'success');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); }
  catch { showToast('Copy failed — select the text manually', 'error'); }
  ta.remove();
}

function openConfigFolder() {
  fetch('/api/open-folder')
    .then(r => r.json())
    .then(d => {
      if (d.ok) showToast('Opening config folder…', 'info');
      else showToast('Could not open folder: ' + (d.error || ''), 'error');
    })
    .catch(() => {});
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const toastTxt = document.getElementById('toastTxt');
  const toastIcon = document.getElementById('toastIcon');
  const icons = { success: '✓', error: '✕', warning: '!', info: 'i' };
  toastIcon.textContent = icons[type] || icons.info;
  toastTxt.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function log(msg, cls = 'cm') {
  const out = document.getElementById('termOut');
  if (!out) return;
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const line = document.createElement('div');
  line.innerHTML = `<span class="cm">[${ts}]</span> <span class="${cls}">${esc(msg)}</span>`;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function getFreeModels(providerId) {
  const cached = liveModels[providerId];
  if (!cached?.freeModels?.length) return [];
  return cached.freeModels;
}

function getModels(providerId) {
  const cached = liveModels[providerId];
  if (!cached?.models?.length) return [];
  return cached.models;
}

function togglePaid(id, show) {
  localStorage.setItem(`gw_paid_${id}`, show ? '1' : '0');
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  const select = card.querySelector('select.model-' + id);
  if (!select) return;
  const list = show ? getModels(id) : getFreeModels(id);
  const sel = localStorage.getItem(`gw_model_${id}`) || '';
  const freeIds = new Set(getFreeModels(id).map(m => m.id));
  select.innerHTML = list.length
    ? list.map(m => `<option value="${esc(m.id)}" ${sel === m.id ? 'selected' : ''}>${esc(m.name || m.id)}${freeIds.has(m.id) ? '  ·free' : ''}</option>`).join('')
    : `<option value="" disabled>Add API key to load models…</option>`;
}

function getAllModels(providerId) {
  const cached = liveModels[providerId];
  if (!cached?.models?.length) return [];
  return cached.models;
}

function createGatewayCard(provider) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = provider.id;
  card.style.setProperty('--card-accent', provider.accent);
  card.onclick = () => pick(provider.id);
  
  const key = localStorage.getItem(`gw_key_${provider.id}`) || '';
  const model = localStorage.getItem(`gw_model_${provider.id}`) || '';
  const FORMAT_META = {
    anthropic: { label: 'Anthropic', color: '#d98a5b' },
    openai:    { label: 'OpenAI',    color: '#10a37f' },
    gemini:    { label: 'Gemini',    color: '#4285f4' },
  };
  const fmtMeta = FORMAT_META[provider.format] || { label: provider.format, color: provider.accent };
  const ccBadge = provider.claudeCode
    ? '<span class="badge cc">Claude Code</span>'
    : '<span class="badge browse">Browse · API</span>';
  const CLIENT_META = {
    Anthropic: { label: 'Anthropic', color: '#d98a5b' },
    OpenAI:    { label: 'OpenAI',    color: '#10a37f' },
    Gemini:    { label: 'Gemini',    color: '#4285f4' },
  };
  const clients = provider.id === 'openrouter' || provider.id === 'custom'
    ? ['Anthropic', 'OpenAI']
    : (provider.format === 'anthropic' ? ['Anthropic'] : provider.format === 'openai' ? ['OpenAI'] : ['Gemini']);
  const hasKey = !!key;
  
  const freeModels = getFreeModels(provider.id);
  const allModels = getModels(provider.id);
  const hasLiveModels = allModels.length > 0;
  const modelCount = freeModels.length;
  const totalCount = allModels.length;
  const needsKey = !provider.publicModels && !provider.hasCustomUrl && !key;
  const modelState = hasLiveModels ? 'ready' : (needsKey ? 'key' : 'loading');
  const showPaid = localStorage.getItem(`gw_paid_${provider.id}`) === '1';
  const listModels = showPaid ? allModels : freeModels;
  const freeIds = new Set(freeModels.map(m => m.id));

  const modelDisplay = (!needsKey && model) ? model : '';

  const isCustom = !!provider.hasCustomUrl;
  const statusClass = isCustom ? (model ? 'live' : 'pending') : (hasLiveModels ? 'live' : 'pending');
  const statusText = isCustom
    ? (model ? esc(model) : 'custom endpoint')
    : (hasLiveModels ? modelCount + ' free · ' + totalCount + ' total' : (needsKey ? 'needs key' : 'loading…'));

  card.innerHTML = `
    <div class="card-top">
      <div class="card-ico">${logoHtml(provider)}</div>
      <div class="card-id">
        <div class="card-name">
          ${provider.name}
          <span class="configured-badge" id="keybadge-${provider.id}" style="${hasKey ? '' : 'display:none'}">configured</span>
          ${appliedProviderId === provider.id ? '<span class="applied-badge">active</span>' : ''}
        </div>
        <div class="card-sub">${provider.sub}</div>
      </div>
      <div class="card-status">
        <span class="status-indicator ${statusClass}"></span>
        <span class="sync-time">${statusText}</span>
      </div>
    </div>

    <div class="badges">
      ${clients.map(c => `<span class="badge client" style="border-color:${CLIENT_META[c].color}33;background:${CLIENT_META[c].color}1a;color:${CLIENT_META[c].color}"><span class="fmt-dot" style="background:${CLIENT_META[c].color}"></span>${CLIENT_META[c].label}</span>`).join('')}
      ${ccBadge}
      <span class="badge cnt">${isCustom ? 'custom model' : modelCount + ' free · ' + totalCount + ' total'}</span>
    </div>

    <div class="card-desc">${provider.desc}</div>

    ${provider.hasCustomUrl ? '' : `
    <div class="model-now">
      <span class="mn-label">Current Model</span>
      <span class="mn-val" title="${esc(modelDisplay)}">${esc(modelDisplay)}</span>
    </div>

    <div class="inp-row model-head" onclick="event.stopPropagation()">
      <label class="inp-label">Model</label>
      <label class="paid-toggle" title="Show paid models in the list">
        <input type="checkbox" ${showPaid ? 'checked' : ''} onchange="togglePaid('${provider.id}', this.checked)">
        <span class="paid-track"></span>
        <span class="paid-text">Paid</span>
      </label>
    </div>`}
    ${provider.hasCustomUrl ? `
    <div class="inp-row" onclick="event.stopPropagation()">
      <input class="inp base-url-${provider.id}" type="text" value="${esc(customUrl)}" placeholder="Gateway base URL (e.g. https://your-gateway.com/v1/)" oninput="customUrl=this.value">
      <select class="fmt-sel" onchange="setFmt(this.value)">
        <option value="anthropic" ${customFormat === 'anthropic' ? 'selected' : ''}>Anthropic</option>
        <option value="openai" ${customFormat === 'openai' ? 'selected' : ''}>OpenAI</option>
      </select>
    </div>
    <div class="inp-row" onclick="event.stopPropagation()" style="margin-top:8px">
      <input class="inp api-key-${provider.id}" type="password" placeholder="Enter API key…" value="${esc(key)}" oninput="setKey('${provider.id}', this.value)">
    </div>
    <div class="inp-row" onclick="event.stopPropagation()" style="margin-top:8px">
      <input class="inp model-${provider.id}" type="text" value="${esc(customModel)}" placeholder="Model ID (e.g. claude-sonnet-4-5)" oninput="customModel=this.value">
    </div>
    ` : `
    <div class="inp-row" onclick="event.stopPropagation()">
      <input class="inp api-key-${provider.id}" type="password" placeholder="${provider.publicModels ? 'API key (optional)…' : 'Enter API key…'}"
             value="${esc(key)}" oninput="setKey('${provider.id}', this.value)">
      ${provider.signup ? `<a class="getkey" href="${provider.signup}" target="_blank" onclick="event.stopPropagation()" title="Get a free key">get key →</a>` : ''}
    </div>

    <div class="inp-row" onclick="event.stopPropagation()" style="margin-top: 8px;">
      <div class="model-select-wrapper">
        ${hasLiveModels
          ? `<select class="inp model-${provider.id}" onchange="chooseModel('${provider.id}', this.value)">
              ${listModels.map(m => `<option value="${esc(m.id)}" ${model === m.id ? 'selected' : ''}>${esc(m.name || m.id)}${freeIds.has(m.id) ? '  ·free' : ''}</option>`).join('')}
            </select>`
          : `<input class="inp model-${provider.id}" type="text" value="${esc(model)}" placeholder="Enter model ID (e.g. ${provider.format === 'openai' ? 'gpt-4o' : 'claude-sonnet-4'})" oninput="setModel('${provider.id}', this.value)">`}
        <button class="btn-refresh refresh-${provider.id}" onclick="event.stopPropagation(); refreshProviderModels('${provider.id}')" title="Refresh models from provider" aria-label="Refresh models">
          <svg class="refresh-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
      </div>
    </div>
    `}
    <div class="inp-row" onclick="event.stopPropagation()" style="margin-top: 8px;">
      <button type="button" class="btn btn-test test-btn-${provider.id}" onclick="event.stopPropagation(); testConnection('${provider.id}', ${provider.hasCustomUrl ? `document.querySelector('.base-url-${provider.id}').value || '${norm(provider.baseUrl)}'` : `'${norm(provider.baseUrl)}'`})">Test Connection</button>
      <button type="button" class="btn btn-go" onclick="event.stopPropagation(); handleApply(event, '${provider.id}')">Apply Config</button>
    </div>
  `;
  return card;
}

function pick(id) {
  const cards = document.querySelectorAll('.card');
  cards.forEach(c => c.classList.remove('on'));
  const selectedCard = document.querySelector(`.card[data-id="${id}"]`);
  if (selectedCard) selectedCard.classList.add('on');
  selectedProviderId = id;
  const provider = PROVIDERS.find(p => p.id === id);
  const liveText = document.getElementById('liveText');
  if (liveText && provider) liveText.textContent = `${provider.name} selected`;
}

const _keyFetchTimers = {};
function setKey(id, val) {
  localStorage.setItem(`gw_key_${id}`, val);
  const badge = document.getElementById(`keybadge-${id}`);
  if (badge) badge.style.display = val ? '' : 'none';
  const provider = PROVIDERS.find(p => p.id === id);
  // Auto-fetch this card's models once a key is entered (and none are loaded yet)
  if (val && provider && !provider.hasCustomUrl && getFreeModels(id).length === 0) {
    clearTimeout(_keyFetchTimers[id]);
    _keyFetchTimers[id] = setTimeout(() => fetchProviderSilent(id), 700);
  }
}

function chooseModel(id, modelId) {
  localStorage.setItem(`gw_model_${id}`, modelId);
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) {
    const mnVal = card.querySelector('.mn-val');
    if (mnVal) { mnVal.textContent = modelId || '—'; mnVal.title = modelId; }
  }
}

function setModel(id, val) {
  localStorage.setItem(`gw_model_${id}`, val);
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) {
    const mnVal = card.querySelector('.mn-val');
    if (mnVal) { mnVal.textContent = val || '—'; mnVal.title = val; }
  }
}

function setFmt(val) {
  customFormat = val;
  localStorage.setItem('gw_custom_format', val);
}

function filterGatewaysDebounced(val) {
  filterText = val.toLowerCase();
  clearTimeout(window.filterTimeout);
  window.filterTimeout = setTimeout(() => {
    renderGateways();
  }, 100);
}

function renderGateways() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  let gatewayCount = 0;
  let freeModelCount = 0;
  let configuredCount = 0;

  PROVIDERS.forEach((provider, idx) => {
    const key = localStorage.getItem(`gw_key_${provider.id}`) || '';
    const freeModels = getFreeModels(provider.id);

    if (filterText && !provider.name.toLowerCase().includes(filterText) && !provider.sub.toLowerCase().includes(filterText)) {
      return;
    }

    gatewayCount++;
    freeModelCount += freeModels.length;
    if (key) configuredCount++;

    const card = createGatewayCard(provider);
    card.style.setProperty('--i', idx);
    if (selectedProviderId === provider.id) card.classList.add('on');
    if (appliedProviderId === provider.id) card.classList.add('applied');
    grid.appendChild(card);

    // Auto-fetch models per card when the server hasn't cached them yet
    if (freeModels.length === 0 && (provider.publicModels || key)) {
      fetchProviderSilent(provider.id);
    }
  });

  document.getElementById('statGw').textContent = gatewayCount;
  document.getElementById('statFree').textContent = freeModelCount;
  document.getElementById('statConfigured').textContent = configuredCount;
}

function highlightJSON(json) {
  return json
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = 'b';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) cls = 'k';
        else cls = 's';
      } else if (/true|false/.test(match)) cls = 'b';
      else if (/null/.test(match)) cls = 'b';
      else if (!isNaN(match)) cls = 's';
      return `<span class="${cls}">${match}</span>`;
    });
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const { config, path } = await res.json();
    if (path) document.getElementById('pathText').textContent = path;
    if (config) {
      const jsonStr = JSON.stringify(config, null, 2);
      document.getElementById('jsonOut').innerHTML = highlightJSON(jsonStr);

      // Detect which provider this config points at → persistent "active" glow
      const base = config.env?.ANTHROPIC_BASE_URL || '';
      const match = PROVIDERS.find(p => norm(p.baseUrl) === norm(base));
      appliedProviderId = match ? match.id : null;
      const liveText = document.getElementById('liveText');
      if (liveText) {
        if (match) {
          liveText.textContent = `${match.name} active`;
          document.getElementById('liveChip').classList.add('live');
        } else if (base) {
          liveText.textContent = `Custom: ${base}`;
          document.getElementById('liveChip').classList.add('live');
        } else {
          liveText.textContent = 'No gateway selected';
        }
      }
    } else {
      const liveText = document.getElementById('liveText');
      if (liveText) liveText.textContent = 'No gateway selected';
    }
  } catch (err) {
    console.warn('Failed to load config:', err);
  }
}

function clearTerm() {
  document.getElementById('termOut').innerHTML = '';
}

// Re-poll the server model cache while its background startup fetch is still
// running, so cards that were empty on first paint fill in automatically.
async function pollForModels(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await new Promise(r => setTimeout(r, 2500));
    const before = modelSignature();
    await fetchCachedModels();
    if (modelSignature() !== before) {
      renderGateways();
    }
  }
}

function modelSignature() {
  return PROVIDERS.map(p => (getFreeModels(p.id) || []).length).join(',');
}

function copyJSON() {
  const jsonOut = document.getElementById('jsonOut');
  const text = jsonOut.textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Config copied to clipboard', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Clear any stale custom-gateway values (a previous build persisted a model
  // name into the base-URL field). The custom fields now start empty.
  localStorage.removeItem('gw_custom_url');
  localStorage.removeItem('gw_model_custom');

  await fetchCachedModels();
  await loadConfig();
  renderGateways();

  // Keep pulling the server cache until its startup fetch settles, so models
  // appear on the dashboard without a manual refresh.
  pollForModels();

  document.getElementById('globalSearch').addEventListener('input', (e) => {
    filterGatewaysDebounced(e.target.value);
  });
});