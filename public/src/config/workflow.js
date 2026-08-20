import { workspace } from '../core/state.js';
import { Storage } from '../core/storage.js';
import { notify } from '../core/notifications.js';
import { openModal } from '../components/modal.js';
import { esc, logoHtml, maskKey, highlightJSON } from '../components/util.js';
import { renderModelPicker } from '../components/modelPicker.js';
import { configEngine } from './engine.js';
import { LocalSettingsRuntime, CopyableRuntime } from './runtimeAdapter.js';
import { getProvider, claudeCodeProviders, providerTags } from '../providers/registry.js';
import { CLIENTS, getClient, isClientSupported } from './clientAdapter.js';

// Configuration Workflow — the primary v0.3.0 config experience.
//  Client → Provider → Model → Review → Apply
// It deliberately does NOT generate configs itself: every config is produced by
// the proven Configuration Engine (buildClaudeSettings / ClaudeCodeAdapter). This
// module only orchestrates steps, renders previews, and applies through the
// existing Runtime Adapter (which writes via the server's backup-then-write store).
export function openWorkflow(opts = {}) {
  const wf = {
    client: 'claude-code',
    provider: opts.initialProvider || (workspace.applied && workspace.applied.provider) || null,
    model: null,
    includePaid: false,
    step: 1,
    lastConfig: null,
    generated: false,
    appliedRecorded: false,
  };
  if (wf.provider) {
    const sm = Storage.getModel(wf.provider);
    if (sm) wf.model = sm;
  }

  const { close } = openModal({
    title: 'Configure Claude Code',
    subtitle: 'Guided configuration · 5 steps',
    size: 'wide',
    bodyHTML: `
      <div class="wf">
        <div class="wf-steps" id="wfSteps"></div>
        <div class="wf-body" id="wfBody"></div>
        <div class="wf-actions" id="wfActions"></div>
      </div>`,
    onMount: (body, ctrl) => {
      wf.ctrl = ctrl;
      wf.stepsEl = body.querySelector('#wfSteps');
      wf.bodyEl = body.querySelector('#wfBody');
      wf.actionsEl = body.querySelector('#wfActions');
      renderStep();
    },
    onClose: () => {
      // If a config was generated but never applied, flag unsaved state.
      if (wf.generated && !wf.appliedRecorded) workspace.unsaved = true;
      if (window.updateShellStatus) window.updateShellStatus();
    },
  });

  function renderSteps() {
    const labels = ['Client', 'Provider', 'Model', 'Review', 'Apply'];
    wf.stepsEl.innerHTML = labels.map((l, i) => {
      const n = i + 1;
      const state = n < wf.step ? 'done' : n === wf.step ? 'active' : '';
      return `<div class="wf-step ${state}"><span class="wf-dot">${n < wf.step ? '✓' : n}</span><span class="wf-lab">${esc(l)}</span></div>`;
    }).join('');
  }

  function renderStep() {
    renderSteps();
    wf.bodyEl.innerHTML = '';
    wf.actionsEl.innerHTML = '';
    ({ 1: stepClient, 2: stepProvider, 3: stepModel, 4: stepReview, 5: stepApply }[wf.step]());
  }

  // ── Step 1: Client ──
  function stepClient() {
    const host = el('wf-pane');
    host.innerHTML = `<h4 class="wf-h">Select client</h4>
      <p class="wf-sub">Nexference generates configuration for the target AI coding client. Claude Code is fully supported; others are shown honestly as coming soon.</p>`;
    const grid = document.createElement('div');
    grid.className = 'client-grid';
    grid.innerHTML = CLIENTS.map((c) => `
      <button class="panel client-card ${c.supported ? 'live' : ''} ${c.id === wf.client ? 'sel' : ''}" data-id="${c.id}" ${c.supported ? '' : 'disabled'}>
        <div class="client-top"><b>${esc(c.name)}</b><span class="badge ${c.supported ? 'live' : 'planned'}">${c.supported ? 'Supported' : 'Coming soon'}</span></div>
        <div class="client-sub">${esc(c.note || '')}</div>
      </button>`).join('');
    grid.querySelectorAll('.client-card').forEach((b) => {
      if (b.disabled) return;
      b.addEventListener('click', () => { wf.client = b.dataset.id; renderStep(); });
    });
    host.appendChild(grid);
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<button class="btn btn-go" id="wfNext">Continue</button>`;
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => {
      if (isClientSupported(wf.client)) { wf.step = 2; renderStep(); }
      else notify.toast(`${getClient(wf.client).name} support is coming soon`, 'info');
    });
  }

  // ── Step 2: Provider ──
  function stepProvider() {
    const host = el('wf-pane');
    const providers = claudeCodeProviders();
    host.innerHTML = `<h4 class="wf-h">Select provider</h4>
      <p class="wf-sub">Providers compatible with Claude Code — Anthropic-format gateways, or OpenRouter via the compatibility layer.</p>
      <input class="inp wf-prov-search" placeholder="Filter providers…" aria-label="Filter providers" />`;
    const grid = document.createElement('div');
    grid.className = 'provider-grid';
    function draw(q) {
      const ql = (q || '').toLowerCase();
      grid.innerHTML = providers
        .filter((p) => !ql || p.name.toLowerCase().includes(ql) || p.sub.toLowerCase().includes(ql))
        .map((p) => `
          <button class="panel provider-card ${p.id === wf.provider ? 'sel' : ''}" data-id="${p.id}">
            <div class="pc-logo-sm">${logoHtml(p)}</div>
            <div class="provider-meta">
              <b>${esc(p.name)}</b>
              <span class="provider-compat">${p.id === 'openrouter' ? 'Anthropic (proxy)' : (p.claudeCode ? 'Anthropic' : 'OpenAI')}</span>
            </div>
            ${p.id === wf.provider ? '<span class="badge cc">selected</span>' : ''}
          </button>`).join('');
      grid.querySelectorAll('.provider-card').forEach((b) => b.addEventListener('click', () => {
        wf.provider = b.dataset.id;
        const sm = Storage.getModel(wf.provider);
        wf.model = sm || null;
        renderStep();
      }));
    }
    draw('');
    host.querySelector('.wf-prov-search').addEventListener('input', (e) => draw(e.target.value));
    host.appendChild(grid);
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<button class="btn btn2" id="wfBack">Back</button><button class="btn btn-go" id="wfNext">Continue</button>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 1; renderStep(); });
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => {
      if (!wf.provider) { notify.toast('Select a provider', 'warning'); return; }
      wf.step = 3; renderStep();
    });
  }

  // ── Step 3: Model ──
  function stepModel() {
    const host = el('wf-pane');
    const provider = getProvider(wf.provider);
    host.innerHTML = `<h4 class="wf-h">Select model</h4>
      <p class="wf-sub">${esc(provider ? provider.name : '')} · search the catalogue (live API, scraped, or curated fallback).</p>
      <label class="paid-toggle"><input type="checkbox" id="wfPaid" ${wf.includePaid ? 'checked' : ''}><span class="paid-track"></span><span class="paid-text">Include paid</span></label>
      <div class="pc-model-host" id="wfModelHost"></div>`;
    wf.bodyEl.appendChild(host);
    renderModelPicker(host.querySelector('#wfModelHost'), wf.provider, {
      includePaid: wf.includePaid,
      showPaidToggle: false,
      current: wf.model,
      onSelect: (id) => { wf.model = id; Storage.setModel(wf.provider, id); },
    });
    host.querySelector('#wfPaid').addEventListener('change', (e) => { wf.includePaid = e.target.checked; renderStep(); });
    wf.actionsEl.innerHTML = `<button class="btn btn2" id="wfBack">Back</button><button class="btn btn-go" id="wfNext">Continue</button>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 2; renderStep(); });
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => {
      if (!wf.model) { notify.toast('Select a model', 'warning'); return; }
      wf.step = 4; renderStep();
    });
  }

  // ── Step 4: Review ──
  function stepReview() {
    const provider = getProvider(wf.provider);
    const baseUrl = provider.baseUrl;
    const key = Storage.getKey(wf.provider) || '';
    if (!key && !provider.publicModels) {
      notify.toast('No API key stored — config will be generated without a key. Add one in the provider panel.', 'warning');
    }
    // Proven generation path — identical output to the original buildClaudeSettings.
    const config = configEngine.buildClaudeSettings(provider, baseUrl, wf.model, key);
    wf.lastConfig = config;
    wf.generated = true;

    const isCopy = !!(config.env.OPENAI_BASE_URL || config.env.GOOGLE_API_KEY);
    const preview = highlightJSON(JSON.stringify(maskConfigForPreview(config), null, 2));
    const compat = provider.id === 'openrouter' ? 'Anthropic (proxy)' : (provider.claudeCode ? 'Anthropic' : 'OpenAI');

    const host = el('wf-pane');
    host.innerHTML = `<h4 class="wf-h">Review configuration</h4>
      <div class="review-meta">
        <div class="kv"><span>Client</span><b>${esc(getClient(wf.client).name)}</b></div>
        <div class="kv"><span>Provider</span><b>${esc(provider.name)}</b></div>
        <div class="kv"><span>Model</span><b>${esc(wf.model)}</b></div>
        <div class="kv"><span>Compatibility</span><b>${esc(compat)}</b></div>
      </div>
      <p class="wf-note">This configuration will update:<br><code>~/.claude/settings.json</code>${
        isCopy ? '<br><span class="warn">OpenAI/Gemini config — will be shown copyable, not written to Claude Code.</span>' : ''
      }</p>
      <pre class="code wf-preview">${preview}</pre>`;
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<button class="btn btn2" id="wfBack">Back</button><button class="btn btn-go" id="wfNext">Continue to apply</button>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 3; renderStep(); });
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => { wf.step = 5; renderStep(); });
  }

  // ── Step 5: Apply ──
  function stepApply() {
    const isCopy = !!(wf.lastConfig.env.OPENAI_BASE_URL || wf.lastConfig.env.GOOGLE_API_KEY);
    const host = el('wf-pane');
    host.innerHTML = `<h4 class="wf-h">Apply configuration</h4>
      <p class="wf-sub">${
        isCopy
          ? 'This client config can’t be consumed by Claude Code. It will be shown for you to copy into your own client.'
          : 'Click Apply to back up the current settings.json, then write the new configuration.'
      }</p>
      <div class="apply-box">
        <div class="kv"><span>Target</span><b>~/.claude/settings.json</b></div>
        <div class="kv"><span>Action</span><b>${isCopy ? 'Show copyable config' : 'Backup + write'}</b></div>
      </div>`;
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<button class="btn btn2" id="wfBack">Back</button><button class="btn btn-go" id="wfApply">${isCopy ? 'Show config' : 'Apply Configuration'}</button>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 4; renderStep(); });
    wf.actionsEl.querySelector('#wfApply').addEventListener('click', () => doApply());
  }

  async function doApply() {
    if (!wf.lastConfig) return;
    const provider = getProvider(wf.provider);
    const isCopy = !!(wf.lastConfig.env.OPENAI_BASE_URL || wf.lastConfig.env.GOOGLE_API_KEY);

    if (isCopy) {
      CopyableRuntime.show(wf.lastConfig, provider.name);
      recordApplied(provider, 'copyable');
      wf.ctrl.close();
      return;
    }
    try {
      const ok = await LocalSettingsRuntime.write(wf.lastConfig);
      if (ok) {
        recordApplied(provider, 'configured');
        workspace.appliedProviderId = wf.provider;
        workspace.activeProvider = wf.provider;
        workspace.activeModel = wf.model;
        notify.toast(`Applied ${provider.name} to Claude Code!`, 'success');
        notify.log(`Applied ${provider.name} · model ${wf.model} (backup saved)`, 't-ok');
        if (window.renderWorkspace) window.renderWorkspace();
        if (window.updateShellStatus) window.updateShellStatus();
        wf.ctrl.close();
      }
    } catch (err) {
      notify.toast(`Error: ${err.message}`, 'error');
    }
  }

  function recordApplied(provider, status) {
    const rec = {
      client: wf.client,
      provider: provider.id,
      model: wf.model,
      appliedAt: new Date().toISOString(),
      status,
    };
    workspace.applied = rec;
    workspace.unsaved = false;
    workspace.appliedRecorded = true;
    Storage.setApplied(rec);
  }

  function el(cls) {
    const d = document.createElement('div');
    d.className = cls;
    return d;
  }
}

// Mask the secret inside apiKeyHelper (`echo '<key>'`) for safe preview display.
// The real key is only ever used by the engine + sent to the provider; it is
// never logged or shown in full.
function maskConfigForPreview(config) {
  const c = JSON.parse(JSON.stringify(config));
  if (c.apiKeyHelper) {
    const m = /echo\s+'(.*)'/.exec(c.apiKeyHelper);
    const key = m ? m[1] : c.apiKeyHelper;
    c.apiKeyHelper = `echo '${maskKey(key)}'`;
  }
  return c;
}
