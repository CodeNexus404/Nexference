// Custom Provider UI (v2.1.0) — renders custom provider cards, onboarding wizard,
// and detail modals. Uses existing design system and modal architecture.
import { esc, svgLogo } from '../components/util.js';
import { fallbackStore } from '../config/fallbackStore.js';
import { notify } from '../core/notifications.js';
import { openModal, confirmModal } from '../components/modal.js';
import { workspace, getFreeModels, getModels } from '../core/state.js';
import { claudeCodeCompatibility } from '../providers/registry.js';
import { Storage } from '../core/storage.js';
import { LocalSettingsRuntime, configClientMeta } from '../config/runtimeAdapter.js';
import { configEngine } from '../config/engine.js';
import * as cpService from '../providers/customProviderService.js';
import { localProxyStatus, armLocalProxy, disarmLocalProxy } from '../localProxy.js';

const ORIGIN_BADGE = '<span class="badge browse">Custom</span>';

// Re-pull the adopted (dyn:) provider index so the Cloud Providers grid reflects
// edits/deletes immediately instead of holding a stale workspace.dynamicProviders.

// Mirror a deliberate primary apply into any armed fallback plan for that client.
// Centralised so every apply path behaves identically, and dispatched only when the
// stored primary actually moved, so listeners do no redundant work.
function syncFallbackPrimary(applied) {
  try {
    if (!fallbackStore.syncPrimaryFromApplied(applied.client, applied)) return;
    window.dispatchEvent(new CustomEvent('nx-fallback', { detail: { client: applied.client, changed: true, reason: 'primary-applied' } }));
  } catch { /* fallback store unavailable — never block an apply on it */ }
}

export async function refreshDynamicIndex() {
  try {
    const res = await fetch('/api/providers?origin=ecosystem').then((r) => r.json()).catch(() => ({ providers: null }));
    if (Array.isArray(res.providers)) workspace.dynamicProviders = res.providers;
    return true;
  } catch { return false; }
}

function relTime(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  // "0s ago" / "just now" reads like a glitch on a session armed seconds ago.
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const FORMAT_LABELS = {
  openai: 'OpenAI Compatible',
  anthropic: 'Anthropic Compatible',
  gemini: 'Gemini Compatible',
  unknown: 'Unknown',
};

function initials(name) {
  return (name || '?').split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

const STATUS_META = {
  active: { label: 'Active', dot: 'dot-green' },
  inactive: { label: 'Inactive', dot: 'dot-gray' },
  'not-tested': { label: 'Not tested', dot: 'dot-gray' },
  connected: { label: 'Connected', dot: 'dot-green' },
  failed: { label: 'Failed', dot: 'dot-red' },
  unverified: { label: 'Unverified', dot: 'dot-gray' },
  'metadata-only': { label: 'Metadata only', dot: 'dot-gray' },
};

// ─── Custom Provider Card (for the Cloud Providers grid) ───
// Compact card matching curated card format. Opens detail modal on click.

// Single source of truth for free/paid classification. A model is free when
// either its input or output price is zero (gateways sometimes only set one),
// or when discovery tagged it accessType "free". Pricing values may be numeric
// or numeric strings ("0") depending on the source API (OpenRouter/HF/LiteLLM),
// so compare numerically rather than with a strict === 0.
// Finally, a free-tier marker in the id/name (free/claude-opus-4.6 free:gpt-4o,
// free-gpt4, gpt-4o:free, "Free GPT-4") classifies as free — gateways like
// APInex / Inference Dahl flag free models purely by name convention, with no
// pricing (the "/" delimiter covers id-slugs like "free/deepseek-v4-flash").
const FREE_NAME_RE = /(^|[:._\-\s/])free(?=$|[:._\-\s/])/i;
function freeNameMarker(m) {
  return (typeof m?.id === 'string' && FREE_NAME_RE.test(m.id)) ||
    (typeof m?.name === 'string' && FREE_NAME_RE.test(m.name));
}
// Some gateways (e.g. Requesty /v1/models) return pricing as an array of
// volume-tier objects instead of one flat price — free only when no tier is paid.
function pricingArrayIsFree(p) {
  if (!Array.isArray(p)) return false;
  const tiers = p.filter((t) => t && typeof t === 'object');
  if (!tiers.length) return false;
  return !tiers.some((t) => (Number(t.input_price ?? t.input ?? t.prompt) || 0) > 0 || (Number(t.output_price ?? t.output ?? t.completion) || 0) > 0);
}
function isFreeModel(m) {
  const p = m?.pricing;
  const isZero = (v) => v !== null && v !== undefined && v !== '' && Number(v) === 0;
  if (pricingArrayIsFree(p)) return true;
  if (isZero(p?.input) || isZero(p?.output)) return true;
  if (m?.accessType === 'free') return true;
  return freeNameMarker(m);
}

// Upstream failures arrive as raw JSON/HTML and differ per gateway, so surface
// the most specific human-readable field instead of dumping the whole body at
// the user. e.g. NVIDIA returns {"status":403,"detail":"Authorization failed"}.
function describeProbeFailure(j) {
  const pick = (body) => {
    if (!body) return '';
    if (typeof body === 'string') {
      const t = body.trim();
      // Never surface markup — a reverse proxy's HTML error page is noise.
      if (t.startsWith('<')) {
        const m = /<title[^>]*>([\s\S]{0,120}?)<\/title>/i.exec(t) || /<h1[^>]*>([\s\S]{0,120}?)<\/h1>/i.exec(t);
        return (m ? m[1] : 'upstream returned an HTML error page').replace(/\s+/g, ' ').trim();
      }
      try { return pick(JSON.parse(t)); } catch { return t.slice(0, 160); }
    }
    return body.detail || body.message || body.error?.message || body.error || body.title || '';
  };
  // The server already wrote a clear sentence for a timed-out probe; prefixing
  // "no response —" onto it just reads as a stutter.
  if (j.timedOut) return String(j.error || 'The provider did not respond in time.').slice(0, 200);
  // Cloudflare / WAF challenge pages arrive as HTML with a 403 and say nothing
  // useful about the key — JustDoWork (api.justwoker.icu) blocks every POST to
  // chat/completions this way. Reporting "invalid API key" there would be a lie,
  // and dumping the raw challenge markup is unreadable, so name the real cause
  // and make clear the request never reached the API.
  //
  // Require actual Cloudflare markers rather than "any HTML": an upstream reverse
  // proxy returning a plain "502 Bad Gateway" page is a different failure and
  // must keep its own message.
  const rawBody = String(j.body || '');
  if (/cf-ray|cf-error-code|cf_chl|challenge-platform|cloudflare|attention required|just a moment|checking your browser/i.test(rawBody)) {
    return 'Blocked by the provider\'s edge firewall (Cloudflare challenge) — not a key problem. '
      + 'The request never reached the API; this host filters automated clients on this path.';
  }
  const detail = pick(j.body) || pick(j);
  const status = j.status ? `HTTP ${j.status}` : 'no response';
  const text = String(detail || j.error || '').trim();
  if (!text) return status;
  // "Authorization failed", "Unauthorized", "Invalid API Key", "Forbidden",
  // "authentication_error" … Note "Authorization" does not contain
  // "unauthor" (unauthor-ized vs author-ization), so match the "authoriz" stem.
  // The adjective may lead ("Incorrect API key") or trail ("API key invalid"),
  // so match both orders.
  if (/authoriz|unauthor|forbidden|authenticat|permission/i.test(text)
    || /invalid|incorrect|expired|revoked|malformed/.test(text) && /key/i.test(text)
    || /api.{0,10}key/i.test(text) && /invalid|incorrect|expired|revoked/i.test(text)) {
    return `${status} — the provider rejected this API key.`;
  }
    if (/not found|does not exist|unknown model|no such model|model.{0,20}not|check the model/i.test(text)) {
      // Gateways word this many ways; Requesty in particular answers
      // "please check the model you provided", which tells the user nothing about
      // whether the key is fine, the id is wrong, or their plan excludes it.
      return `${status} — that model ID was rejected. The key was accepted, so either the ID is `
        + `not spelled the way this gateway expects, or it isn't available on your plan. `
        + `Pick another model from the list.`;
    }
  if (/rate|quota|429|too many requests/i.test(text)) return `${status} — rate limited or out of quota. Try again shortly.`;
  if (/<[a-z]/i.test(text)) return `${status} — the upstream returned an HTML error page.`;
  return `${status} — ${text.slice(0, 140)}`;
}

export function customProviderCard(p) {
  const id = esc(p.id);
  const name = esc(p.name);
  const fmt = FORMAT_LABELS[p.format] || esc(p.format || 'unknown');
  const adopted = p.origin === 'ecosystem';
  const compat = `${adopted ? 'Adopted' : 'Custom'} · ${fmt}`;
  const key = Storage.getKey(p.id);
  const models = workspace.liveModels[p.id]?.models || [];
  const freeModels = models.filter(isFreeModel);
  const modelCount = models.length || p.modelCount || 0;
  const freeCount = freeModels.length;
  const intel = workspace.providerIntel[p.id];
  const ds = intel?.status?.discoveryStatus;
  const dot = ds ? `<span class="pi-dot ds-${ds || 'unknown'}" title="${esc(ds || 'unknown')}"></span>` : '';
  // Prefer the live, locally classified model list whenever it's loaded — the
  // intel feed is only a fallback for before the first fetch, so a stale
  // snapshot can never freeze the badge at "0 free" for name-marked free
  // models (APInex free/claude-…, Inference Dahl).
  const hasLive = models.length > 0;
  const totalModels = hasLive ? modelCount : (intel?.models?.total ?? modelCount);
  const freeModelsN = hasLive ? freeCount : (intel?.models?.free ?? freeCount);
  const lastChecked = intel?.source?.lastCheckedAt
    ? relTime(intel.source.lastCheckedAt)
    : ((p.updatedAt || p.createdAt) ? relTime(p.updatedAt || p.createdAt) : 'not checked');
  // Active highlight — this provider is the one current in settings.json.
  const active = workspace.appliedProviderId === p.id;
  // Favicon rendering with graceful fallback. The /api/ecosystem/logo proxy
  // only accepts https image/* URLs, so favicons served over http or as .ico
  // (image/x-icon) fail there. On failure we swap src to the provider's website
  // scrape endpoint before ceding to the initial monogram. `data:` logos render
  // directly.
  const site = p.website || p.sub || '';
  const logoImg = (src, fbUrl) => `<img src="${src}" alt="" loading="lazy" onerror="if(!this.hu){this.hu=1;fetch('${fbUrl}').then(r=>r.json()).then(d=>{if(d&&d.ok&&d.url){this.src=d.url}else{this.style.display='none';this.nextElementSibling.style.display=''}}).catch(()=>{this.style.display='none';this.nextElementSibling.style.display=''})}else{this.style.display='none';this.nextElementSibling.style.display=''}" /><span class="mono-fallback" style="display:none">${svgLogo(p)}</span>`;
  const favSrc = p.logo
    ? (p.logo.startsWith('data:')
      ? `<img src="${p.logo}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display=''" /><span class="mono-fallback" style="display:none">${svgLogo(p)}</span>`
      : logoImg(`/api/ecosystem/logo?url=${encodeURIComponent(p.logo)}`, site ? `/api/custom-providers/favicon?url=${encodeURIComponent(site)}&format=data` : ''))
    : `<span class="mono-fallback">${svgLogo(p)}</span>`;

  return `<div class="panel provider-card cp-card${active ? ' applied' : ''}" data-id="${id}" data-origin="custom" role="button" tabindex="0">
    <div class="pc-head">
      <div class="pc-logo-sm">${favSrc}</div>
      <div class="provider-meta"><b>${name}</b><span class="provider-compat">${compat}</span></div>
      ${dot}
    </div>
    <div class="pc-card-foot">
      <span class="badge cnt">${totalModels ? (freeModelsN + ' free · ' + totalModels + ' total') : 'models…'}</span>
      ${active ? '<span class="applied-badge">active</span>' : ''}${key ? '<span class="badge cc">configured</span>' : ''}${adopted ? '<span class="badge pi-src">ecosystem</span>' : ''}
    </div>
    <div class="pc-intel-row">
      <span class="pi-status">${esc(p.identity?.description || 'Custom provider')}</span>
      <span class="pi-checked">· ${esc(lastChecked)}</span>
    </div>
    <div class="pc-actions">
      <button class="btn btn2 sm cp-details-btn" data-id="${id}" type="button">Details</button>
      <button class="btn btn2 sm cp-refresh-btn" data-id="${id}" type="button" title="Refresh models">↻</button>
    </div>
  </div>`;
}

function isValidHttpsUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try { const u = new URL(str); return u.protocol === 'https:'; } catch { return false; }
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// ─── Onboarding Wizard ───
export function openAddCustomProviderWizard() {
  let step = 1;
  let formData = { name: '', website: '', description: '', baseUrl: '', format: 'openai', logoChoice: 'website', logoDataUrl: null, logoUrl: null };
  let ctrlRef = null;

  function renderStep() {
    const body = document.querySelector('.modal-card-body');
    if (!body) return;
    let html = '';
    if (step === 1) html = renderStep1();
    else if (step === 2) html = renderStep2();
    else if (step === 3) html = renderStep3();
    else html = renderStep4();

    const steps = [1, 2, 3, 4].map((s) => `<span class="wizard-step ${s === step ? 'active' : ''} ${s < step ? 'done' : ''}">${s}</span>`).join('');
    body.innerHTML = `<div class="wizard-progress">${steps}</div>${html}`;
    bindStep();

    // Auto-scrape favicon on ENTERING step 3 — the radio `change` event alone
    // misses the case where "Website" is already selected (default or re-entry),
    // leaving logoUrl null and the card without a logo. Uses the website URL,
    // falling back to the base URL, so the logo populates whenever ANY url was
    // entered (the server also falls back to the bare domain for API hosts).
    if (step === 3 && formData.logoChoice === 'website' && !formData.logoUrl && !formData.logoDataUrl && !formData.logoFetching && (formData.website || formData.baseUrl)) {
      (async () => {
        formData.logoFetching = true;
        const previewWrap = body.querySelector('.cpw-logo-preview-wrap');
        if (previewWrap) previewWrap.innerHTML = '<span class="muted">Fetching favicon…</span>';
        const result = await cpService.scrapeFavicon(formData.website || formData.baseUrl);
        formData.logoFetching = false;
        if (formData.logoChoice !== 'website') return; // user switched while fetching
        // scrapeFavicon now returns a base64 data URL. Storing that data URL as the
        // provider logo lets the created card render it inline — no proxy round-trip,
        // so it loads instantly on page refresh instead of re-fetching. Fall back to
        // the raw URL when the server can't produce a data URL (huge/non-image/blocked).
        const dataUrl = result?.ok && result.url?.startsWith('data:') ? result.url : null;
        formData.logoDataUrl = dataUrl;
        formData.logoUrl = dataUrl ? null : (result?.ok ? (result.url || null) : null);
        formData.logoSrc = dataUrl ? 'website' : (formData.logoUrl ? 'website' : null);
        const preview = body.querySelector('.cpw-logo-preview-wrap');
        if (preview) {
          preview.innerHTML = formData.logoDataUrl
            ? `<div class="cpw-logo-preview"><img src="${formData.logoDataUrl}" alt="Logo" /></div>`
            : (formData.logoUrl
              ? `<div class="cpw-logo-preview"><img src="/api/ecosystem/logo?url=${encodeURIComponent(formData.logoUrl)}" alt="Logo" onerror="this.parentElement.innerHTML='<span class=muted>Not found</span>'" /></div>`
              : '<div class="cpw-logo-preview cpw-logo-fallback">' + esc(initials(formData.name)) + '</div>');
        }
      })();
    }
  }

  function renderStep1() {
    return `<div class="wizard-body">
      <h3 class="wizard-title">Provider Name</h3>
      <div class="form-row"><label class="lbl">Name *</label>
        <input class="inp" id="cpwName" value="${esc(formData.name)}" placeholder="e.g. My Company AI" maxlength="100" autofocus /></div>
      <div class="form-row"><label class="lbl">Website</label>
        <input class="inp" id="cpwWebsite" value="${esc(formData.website)}" placeholder="https://example.com" /></div>
      <div class="form-row"><label class="lbl">Description</label>
        <input class="inp" id="cpwDesc" value="${esc(formData.description)}" placeholder="Optional one-liner" maxlength="200" /></div>
      <div class="wizard-nav">
        <button class="btn btn2" data-act="cancel">Cancel</button>
        <button class="btn btn-go" data-act="next">Next →</button>
      </div></div>`;
  }

  function renderStep2() {
    const formats = [
      { value: 'openai', label: 'OpenAI', desc: '/v1/chat/completions' },
      { value: 'anthropic', label: 'Anthropic', desc: '/v1/messages' },
      { value: 'gemini', label: 'Gemini', desc: 'Google Generative AI' },
      { value: 'unknown', label: 'Skip', desc: 'No format selected' },
    ];
    return `<div class="wizard-body">
      <h3 class="wizard-title">API Format & Base URL</h3>
      <div class="form-row"><label class="lbl">Format</label>
        <div class="cpw-format-grid">${formats.map((f) =>
          `<label class="cpw-format-opt ${formData.format === f.value ? 'selected' : ''}">
            <input type="radio" name="cpwFormat" value="${f.value}" ${formData.format === f.value ? 'checked' : ''} />
            <span class="cpw-format-label">${f.label}</span>
            <span class="cpw-format-desc">${f.desc}</span>
          </label>`).join('')}
        </div></div>
      <div class="form-row"><label class="lbl">Base URL</label>
        <input class="inp" id="cpwBaseUrl" value="${esc(formData.baseUrl)}" placeholder="https://api.example.com/v1/" /></div>
      <div class="wizard-nav">
        <button class="btn btn2" data-act="back">← Back</button>
        <button class="btn btn2" data-act="cancel">Cancel</button>
        <button class="btn btn-go" data-act="next">Next →</button>
      </div></div>`;
  }

  function renderStep3() {
    const logoPreview = formData.logoDataUrl
      ? `<div class="cpw-logo-preview"><img src="${formData.logoDataUrl}" alt="Logo preview" /></div>`
      : formData.logoUrl
        ? `<div class="cpw-logo-preview"><img src="${esc(formData.logoUrl)}" alt="Logo preview" onerror="this.parentElement.innerHTML='<span class=muted>Failed to load</span>'" /></div>`
        : `<div class="cpw-logo-preview cpw-logo-fallback">${esc(initials(formData.name))}</div>`;
    return `<div class="wizard-body">
      <h3 class="wizard-title">Logo</h3>
      <div class="cpw-logo-row">
        <div class="cpw-logo-options">
          <label class="cpw-format-opt ${formData.logoChoice === 'website' ? 'selected' : ''}">
            <input type="radio" name="cpwLogo" value="website" ${formData.logoChoice === 'website' ? 'checked' : ''} />
            <span class="cpw-format-label">Website</span>
            <span class="cpw-format-desc">Fetch favicon from URL</span>
          </label>
          <label class="cpw-format-opt ${formData.logoChoice === 'file' ? 'selected' : ''}">
            <input type="radio" name="cpwLogo" value="file" ${formData.logoChoice === 'file' ? 'checked' : ''} />
            <span class="cpw-format-label">Upload File</span>
            <span class="cpw-format-desc">SVG, PNG, ICO</span>
          </label>
          <label class="cpw-format-opt ${formData.logoChoice === 'initials' ? 'selected' : ''}">
            <input type="radio" name="cpwLogo" value="initials" ${formData.logoChoice === 'initials' ? 'checked' : ''} />
            <span class="cpw-format-label">Initials</span>
            <span class="cpw-format-desc">Auto-generated</span>
          </label>
        </div>
        <div class="cpw-logo-preview-wrap">${logoPreview}</div>
      </div>
      ${formData.logoChoice === 'file' ? `<div class="form-row"><input class="inp" id="cpwLogoFile" type="file" accept=".svg,.png,.ico,.jpeg,.jpg,.gif,.webp,image/*" /></div>` : ''}
      <div class="wizard-nav">
        <button class="btn btn2" data-act="back">← Back</button>
        <button class="btn btn2" data-act="cancel">Cancel</button>
        <button class="btn btn-go" data-act="next">Next →</button>
      </div></div>`;
  }

  function renderStep4() {
    const fmt = FORMAT_LABELS[formData.format] || 'Unknown';
    return `<div class="wizard-body">
      <h3 class="wizard-title">Review</h3>
      <div class="cpw-review">
        <div class="cpw-review-row"><span class="cpw-review-label">Name</span><span class="cpw-review-val">${esc(formData.name)}</span></div>
        <div class="cpw-review-row"><span class="cpw-review-label">Format</span><span class="cpw-review-val">${esc(fmt)}</span></div>
        ${formData.baseUrl ? `<div class="cpw-review-row"><span class="cpw-review-label">Base URL</span><span class="cpw-review-val mono">${esc(formData.baseUrl)}</span></div>` : ''}
        ${formData.website ? `<div class="cpw-review-row"><span class="cpw-review-label">Website</span><span class="cpw-review-val">${esc(formData.website)}</span></div>` : ''}
        ${formData.description ? `<div class="cpw-review-row"><span class="cpw-review-label">Description</span><span class="cpw-review-val">${esc(formData.description)}</span></div>` : ''}
        <div class="cpw-review-row"><span class="cpw-review-label">Logo</span><span class="cpw-review-val">${formData.logoChoice === 'file' ? 'Uploaded file' : formData.logoChoice === 'website' ? 'Website favicon' : 'Generated initials'}</span></div>
      </div>
      <div class="wizard-nav">
        <button class="btn btn2" data-act="back">← Back</button>
        <button class="btn btn2" data-act="cancel">Cancel</button>
        <button class="btn btn-go" data-act="create">Create Provider</button>
      </div></div>`;
  }

  function readForm() {
    const body = document.querySelector('.modal-card-body');
    if (!body) return;
    // Only overwrite formData when the element exists AND has a non-empty value,
    // or when the element is a text field that the user actively cleared.
    // This prevents readForm on step 4 (review, no inputs) from clobbering values.
    if (step === 1) {
      const el = body.querySelector('#cpwName');
      if (el && el.value.trim()) formData.name = el.value;
      const w = body.querySelector('#cpwWebsite');
      if (w) formData.website = w.value;
      const d = body.querySelector('#cpwDesc');
      if (d) formData.description = d.value;
    } else if (step === 2) {
      const u = body.querySelector('#cpwBaseUrl');
      if (u) formData.baseUrl = u.value;
      const fmtEl = body.querySelector('input[name="cpwFormat"]:checked');
      if (fmtEl) formData.format = fmtEl.value;
    } else if (step === 3) {
      const logoEl = body.querySelector('input[name="cpwLogo"]:checked');
      if (logoEl) formData.logoChoice = logoEl.value;
    }
  }

  // Scrape + store the website favicon into formData and refresh the preview.
  // Centralised so the "enter step 3", radio-change and URL-typing paths share
  // one implementation. Best-effort: failures leave the generated initials.
  async function scrapeLogoFor(url) {
    if (!url || formData.logoFetching || formData.logoChoice !== 'website') return;
    formData.logoFetching = true;
    const body = document.querySelector('.modal-card-body');
    const previewWrap = body?.querySelector('.cpw-logo-preview-wrap');
    if (previewWrap) previewWrap.innerHTML = '<span class="muted">Fetching favicon…</span>';
    try {
      const result = await cpService.scrapeFavicon(url);
      if (formData.logoChoice !== 'website') return; // user switched while fetching
      const dataUrl = result?.ok && result.url?.startsWith('data:') ? result.url : null;
      formData.logoDataUrl = dataUrl;
      formData.logoUrl = dataUrl ? null : (result?.ok && result.url ? result.url : null);
      formData.logoSrc = dataUrl || formData.logoUrl ? 'website' : null;
      const preview = body?.querySelector('.cpw-logo-preview-wrap');
      if (preview) {
        preview.innerHTML = formData.logoDataUrl
          ? `<div class="cpw-logo-preview"><img src="${formData.logoDataUrl}" alt="Logo" /></div>`
          : (formData.logoUrl
            ? `<div class="cpw-logo-preview"><img src="/api/ecosystem/logo?url=${encodeURIComponent(formData.logoUrl)}" alt="Logo" onerror="this.parentElement.innerHTML='<span class=muted>Not found</span>'" /></div>`
            : '<div class="cpw-logo-preview cpw-logo-fallback">' + esc(initials(formData.name)) + '</div>');
      }
    } finally {
      formData.logoFetching = false;
    }
  }

  function bindStep() {
    const body = document.querySelector('.modal-card-body');
    if (!body) return;

    // Auto-fetch the favicon as soon as the user types a website/base URL and the
    // logo choice is "Website favicon" (the default). Debounced so a URL typed in
    // characters doesn't fire a scrape per keystroke; the result is cached in
    // formData so the review step and the created card show it immediately.
    let urlScrapeTimer = null;
    function triggerUrlScrape() {
      clearTimeout(urlScrapeTimer);
      urlScrapeTimer = setTimeout(() => {
        const url = formData.logoChoice === 'website' ? (formData.website || formData.baseUrl) : '';
        if (!url || url.length < 8 || formData.logoFetching) return;
        scrapeLogoFor(formData.website || formData.baseUrl);
      }, 700);
    }

    // Debounced input listeners on the URL fields (best effort, non-blocking).
    const wsInput = body.querySelector('#cpwWebsite');
    if (wsInput) wsInput.addEventListener('input', (e) => { formData.website = e.target.value; triggerUrlScrape(); });
    const buInput = body.querySelector('#cpwBaseUrl');
    if (buInput) buInput.addEventListener('input', (e) => { formData.baseUrl = e.target.value; triggerUrlScrape(); });

    // Highlight selected radio on change
    body.querySelectorAll('input[type="radio"]').forEach((r) => {
      r.addEventListener('change', async () => {
        body.querySelectorAll(`input[name="${r.name}"]`).forEach((x) => {
          x.closest('.cpw-format-opt')?.classList.toggle('selected', x.checked);
        });
        // Auto-scrape favicon when "Website" logo is selected — website URL,
        // falling back to base URL so any entered URL populates the logo.
        if (r.name === 'cpwLogo' && r.value === 'website' && (formData.website || formData.baseUrl) && !formData.logoFetching) {
          formData.logoFetching = true;
          const previewWrap = body.querySelector('.cpw-logo-preview-wrap');
          if (previewWrap) previewWrap.innerHTML = '<span class="muted">Fetching favicon…</span>';
          const result = await cpService.scrapeFavicon(formData.website || formData.baseUrl);
          formData.logoFetching = false;
          const dataUrl = result?.ok && result.url?.startsWith('data:') ? result.url : null;
          formData.logoDataUrl = dataUrl;
          formData.logoUrl = dataUrl ? null : (result?.ok && result.url ? result.url : null);
          formData.logoSrc = dataUrl || formData.logoUrl ? 'website' : null;
          const preview = body.querySelector('.cpw-logo-preview-wrap');
          if (preview) {
            preview.innerHTML = formData.logoDataUrl
              ? `<div class="cpw-logo-preview"><img src="${formData.logoDataUrl}" alt="Logo" /></div>`
              : (formData.logoUrl
                ? `<div class="cpw-logo-preview"><img src="/api/ecosystem/logo?url=${encodeURIComponent(formData.logoUrl)}" alt="Logo" onerror="this.parentElement.innerHTML='<span class=muted>Not found</span>'" /></div>`
                : '<div class="cpw-logo-preview cpw-logo-fallback">' + esc(initials(formData.name)) + '</div>');
          }
        }
        if (r.name === 'cpwLogo' && r.value === 'initials') {
          formData.logoDataUrl = null;
          formData.logoUrl = null;
          formData.logoSrc = null;
          formData.logoFetching = false;
        }
        // Re-render step when logo choice changes so file input appears/disappears
        if (r.name === 'cpwLogo') {
          readForm();
          renderStep();
        }
      });
    });

    // File upload handler
    const fileInput = body.querySelector('#cpwLogoFile');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 500 * 1024) { notify.toast('File too large (max 500KB)', 'warning'); return; }
        const dataUrl = await fileToDataUrl(file);
        if (dataUrl) {
          formData.logoDataUrl = dataUrl;
          formData.logoUrl = null;
          formData.logoSrc = 'upload';
          const preview = body.querySelector('.cpw-logo-preview-wrap');
          if (preview) preview.innerHTML = `<div class="cpw-logo-preview"><img src="${dataUrl}" alt="Logo" /></div>`;
        }
      });
    }

    body.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        if (act === 'cancel') { ctrlRef?.close(); return; }
        if (act === 'back') { readForm(); step--; renderStep(); return; }
        if (act === 'next') {
          readForm();
          if (step === 1 && !formData.name.trim()) { notify.toast('Name is required', 'warning'); return; }
          if (step === 2 && formData.baseUrl && !isValidHttpsUrl(formData.baseUrl)) {
            notify.toast('Base URL must be a valid HTTPS URL', 'warning'); return;
          }
          step++;
          renderStep();
          return;
        }
        if (act === 'create') {
          // Read ALL fields from the DOM directly (step 4 has no inputs, so readForm won't help)
          const body = document.querySelector('.modal-card-body');
          if (body) {
            const n = body.querySelector('#cpwName');
            if (n) formData.name = n.value;
            const w = body.querySelector('#cpwWebsite');
            if (w) formData.website = w.value;
            const d = body.querySelector('#cpwDesc');
            if (d) formData.description = d.value;
            const u = body.querySelector('#cpwBaseUrl');
            if (u) formData.baseUrl = u.value;
            const f = body.querySelector('input[name="cpwFormat"]:checked');
            if (f) formData.format = f.value;
            const l = body.querySelector('input[name="cpwLogo"]:checked');
            if (l) formData.logoChoice = l.value;
          }
          if (!formData.name.trim()) { notify.toast('Name is required', 'warning'); return; }
          if (formData.baseUrl && !isValidHttpsUrl(formData.baseUrl)) {
            notify.toast('Base URL must be a valid HTTPS URL', 'warning'); return;
          }
          btn.disabled = true;
          btn.textContent = 'Creating…';
          try {
            // Build logo object. When the favicon was fetched from the website it's
            // persisted as a `data:` URL so the card renders it inline and loads
            // instantly on page refresh (no re-fetch).
            let logo;
            if (formData.logoDataUrl) {
              logo = { url: formData.logoDataUrl, source: formData.logoSrc || 'website', status: 'resolved' };
            } else if (formData.logoUrl) {
              logo = { url: formData.logoUrl, source: 'website', status: 'resolved' };
            } else {
              logo = { url: null, source: 'generated', status: 'available' };
            }

            const result = await cpService.createCustomProvider({
              name: formData.name, website: formData.website, description: formData.description,
              baseUrl: formData.baseUrl, format: formData.format, logo,
            });
            if (result?.ok) {
              const providerId = result.provider?.id;
              ctrlRef?.close();
              notify.toast(`"${formData.name}" created!`, 'success');

              // Fetch models from API/website
              if (providerId) {
                notify.toast('Fetching models…', 'info');
                let modelsResult = await cpService.fetchCustomProviderModels(providerId, Storage.getKey(providerId));
                if (modelsResult?.ok && modelsResult.models?.length) {
                  const fetchedModels = modelsResult.models.map(m => ({ ...m, source: 'fetched' }));
                  workspace.liveModels[providerId] = {
                    models: fetchedModels,
                    freeModels: fetchedModels.filter(isFreeModel),
                    source: { type: 'custom-api', fetchedAt: new Date().toISOString() },
                  };
                  notify.toast(`Found ${modelsResult.models.length} models`, 'success');
                } else {
                  notify.toast('No models found. You can add them manually from the provider detail.', 'info');
                }
              }

              if (window.renderCloudProviders) {
                window.renderCloudProviders({ registryFilter: 'custom' });
              }
            } else if (result?.duplicates?.length) {
              btn.disabled = false;
              btn.textContent = 'Create Provider';
              notify.toast(`Possible duplicate: ${result.duplicates[0]?.reason}`, 'warning');
            } else {
              btn.disabled = false;
              btn.textContent = 'Create Provider';
              notify.toast('Failed to create provider.', 'error');
            }
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Create Provider';
            notify.toast('Network error.', 'error');
          }
        }
      });
    });
  }

  const { close, overlay } = openModal({
    title: 'Add Custom Provider',
    subtitle: null,
    bodyHTML: `<div class="wizard-progress">${[1,2,3,4].map((s) => `<span class="wizard-step ${s === 1 ? 'active' : ''}">${s}</span>`).join('')}</div>${renderStep1()}`,
    onClose: () => { ctrlRef = null; },
  });
  ctrlRef = { close, overlay };
  bindStep();
}

// ─── Detail Modal ───
export async function openCustomProviderDetail(id) {
  const data = await cpService.getCustomProvider(id);
  if (!data?.provider) { notify.toast('Provider not found', 'error'); return; }
  const p = data.provider;
  const fmt = FORMAT_LABELS[p.api?.format] || 'Unknown';
  const key = Storage.getKey(p.id);
  const model = Storage.getModel(p.id);
  // One shared decision for custom (cst:) and adopted (dyn:) cards, identical to
  // the curated cards — an Anthropic-compatible provider is configured directly
  // and is never offered the local proxy as a second route.
  const { anthropic: anthropicSupported, proxy: showProxy } = claudeCodeCompatibility(p);
  const website = p.identity?.website || '';
  const sub = website ? (() => { try { return new URL(website).hostname; } catch { return website; } })() : '';
  // The raw record stores logo as {url, source, status}; the unified shape uses
  // a plain string. Normalise so rendering works for both.
  const logoUrl = typeof p.logo === 'string' ? p.logo : (p.logo?.url || null);
  // svgLogo() needs the curated-card presentation shape (name + accent).
  const logoP = { name: p.identity?.name || id, accent: '#6366f1' };

  // Auto-fetch models only when none are loaded yet. The live cache is
  // authoritative once populated (it comes from a live gateway fetch), so never
  // overwrite a fresh list with a stored snapshot — otherwise the picker count
  // can diverge from the card badge after a refresh.
  try {
    const stored = await cpService.getStoredModels(id);
    const cachedCount = workspace.liveModels[id]?.models?.length || 0;
    const storedCount = stored?.models?.length || 0;
    if (stored?.ok && storedCount && cachedCount === 0) {
      workspace.liveModels[id] = {
        models: stored.models.map(m => ({ ...m, source: m.source || 'fetched' })),
        freeModels: stored.models.filter(isFreeModel).map(m => ({ ...m, source: m.source || 'fetched' })),
        source: { type: 'server-stored', fetchedAt: new Date().toISOString() },
      };
    }
  } catch {}

  function getModelData() {
    const models = workspace.liveModels[id]?.models || [];
    const freeModels = models.filter(isFreeModel);
    return { models, freeModels, modelCount: models.length, freeCount: freeModels.length };
  }

  function renderModelPicker(host) {
    const { models, freeModels, modelCount, freeCount } = getModelData();
    const showPaid = Storage.getPaid(id);
    // Adopted (dyn:) providers get authoritative free/paid classification from
    // discovery pricing, so the toggle is respected strictly: "Include paid" off
    // shows ONLY free models (0 free → empty list, never a silent paid spillover).
    // Custom (cst:) providers keep the legacy fallback so an unclassified or
    // manually-entered list never renders as a blank picker.
    let listModels = showPaid ? models : freeModels;
    if (!showPaid && !listModels.length && models.length && !id.startsWith('dyn:')) listModels = models;
    const freeIds = new Set(freeModels.map(m => m.id));
    const hasLiveModels = models.length > 0;
    const currentModel = Storage.getModel(id);

    // Render up to this many rows at once; search always queries the full
    // dataset below, so deeper models stay reachable even when capped.
    const ALL_CAP = 400;

    // Building buttons from the full model data (never the pre-rendered DOM)
    // is what keeps the search box able to find every model — a previous
    // version only rendered the first 50 rows and filtered those, silently
    // hiding everything past them.
    function itemHtml(m) {
      return `<button type="button" class="mp-item ${currentModel === m.id ? 'sel' : ''}" data-id="${esc(m.id)}" role="option">
                <span class="mp-name">${esc(m.name || m.id)}</span>
                ${freeIds.has(m.id) ? '<span class="mp-free">free</span>' : ''}
                <span class="mp-id">${esc(m.id)}</span>
              </button>`;
    }

    function listHtml(items) {
      const capped = items.slice(0, ALL_CAP);
      const rows = items.length
        ? capped.map(itemHtml).join('')
        : (freeCount === 0 ? '<div class="mp-empty">No free models for this provider.</div>' : '<div class="mp-empty">No models match.</div>');
      return rows + (items.length > ALL_CAP ? `<div class="mp-empty">…and ${items.length - ALL_CAP} more</div>` : '');
    }

    function bindItems(container) {
      container.querySelectorAll('.mp-item').forEach(b => b.addEventListener('click', () => {
        container.querySelectorAll('.mp-item').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
        Storage.setModel(id, b.dataset.id);
        resetTestButton();
      }));
    }

    host.innerHTML = `
      <div class="model-picker">
        <label class="paid-toggle mp-paid"><input type="checkbox" ${showPaid ? 'checked' : ''}><span class="paid-track"></span><span class="paid-text">Include paid</span></label>
        <input class="inp mp-input" type="text" placeholder="Search models…" aria-label="Search models" />
        <div class="mp-list" role="listbox">
          ${hasLiveModels ? listHtml(listModels) : ''}
        </div>
        ${!hasLiveModels ? `<input class="inp" data-cp="model-input" type="text" value="${esc(currentModel)}" placeholder="Enter model ID (e.g. gpt-4o)" style="margin-top:8px" />` : ''}
      </div>
      <div class="cpw-model-list" style="margin-top:8px">
        ${!hasLiveModels && !modelCount ? '<div class="muted" style="padding:4px 0;font-size:12px">No models found for this provider.</div>' : ''}
      </div>`;

    // Wire model select from mp-list
    bindItems(host);

    // Wire model input fallback
    const modelInput = host.querySelector('[data-cp="model-input"]');
    if (modelInput) modelInput.addEventListener('input', () => { Storage.setModel(id, modelInput.value); resetTestButton(); });

    // A change of model invalidates a previous test result — show the base label.
    function resetTestButton() {
      // The test button lives in the modal body (sibling of this picker host),
      // so query from document; the dialog is modal so only one exists.
      const btn = document.querySelector('[data-act="test"]');
      if (!btn || btn.disabled) return; // don't clobber an in-flight test
      const prev = btn.textContent;
      if (prev.startsWith('Connection OK') || prev.startsWith('Failed (') || prev.startsWith('Error (')) {
        btn.textContent = 'Test Connection';
      }
    }

    // Wire paid toggle
    const paidCb = host.querySelector('.mp-paid input');
    if (paidCb) paidCb.addEventListener('change', (e) => { Storage.setPaid(id, e.target.checked); renderModelPicker(host); });

    // Wire search — filter the FULL model dataset and re-render the list, so
    // every model (beyond the first screenful) is reachable.
    const mpInput = host.querySelector('.mp-input');
    if (mpInput) mpInput.addEventListener('input', () => {
      const q = mpInput.value.trim().toLowerCase();
      const listEl = host.querySelector('.mp-list');
      if (!q) {
        listEl.innerHTML = listHtml(listModels);
        bindItems(listEl);
        return;
      }
      const matches = listModels.filter(m => ((m.name || '') + ' ' + m.id).toLowerCase().includes(q));
      listEl.innerHTML = listHtml(matches);
      bindItems(listEl);
    });
  }

  openModal({
    title: '',
    subtitle: 'Provider configuration',
    size: 'wide',
    bodyHTML: `<div class="pc">
      <div class="pc-head">
        <div class="pc-logo">${logoUrl
          ? (logoUrl.startsWith('data:')
            ? `<img src="${logoUrl}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display=''" /><span class="mono-fallback" style="display:none">${svgLogo(logoP)}</span>`
            : website
              ? `<img src="/api/ecosystem/logo?url=${encodeURIComponent(logoUrl)}" alt="" loading="lazy" onerror="if(!this.hu){this.hu=1;fetch('/api/custom-providers/favicon?url=${encodeURIComponent(website)}&format=data').then(r=>r.json()).then(d=>{if(d&&d.ok&&d.url){this.src=d.url}else{this.style.display='none';this.nextElementSibling.style.display=''}}).catch(()=>{this.style.display='none';this.nextElementSibling.style.display=''})}else{this.style.display='none';this.nextElementSibling.style.display=''}" /><span class="mono-fallback" style="display:none">${svgLogo(logoP)}</span>`
              : `<img src="/api/ecosystem/logo?url=${encodeURIComponent(logoUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display=''" /><span class="mono-fallback" style="display:none">${svgLogo(logoP)}</span>`)
          : `<span class="mono-fallback">${svgLogo(logoP)}</span>`
        }</div>
        <div class="pc-meta">
          <div class="pc-name">${esc(p.identity?.name || id)}</div>
          ${sub ? `<div class="pc-sub pc-sub-link" role="link" tabindex="0" title="Open ${esc(sub)}">${esc(sub)}</div>` : ''}
        </div>
        <span class="badge ${anthropicSupported ? 'cc' : 'browse'}">${anthropicSupported ? 'Claude Code' : 'Browse · API'}</span>
      </div>
      <p class="pc-desc">${esc(p.identity?.description || fmt)}</p>

      ${(id.startsWith('dyn:') || p.api?.baseUrl || Storage.getBaseUrl(id)) ? `
        <div class="lbl-row" style="display:flex;align-items:center;gap:6px">
          <label class="lbl" style="margin-bottom:0">Base URL</label>
          <span class="cp-baseurl-saved" style="display:none">Saved</span>
        </div>
        <input class="inp" id="cpDetailBaseUrl" type="text" value="${esc(Storage.getBaseUrl(id) || p.api?.baseUrl || '')}" placeholder="https://your-gateway.com/v1/" />` : ''}

      <label class="lbl">API Key</label>
      <div class="key-row">
        <input class="inp" id="cpDetailApiKey" type="password" value="${esc(key)}" placeholder="Enter API key…" />
        <button class="btn btn2 key-eye" type="button" data-act="toggle">show</button>
      </div>

      <label class="lbl">Model</label>
      <div id="cpDetailModelHost" class="pc-model-host"></div>

      <div class="modal-actions">
        <button class="btn btn2" data-act="test" type="button">Test Connection</button>
        ${showProxy ? '<button class="btn btn2" data-act="proxy" type="button">Use with Claude Code (via Nexference)</button>' : ''}
        <button class="btn btn-go" data-act="apply" type="button">${anthropicSupported ? 'Apply to Claude Code' : 'Show config'}</button>
      </div>

        <div data-cfg-host hidden></div>
        <div data-proxy-host hidden></div>

        <details class="intg-details">
        <summary>Provider Integration</summary>
        <div data-intg-host class="intg-section">Loading integration…</div>
      </details>
    </div>
    <div class="cpw-actions" style="margin-top:12px;display:flex;gap:8px;border-top:1px solid var(--border);padding-top:12px">
      <button class="btn btn2" type="button" id="cpDetailEditBtn">Edit</button>
      <button class="btn btn-sm" type="button" id="cpDetailDeleteBtn" style="color:var(--danger)">Delete</button>
    </div>`,
    onMount: (body, ctrl) => {
      // ── Wire the critical footer buttons FIRST ──
      // If anything later in onMount throws (picker rendering, integration
      // section, …) these must already be functional.

      // Edit button
      const editBtn = body.querySelector('#cpDetailEditBtn');
      editBtn?.addEventListener('click', async () => {
        editBtn.disabled = true;
        editBtn.textContent = 'Opening…';
        try {
          ctrl.close();
          await editCustomProviderFlow(id);
        } catch (e) {
          notify.toast('Failed to open editor: ' + (e?.message || e), 'error');
          editBtn.disabled = false;
          editBtn.textContent = 'Edit';
        }
      });

      // Delete button
      const deleteBtn = body.querySelector('#cpDetailDeleteBtn');
      deleteBtn?.addEventListener('click', async () => {
        const isAdopted = id.startsWith('dyn:');
        const ok = await confirmModal({
          title: isAdopted ? 'Delete adopted provider?' : 'Delete custom provider?',
          message: isAdopted
            ? `This removes "${p.identity?.name || id}" from the adopted providers registry. The original ecosystem discovery record is kept. This cannot be undone.`
            : `This permanently removes "${p.identity?.name || id}" and its stored models. This cannot be undone.`,
          confirmLabel: 'Delete', danger: true,
        });
        if (!ok) return;
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting…';
        try {
          const r = await cpService.deleteCustomProvider(id);
          if (r?.ok) {
            if (id.startsWith('dyn:')) await refreshDynamicIndex();
            notify.toast('Deleted', 'warning');
            delete workspace.liveModels[id];
            Storage.removeKey(id);
            Storage.removeBaseUrl(id);
            ctrl.close();
            if (window.renderCloudProviders) window.renderCloudProviders();
            if (window.renderGateways) window.renderGateways();
            if (window.renderWorkspace) window.renderWorkspace();
          } else {
            notify.toast('Delete failed', 'error');
            deleteBtn.disabled = false;
            deleteBtn.textContent = 'Delete';
          }
        } catch (e) {
          notify.toast('Delete failed: ' + (e?.message || e), 'error');
          deleteBtn.disabled = false;
          deleteBtn.textContent = 'Delete';
        }
      });

      // ── Everything below is non-critical and individually guarded ──

      const modelHost = body.querySelector('#cpDetailModelHost');
      try { renderModelPicker(modelHost); } catch (e) {
        console.error('model picker render failed', e);
      }

      const keyInput = body.querySelector('#cpDetailApiKey');
      keyInput?.addEventListener('input', () => Storage.setKey(id, keyInput.value));

      // Base URL — persisted exactly like the API key: the typed value is stored
      // locally on every keystroke (survives reloads) and, once the user pauses
      // and the URL is valid, it is also written back to the provider record so
      // the integration section / edit dialog / config path all stay in sync.
      const baseUrlInput = body.querySelector('#cpDetailBaseUrl');
      if (baseUrlInput) {
        let baseUrlTimer = null;
        let savedBaseUrl = p.api?.baseUrl || '';
        baseUrlInput.addEventListener('input', () => {
          const val = baseUrlInput.value.trim();
          Storage.setBaseUrl(id, val);
          if (val === savedBaseUrl) return;
          clearTimeout(baseUrlTimer);
          baseUrlTimer = setTimeout(async () => {
            if (val === savedBaseUrl) return;
            if (val && !/^https?:\/\/\S+$/i.test(val)) return;
            try {
              const r = await cpService.updateCustomProvider(id, { baseUrl: val });
              if (r?.ok) {
                savedBaseUrl = val;
                const rec = r.provider;
                p.api = p.api || {};
                p.api.baseUrl = rec?.api?.baseUrl || rec?.integration?.baseUrl || savedBaseUrl;
                const savedLabel = body.querySelector('.cp-baseurl-saved');
                if (savedLabel) {
                  savedLabel.style.display = 'inline-flex';
                  clearTimeout(savedLabel._t);
                  savedLabel._t = setTimeout(() => { savedLabel.style.display = 'none'; }, 2500);
                }
              }
            } catch { /* network offline / server restart pending — Storage has the value */ }
          }, 700);
        });
      }

      const eye = body.querySelector('[data-act="toggle"]');
      eye?.addEventListener('click', () => {
        const showing = keyInput.type === 'text';
        keyInput.type = showing ? 'password' : 'text';
        eye.textContent = showing ? 'show' : 'hide';
      });

      // Website link
      const pcSub = body.querySelector('.pc-sub');
      if (pcSub && sub) {
        const goSite = () => window.open(website, '_blank', 'noopener');
        pcSub.addEventListener('click', goSite);
        pcSub.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goSite(); } });
      }

      // Test connection — uses the model currently highlighted in the picker
      // (exactly like curated cards), not the possibly-stale Storage value.
      // No artificial timeout: a healthy gateway may need time to handshake a
      // model, so we let the underlying request finish.
      body.querySelector('[data-act="test"]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const apiKey = keyInput.value;
        if (!apiKey) { notify.toast('Enter an API key first', 'warning'); return; }
        const baseUrl = (body.querySelector('#cpDetailBaseUrl')?.value?.trim()) || p.api?.baseUrl || '';
        const fmt = p.api?.format || 'openai';
        const hostEl = body.querySelector('#cpDetailModelHost');
        const selected = hostEl?.querySelector('.mp-item.sel')?.dataset?.id || '';
        const modelVal = selected || Storage.getModel(id) || '';
        btn.disabled = true;
        btn.textContent = 'Testing…';
        const startedAt = Date.now();
        const timer = setInterval(() => {
          btn.textContent = `Testing… ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
        }, 100);
        const done = (label) => {
          clearInterval(timer);
          btn.disabled = false;
          btn.textContent = `${label} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`;
        };
          try {
            const qs = new URLSearchParams({ url: baseUrl, key: apiKey, format: fmt });
            if (modelVal) qs.set('model', modelVal);
            const res = await fetch(`/api/test?${qs.toString()}`);
            const result = await res.json();
            if (result.status && result.status >= 200 && result.status < 300) {
              notify.toast('Connection successful!', 'success');
              done('Connection OK');
            } else {
              notify.toast(`Failed: ${describeProbeFailure(result)}`, 'error');
              done('Failed');
            }
          } catch (err) { notify.toast(`Error: ${err.message}`, 'error'); done('Error'); }
        });

      // Apply / show config
      body.querySelector('[data-act="apply"]')?.addEventListener('click', async () => {
        const apiKey = keyInput.value;
        const modelVal = Storage.getModel(id) || '';
        if (!apiKey) { notify.toast('Enter an API key first', 'warning'); return; }
        if (!modelVal) { notify.toast('Select or enter a model', 'warning'); return; }
        const baseUrl = (body.querySelector('#cpDetailBaseUrl')?.value?.trim()) || p.api?.baseUrl || '';
        Storage.setKey(id, apiKey);
        Storage.setBaseUrl(id, baseUrl);
        Storage.setModel(id, modelVal);

        const provider = {
          id: p.id, name: p.identity?.name || id, format: p.api?.format || 'openai',
          baseUrl, publicModels: false,
        };
        const cfg = configEngine.buildClaudeSettings(provider, baseUrl, modelVal, apiKey);

        if (anthropicSupported) {
          const ok = await LocalSettingsRuntime.write(cfg);
          if (ok) {
            workspace.applied = { client: 'claude-code', connectionType: 'cloud', provider: p.id, model: modelVal, appliedAt: new Date().toISOString(), status: 'configured' };
            workspace.appliedProviderId = p.id;
            workspace.activeProvider = p.id;
            workspace.activeModel = modelVal;
            workspace.activeClient = 'claude-code';
            Storage.setApplied(workspace.applied);
            notify.toast(`Applied ${p.identity?.name || id} to Claude Code!`, 'success');
            if (window.renderWorkspace) window.renderWorkspace();
            if (window.updateShellStatus) window.updateShellStatus();
            if (window.syncAppliedHighlights) window.syncAppliedHighlights();
          }
          } else {
            // Render inline rather than CopyableRuntime.show(), which calls
            // openModal() and APPENDS an overlay — that stacked a second dialog on
            // top of this one, so dismissing the config view revealed the provider
            // dialog again instead of the card.
            const cfgHost = body.querySelector('[data-cfg-host]');
            const cfgText = JSON.stringify(cfg, null, 2);
            const meta = configClientMeta(cfg);
            const fmt = p.api?.format || 'openai';
            if (cfgHost) {
              cfgHost.hidden = false;
              cfgHost.innerHTML = `
                <div class="px-note-row">
                  <span class="wizard-title">${esc(meta.title)}</span>
                  <button class="btn btn2 sm" data-cp-cfg-close type="button">Hide</button>
                </div>
                <p class="px-note">${esc(meta.sub)}</p>
                <p class="px-hint px-hint-warn">Claude Code only reads <code>ANTHROPIC_*</code> variables, so this config has no effect on it. Use the Nexference local proxy to route Claude Code through ${esc(p.identity?.name || id)}.</p>
                <pre class="code config-code pc-cfg-code">${esc(cfgText)}</pre>
                <div class="px-actions">
                  <button class="btn btn2" data-cp-cfg-copy type="button">Copy config</button>
                  ${fmt === 'openai' ? '<button class="btn btn-go" data-cp-cfg-to-proxy type="button">Set up Claude Code instead</button>' : ''}
                </div>`;
              cfgHost.querySelector('[data-cp-cfg-close]')?.addEventListener('click', () => {
                cfgHost.hidden = true; cfgHost.innerHTML = '';
              });
              cfgHost.querySelector('[data-cp-cfg-copy]')?.addEventListener('click', () => {
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(cfgText)
                    .then(() => notify.toast('Config copied to clipboard', 'success'))
                    .catch(() => notify.toast('Copy failed — select the text manually', 'error'));
                } else {
                  const ta = document.createElement('textarea');
                  ta.value = cfgText; ta.style.position = 'fixed'; ta.style.opacity = '0';
                  document.body.appendChild(ta); ta.select();
                  try { document.execCommand('copy'); notify.toast('Config copied to clipboard', 'success'); }
                  catch { notify.toast('Copy failed — select the text manually', 'error'); }
                  ta.remove();
                }
              });
              cfgHost.querySelector('[data-cp-cfg-to-proxy]')?.addEventListener('click', () => {
                cfgHost.hidden = true; cfgHost.innerHTML = '';
                const pxHost = body.querySelector('[data-proxy-host]');
                const pxBtn = body.querySelector('[data-act="proxy"], [data-cp-proxy-toggle]');
                if (pxHost) pxHost.hidden = false;
                if (pxBtn) pxBtn.textContent = 'Hide Claude Code setup';
                pxHost?.querySelector('[data-px-verify]')?.focus();
              });
            }
          }
      });

      // Use with Claude Code (via Nexference) — OpenAI-compatible providers only.
      // Expands the proxy panel INSIDE this dialog (no second modal), and passes
      // this dialog's live key field so the connect uses what the user just typed
      // rather than a possibly stale stored key.
      const proxyHost = body.querySelector('[data-proxy-host]');
      const proxyBtn = body.querySelector('[data-act="proxy"]');
      proxyBtn?.addEventListener('click', async () => {
        if (!proxyHost) return;
        const opening = proxyHost.hidden;
        if (!opening) { proxyHost.hidden = true; proxyBtn.textContent = 'Use with Claude Code (via Nexference)'; return; }
        proxyHost.hidden = false;
        proxyBtn.textContent = 'Hide Claude Code setup';
        await renderProxyPanel(proxyHost, p, id, { getApiKey: () => keyInput?.value || '' });
      });
      // If the proxy is already armed for THIS provider, show the panel up front
      // so the connection state is visible without an extra click.
      if (proxyHost) {
        localProxyStatus().then(async (s) => {
          if (s?.ok && s.data?.armed && s.data.providerId === id) {
            proxyHost.hidden = false;
            if (proxyBtn) proxyBtn.textContent = 'Hide Claude Code setup';
            await renderProxyPanel(proxyHost, p, id, { getApiKey: () => keyInput?.value || '' });
          }
        }).catch(() => {});
      }

      // Provider Integration section — the custom ID contains a colon ("cst:…")
      // which is invalid inside a CSS ID selector (parsed as a pseudo-class,
      // throwing a DOMException). Query by attribute value instead.
      const intgHost = body.querySelector('[data-intg-host]');
      if (intgHost) {
        import('../ui/providerIntegrations.js').then(({ integrationSectionHTML }) => {
          integrationSectionHTML(id).then(html => { intgHost.innerHTML = html; });
        }).catch(() => { intgHost.innerHTML = 'Integration unavailable'; });
      }
      body.addEventListener('click', (e) => {
        const t = e.target.closest('[data-intg-action]');
        if (t && window.integrationAction) window.integrationAction(t.dataset.intgAction, t.dataset.id);
      });
    },
  });
}

// ─── Claude Code via Nexference (inline panel) ───
//
// This renders INSIDE the provider's own configuration dialog instead of opening
// a second modal. The old flow was: open the provider dialog → click "Use with
// Claude Code (via Nexference)" → a whole new dialog replaced it, so the key and
// model you had just typed were no longer on screen and the extra step read as
// two separate tasks. Curated, custom (cst:) and adopted (dyn:) cards all mount
// this same panel, so they behave identically.
//
// `getApiKey` lets the host dialog hand over its live key field, which is more
// reliable than re-reading Storage — the old code only knew about the custom
// dialog's `#cpDetailApiKey` and silently fell back to a stale stored key for
// every other card type.

function proxyDisplayUrl() {
  return `http://127.0.0.1:${window.location.port || 3000}/v1/messages`;
}

// Resolve the provider's REAL model list for the proxy picker. The workspace
// cache is often empty for a freshly keyed provider (the startup fetch runs
// keyless and most gateways 401 without a key), which would leave the panel
// with an empty dropdown and force the user to type a model id by hand. The key
// is passed transiently to the server for this one fetch and is never stored
// here. Returns [] when nothing can be resolved so the caller can fall back to
// manual entry.
  const isCustomId = (id) => typeof id === 'string' && id.startsWith('cst:');

  // The server classifies free/paid with provider-specific rules (NVIDIA's
  // keyless catalogue, Mistral's servable-only filter, TokenRouter's pricing API)
  // and returns the result as a SEPARATE `freeModels` array. Individual model
  // objects carry `pricing: null` and no free flag, so recomputing it here with
  // isFreeModel() found 0 free models for providers that genuinely have many —
  // NVIDIA reported "82 available" with no free count despite 59 free models.
  // Tag the server's free set onto the models instead, so the badge, the picker's
  // per-row "free" tag, and the free/paid filter all read the same authority.
  function tagFreeModels(models, freeModels) {
    if (!Array.isArray(freeModels) || !freeModels.length) return models;
    const freeIds = new Set(freeModels.map((m) => m?.id || m?.modelId || m?.name).filter(Boolean));
    if (!freeIds.size) return models;
    return models.map((m) => (freeIds.has(m?.id) ? { ...m, accessType: 'free', isFree: true } : m));
  }

  async function resolveProxyModels(id, apiKey) {
    const cached = workspace.liveModels[id]?.models || [];
    if (cached.length) return cached;
    if (!apiKey && !isCustomId(id)) return [];
    try {
      // Custom (cst:) providers must use their OWN endpoint. /api/refresh-models
      // only resolves curated ids, so calling it with a cst: id returned
      // 404 "Unknown provider" for every custom card — which is why the proxy
      // panel always fell through to the "enter a model ID" fallback and never
      // showed a real model list, even when the provider had hundreds of models.
      const url = isCustomId(id)
        ? `/api/custom-providers/${encodeURIComponent(id)}/fetch-models${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`
        : '/api/refresh-models';
      const opts = { method: isCustomId(id) ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } };
      if (!isCustomId(id)) opts.body = JSON.stringify({ providerId: id, key: apiKey });
      const r = await fetch(url, opts);
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) return [];
      const models = tagFreeModels(
        (j.models || []).filter((m) => m && (m.id || m.name)),
        j.freeModels
      );
      if (models.length) {
        // Cache client-side so the picker/other views agree on this list.
        workspace.liveModels[id] = {
          models: models.map((m) => ({ ...m, source: 'fetched' })),
          freeModels: models.filter(isFreeModel).map((m) => ({ ...m, source: 'fetched' })),
          source: { type: 'custom-api', fetchedAt: new Date().toISOString() },
        };
      }
      return models;
    } catch { return []; }
  }

// Pre-flight check of the provider key/model BEFORE arming the proxy. Arming
// rewrites ~/.claude/settings.json, so connecting with a bad key leaves Claude
// Code pointed at a proxy that can only ever return auth errors — and the user
// has to arm, restart, fail, then diagnose. This hits the same /api/test probe
// the provider dialog's Test Connection button uses, so the answer is the same
// one they'd get manually.
async function verifyProxyUpstream(p, id, apiKey, model) {
  const baseUrl = p?.api?.baseUrl || p?.baseUrl || Storage.getBaseUrl(id) || '';
  if (!baseUrl || !apiKey) return { ok: false, reason: 'missing url or key' };
  // Always send a concrete model. Omitting it made the server probe with a
  // hardcoded gpt-4o-mini, which doesn't exist on NVIDIA/Groq/Together/
  // TokenRouter — so "Verify key" reported a bogus "model not found" failure on
  // a perfectly good key. Pick a real model from this provider's own catalogue.
  let chosen = String(model || '').trim();
  if (!chosen) {
    try {
      const list = await resolveProxyModels(id, apiKey);
      chosen = list.find((m) => m.id)?.id || list[0]?.id || '';
    } catch { /* fall through to the stored/typed model */ }
    if (!chosen) chosen = String(Storage.getModel(id) || '').trim();
  }
  try {
    const qs = new URLSearchParams({ url: baseUrl, key: apiKey, format: p?.api?.format || p?.format || 'openai' });
    if (chosen) qs.set('model', chosen);
      const res = await fetch(`/api/test?${qs.toString()}`);
      const j = await res.json().catch(() => ({}));
      if (j.status >= 200 && j.status < 300) return { ok: true };
      return { ok: false, reason: describeProbeFailure(j) };
    } catch (err) {
      return { ok: false, reason: err?.message || 'unreachable' };
    }
  }



  // The badge sat silent when a provider had 0 free models, so "12 available"
  // read as "some of these are free" to anyone hunting for a free tier — which is
  // exactly the question the badge exists to answer. State the free count
  // either way, and surface a paid warning so the free-only intent is explicit.
  // Claude Code drives the model through tool calls, so a model that reports no
  // tool-calling support — or that only generates images — can never work here,
  // no matter how many tokens it is willing to spend. Offering them produced a
  // bare 404 ("please check the model you provided") with nothing to act on, so
  // the proxy picker now hides them and says how many it hid.
  function claudeCodeUsableModels(models) {
    if (!Array.isArray(models) || !models.length) return { usable: models || [], hidden: 0 };
    const usable = [], hidden = [];
    for (const m of models) {
      const noTools = m.supports_tool_calling === false;
      const imageOnly = m.supports_image_generation === true && m.supports_tool_calling !== true;
      (noTools || imageOnly) ? hidden.push(m) : usable.push(m);
    }
    // Only narrow the list when the gateway actually told us something. If no
    // model carries the flags (most providers), the catalogue is unchanged —
    // assuming "no tool support" from a missing field would empty every picker.
    return { usable, hidden: usable.length ? hidden.length : 0 };
  }

  function modelsBadge(models, freeCount) {
    const total = models.length;
    if (!total) return 'no list yet';
    if (freeCount > 0) return `${total} available · ${freeCount} free`;
    return `${total} available · none free`;
  }

  // Renders the panel into `host` and binds its actions. Re-invoked after every
// state change (connect / disconnect / refresh) so it always reflects the real
// proxy session.
export async function renderProxyPanel(host, p, id, { getApiKey } = {}) {
  if (!host) return;
  const readKey = () => {
    const live = typeof getApiKey === 'function' ? getApiKey() : '';
    return (live && live.trim()) || Storage.getKey(id) || '';
  };

  const st = await localProxyStatus();
  const status = st.ok && st.data ? st.data : null;
  const armed = !!(status && status.armed);
  // Only this provider's session counts — another card may be armed.
  const armedHere = armed && status.providerId === id;
  const allModels = await resolveProxyModels(id, readKey());
  // Hide models that cannot run under Claude Code (no tool calling / image-only)
  // so the picker can't hand the user a model that is guaranteed to 404.
  const { usable: models, hidden: hiddenModels } = claudeCodeUsableModels(allModels);
  const currentModel = Storage.getModel(id) || models[0]?.id || '';
  const providerName = p?.identity?.name || p?.name || id;
  const proxyUrl = armedHere ? (status.proxyUrl || proxyDisplayUrl()) : proxyDisplayUrl();
  const freeCount = models.filter(isFreeModel).length;
  // Preserved across the re-render that follows connect/disconnect/refresh, so
  // the search box does not reset to empty every time the panel re-renders.
  let modelQuery = '';
  // Claude Code is configured to talk to the proxy but we hold no session — the
  // state a Nexference restart leaves behind, since the upstream key is never
  // persisted and so the session cannot be restored silently.
  const orphaned = !armed && !!status?.settingsOrphaned;

  host.hidden = false;
  host.innerHTML = `
    <div class="px-panel" data-state="${armedHere ? 'armed' : 'idle'}">
      ${orphaned ? `
        <div class="px-warn">
          <span class="px-warn-ico" aria-hidden="true">!</span>
          <span class="px-warn-text">Proxy not armed, but Claude Code still points at it${status.orphanedModel ? ` (<b class="mono">${esc(status.orphanedModel)}</b>)` : ''} — reconnect below.</span>
        </div>` : ''}
      <div class="px-head">
        <div class="px-head-main">
          <span class="px-title">Claude Code via Nexference</span>
          <span class="px-sub">${esc(providerName)}</span>
        </div>
        <span class="px-status ${armedHere ? 'is-on' : 'is-off'}"><i class="px-dot"></i>${armedHere ? 'Connected' : 'Not connected'}</span>
      </div>

      <div class="px-flow" aria-hidden="true">
        <span class="px-node">Claude Code</span>
        <span class="px-arrow">→</span>
        <span class="px-node px-node-mid">Nexference proxy</span>
        <span class="px-arrow">→</span>
        <span class="px-node">${esc(providerName)}</span>
      </div>

      <!-- The model Claude Code will actually run on. Always visible, in BOTH
           states: when connected it is the live session's model, and before
           connecting it is the row highlighted in the picker below, so the
           choice is never hidden behind a scrollable list. This replaces the
           old duplicated "Model" tile. -->
      <div class="px-selected" data-pd="selectedRow">
        <div class="px-selected-top">
          <span class="px-selected-label">Selected model</span>
          <button class="px-copy" data-pd="copyModel" type="button" title="Copy model id">Copy</button>
        </div>
        <b class="mono px-selected-value" data-pd="selectedModel">${esc(armedHere ? (status.model || '—') : (currentModel || 'none selected'))}</b>
      </div>

      <dl class="px-meta">
        <div class="px-meta-row">
          <dt>Proxy URL</dt>
          <dd>
            <span class="mono" title="${esc(proxyUrl)}">${esc(proxyUrl)}</span>
            <button class="px-copy" data-pd="copyUrl" type="button" title="Copy proxy URL">Copy</button>
          </dd>
        </div>
        ${armedHere ? `<div class="px-meta-row"><dt>Connected</dt><dd>${esc(relTime(status.armedAt) || 'just now')}</dd></div>` : ''}
        ${armedHere ? `<div class="px-meta-row"><dt>Upstream key</dt><dd>held in memory only</dd></div>` : ''}
      </dl>

      ${armedHere ? `
        <p class="px-note"><strong>Connected.</strong> Requests are translated to ${esc(providerName)} behind the scenes. <code>~/.claude/settings.json</code> holds only a random Nexference token — your ${esc(providerName)} key never leaves memory. <strong>Restart Claude Code</strong> to apply.</p>
      ` : `
        <p class="px-note">Point Claude Code at this OpenAI-compatible provider. Nexference takes Anthropic requests on the local proxy and translates them to ${esc(providerName)}; the upstream key stays in memory and is never written to disk.</p>
      `}

      ${armedHere ? '' : `
        <div class="px-field">
          <div class="px-field-head">
            <label class="lbl">Model</label>
            ${models.length ? `<span class="px-hint">${modelsBadge(models, freeCount)}${hiddenModels ? ` · ${hiddenModels} hidden (no tool calling)` : ''}</span>` : '<span class="px-hint">no list yet</span>'}
          </div>
        ${models.length ? `
          <div class="model-picker px-picker" data-pd="picker">
            <input class="inp mp-input" data-pd="modelSearch" type="text" placeholder="Search ${models.length} models…" aria-label="Search models" value="${esc(modelQuery)}" />
            <div class="mp-list" data-pd="modelList" role="listbox"></div>
          </div>` : `
          <input class="inp" data-pd="modelInput" type="text" value="${esc(currentModel)}" placeholder="Enter model ID (e.g. gpt-4o)" />`}
        ${models.length ? '' : '<span class="px-hint px-hint-warn">No model list available — enter an exact model ID. Adding a key usually populates this list.</span>'}
      </div>`}

      <div class="px-actions">
        ${armedHere
          ? `<button class="btn btn2" data-pd="disconnect" type="button">Disconnect</button>
             <button class="btn btn2" data-pd="refresh" type="button">Refresh status</button>`
          : `<button class="btn btn-go" data-pd="connect" type="button">Connect &amp; configure Claude Code</button>
             <button class="btn btn2" data-pd="verify" type="button">Verify key</button>
             <button class="btn btn2" data-pd="refresh" type="button">Refresh status</button>`}
      </div>
      <div data-pd="note" class="px-feedback"></div>
    </div>`;

  const note = host.querySelector('[data-pd="note"]');
  const setNote = (msg, kind = '') => {
    if (note) note.innerHTML = msg ? `<p class="px-msg ${kind}">${esc(msg)}</p>` : '';
  };

  // ── Model selection ──
  // A native <select> was unusable here: OpenRouter alone has 458 models, with no
  // search and no type-to-jump, and the two big gateways (OpenRouter, TokenRouter)
  // use namespaced ids, so the visible label rarely matched what you needed. This
  // reuses the app's existing .model-picker classes so it looks and behaves like
  // every other model list in the product. The selection is held in `chosen` and
  // written straight to Storage, so it survives the re-render that follows a
  // connect/disconnect/refresh instead of snapping back to the first model.
  let chosen = currentModel;
  const listEl = host.querySelector('[data-pd="modelList"]');
  const searchEl = host.querySelector('[data-pd="modelSearch"]');
  const selectedEl = host.querySelector('[data-pd="selectedModel"]');

  // Keep the "Selected model" row in step with the picker and the free-text
  // fallback, so the model Claude Code will use is always on screen.
  const paintSelected = (val) => {
    if (!selectedEl) return;
    const text = val || 'none selected';
    selectedEl.textContent = text;
    selectedEl.title = text;
    selectedEl.classList.toggle('is-empty', !val);
  };
  paintSelected(armedHere ? (status.model || '') : chosen);

  const drawList = () => {
    if (!listEl) return;
    const q = (searchEl?.value || modelQuery || '').trim().toLowerCase();
    const matches = q
      ? models.filter((m) => `${m.name || ''} ${m.id}`.toLowerCase().includes(q))
      : models;
    if (!matches.length) {
      listEl.innerHTML = `<div class="mp-empty">No model matches “${esc(q)}”.</div>`;
      return;
    }
    listEl.innerHTML = matches.slice(0, 400).map((m) => `
      <button type="button" class="mp-item ${chosen === m.id ? 'sel' : ''}" data-id="${esc(m.id)}" role="option" aria-selected="${chosen === m.id}">
        <span class="mp-name">${esc(m.name || m.id)}</span>
        ${isFreeModel(m) ? '<span class="mp-free">free</span>' : ''}
        <span class="mp-id">${esc(m.id)}</span>
      </button>`).join('')
      + (matches.length > 400 ? `<div class="mp-empty">…and ${matches.length - 400} more — refine your search</div>` : '');
    listEl.querySelectorAll('.mp-item').forEach((b) => b.addEventListener('click', () => {
      chosen = b.dataset.id;
      Storage.setModel(id, chosen);
      paintSelected(chosen);
      drawList();
    }));
  };
  if (listEl) drawList();
  searchEl?.addEventListener('input', () => { modelQuery = searchEl.value; drawList(); });
  // Free-text path (no model list resolved) updates the row as you type.
  host.querySelector('[data-pd="modelInput"]')?.addEventListener('input', (e) => {
    chosen = e.currentTarget.value.trim();
    paintSelected(chosen);
  });

  const readModel = () => (
    host.querySelector('[data-pd="modelInput"]')?.value
    || chosen
    || Storage.getModel(id)
    || ''
  ).trim();

  // Standalone key check, so the user can confirm credentials BEFORE letting the
  // panel rewrite settings.json.
  host.querySelector('[data-pd="verify"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const model = readModel();
    const apiKey = readKey();
    if (!apiKey) { setNote('Enter an API key for this provider first.', 'err'); return; }
    btn.disabled = true;
    btn.textContent = 'Verifying…';
    setNote(`Checking the key against ${providerName}…`);
    const v = await verifyProxyUpstream(p, id, apiKey, model);
    if (v.ok) {
      setNote(`Key works — ${providerName} accepted it${model ? ` for ${model}` : ''}.`, 'ok');
      notify.toast('Key verified', 'success');
    } else {
      setNote(`Key rejected: ${v.reason}`, 'err');
      notify.toast('Key verification failed', 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Verify key';
  });

  // Clipboard: the async Clipboard API only exists in a SECURE context. It works
  // on http://localhost, but not when the dashboard is opened over a LAN address
  // (http://192.168.x.x:3000) — a common way to reach it from another machine,
  // notably on Windows. So guard on the API's existence and fall back to the
  // legacy execCommand path, matching copyConfigText() in app.js.
  const legacyCopy = (text) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  };
  const copyText = async (text, btn, label) => {
    if (!text) { notify.toast(`No ${label} to copy`, 'warning'); return; }
    let ok = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
    }
    if (!ok) ok = legacyCopy(text);
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    if (ok) notify.toast(`${label} copied`, 'success');
    else notify.toast('Copy failed — select the text manually', 'error');
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  };
  host.querySelector('[data-pd="copyUrl"]')?.addEventListener('click', (e) => copyText(proxyUrl, e.currentTarget, 'Proxy URL'));
  host.querySelector('[data-pd="copyModel"]')?.addEventListener('click', (e) => {
    const val = selectedEl?.textContent?.trim();
    copyText(val && val !== 'none selected' ? val : '', e.currentTarget, 'Model id');
  });

  host.querySelector('[data-pd="connect"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const model = readModel();
    if (!model) { setNote('Select or enter a model first.', 'err'); return; }
    const apiKey = readKey();
    if (!apiKey) { setNote('Enter an API key for this provider first.', 'err'); return; }
    btn.disabled = true;
    btn.textContent = 'Checking key…';
    // Pre-flight before touching settings.json: arming with a bad key leaves
    // Claude Code aimed at a proxy that can only return auth errors.
    setNote(`Verifying the key against ${providerName}…`);
    const v = await verifyProxyUpstream(p, id, apiKey, model);
    if (!v.ok) {
      setNote(`Key check failed: ${v.reason}. Fix the key or model, then try again — nothing was changed.`, 'err');
      notify.toast('Key check failed — not connected', 'error');
      btn.disabled = false;
      btn.textContent = 'Connect & configure Claude Code';
      return;
    }
    btn.textContent = 'Connecting…';
    setNote('Key verified. Connecting and updating Claude Code settings…');
    const r = await armLocalProxy({ providerId: id, model, apiKey });
    if (r.ok) {
      // The proxy rewrites ANTHROPIC_BASE_URL to the local proxy address, so the
      // base-URL match in loadConfig can never resolve this card on its own. Set
      // the active id here (and mirror it into the persisted record) so the
      // "active" highlight survives a reload.
      workspace.appliedProviderId = id;
      workspace.applied = {
        client: 'claude-code', connectionType: 'proxy', provider: id,
        runtime: null, model, appliedAt: new Date().toISOString(), status: 'configured',
      };
      Storage.setApplied(workspace.applied);
      Storage.setModel(id, model);
        // Deliberate primary apply — keep an armed fallback plan in step.
        syncFallbackPrimary(workspace.applied);
      window.syncAppliedHighlights?.();
      notify.toast(`Claude Code now runs on ${providerName} via Nexference — restart Claude Code to apply`, 'success');
    } else {
      const msg = r.data?.error || (r.status ? `HTTP ${r.status}` : 'Nexference server unreachable');
      setNote(`Could not connect: ${msg}`, 'err');
      notify.toast(`Failed to connect: ${msg}`, 'error');
    }
    await renderProxyPanel(host, p, id, { getApiKey });
  });

  host.querySelector('[data-pd="disconnect"]')?.addEventListener('click', async () => {
    const r = await disarmLocalProxy();
    if (r.ok) {
      const msg = (r.data?.hadPrevious && r.data?.restored)
        ? 'Disconnected. Previous Claude Code configuration restored.'
        : (r.data?.hadPrevious ? `Disconnected. Restore incomplete: ${r.data.error || 'unknown'}` : 'Disconnected. No previous configuration to restore.');
      notify.toast(msg, 'success');
      // Disconnecting drops the proxy from settings.json, so the card is no
      // longer the active one — clear the highlight instead of leaving a stale glow.
      if (workspace.applied?.connectionType === 'proxy') {
        workspace.applied = null;
        workspace.appliedProviderId = null;
        Storage.setApplied(null);
        window.syncAppliedHighlights?.();
      }
    } else {
      setNote(`Disconnect failed: ${r.data?.error || `HTTP ${r.status}`}`, 'err');
    }
    await renderProxyPanel(host, p, id, { getApiKey });
  });

  host.querySelector('[data-pd="refresh"]')?.addEventListener('click', () => renderProxyPanel(host, p, id, { getApiKey }));
}

// ─── Global action dispatcher ───
export function initCustomProviderActions() {
  window.openCustomProvider = openCustomProviderDetail;
  window.openAddCustomProviderWizard = openAddCustomProviderWizard;
  window.deleteCustomProviderFromCard = async (id) => {
    const ok = await confirmModal({
      title: 'Delete custom provider?',
      message: 'This permanently removes the provider and its stored models. This cannot be undone.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    const r = await cpService.deleteCustomProvider(id);
    if (r?.ok) {
      if (id.startsWith('dyn:')) await refreshDynamicIndex();
      notify.toast('Deleted', 'warning');
      delete workspace.liveModels[id];
      Storage.removeKey(id);
      Storage.removeBaseUrl(id);
      if (window.renderCloudProviders) window.renderCloudProviders();
      if (window.renderGateways) window.renderGateways();
    }
  };
}

async function editCustomProviderFlow(id) {
  const data = await cpService.getCustomProvider(id);
  if (!data?.provider) { notify.toast('Provider not found', 'error'); return; }
  const p = data.provider;
  const isCustom = String(id).startsWith('cst:');
  // cst records store logo as { url, source, status }; adopted shapes carry a
  // plain URL string. Normalise to a displayable URL.
  const curLogo = (p.logo && typeof p.logo === 'object' && p.logo.url) ? p.logo.url : (typeof p.logo === 'string' ? p.logo : null);
  const curFmt = p.api?.format || 'unknown';
  const website = p.identity?.website || '';
  const websiteHost = (() => { try { return new URL(website).hostname; } catch { return website.replace(/^https?:\/\//, ''); } })();

  // Logo editor state (only used for cst: custom providers).
  let logoChoice = 'keep';       // keep | website | file | initials
  let logoDataUrl = null;        // staged data: URL for website/file choices

  const nameOf = () => (p.identity?.name || p.name || '?');
  const initialsOf = (name) => `${esc(initials(name))}`;
  const avatarFallback = (name) => `<span class="cp-edit-avatar-fb">${initialsOf(name)}</span>`;
  const previewFallback = (name) => `<div class="cpw-logo-preview cpw-logo-fallback">${initialsOf(name)}</div>`;

  // Renders the current/selected logo into the header avatar AND the preview
  // wrap. The avatar is a compact tile; the preview is the larger square. Remote
  // http(s) URLs render through the ecosystem logo proxy with a graceful
  // initials fallback when the image fails to load. A data: URL is inlined.
  function renderLogo(avatar, wrap, { busy = false } = {}) {
    const name = nameOf();
    if (wrap) {
      if (busy) { wrap.innerHTML = '<span class="muted">Fetching favicon…</span>'; }
      else {
        const url = logoDataUrl || (logoChoice === 'keep' ? curLogo : null);
        if (url && url.startsWith('data:')) {
          wrap.innerHTML = `<div class="cpw-logo-preview"><img src="${url}" alt="Logo preview" onerror="this.parentElement.innerHTML='${previewFallback(name).replace(/"/g, '&quot;')}'" /></div>`;
        } else if (url) {
          const fb = previewFallback(name).replace(/"/g, '&quot;');
          wrap.innerHTML = `<div class="cpw-logo-preview"><img src="/api/ecosystem/logo?url=${encodeURIComponent(url)}" alt="Logo preview" loading="lazy" onerror="this.parentElement.innerHTML='${fb}'" /></div>`;
        } else {
          wrap.innerHTML = previewFallback(name);
        }
      }
    }
    if (avatar) {
      const url = logoDataUrl || (logoChoice === 'keep' ? curLogo : null);
      if (url && url.startsWith('data:')) {
        avatar.innerHTML = `<img src="${url}" alt="Logo" onerror="this.outerHTML='${avatarFallback(name).replace(/"/g, '&quot;')}'" />`;
      } else if (url) {
        avatar.innerHTML = `<img src="/api/ecosystem/logo?url=${encodeURIComponent(url)}" alt="Logo" loading="lazy" onerror="this.outerHTML='${avatarFallback(name).replace(/"/g, '&quot;')}'" />`;
      } else {
        avatar.innerHTML = avatarFallback(name);
      }
    }
  }

  function highlightOpts(el, name) {
    el.querySelectorAll(`input[name="${name}"]`).forEach((r) => {
      r.closest('.cpw-format-opt')?.classList.toggle('selected', r.checked);
    });
  }

  // Auto-scrape the website favicon (website first, then base URL) into logoDataUrl.
  async function fetchLogoFromUrl(websiteVal, baseUrlVal, avatar, wrap) {
    const url = websiteVal || baseUrlVal;
    if (!url || url.length < 8) { notify.toast('Enter a Website or Base URL first', 'warning'); return; }
    renderLogo(avatar, wrap, { busy: true });
    const result = await cpService.scrapeFavicon(url);
    if (result?.ok && result.url) logoDataUrl = result.url;
    renderLogo(avatar, wrap);
  }

  const formats = [
    { value: 'openai', label: 'OpenAI', desc: '/v1/chat/completions' },
    { value: 'anthropic', label: 'Anthropic', desc: '/v1/messages' },
    { value: 'gemini', label: 'Gemini', desc: 'Google Generative AI' },
    { value: 'unknown', label: 'Skip', desc: 'No format selected' },
  ];

  openModal({
    title: 'Edit Custom Provider', subtitle: null,
    bodyHTML: `<div class="wizard-body">
      <div class="cp-edit-head">
        <div class="cp-edit-avatar" id="cpEditAvatar"></div>
        <div class="cp-edit-head-main">
          <label class="lbl" style="margin:0">Provider Name *</label>
          <input class="inp" id="cpEditName" value="${esc(p.identity?.name || '')}" maxlength="100" />
          <div class="cp-edit-head-sub">${websiteHost ? `<span class="badge fmt">${esc(websiteHost)}</span>` : ''}<span class="badge fmt">${esc(FORMAT_LABELS[curFmt] || 'Unknown')} format</span></div>
        </div>
      </div>

      <div class="cp-edit-grid">
        <div class="cp-edit-col">
          <h4 class="wizard-title">Identity</h4>
          <div class="form-row"><label class="lbl">Website</label>
            <input class="inp" id="cpEditWebsite" value="${esc(p.identity?.website || '')}" placeholder="https://example.com" /></div>
          <div class="form-row"><label class="lbl">Description</label>
            <input class="inp" id="cpEditDesc" value="${esc(p.identity?.description || '')}" maxlength="200" /></div>
        </div>

        <div class="cp-edit-col">
          <h4 class="wizard-title">API</h4>
          <div class="form-row"><label class="lbl">Base URL</label>
            <input class="inp" id="cpEditBaseUrl" value="${esc(p.api?.baseUrl || '')}" placeholder="https://api.example.com/v1/" /></div>
          <div class="form-row"><label class="lbl">Format</label>
            <div class="cpw-format-grid">${formats.map((f) =>
              `<label class="cpw-format-opt ${curFmt === f.value ? 'selected' : ''}">
                <input type="radio" name="cpEditFormat" value="${f.value}" ${curFmt === f.value ? 'checked' : ''} />
                <span class="cpw-format-label">${f.label}</span>
                <span class="cpw-format-desc">${f.desc}</span>
              </label>`).join('')}
            </div></div>
        </div>

        ${isCustom ? `<div class="cp-edit-col cp-edit-col-wide">
          <h4 class="wizard-title">Logo</h4>
          <div class="cpw-logo-row">
            <div class="cp-edit-logo-opts" id="cpEditLogoOpts">
              <label class="cpw-format-opt selected"><input type="radio" name="cpEditLogo" value="keep" checked /><span class="cpw-format-label">Keep current</span><span class="cpw-format-desc">Leave logo unchanged</span></label>
              <label class="cpw-format-opt"><input type="radio" name="cpEditLogo" value="website" /><span class="cpw-format-label">Fetch from URL</span><span class="cpw-format-desc">Scrape favicon</span></label>
              <label class="cpw-format-opt"><input type="radio" name="cpEditLogo" value="file" /><span class="cpw-format-label">Upload file</span><span class="cpw-format-desc">SVG, PNG, ICO</span></label>
              <label class="cpw-format-opt"><input type="radio" name="cpEditLogo" value="initials" /><span class="cpw-format-label">Use initials</span><span class="cpw-format-desc">Auto monogram</span></label>
            </div>
            <div class="cpw-logo-preview-wrap" id="cpEditLogoPreview"></div>
          </div>
          <div id="cpEditLogoFileRow" style="display:none">
            <label class="cp-edit-file" for="cpEditLogoFile">Choose an image… <span class="cp-edit-file-hint">SVG, PNG, ICO · max 500KB</span></label>
            <input id="cpEditLogoFile" type="file" accept=".svg,.png,.ico,.jpeg,.jpg,.gif,.webp,image/*" style="display:none" />
          </div>
        </div>` : ''}
      </div>

      <div class="wizard-nav"><button class="btn btn2" data-act="cancel">Cancel</button><button class="btn btn-go" data-act="save">Save changes</button></div>
    </div>`,
    onMount: (el, ctrl) => {
      el.querySelector('[data-act="cancel"]')?.addEventListener('click', () => ctrl.close());
      const avatar = el.querySelector('#cpEditAvatar');
      const previewWrap = el.querySelector('#cpEditLogoPreview');

      if (avatar) {
        renderLogo(avatar, previewWrap);
        el.querySelector('#cpEditName')?.addEventListener('input', () => renderLogo(avatar, previewWrap));
      }

      // Format card radios → highlight the selected option.
      el.querySelectorAll('input[name="cpEditFormat"]').forEach((r) =>
        r.addEventListener('change', () => highlightOpts(el, 'cpEditFormat')));

      if (isCustom && previewWrap) {
        el.querySelectorAll('#cpEditLogoOpts input[name="cpEditLogo"]').forEach((r) => {
          r.addEventListener('change', async () => {
            highlightOpts(el, 'cpEditLogo');
            logoChoice = r.value;
            const fileRow = el.querySelector('#cpEditLogoFileRow');
            if (fileRow) {
              fileRow.style.display = logoChoice === 'file' ? '' : 'none';
            }
            if (logoChoice === 'website') {
              logoDataUrl = null;
              await fetchLogoFromUrl(el.querySelector('#cpEditWebsite')?.value || '', el.querySelector('#cpEditBaseUrl')?.value || '', avatar, previewWrap);
            } else if (logoChoice === 'initials') {
              logoDataUrl = null;
              renderLogo(avatar, previewWrap);
            } else {
              renderLogo(avatar, previewWrap);
            }
          });
        });

        const fileInput = el.querySelector('#cpEditLogoFile');
        if (fileInput) {
          fileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 500 * 1024) { notify.toast('File too large (max 500KB)', 'warning'); return; }
            const dataUrl = await fileToDataUrl(file);
            if (dataUrl) { logoDataUrl = dataUrl; logoChoice = 'file'; renderLogo(avatar, previewWrap); }
          });
        }
      }

      const saveBtn = el.querySelector('[data-act="save"]');
      saveBtn?.addEventListener('click', async () => {
        const name = el.querySelector('#cpEditName')?.value || '';
        if (!name.trim()) { notify.toast('Name required', 'warning'); return; }
        const baseUrl = el.querySelector('#cpEditBaseUrl')?.value || '';
        if (baseUrl && !isValidHttpsUrl(baseUrl)) { notify.toast('Base URL must be HTTPS', 'warning'); return; }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          const payload = {
            name, website: el.querySelector('#cpEditWebsite')?.value || '',
            description: el.querySelector('#cpEditDesc')?.value || '',
            baseUrl, format: el.querySelector('input[name="cpEditFormat"]:checked')?.value || 'unknown',
          };
          // Send an explicit logo only when the user changed it. "keep" omits the
          // field so the server keeps the current logo (and still auto-resolves
          // when only the URLs changed).
          if (isCustom) {
            if (logoChoice === 'file' && logoDataUrl) {
              payload.logo = { url: logoDataUrl, source: 'upload', status: 'resolved' };
            } else if (logoChoice === 'website' && logoDataUrl) {
              payload.logo = { url: logoDataUrl, source: 'website', status: 'resolved' };
            } else if (logoChoice === 'initials') {
              payload.logo = { url: null, source: 'generated', status: 'available' };
            }
          }
          const r = await cpService.updateCustomProvider(id, payload);
          if (r?.ok) {
            ctrl.close();
            if (id.startsWith('dyn:')) await refreshDynamicIndex();
            notify.toast('Updated', 'success');
            if (window.renderCloudProviders) window.renderCloudProviders();
            if (window.renderGateways) window.renderGateways();
          } else {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save changes';
          }
        } catch (e) {
          notify.toast('Update failed: ' + (e?.message || e), 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save changes';
        }
      });
    },
  });
}
