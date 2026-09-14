import { workspace } from '../core/state.js';
import { Storage } from '../core/storage.js';
import { notify } from '../core/notifications.js';
import { recordActivity } from '../core/activityStore.js';
import { openModal } from '../components/modal.js';
import { esc, logoHtml, maskKey, highlightJSON, clientLogoHtml } from '../components/util.js';
import { renderModelPickerUnified } from '../components/modelLibrary.js';
import { configEngine } from './engine.js';
import { LocalSettingsRuntime, CopyableRuntime } from './runtimeAdapter.js';
import { getProvider, allProviders, setProviderExtras } from '../providers/registry.js';
import { getClient, normalizeClientId } from '../clients/registry.js';
import { getClientAdapter } from '../clients/index.js';
import { RUNTIMES, getRuntime } from '../runtimes/registry.js';
import { getRuntimeAdapter } from '../runtimes/index.js';
import { checkClientProvider } from '../compatibility/clientProviderCompatibility.js';
import { checkClientRuntime } from '../compatibility/clientRuntimeCompatibility.js';
import { resolveSelection } from '../compatibility/capabilityResolver.js';
import { levelBadge, compatNoteList, connectionLabel } from '../compatibility/ui.js';
import { fallbackStore } from './fallbackStore.js';

// Inline step-glyph library (24px stroke icons, inherited color).
const GLYPHS = {
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.3"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 18.5a4.4 4.4 0 0 1-.6-8.76 6 6 0 0 1 11.66 1.39A3.9 3.9 0 0 1 17.4 18.5H7.5Z"/></svg>',
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.6 20 7.5l-8 3.9-8-3.9 8-3.9Z"/><path d="M4.5 11.6 12 15.5l7.5-3.9"/><path d="M4.5 15.6 12 19.5l7.5-3.9"/></svg>',
  chip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7.2" y="7.2" width="9.6" height="9.6" rx="2"/><path d="M9.4 3.4v2M14.6 3.4v2M9.4 18.6v2M14.6 18.6v2M3.4 9.4h2M3.4 14.6h2M18.6 9.4h2M18.6 14.6h2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 19 5.7v5.1c0 4.3-2.8 8.1-7 9.7-4.2-1.6-7-5.4-7-9.7V5.7L12 3.2Z"/><path d="m9 11.8 2.1 2.2 4-4.3"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 21V4"/><path d="M5.5 5.5h11.2L14 9.2l2.7 3.6H5.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 4.2 4.2 8.8-9.4"/></svg>',
  local: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 9.5h8M8 13h5"/></svg>',
};
function glyph(name) {
  return GLYPHS[name] || GLYPHS.user;
}

// v0.5.0 draft persistence — so an in-progress configuration survives a refresh
// or a detour to another page. Only non-sensitive selection state + the generated
// config are stored (no API keys; lastConfig already masks secrets in its display
// path, and the live write path re-derives from the key + engine on apply).
const DRAFT_KEY = 'nx_wf_draft';

function saveDraft(wf) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      connectionType: wf.connectionType,
      provider: wf.provider,
      runtime: wf.runtime,
      model: wf.model,
      step: wf.step,
      generated: wf.generated,
      lastConfig: wf.generated ? wf.lastConfig : null,
    }));
  } catch { /* ignore quota errors */ }
}

function loadDraftInto(wf) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    // Drafts never override the target client — openWorkflow fixes it on open.
    if (d.connectionType) wf.connectionType = d.connectionType;
    if (d.provider !== undefined) wf.provider = d.provider;
    if (d.runtime !== undefined) wf.runtime = d.runtime;
    if (d.model) wf.model = d.model;
    if (d.step) wf.step = Math.max(1, Math.min(5, d.step > 1 ? d.step - 1 : 1));
    wf.generated = !!d.generated;
    wf.lastConfig = d.lastConfig || null;
    return !!d.lastConfig;
  } catch { return false; }
}

export function discardDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

export function hasUsableDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    return !!(JSON.parse(raw).lastConfig);
  } catch { return false; }
}

// Configuration Workflow — the primary v0.4.0 config experience, explicitly
// CLIENT-AWARE. The flow is:
//
//   Connection → Provider/Runtime → Model → Review (compatibility) → Apply
//
// The target client is fixed by the entry point (the Configure button already
// knows which client was chosen), so there is no client-picker step. The dialog
// title and the pinned "Target" chip keep the client visible throughout.
//
// It deliberately does NOT generate configs itself: every config is produced by
// a Client Adapter that wraps the proven Configuration Engine (buildClaudeSettings
// for Claude Code). This module only orchestrates steps, renders previews, and
// applies through the existing Runtime Adapter. The Claude Code generation path
// is byte-identical to v0.3.0 — it is NOT reimplemented here.
export function openWorkflow(opts = {}) {
  const client0 = normalizeClientId(opts.initialClient || (workspace.applied && normalizeClientId(workspace.applied.client)) || 'claude-code');
  const wf = {
    client: client0,
    connectionType: opts.initialConnectionType || (workspace.applied && workspace.applied.connectionType) || 'cloud',
    mode: opts.mode || 'normal',
    tierIndex: opts.tierIndex || 0,
    provider: opts.initialProvider || (workspace.applied && workspace.applied.provider) || null,
    runtime: opts.initialRuntime || (workspace.applied && workspace.applied.runtime) || null,
    model: null,
    includePaid: false,
    step: 1,
    lastConfig: null,
    lastCompat: null,
    instructions: null,
    generated: false,
    appliedRecorded: false,
  };
  // Tier-mode plans are cloud-only by definition — no local fallback tiers.
  if (wf.mode === 'fallback-tier') wf.connectionType = 'cloud';
  if (wf.provider) {
    const sm = Storage.getModel(wf.provider);
    if (sm) wf.model = sm;
  }

  // Resume an in-progress draft unless an explicit initial selection was given.
  if (!opts.initialProvider && !opts.initialClient && !opts.initialRuntime && wf.mode !== 'fallback-tier') {
    loadDraftInto(wf);
  }

  const { close } = openModal({
    title: wf.mode === 'fallback-tier'
      ? `Set up Fallback ${wf.tierIndex} — ${getClient(wf.client).name}`
      : `Configure ${getClient(wf.client).name}`,
    subtitle: wf.mode === 'fallback-tier'
      ? 'Saves a backup provider + model. Does not change your live configuration.'
      : 'Guided configuration',
    size: 'wide',
    bodyHTML: `
      <div class="wf">
        <aside class="wf-rail">
          <div class="wf-rail-label">Setup steps</div>
          <div class="wf-rail-steps" id="wfSteps"></div>
          <div class="wf-rail-caption">Your progress is saved on this device as you go.</div>
        </aside>
        <section class="wf-main">
          <div class="wf-clienthead" id="wfClientHead"></div>
          <header class="wf-head" id="wfHead"></header>
          <div class="wf-content" id="wfContent"></div>
          <footer class="wf-actions" id="wfActions"></footer>
        </section>
      </div>`,
    onMount: (body, ctrl) => {
      wf.ctrl = ctrl;
      wf.stepsEl = body.querySelector('#wfSteps');
      wf.clientHeadEl = body.querySelector('#wfClientHead');
      wf.headEl = body.querySelector('#wfHead');
      wf.bodyEl = body.querySelector('#wfContent');
      wf.actionsEl = body.querySelector('#wfActions');
      // Enter advances through non-destructive steps (never on Apply/Review).
      body.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.repeat) return;
        if (e.target && e.target.closest('input,textarea,select,[contenteditable]')) return;
        const next = wf.actionsEl.querySelector('#wfNext');
        if (next && !next.disabled && /continue/i.test(next.textContent)) next.click();
      });
      renderStep();
      // Load adopted (dynamic) + custom providers once so the provider step can
      // offer them alongside the curated registry. Best-effort — the wizard is
      // fully functional with curated providers alone.
      if (!workspace.dynamicProviders || !workspace.customProviders) {
        loadProviderExtras().finally(() => { if (wf.step <= 3) renderStep(); });
      }
    },
    onClose: () => {
      if (wf.generated && !wf.appliedRecorded) workspace.unsaved = true;
      if (window.updateShellStatus) window.updateShellStatus();
    },
  });

  // ── Stepper metadata ──
  function stepList() {
    return wf.connectionType === 'local'
      ? ['Connection', 'Runtime', 'Model', 'Review', 'Apply']
      : ['Connection', 'Provider', 'Model', 'Review', 'Apply'];
  }
  function stepMeta() {
    const isLocal = wf.connectionType === 'local';
    return {
      1: { icon: 'cloud', t: 'How will you connect?', s: 'Cloud AI talks to a hosted provider API. Local AI talks to a runtime on your machine.' },
      2: isLocal
        ? { icon: 'cube', t: 'Choose your runtime', s: 'Local runtimes compatible with your client. Some clients need an Anthropic-compatible proxy.' }
        : { icon: 'cube', t: 'Choose your provider', s: 'Providers compatible with your client for a cloud connection. Search or pick from the catalogue.' },
      3: { icon: 'chip', t: 'Choose your model', s: isLocal ? 'Enter the model name served by your runtime.' : 'Pick a model from the unified catalogue — live status, pricing and source are shown.' },
      4: { icon: 'shield', t: 'Review your configuration', s: 'Final compatibility check before anything is written. Nothing changes until you confirm.' },
      5: { icon: 'flag', t: 'Apply', s: 'Back up the current settings, write the new configuration, and you are done.' },
    }[wf.step];
  }

  function canGo(n) { return n >= 1 && n <= 5 && n <= wf.step; }
  function goStep(n) { if (canGo(n) && n !== wf.step) { wf.step = n; renderStep(); } }

  function renderRail() {
    const labels = stepList();
    const sub3 = wf.connectionType === 'local' ? 'Runtime' : 'Provider';
    wf.stepsEl.innerHTML = labels.map((l, i) => {
      const n = i + 1;
      const state = n < wf.step ? 'done' : n === wf.step ? 'active' : 'future';
      return `<button type="button" class="wf-rail-step ${state}" data-step="${n}" ${state === 'future' ? 'aria-disabled="true"' : ''}>
        <span class="wf-rail-dot">${n < wf.step ? '✓' : n}</span>
        <span class="wf-rail-t"><span class="wf-rail-name">${esc(l)}</span><span class="wf-rail-sub">${esc(n === 3 ? sub3 : l)}</span></span>
      </button>`;
    }).join('');
    wf.stepsEl.querySelectorAll('.wf-rail-step').forEach((b) => {
      b.addEventListener('click', () => goStep(+b.dataset.step));
    });
  }

  function renderClientHead() {
    const c = getClient(wf.client);
    const supportLabel = c.support === 'verified' ? 'Verified' : c.support === 'manual' ? 'Manual setup' : 'Coming soon';
    wf.clientHeadEl.innerHTML = `
      <div class="wf-ch-logo" style="--cm:${esc(c.color || '#5b8def')}">${clientLogoHtml(c)}</div>
      <div class="wf-ch-id">
        <b>${esc(c.name)}</b>
        <span class="badge ${esc(c.support || '')}">${esc(supportLabel)}</span>
      </div>
      <div class="wf-ch-t">
        <span>Config file</span>
        <b class="mono">${esc(c.configPath || '—')}</b>
      </div>
      <span class="chipx wf-ch-conn">${esc(connectionLabel(wf.connectionType))}</span>`;
  }

  function renderStep() {
    renderRail();
    renderClientHead();
    const meta = stepMeta();
    const lab = stepList()[wf.step - 1];
    wf.headEl.innerHTML = `<div class="wf-head-ico">${glyph(meta.icon)}</div>
      <div class="wf-head-t">
        <div class="wf-head-kicker">Step ${wf.step} of ${stepList().length} · ${esc(lab)}</div>
        <div class="wf-head-title">${esc(meta.t)}</div>
        <div class="wf-head-sub">${esc(meta.s)}</div>
      </div>`;
    wf.bodyEl.innerHTML = '';
    wf.actionsEl.innerHTML = '';
    const map = {
      1: stepConnection,
      2: wf.connectionType === 'local' ? stepRuntime : stepProvider,
      3: stepModel,
      4: stepReview,
      5: stepApply,
    };
    (map[wf.step] || stepConnection)();
    wf.bodyEl.scrollTop = 0;
    saveDraft(wf);
  }

  function el(cls) { const d = document.createElement('div'); d.className = cls; return d; }

  // Load adopted (dynamic) + user-created custom providers into workspace state
  // so the provider dropdown reflects reality. Idempotent per open; cached on
  // workspace so other views (playground, model picker) reuse the same list.
  async function loadProviderExtras() {
    const [dyn, cst] = await Promise.all([
      workspace.dynamicProviders
        ? Promise.resolve({ providers: workspace.dynamicProviders })
        : fetch('/api/providers?origin=ecosystem').then((r) => r.json()).catch(() => ({ providers: [] })),
      workspace.customProviders
        ? Promise.resolve({ providers: workspace.customProviders })
        : fetch('/api/custom-providers').then((r) => r.json()).catch(() => ({ providers: [] })),
    ]);
    if (!workspace.dynamicProviders) workspace.dynamicProviders = dyn.providers || [];
    if (!workspace.customProviders) workspace.customProviders = (cst.providers || []).filter((p) => p.lifecycle === 'active');
    // Register the merged index so getProvider()/model pickers resolve the
    // adopted/custom providers exactly like curated ones.
    setProviderExtras(allProviders({ dynamic: workspace.dynamicProviders, custom: workspace.customProviders }));
  }

  // ── Step 1: Connection Type ──
  function stepConnection() {
    const c = getClient(wf.client);
    const types = c.connectionTypes.length ? c.connectionTypes : ['cloud'];
    const options = [
      { type: 'cloud', icon: 'cloud', title: 'Cloud AI', sub: 'Route through a hosted provider API — Anthropic, OpenRouter, OpenAI, Gemini and more.' },
      { type: 'local', icon: 'local', title: 'Local AI', sub: 'Use models served on your machine — Ollama, LM Studio, llama.cpp.', note: c.id === 'claude-code' ? 'Experimental · Claude Code needs an Anthropic-compatible proxy' : '' },
    ].filter((x) => types.includes(x.type) && (wf.mode !== 'fallback-tier' || x.type === 'cloud'));
    const host = el('conn-grid');
    host.innerHTML = options.map((o) => `
      <button type="button" class="panel conn-card ${wf.connectionType === o.type ? 'sel' : ''}" data-type="${o.type}">
        ${wf.connectionType === o.type ? '<span class="sel-tick">✓</span>' : ''}
        <div class="conn-ico">${glyph(o.icon)}</div>
        <div class="conn-title">${esc(o.title)}</div>
        <div class="conn-sub">${esc(o.sub)}</div>
        ${o.note ? `<div class="conn-note">${esc(o.note)}</div>` : ''}
      </button>`).join('');
    host.querySelectorAll('.conn-card').forEach((b) => b.addEventListener('click', () => {
      if (wf.connectionType === b.dataset.type) return;
      wf.connectionType = b.dataset.type;
      wf.provider = null; wf.runtime = null; wf.model = null;
      renderStep();
    }));
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<div class="wf-side"><button class="btn btn-go" id="wfNext">Continue →</button></div>`;
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => { wf.step = 2; renderStep(); });
  }

  // ── Step 2a: Provider (cloud) ──
  function stepProvider() {
    const providers = allProviders({
      dynamic: workspace.dynamicProviders || [],
      custom: workspace.customProviders || [],
    }).filter((p) => checkClientProvider(wf.client, p.id).compatible);
    const host = el('wf-pane');
    host.innerHTML = `<div class="search-wrap"><input class="inp" id="wfSearch" placeholder="Search providers by name or description…" aria-label="Filter providers" /></div>
      <div class="provider-grid" id="wfGrid"></div>
      <div id="wfHint"></div>`;
    const grid = host.querySelector('#wfGrid');
    const hint = host.querySelector('#wfHint');
    let q = '';
    function providerHintHTML() {
      if (!wf.provider) return `<div class="wf-note">Choose a provider to continue. Only providers compatible with ${esc(getClient(wf.client).name)} are listed.</div>`;
      const p = getProvider(wf.provider);
      if (!p) return '';
      const hasKey = !!Storage.getKey(wf.provider);
      const needsKey = !p.publicModels;
      const keyNote = hasKey
        ? '<b>A key is stored</b> — it will be used to build the settings.'
        : (needsKey ? '<b>No key stored yet</b> — continue, then add your key to apply.' : '<b>Works without a key</b>');
      return `<div class="wf-note">${esc(p.name)} · ${keyNote}</div>`;
    }
    function draw() {
      const ql = q.toLowerCase();
      grid.innerHTML = providers
        .filter((p) => !ql || p.name.toLowerCase().includes(ql) || (p.sub || '').toLowerCase().includes(ql))
        .map((p) => {
          const comp = checkClientProvider(wf.client, p.id);
          const sel = p.id === wf.provider;
          return `
          <button type="button" class="panel provider-card ${sel ? 'sel' : ''}" data-id="${p.id}">
            ${sel ? '<span class="sel-tick">✓</span>' : ''}
            <div class="pc-logo-sm">${logoHtml(p)}</div>
            <div class="provider-meta">
              <b>${esc(p.name)}</b>
              ${levelBadge(comp.level)}
            </div>
          </button>`;
        }).join('') || '<div class="wf-note">No providers match your filter.</div>';
      grid.querySelectorAll('.provider-card').forEach((b) => b.addEventListener('click', () => {
        wf.provider = b.dataset.id;
        const sm = Storage.getModel(wf.provider);
        wf.model = sm || null;
        draw();
        hint.innerHTML = providerHintHTML();
      }));
    }
    draw();
    hint.innerHTML = providerHintHTML();
    host.querySelector('#wfSearch').addEventListener('input', (e) => { q = e.target.value; draw(); });
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<div class="wf-side"><button class="btn btn2" id="wfBack">← Back</button></div>
      <div class="wf-side"><button class="btn btn-go" id="wfNext">Continue →</button></div>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 1; renderStep(); });
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => {
      if (!wf.provider) { notify.toast('Select a provider', 'warning'); return; }
      wf.step = 3; renderStep();
    });
  }

  // ── Step 2b: Runtime (local) ──
  function stepRuntime() {
    const host = el('wf-pane');
    const runtimes = RUNTIMES.filter((r) => checkClientRuntime(wf.client, r.id).compatible);
    if (!runtimes.length) {
      host.innerHTML = `<div class="warn-box">No compatible local runtime for this client yet. Local models require a runtime that speaks the client’s protocol.</div>`;
    } else {
      const grid = document.createElement('div');
      grid.className = 'provider-grid';
      grid.innerHTML = runtimes.map((r) => {
        const comp = checkClientRuntime(wf.client, r.id);
        const sel = r.id === wf.runtime;
        return `
        <button type="button" class="panel provider-card ${sel ? 'sel' : ''}" data-id="${r.id}">
          ${sel ? '<span class="sel-tick">✓</span>' : ''}
          <div class="provider-meta"><b>${esc(r.name)}</b>${levelBadge(comp.level)}</div>
          <div class="client-sub">${esc(r.note || '')}</div>
        </button>`;
      }).join('');
      grid.querySelectorAll('.provider-card').forEach((b) => b.addEventListener('click', () => {
        wf.runtime = b.dataset.id;
        grid.querySelectorAll('.provider-card').forEach((x) => x.classList.toggle('sel', x === b));
      }));
      host.appendChild(grid);
    }
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<div class="wf-side"><button class="btn btn2" id="wfBack">← Back</button></div>
      <div class="wf-side">${runtimes.length ? '<button class="btn btn-go" id="wfNext">Continue →</button>' : ''}</div>`;
    wf.actionsEl.querySelector('#wfBack')?.addEventListener('click', () => { wf.step = 1; renderStep(); });
    wf.actionsEl.querySelector('#wfNext')?.addEventListener('click', () => {
      if (!wf.runtime) { notify.toast('Select a runtime', 'warning'); return; }
      wf.step = 3; renderStep();
    });
  }

  // ── Step 3: Model ──
  function stepModel() {
    const host = el('wf-pane');
    if (wf.connectionType === 'cloud') {
      const provider = getProvider(wf.provider);
      host.innerHTML = `<div class="wf-modelbar" id="wfModelbar"></div>
        <div class="pc-model-host" id="wfModelHost"></div>`;
      wf.bodyEl.appendChild(host);
      function modelbar() {
        const bar = host.querySelector('#wfModelbar');
        if (!bar) return;
        bar.innerHTML = wf.model
          ? `<span class="wf-mb-txt">Selected model${provider ? ' · ' + esc(provider.name) : ''}: <b>${esc(wf.model)}</b></span>
             <span class="wf-mb-out" id="wfTestOut" hidden></span>
             <button type="button" class="btn btn2 wf-mb-test" id="wfTestModel">Test model</button>`
          : 'No model selected yet — pick one below, or clear the filter to browse the catalogue.';
        const b = bar.querySelector('#wfTestModel');
        if (b) b.addEventListener('click', testModel);
      }
      function testModel() {
        const provider = getProvider(wf.provider);
        const model = wf.model;
        if (!provider || !model) { notify.toast('Select a model first', 'warning'); return; }
        let url = provider.baseUrl || '';
        if (provider.hasCustomUrl) url = document.querySelector(`.base-url-${wf.provider}`)?.value || url;
        if (!url) { notify.toast('No base URL known for this provider — check its settings.', 'warning'); return; }
        const key = Storage.getKey(wf.provider);
        if (!key) { notify.toast('No API key stored for this provider yet — add it in Cloud Providers.', 'warning'); return; }
        const btn = host.querySelector('#wfTestModel');
        const out = host.querySelector('#wfTestOut');
        const startedAt = Date.now();
        if (btn) btn.disabled = true;
        if (out) { out.hidden = false; out.className = 'wf-mb-out'; out.textContent = 'Testing…'; }
        (async () => {
          const ms = () => ((Date.now() - startedAt) / 1000).toFixed(1);
          try {
            const qs = new URLSearchParams({ url, key, format: provider.format || 'anthropic' });
            qs.set('model', model);
            const res = await fetch(`/api/test?${qs.toString()}`);
            const result = await res.json();
            if (result.status && result.status >= 200 && result.status < 300) {
              if (out) { out.className = 'wf-mb-out ok'; out.textContent = `✓ Connection OK · ${ms()}s`; }
              notify.toast(`“${model}” is reachable — connection OK`, 'success');
            } else {
              const raw = (result.body || result.error || 'Unknown error').toString().slice(0, 140);
              if (out) { out.className = 'wf-mb-out err'; out.textContent = `✗ Failed (${ms()}s)`; }
              if (/authorization|api key|authentication|invalid key|wrong_api_key/i.test(raw)) notify.toast('Key rejected by the provider', 'warning');
              else if (/payment|402|billing|quota/i.test(raw)) notify.toast('Valid key, but the account needs an active payment method', 'warning');
              else if (/model_not_found|does not exist|no access|not found/i.test(raw)) notify.toast(`“${model}” is not available on this account`, 'warning');
              else notify.toast(`Connection failed: ${raw.slice(0, 120)}`, 'error');
            }
          } catch (err) {
            if (out) { out.className = 'wf-mb-out err'; out.textContent = '✗ Network error'; }
            notify.toast('Could not reach the provider', 'error');
          } finally {
            if (btn) btn.disabled = false;
          }
        })();
      }
      modelbar();
      renderModelPickerUnified(host.querySelector('#wfModelHost'), wf.provider, {
        includePaid: wf.includePaid,
        showPaidToggle: true,
        current: wf.model,
        onSelect: (id) => { wf.model = id; Storage.setModel(wf.provider, id); modelbar(); },
      });
      // Keep the wizard's paid preference in sync with the inline toggle so the
      // review step and any later re-render honour the user's choice.
      const paidBox = host.querySelector('#wfModelHost .mp-paid input');
      if (paidBox) paidBox.addEventListener('change', (e) => { wf.includePaid = !!e.target.checked; });
    } else {
      const rt = getRuntime(wf.runtime);
      host.innerHTML = `<div class="wf-modelbar" id="wfModelbar">Local model for <b>${esc(rt?.name || 'the runtime')}</b></div>
        <input class="inp" id="wfLocalModel" placeholder="e.g. llama3.1:latest" value="${esc(wf.model || '')}" list="wfLocalModels" />
        <datalist id="wfLocalModels"></datalist>`;
      wf.bodyEl.appendChild(host);
      const dl = host.querySelector('#wfLocalModels');
      if (wf.runtime === 'ollama') {
        getRuntimeAdapter('ollama').listModels().then((ms) => {
          dl.innerHTML = ms.map((m) => `<option value="${esc(m)}">`).join('');
        });
      }
    }
    wf.actionsEl.innerHTML = `<div class="wf-side"><button class="btn btn2" id="wfBack">← Back</button></div>
      <div class="wf-side"><button class="btn btn-go" id="wfNext">Continue →</button></div>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 2; renderStep(); });
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => {
      if (wf.connectionType === 'local') wf.model = host.querySelector('#wfLocalModel')?.value || wf.model;
      if (!wf.model) { notify.toast('Select a model', 'warning'); return; }
      wf.step = 4; renderStep();
    });
  }

  // ── Step 4: Review (compatibility-driven) ──
  function stepReview() {
    const comp = resolveSelection({
      clientId: wf.client, connectionType: wf.connectionType,
      providerId: wf.provider, runtimeId: wf.runtime, modelId: wf.model,
    });
    wf.lastCompat = comp;
    let built = { config: null, instructions: null };
    if (wf.mode !== 'fallback-tier') {
      built = buildSelectionConfig();
      wf.lastConfig = built.config;
      wf.instructions = built.instructions;
      wf.generated = true;
    }

    const targetName = wf.connectionType === 'local' ? (getRuntime(wf.runtime)?.name || '') : (getProvider(wf.provider)?.name || '');
    const rows = [
      { step: 1, k: 'Connection', v: connectionLabel(wf.connectionType) },
      { step: 2, k: wf.connectionType === 'local' ? 'Runtime' : 'Provider', v: targetName },
      { step: 3, k: 'Model', v: wf.model || '' },
    ];
    const verdict = wf.mode === 'fallback-tier'
      ? { cls: 'good', icon: 'check', text: `Fallback ${wf.tierIndex} will be saved for ${getClient(wf.client).name} — your live configuration stays untouched.` }
      : verdictFor(comp);
    const host = el('wf-pane');
    host.innerHTML = `
      <div class="verdict ${verdict.cls}"><span class="verdict-ico">${glyph(verdict.icon)}</span><span>${verdict.text}</span></div>
      <div class="review-card">${rows.map((r) => `
        <button type="button" class="review-row" data-step="${r.step}">
          <span class="lbl">${esc(r.k)}</span><span class="val ${r.v ? '' : 'empty'}">${esc(r.v || 'not chosen')}</span><span class="edit">edit</span>
        </button>`).join('')}
      </div>
      ${compatNoteList(comp)}
      ${built.config ? `<pre class="code wf-preview">${highlightJSON(JSON.stringify(maskConfigForPreview(built.config), null, 2))}</pre>` : ''}
      ${!built.config && built.instructions ? `<div class="manual-box"><b>Manual setup</b><ul>${built.instructions.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
      ${!comp.compatible ? `<div class="warn-box">${esc(comp.reason || 'This combination is not compatible.')}</div>` : ''}`;
    host.querySelectorAll('.review-row').forEach((b) => b.addEventListener('click', () => goStep(+b.dataset.step)));
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<div class="wf-side"><button class="btn btn2" id="wfBack">← Back</button></div>
      <div class="wf-side"><button class="btn btn-go" id="wfNext">${wf.mode === 'fallback-tier' ? 'Continue to save →' : 'Continue to apply →'}</button></div>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 3; renderStep(); });
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => { wf.step = 5; renderStep(); });
  }

  function verdictFor(comp) {
    const name = getClient(wf.client).name;
    if (comp.compatible && comp.autoApply) return { cls: 'good', icon: 'check', text: `Ready to configure — ${name} will be written automatically with a safe backup of your current settings.` };
    if (comp.compatible) return { cls: 'warn', icon: 'flag', text: `Partial setup — Nexference will guide the manual steps for ${name}; it will not write an unsafe configuration.` };
    return { cls: 'bad', icon: 'shield', text: 'Not compatible — switch your client, connection or provider, or follow the manual guidance shown below.' };
  }

  // ── Step 5: Apply ──
  function stepApply() {
    if (wf.mode === 'fallback-tier') return saveTierStep();
    const comp = wf.lastCompat;
    const canApply = comp && comp.autoApply && wf.lastConfig;
    const host = el('wf-pane');
    host.innerHTML = `
      <div class="apply-box">
        <div class="kv"><span>Target client</span><b>${esc(getClient(wf.client).name)}</b></div>
        <div class="kv"><span>Action</span><b>${canApply ? 'Backup + write' : 'Show manual steps'}</b></div>
        <div class="kv"><span>Compatibility</span><b>${levelBadge(comp ? comp.level : 'unsupported')}</b></div>
      </div>
      <div id="wfDiff" class="wf-diff"></div>`;
    wf.bodyEl.appendChild(host);

    // CURRENT → NEW preview (computed server-side so secrets stay masked).
    if (canApply && wf.lastConfig) {
      const diffEl = host.querySelector('#wfDiff');
      diffEl.innerHTML = '<div class="muted">Computing configuration diff…</div>';
      const previewUrl = wf.client === 'claude-code'
        ? '/api/config/preview'
        : `/api/config/${encodeURIComponent(wf.client)}/preview`;
      fetch(previewUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next: wf.lastConfig }),
      })
        .then((r) => r.json())
        .then((d) => {
          const diff = d.diff || { changed: false, fields: [] };
          if (!diff.changed) { diffEl.innerHTML = '<div class="diff-note">No change — the new config matches the current one.</div>'; return; }
          diffEl.innerHTML = '<div class="diff-head">CURRENT → NEW</div>' + diff.fields
            .filter((f) => f.changed)
            .map((f) => {
              const from = f.sensitive ? (f.from === 'set' ? '••• set' : '—') : (f.from == null ? '—' : esc(String(f.from)));
              const to = f.sensitive ? (f.to === 'set' ? '••• set' : '—') : (f.to == null ? '—' : esc(String(f.to)));
              return `<div class="diff-row"><span class="diff-key mono">${esc(f.key)}</span><span class="diff-from mono">${from}</span><span class="diff-arrow">→</span><span class="diff-to mono">${to}</span></div>`;
            }).join('');
        })
        .catch(() => { diffEl.innerHTML = ''; });
    }

    wf.actionsEl.innerHTML = `<div class="wf-side"><button class="btn btn2" id="wfBack">← Back</button><div class="wf-hint">Nothing writes until you confirm below.</div></div>
      <div class="wf-side"><button class="btn btn2" id="wfSaveProfile">Save profile</button><button class="btn btn-go" id="wfApply">${canApply ? 'Apply Configuration' : 'Show manual steps'} →</button></div>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 4; renderStep(); });
    wf.actionsEl.querySelector('#wfSaveProfile').addEventListener('click', () => {
      const name = prompt('Profile name (references only — never stores secrets)', `${getClient(wf.client).name} · ${wf.model || 'config'}`);
      if (!name || !name.trim()) return;
      Storage.saveProfile({ id: 'p_' + Date.now().toString(36), name: name.trim(), client: wf.client, connectionType: wf.connectionType, sourceType: wf.connectionType, provider: wf.provider || null, runtime: wf.runtime || null, model: wf.model });
      notify.toast(`Saved profile “${name.trim()}”`, 'success');
    });
    wf.actionsEl.querySelector('#wfApply').addEventListener('click', () => doApply(canApply));
  }

  // Tier-mode save — writes NO config; stores the fallback plan only.
  function saveTierStep() {
    const n = wf.tierIndex;
    const host = el('wf-pane');
    host.innerHTML = `
      <div class="apply-box">
        <div class="kv"><span>Target client</span><b>${esc(getClient(wf.client).name)}</b></div>
        <div class="kv"><span>Fallback tier</span><b>Fallback ${n}</b></div>
        <div class="kv"><span>Provider</span><b>${esc(getProvider(wf.provider)?.name || wf.provider || '—')}</b></div>
        <div class="kv"><span>Model</span><b class="mono">${esc(wf.model || '—')}</b></div>
      </div>
      <div class="wf-note">Only saves this fallback selection — nothing is written to your configuration file. The monitor switches to it automatically if the active provider/model fails twice in a row.</div>`;
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<div class="wf-side"><button class="btn btn2" id="wfBack">← Back</button></div>
      <div class="wf-side"><button class="btn btn-go" id="wfSaveFallback">Save as Fallback ${n} →</button></div>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 4; renderStep(); });
    wf.actionsEl.querySelector('#wfSaveFallback').addEventListener('click', saveTier);
  }

  function saveTier() {
    if (!wf.provider || !wf.model) { notify.toast('Select a provider and model first', 'warning'); return; }
    // Capture the current primary so the monitor has a recovery target. Prefer
    // an already-saved primary (a fallback switch must never overwrite it).
    const applied = workspace.applied;
    const plan0 = fallbackStore.getPlan(wf.client);
    const snapshot = plan0 && plan0.primary && plan0.primary.provider
      ? { provider: plan0.primary.provider, model: plan0.primary.model }
      : (applied && applied.client === wf.client
        ? { provider: applied.provider, model: applied.model }
        : {});
    fallbackStore.ensurePlan(wf.client, snapshot);
    fallbackStore.setTier(wf.client, wf.tierIndex, { provider: wf.provider, model: wf.model });
    const p = getProvider(wf.provider);
    recordActivity('fallback', `Configured Fallback ${wf.tierIndex} for ${getClient(wf.client).name} — ${p?.name || wf.provider} · ${wf.model}`);
    notify.toast(`Fallback ${wf.tierIndex} saved (${p?.name || wf.provider} · ${wf.model})`, 'success');
    notify.log(`Fallback ${wf.tierIndex} set: ${p?.name || wf.provider} · ${wf.model}`, 't-ok');
    window.dispatchEvent(new CustomEvent('nx-fallback', { detail: { client: wf.client, changed: true } }));
    wf.ctrl.close();
  }

  async function doApply(canApply) {
    const targetMeta = wf.connectionType === 'local'
      ? getRuntime(wf.runtime)
      : getProvider(wf.provider);

    if (canApply && wf.lastConfig) {
      try {
        const ok = await LocalSettingsRuntime.write(wf.lastConfig, wf.client);
        if (ok) {
          discardDraft();
          recordApplied(targetMeta, 'configured');
          recordActivity('apply', `Applied ${targetMeta.name} · model ${wf.model} to ${getClient(wf.client).name}`);
          workspace.appliedProviderId = wf.provider;
          workspace.activeProvider = wf.provider;
          workspace.activeModel = wf.model;
          workspace.activeClient = wf.client;
          workspace.activeRuntime = wf.runtime;
          notify.toast(`Applied ${targetMeta.name} to ${getClient(wf.client).name}!`, 'success');
          notify.log(`Applied ${targetMeta.name} · model ${wf.model} (backup saved)`, 't-ok');
          if (window.renderWorkspace) window.renderWorkspace();
          if (window.updateShellStatus) window.updateShellStatus();
          wf.ctrl.close();
        }
      } catch (err) {
        notify.toast(`Error: ${err.message}`, 'error');
      }
      return;
    }

    // Manual path — show instructions, never fake a write.
    if (wf.lastConfig) {
      CopyableRuntime.show(wf.lastConfig, targetMeta.name);
    } else {
      openModal({
        title: `Manual setup — ${getClient(wf.client).name}`,
        subtitle: 'Nexference does not auto-configure this client yet',
        size: 'wide',
        bodyHTML: `<div class="manual-box"><ul>${(wf.instructions || wf.lastCompat?.notes || ['See client documentation.']).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`,
      });
    }
    recordApplied(targetMeta, 'manual');
    recordActivity('apply', `Manual setup for ${getClient(wf.client).name} · ${targetMeta.name}`);
    workspace.activeClient = wf.client;
    workspace.activeRuntime = wf.runtime;
    if (window.renderWorkspace) window.renderWorkspace();
    if (window.updateShellStatus) window.updateShellStatus();
    wf.ctrl.close();
  }

  function recordApplied(targetMeta, status) {
    const rec = {
      client: wf.client,
      connectionType: wf.connectionType,
      provider: wf.provider || null,
      runtime: wf.runtime || null,
      model: wf.model,
      appliedAt: new Date().toISOString(),
      status,
    };
    workspace.applied = rec;
    workspace.unsaved = false;
    workspace.appliedRecorded = true;
    Storage.setApplied(rec);
  }

  // Produce the config (or instructions) for the current selection. The Claude
  // Code path delegates to the proven engine — output is unchanged.
  function buildSelectionConfig() {
    return configForSelection({
      client: wf.client,
      connectionType: wf.connectionType,
      provider: wf.provider,
      runtime: wf.runtime,
      model: wf.model,
      compat: wf.lastCompat,
    });
  }
}

// Shared selection→config builder, used by both the wizard and the fallback
// monitor. Behaviour is identical to the original buildSelectionConfig: the
// Claude Code path delegates to the proven engine and is unchanged.
export function configForSelection({ client, connectionType = 'cloud', provider = null, runtime = null, model = null, compat = null }) {
  if (client === 'claude-code' && connectionType === 'cloud') {
    const p = getProvider(provider);
    if (!p) return { config: null, instructions: ['Select a provider'] };
    const key = Storage.getKey(provider) || '';
    if (!key && !p.publicModels) {
      notify.toast('No API key stored — add one in the provider panel before applying.', 'warning');
    }
    const cfg = configEngine.buildClaudeSettings(p, p.baseUrl, model, key);
    return { config: cfg, instructions: null };
  }
  if (client === 'claude-code' && connectionType === 'local') {
    // Experimental proxy-required — no writeable config; guidance only.
    return { config: null, instructions: compat?.notes || ['Claude Code requires an Anthropic-compatible proxy to use a local runtime.'] };
  }
  const adapter = getClientAdapter(client);
  const providerMeta = provider ? getProvider(provider) : null;
  const g = adapter.generateConfig({
    provider: providerMeta,
    runtime: runtime ? getRuntime(runtime) : null,
    baseUrl: provider ? providerMeta.baseUrl : null,
    model: model,
    apiKey: provider ? (Storage.getKey(provider) || '') : '',
  });
  return { config: g.config, instructions: g.instructions };
}

// Mask the secret inside apiKeyHelper (`echo '<key>'`) for safe preview display.
function maskConfigForPreview(config) {
  const c = JSON.parse(JSON.stringify(config));
  if (c.apiKeyHelper) {
    const m = /echo\s+'(.*)'/.exec(c.apiKeyHelper);
    const key = m ? m[1] : c.apiKeyHelper;
    c.apiKeyHelper = `echo '${maskKey(key)}'`;
  }
  return c;
}