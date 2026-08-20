import { esc, logoHtml } from './util.js';
import { getProvider } from '../providers/registry.js';
import { Storage } from '../core/storage.js';
import { workspace } from '../core/state.js';
import { openModal } from './modal.js';
import { openWorkflow } from '../config/workflow.js';
import { renderModelPicker } from './modelPicker.js';
import { notify } from '../core/notifications.js';

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
  const baseVal = provider.hasCustomUrl ? (workspace.customUrl || provider.baseUrl) : provider.baseUrl;

  const body = `
    <div class="pc">
      <div class="pc-head">
        <div class="pc-logo">${logoHtml(provider)}</div>
        <div class="pc-meta">
          <div class="pc-name">${esc(provider.name)}</div>
          <div class="pc-sub">${esc(provider.sub)}</div>
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
        <button class="btn btn-go" data-act="continue" type="button">Continue →</button>
      </div>
    </div>`;

  const { close } = openModal({
    title: provider.name,
    subtitle: 'Provider configuration',
    size: 'wide',
    bodyHTML: body,
    onMount: (b, ctrl) => {
      const keyInput = b.querySelector(`.api-key-${providerId}`);
      keyInput.addEventListener('input', () => Storage.setKey(providerId, keyInput.value));

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
          : provider.baseUrl;
        if (window.testConnection) window.testConnection(providerId, url);
        else notify.toast('Test unavailable', 'error');
      });

      b.querySelector('[data-act="continue"]').addEventListener('click', () => {
        ctrl.close();
        openWorkflow({ initialProvider: providerId });
      });
    },
  });
}
