import { esc, logoHtml } from './util.js';
import { getProvider } from '../providers/registry.js';
import { Storage } from '../core/storage.js';
import { workspace } from '../core/state.js';
import { openModal } from './modal.js';
import { renderModelPicker } from './modelPicker.js';
import { notify } from '../core/notifications.js';
import { configEngine } from '../config/engine.js';
import { LocalSettingsRuntime, CopyableRuntime } from '../config/runtimeAdapter.js';
import { recordActivity } from '../core/activityStore.js';

// Provider configuration panel — opened when a provider card is clicked. Replaces
// the old inline-card editing with a focused modal: API key (password + show/hide),
// searchable model picker, connection test (via the existing /api/test endpoint),
// and a "Continue" that hands off to the guided configuration workflow. No
// configuration generation happens here — that stays in the engine/workflow.
export function openProviderConfig(providerId) {
  const provider = getProvider(providerId);
  if (!provider) return;

  const key = Storage.getKey(providerId) || '';
  const model = Storage.getModel(providerId) || '';
  const baseVal = provider.hasCustomUrl ? (workspace.customUrl || '') : (provider.baseUrl || '');

  const body = `
    <div class="pc">
      <div class="pc-head">
        <div class="pc-logo">${logoHtml(provider)}</div>
        <div class="pc-meta">
          <div class="pc-name">${esc(provider.name)}</div>
          ${provider.id !== 'custom' && provider.sub ? `<div class="pc-sub pc-sub-link" role="link" tabindex="0" title="Open ${esc(provider.sub)}">${esc(provider.sub)}</div>` : ''}
        </div>
        <span class="badge ${provider.claudeCode ? 'cc' : 'browse'}">${provider.claudeCode ? 'Claude Code' : 'Browse · API'}</span>
      </div>
      <p class="pc-desc">${esc(provider.desc)}</p>

      ${provider.hasCustomUrl ? `
        <label class="lbl">Base URL</label>
        <input class="inp base-url-${providerId}" type="text" value="${esc(baseVal)}" placeholder="https://your-gateway.com/v1/" />` : ''}

      <label class="lbl">API Key</label>
      <div class="key-row">
        <input class="inp api-key-${providerId}" type="password" value="${esc(key)}"
               placeholder="${provider.publicModels ? 'API key (optional)…' : 'Enter API key…'}" />
        <button class="btn btn2 key-eye" type="button" data-act="toggle">show</button>
      </div>

      <label class="lbl">Model</label>
      <div class="pc-model-host"></div>
      <input type="hidden" class="model-${providerId}" value="${esc(model)}" />

      <div class="modal-actions">
        <button class="btn btn2" data-act="test" type="button">Test Connection</button>
        <button class="btn btn-go" data-act="apply" type="button">${provider.claudeCode ? 'Apply to Claude Code' : 'Show config'}</button>
      </div>
    </div>`;

  const { close } = openModal({
    title: '',
    subtitle: 'Provider configuration',
    size: 'wide',
    bodyHTML: body,
    onMount: (b, ctrl) => {
      const keyInput = b.querySelector(`.api-key-${providerId}`);
      keyInput.addEventListener('input', () => Storage.setKey(providerId, keyInput.value));

      const pcSub = b.querySelector('.pc-sub');
      if (pcSub && provider.sub && provider.id !== 'custom') {
        const goSite = () => window.open('https://' + provider.sub, '_blank', 'noopener');
        pcSub.addEventListener('click', goSite);
        pcSub.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goSite(); } });
      }

      const eye = b.querySelector('[data-act="toggle"]');
      eye.addEventListener('click', () => {
        const showing = keyInput.type === 'text';
        keyInput.type = showing ? 'password' : 'text';
        eye.textContent = showing ? 'show' : 'hide';
      });

      const modelHost = b.querySelector('.pc-model-host');
      renderModelPicker(modelHost, providerId, {
        current: model,
        includePaid: Storage.getPaid(providerId),
        showPaidToggle: provider.id !== 'custom',
        onSelect: (id) => {
          Storage.setModel(providerId, id);
          const m = b.querySelector(`.model-${providerId}`);
          if (m) m.value = id;
        },
      });

      b.querySelector('[data-act="test"]').addEventListener('click', () => {
        // Reuse the proven global testConnection (reads the .api-key-* / .model-* /
        // .base-url-* selectors this modal renders). No behaviour change.
        const url = provider.hasCustomUrl
          ? (b.querySelector(`.base-url-${providerId}`)?.value || baseVal)
          : (provider.baseUrl || '');
        if (window.testConnection) window.testConnection(providerId, url);
        else notify.toast('Test unavailable', 'error');
      });

      // Apply / show config — decided by provider compatibility with Claude Code
      // (registry `claudeCode` flag), not by provider id:
      // - Anthropic-compatible providers (anthropic, agentrouter, aerolink,
      //   freemodel, tokenrouter, custom) write the built config directly to
      //   settings.json (atomic + backup + verify on the server).
      // - OpenAI/Gemini-style clients (openrouter, nvidia, groq, gemini, …) are
      //   NOT written to settings.json. The generated JSON is shown in a copyable
      //   dialog (tailored to the client by CopyableRuntime) so the user applies
      //   it manually to the right client.
      b.querySelector('[data-act="apply"]').addEventListener('click', async () => {
        const key = keyInput.value;
        const model = (b.querySelector(`.model-${providerId}`)?.value || '').trim();
        if (!model) { notify.toast('Choose a model before applying.', 'warning'); return; }
        if (!provider.publicModels && !key) { notify.toast('Add an API key before applying.', 'warning'); return; }
        const baseUrl = provider.hasCustomUrl
          ? (b.querySelector(`.base-url-${providerId}`)?.value || baseVal)
          : (provider.baseUrl || '');
        const cfg = configEngine.buildClaudeSettings(provider, baseUrl, model, key);

        if (provider.claudeCode) {
          const ok = await LocalSettingsRuntime.write(cfg);
          if (ok) {
            Storage.setKey(providerId, key);
            Storage.setModel(providerId, model);
            workspace.applied = {
              client: 'claude-code', connectionType: 'cloud', provider: providerId,
              runtime: null, model, appliedAt: new Date().toISOString(), status: 'configured',
            };
            workspace.appliedProviderId = providerId;
            workspace.activeProvider = providerId;
            workspace.activeModel = model;
            workspace.activeClient = 'claude-code';
            Storage.setApplied(workspace.applied);
            recordActivity('apply', `Applied ${provider.name} · model ${model} to Claude Code`);
            notify.toast(`Applied ${provider.name} to Claude Code!`, 'success');
            notify.log(`Applied ${provider.name} · model ${model} (backup saved)`, 't-ok');
            if (window.renderWorkspace) window.renderWorkspace();
            if (window.updateShellStatus) window.updateShellStatus();
            ctrl.close();
          }
          return;
        }

        // Non-Claude-Code client: show the generated JSON in a copyable dialog.
        // Do NOT write to settings.json.
        CopyableRuntime.show(cfg, `${provider.name} config`);
        recordActivity('copy-config', `Viewed ${provider.name} · model ${model} config (copy)`);
      });
    },
  });
}
