// Custom Provider UI (v2.1.0) — renders custom provider cards, onboarding wizard,
// and detail modals. Uses existing design system and modal architecture.
import { esc, svgLogo } from '../components/util.js';
import { notify } from '../core/notifications.js';
import { openModal, confirmModal } from '../components/modal.js';
import { workspace, getFreeModels, getModels } from '../core/state.js';
import { Storage } from '../core/storage.js';
import { CopyableRuntime, LocalSettingsRuntime } from '../config/runtimeAdapter.js';
import { configEngine } from '../config/engine.js';
import * as cpService from '../providers/customProviderService.js';

const ORIGIN_BADGE = '<span class="badge browse">Custom</span>';

// Re-pull the adopted (dyn:) provider index so the Cloud Providers grid reflects
// edits/deletes immediately instead of holding a stale workspace.dynamicProviders.
export async function refreshDynamicIndex() {
  try {
    const res = await fetch('/api/providers?origin=ecosystem').then((r) => r.json()).catch(() => ({ providers: null }));
    if (Array.isArray(res.providers)) workspace.dynamicProviders = res.providers;
    return true;
  } catch { return false; }
}

function relTime(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
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
function isFreeModel(m) {
  const p = m?.pricing;
  const isZero = (v) => v !== null && v !== undefined && v !== '' && Number(v) === 0;
  if (isZero(p?.input) || isZero(p?.output)) return true;
  if (m?.accessType === 'free') return true;
  return freeNameMarker(m);
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
  const anthropicSupported = p.api?.format === 'anthropic';
  const website = p.identity?.website || '';
  const sub = website ? (() => { try { return new URL(website).hostname; } catch { return website; } })() : '';
  // The raw record stores logo as {url, source, status}; the unified shape uses
  // a plain string. Normalise so rendering works for both.
  const logoUrl = typeof p.logo === 'string' ? p.logo : (p.logo?.url || null);
  // svgLogo() needs the curated-card presentation shape (name + accent).
  const logoP = { name: p.identity?.name || id, accent: '#6366f1' };

  // Auto-fetch models if not loaded, OR if the live cache is stale/partial.
  // The authoritative source is the server's stored modelSupport (persisted at
  // startup / refresh). A racing silent background refresh may have dropped
  // models, so re-sync whenever the live cache has fewer than the store.
  try {
    const stored = await cpService.getStoredModels(id);
    const cachedCount = workspace.liveModels[id]?.models?.length || 0;
    const storedCount = stored?.models?.length || 0;
    if (stored?.ok && storedCount && storedCount > cachedCount) {
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

    host.innerHTML = `
      <div class="model-picker">
        <label class="paid-toggle mp-paid"><input type="checkbox" ${showPaid ? 'checked' : ''}><span class="paid-track"></span><span class="paid-text">Include paid</span></label>
        <input class="inp mp-input" type="text" placeholder="Search models…" aria-label="Search models" />
        <div class="mp-list" role="listbox">
          ${hasLiveModels
            ? (listModels.length ? listModels.slice(0, 50).map(m => `
              <button type="button" class="mp-item ${currentModel === m.id ? 'sel' : ''}" data-id="${esc(m.id)}" role="option">
                <span class="mp-name">${esc(m.name || m.id)}</span>
                ${freeIds.has(m.id) ? '<span class="mp-free">free</span>' : ''}
                <span class="mp-id">${esc(m.id)}</span>
              </button>`).join('') + (listModels.length > 50 ? `<div class="mp-empty">…and ${listModels.length - 50} more</div>` : '')
              : (freeCount === 0 ? '<div class="mp-empty">No free models for this provider.</div>' : '<div class="mp-empty">No models match.</div>'))
            : ''}
        </div>
        ${!hasLiveModels ? `<input class="inp" data-cp="model-input" type="text" value="${esc(currentModel)}" placeholder="Enter model ID (e.g. gpt-4o)" style="margin-top:8px" />` : ''}
      </div>
      <div class="cpw-model-list" style="margin-top:8px">
        ${!hasLiveModels && !modelCount ? '<div class="muted" style="padding:4px 0;font-size:12px">No models found for this provider.</div>' : ''}
      </div>`;

    // Wire model select from mp-list
    host.querySelectorAll('.mp-item').forEach(b => b.addEventListener('click', () => {
      host.querySelectorAll('.mp-item').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      Storage.setModel(id, b.dataset.id);
      resetTestButton();
    }));

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

    // Wire search
    const mpInput = host.querySelector('.mp-input');
    if (mpInput) mpInput.addEventListener('input', () => {
      const q = mpInput.value.toLowerCase();
      host.querySelectorAll('.mp-item').forEach(b => {
        const name = (b.querySelector('.mp-name')?.textContent || '').toLowerCase();
        const mid = (b.dataset.id || '').toLowerCase();
        b.style.display = (!q || name.includes(q) || mid.includes(q)) ? '' : 'none';
      });
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
        <button class="btn btn-go" data-act="apply" type="button">${anthropicSupported ? 'Apply to Claude Code' : 'Show config'}</button>
      </div>

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
            const raw = (result.body || result.error || 'Unknown error').toString();
            notify.toast(`Failed: ${raw.slice(0, 120)}`, 'error');
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
          CopyableRuntime.show(cfg, `${p.identity?.name || id} config`);
        }
      });

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
  openModal({
    title: 'Edit Custom Provider', subtitle: null,
    bodyHTML: `<div class="wizard-body">
      <div class="form-row"><label class="lbl">Name *</label>
        <input class="inp" id="cpEditName" value="${esc(p.identity?.name || '')}" maxlength="100" /></div>
      <div class="form-row"><label class="lbl">Website</label>
        <input class="inp" id="cpEditWebsite" value="${esc(p.identity?.website || '')}" placeholder="https://example.com" /></div>
      <div class="form-row"><label class="lbl">Description</label>
        <input class="inp" id="cpEditDesc" value="${esc(p.identity?.description || '')}" maxlength="200" /></div>
      <div class="form-row"><label class="lbl">Base URL</label>
        <input class="inp" id="cpEditBaseUrl" value="${esc(p.api?.baseUrl || '')}" placeholder="https://api.example.com/v1/" /></div>
      <div class="form-row"><label class="lbl">Format</label>
        <select class="inp" id="cpEditFormat">
          <option value="openai" ${p.api?.format === 'openai' ? 'selected' : ''}>OpenAI</option>
          <option value="anthropic" ${p.api?.format === 'anthropic' ? 'selected' : ''}>Anthropic</option>
          <option value="gemini" ${p.api?.format === 'gemini' ? 'selected' : ''}>Gemini</option>
          <option value="unknown" ${p.api?.format === 'unknown' ? 'selected' : ''}>Skip</option>
        </select></div>
      <div class="wizard-nav"><button class="btn btn2" data-act="cancel">Cancel</button><button class="btn btn-go" data-act="save">Save</button></div>
    </div>`,
    onMount: (el, ctrl) => {
      el.querySelector('[data-act="cancel"]')?.addEventListener('click', () => ctrl.close());
      const saveBtn = el.querySelector('[data-act="save"]');
      saveBtn?.addEventListener('click', async () => {
        const name = el.querySelector('#cpEditName')?.value || '';
        if (!name.trim()) { notify.toast('Name required', 'warning'); return; }
        const baseUrl = el.querySelector('#cpEditBaseUrl')?.value || '';
        if (baseUrl && !isValidHttpsUrl(baseUrl)) { notify.toast('Base URL must be HTTPS', 'warning'); return; }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          const r = await cpService.updateCustomProvider(id, {
            name, website: el.querySelector('#cpEditWebsite')?.value || '',
            description: el.querySelector('#cpEditDesc')?.value || '',
            baseUrl, format: el.querySelector('#cpEditFormat')?.value || 'unknown',
          });
          if (r?.ok) {
            ctrl.close();
            if (id.startsWith('dyn:')) await refreshDynamicIndex();
            notify.toast('Updated', 'success');
            if (window.renderCloudProviders) window.renderCloudProviders();
            if (window.renderGateways) window.renderGateways();
          } else {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
          }
        } catch (e) {
          notify.toast('Update failed: ' + (e?.message || e), 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
      });
    },
  });
}
