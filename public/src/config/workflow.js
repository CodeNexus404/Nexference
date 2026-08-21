import { workspace } from '../core/state.js';
import { Storage } from '../core/storage.js';
import { notify } from '../core/notifications.js';
import { openModal } from '../components/modal.js';
import { esc, logoHtml, maskKey, highlightJSON } from '../components/util.js';
import { renderModelPicker } from '../components/modelPicker.js';
import { configEngine } from './engine.js';
import { LocalSettingsRuntime, CopyableRuntime } from './runtimeAdapter.js';
import { getProvider, claudeCodeProviders, PROVIDERS } from '../providers/registry.js';
import { getClient, isClientSupported, normalizeClientId, CLIENTS } from '../clients/registry.js';
import { getClientAdapter } from '../clients/index.js';
import { RUNTIMES, getRuntime } from '../runtimes/registry.js';
import { getRuntimeAdapter } from '../runtimes/index.js';
import { checkClientProvider } from '../compatibility/clientProviderCompatibility.js';
import { checkClientRuntime } from '../compatibility/clientRuntimeCompatibility.js';
import { resolveSelection } from '../compatibility/capabilityResolver.js';
import { levelBadge, compatNoteList, connectionLabel } from '../compatibility/ui.js';

// Configuration Workflow — the primary v0.4.0 config experience, now explicitly
// CLIENT-AWARE. The flow is:
//
//   Client → Connection Type → Provider/Runtime → Model → Review (compatibility) → Apply
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
  if (wf.provider) {
    const sm = Storage.getModel(wf.provider);
    if (sm) wf.model = sm;
  }

  const { close } = openModal({
    title: `Configure ${getClient(wf.client).name}`,
    subtitle: 'Guided configuration',
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
      if (wf.generated && !wf.appliedRecorded) workspace.unsaved = true;
      if (window.updateShellStatus) window.updateShellStatus();
    },
  });

  function stepList() {
    return wf.connectionType === 'local'
      ? ['Client', 'Connection', 'Runtime', 'Model', 'Review', 'Apply']
      : ['Client', 'Connection', 'Provider', 'Model', 'Review', 'Apply'];
  }

  function renderSteps() {
    const labels = stepList();
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
    const map = {
      1: stepClient,
      2: stepConnection,
      3: wf.connectionType === 'local' ? stepRuntime : stepProvider,
      4: stepModel,
      5: stepReview,
      6: stepApply,
    };
    (map[wf.step] || stepClient)();
  }

  function el(cls) { const d = document.createElement('div'); d.className = cls; return d; }

  // ── Step 1: Client ──
  function stepClient() {
    const host = el('wf-pane');
    host.innerHTML = `<h4 class="wf-h">Select client</h4>
      <p class="wf-sub">Nexference generates configuration for the target AI coding client. Claude Code is fully verified; others are shown honestly as manual/experimental.</p>`;
    const grid = document.createElement('div');
    grid.className = 'client-grid';
    grid.innerHTML = CLIENTS.map((c) => `
      <button class="panel client-card ${c.support !== 'unsupported' ? 'live' : ''} ${c.id === wf.client ? 'sel' : ''}" data-id="${c.id}" ${c.support === 'unsupported' ? 'disabled' : ''}>
        <div class="client-top"><b>${esc(c.name)}</b><span class="badge ${c.support}">${esc(c.support === 'verified' ? 'Verified' : c.support === 'manual' ? 'Manual' : 'Coming soon')}</span></div>
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
      const c = getClient(wf.client);
      if (c.support === 'unsupported') { notify.toast(`${c.name} support is coming soon`, 'info'); return; }
      wf.step = 2; renderStep();
    });
  }

  // ── Step 2: Connection Type ──
  function stepConnection() {
    const c = getClient(wf.client);
    const types = c.connectionTypes.length ? c.connectionTypes : ['cloud'];
    const host = el('wf-pane');
    host.innerHTML = `<h4 class="wf-h">How do you want to connect?</h4>
      <p class="wf-sub">Choose the connection type this client will use.</p>
      <div class="conn-grid"></div>`;
    const grid = host.querySelector('.conn-grid');
    const cards = [
      { type: 'cloud', title: '☁ Cloud AI', sub: 'Anthropic, OpenRouter, OpenAI, Gemini…', note: '' },
      { type: 'local', title: '◉ Local AI', sub: 'Ollama, LM Studio, llama.cpp…', note: c.id === 'claude-code' ? 'Experimental · requires an Anthropic-compatible proxy' : '' },
    ].filter((x) => types.includes(x.type));
    grid.innerHTML = cards.map((x) => `
      <button class="panel conn-card ${wf.connectionType === x.type ? 'sel' : ''}" data-type="${x.type}">
        <div class="conn-title">${esc(x.title)}</div>
        <div class="conn-sub">${esc(x.sub)}</div>
        ${x.note ? `<div class="conn-note">${esc(x.note)}</div>` : ''}
      </button>`).join('');
    grid.querySelectorAll('.conn-card').forEach((b) => b.addEventListener('click', () => {
      wf.connectionType = b.dataset.type;
      wf.provider = null; wf.runtime = null; wf.model = null;
      renderStep();
    }));
    host.appendChild(grid);
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<button class="btn btn2" id="wfBack">Back</button><button class="btn btn-go" id="wfNext">Continue</button>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 1; renderStep(); });
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => { wf.step = 3; renderStep(); });
  }

  // ── Step 3a: Provider (cloud) ──
  function stepProvider() {
    const host = el('wf-pane');
    const providers = PROVIDERS.filter((p) => checkClientProvider(wf.client, p.id).compatible);
    host.innerHTML = `<h4 class="wf-h">Select provider</h4>
      <p class="wf-sub">Providers compatible with ${esc(getClient(wf.client).name)} for a cloud connection.</p>
      <input class="inp wf-prov-search" placeholder="Filter providers…" aria-label="Filter providers" />`;
    const grid = document.createElement('div');
    grid.className = 'provider-grid';
    function draw(q) {
      const ql = (q || '').toLowerCase();
      grid.innerHTML = providers
        .filter((p) => !ql || p.name.toLowerCase().includes(ql) || p.sub.toLowerCase().includes(ql))
        .map((p) => {
          const comp = checkClientProvider(wf.client, p.id);
          return `
          <button class="panel provider-card ${p.id === wf.provider ? 'sel' : ''}" data-id="${p.id}">
            <div class="pc-logo-sm">${logoHtml(p)}</div>
            <div class="provider-meta">
              <b>${esc(p.name)}</b>
              ${levelBadge(comp.level)}
            </div>
            ${p.id === wf.provider ? '<span class="badge cc">selected</span>' : ''}
          </button>`;
        }).join('');
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
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 2; renderStep(); });
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => {
      if (!wf.provider) { notify.toast('Select a provider', 'warning'); return; }
      wf.step = 4; renderStep();
    });
  }

  // ── Step 3b: Runtime (local) ──
  function stepRuntime() {
    const host = el('wf-pane');
    const runtimes = RUNTIMES.filter((r) => checkClientRuntime(wf.client, r.id).compatible);
    host.innerHTML = `<h4 class="wf-h">Select local runtime</h4>
      <p class="wf-sub">Local runtimes compatible with ${esc(getClient(wf.client).name)}. Ollama is fully supported; others are detection-only.</p>`;
    if (!runtimes.length) {
      host.innerHTML += `<div class="warn-box">No compatible local runtime for this client yet. Local models require a runtime that speaks the client’s protocol.</div>`;
    } else {
      const grid = document.createElement('div');
      grid.className = 'provider-grid';
      grid.innerHTML = runtimes.map((r) => {
        const comp = checkClientRuntime(wf.client, r.id);
        return `
        <button class="panel provider-card ${r.id === wf.runtime ? 'sel' : ''}" data-id="${r.id}">
          <div class="provider-meta"><b>${esc(r.name)}</b>${levelBadge(comp.level)}</div>
          <div class="client-sub">${esc(r.note || '')}</div>
        </button>`;
      }).join('');
      grid.querySelectorAll('.provider-card').forEach((b) => b.addEventListener('click', () => {
        wf.runtime = b.dataset.id; wf.step = 4; renderStep();
      }));
      host.appendChild(grid);
    }
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<button class="btn btn2" id="wfBack">Back</button>${runtimes.length ? '<button class="btn btn-go" id="wfNext">Continue</button>' : ''}`;
    wf.actionsEl.querySelector('#wfBack')?.addEventListener('click', () => { wf.step = 2; renderStep(); });
    wf.actionsEl.querySelector('#wfNext')?.addEventListener('click', () => {
      if (!wf.runtime) { notify.toast('Select a runtime', 'warning'); return; }
      wf.step = 4; renderStep();
    });
  }

  // ── Step 4: Model ──
  function stepModel() {
    const host = el('wf-pane');
    if (wf.connectionType === 'cloud') {
      const provider = getProvider(wf.provider);
      host.innerHTML = `<h4 class="wf-h">Select model</h4>
        <p class="wf-sub">${esc(provider ? provider.name : '')} · search the catalogue (live API, scraped, or curated fallback).</p>
        <div class="pc-model-host" id="wfModelHost"></div>`;
      wf.bodyEl.appendChild(host);
      renderModelPicker(host.querySelector('#wfModelHost'), wf.provider, {
        includePaid: wf.includePaid,
        showPaidToggle: false,
        current: wf.model,
        onSelect: (id) => { wf.model = id; Storage.setModel(wf.provider, id); },
      });
    } else {
      host.innerHTML = `<h4 class="wf-h">Select local model</h4>
        <p class="wf-sub">Enter the model name served by ${esc(getRuntime(wf.runtime)?.name || 'the runtime')}. Ollama models are listed if it is running.</p>
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
    wf.actionsEl.innerHTML = `<button class="btn btn2" id="wfBack">Back</button><button class="btn btn-go" id="wfNext">Continue</button>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 3; renderStep(); });
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => {
      if (wf.connectionType === 'local') wf.model = host.querySelector('#wfLocalModel')?.value || wf.model;
      if (!wf.model) { notify.toast('Select a model', 'warning'); return; }
      wf.step = 5; renderStep();
    });
  }

  // ── Step 5: Review (compatibility-driven) ──
  function stepReview() {
    const comp = resolveSelection({
      clientId: wf.client, connectionType: wf.connectionType,
      providerId: wf.provider, runtimeId: wf.runtime, modelId: wf.model,
    });
    wf.lastCompat = comp;
    const built = buildSelectionConfig();
    wf.lastConfig = built.config;
    wf.instructions = built.instructions;
    wf.generated = true;

    const targetName = wf.connectionType === 'local' ? (getRuntime(wf.runtime)?.name || '') : (getProvider(wf.provider)?.name || '');
    const host = el('wf-pane');
    host.innerHTML = `<h4 class="wf-h">Review configuration</h4>
      <div class="review-meta">
        <div class="kv"><span>Client</span><b>${esc(getClient(wf.client).name)}</b></div>
        <div class="kv"><span>Connection</span><b>${esc(connectionLabel(wf.connectionType))}</b></div>
        <div class="kv"><span>${wf.connectionType === 'local' ? 'Runtime' : 'Provider'}</span><b>${esc(targetName)}</b></div>
        <div class="kv"><span>Model</span><b>${esc(wf.model)}</b></div>
        <div class="kv"><span>Compatibility</span><b>${levelBadge(comp.level)}</b></div>
      </div>
      ${compatNoteList(comp)}
      ${built.config ? `<pre class="code wf-preview">${highlightJSON(JSON.stringify(maskConfigForPreview(built.config), null, 2))}</pre>` : ''}
      ${!built.config && built.instructions ? `<div class="manual-box"><b>Manual setup</b><ul>${built.instructions.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
      ${!comp.compatible ? `<div class="warn-box">This combination is ${esc(comp.level)}. Nexference will not write a configuration that will not work — switch the client or provider, or follow the manual guidance above.</div>` : ''}`;
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<button class="btn btn2" id="wfBack">Back</button><button class="btn btn-go" id="wfNext">Continue to apply</button>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 4; renderStep(); });
    wf.actionsEl.querySelector('#wfNext').addEventListener('click', () => { wf.step = 6; renderStep(); });
  }

  // ── Step 6: Apply ──
  function stepApply() {
    const comp = wf.lastCompat;
    const canApply = comp && comp.autoApply && wf.lastConfig;
    const host = el('wf-pane');
    host.innerHTML = `<h4 class="wf-h">Apply configuration</h4>
      <p class="wf-sub">${
        canApply
          ? 'Click Apply to back up the current settings, then write the new configuration.'
          : 'This client/connection cannot be auto-applied. Nexference will show the manual steps instead of writing a config that will not work.'
      }</p>
      <div class="apply-box">
        <div class="kv"><span>Target client</span><b>${esc(getClient(wf.client).name)}</b></div>
        <div class="kv"><span>Action</span><b>${canApply ? 'Backup + write' : 'Show manual steps'}</b></div>
      </div>`;
    wf.bodyEl.appendChild(host);
    wf.actionsEl.innerHTML = `<button class="btn btn2" id="wfBack">Back</button><button class="btn btn-go" id="wfApply">${canApply ? 'Apply Configuration' : 'Show manual steps'}</button>`;
    wf.actionsEl.querySelector('#wfBack').addEventListener('click', () => { wf.step = 5; renderStep(); });
    wf.actionsEl.querySelector('#wfApply').addEventListener('click', () => doApply(canApply));
  }

  async function doApply(canApply) {
    const targetMeta = wf.connectionType === 'local'
      ? getRuntime(wf.runtime)
      : getProvider(wf.provider);

    if (canApply && wf.lastConfig) {
      try {
        const ok = await LocalSettingsRuntime.write(wf.lastConfig);
        if (ok) {
          recordApplied(targetMeta, 'configured');
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
    if (wf.client === 'claude-code' && wf.connectionType === 'cloud') {
      const p = getProvider(wf.provider);
      if (!p) return { config: null, instructions: ['Select a provider'] };
      const key = Storage.getKey(wf.provider) || '';
      if (!key && !p.publicModels) {
        notify.toast('No API key stored — add one in the provider panel before applying.', 'warning');
      }
      const cfg = configEngine.buildClaudeSettings(p, p.baseUrl, wf.model, key);
      return { config: cfg, instructions: null };
    }
    if (wf.client === 'claude-code' && wf.connectionType === 'local') {
      // Experimental proxy-required — no writeable config; guidance only.
      return { config: null, instructions: wf.lastCompat?.notes || ['Claude Code requires an Anthropic-compatible proxy to use a local runtime.'] };
    }
    const adapter = getClientAdapter(wf.client);
    const g = adapter.generateConfig({
      provider: wf.provider ? getProvider(wf.provider) : null,
      runtime: wf.runtime ? getRuntime(wf.runtime) : null,
      baseUrl: wf.provider ? getProvider(wf.provider).baseUrl : null,
      model: wf.model,
      apiKey: wf.provider ? (Storage.getKey(wf.provider) || '') : '',
    });
    return { config: g.config, instructions: g.instructions };
  }
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
