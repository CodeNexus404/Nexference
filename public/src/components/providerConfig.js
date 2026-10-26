import { esc, logoHtml, cpField } from './util.js';
import { fallbackStore } from '../config/fallbackStore.js';
import { getProvider, claudeCodeCompatibility } from '../providers/registry.js';
import { Storage } from '../core/storage.js';
import { workspace } from '../core/state.js';
import { openModal } from './modal.js';
import { renderModelPicker } from './modelPicker.js';
import { notify } from '../core/notifications.js';
import { configEngine } from '../config/engine.js';
  import { LocalSettingsRuntime, configClientMeta } from '../config/runtimeAdapter.js';
import { recordActivity } from '../core/activityStore.js';
import { integrationSectionHTML } from '../ui/providerIntegrations.js';
import { localProxyStatus } from '../localProxy.js';

// Provider configuration panel — opened when a provider card is clicked. Replaces
// the old inline-card editing with a focused modal: API key (password + show/hide),
// searchable model picker, connection test (via the existing /api/test endpoint),
// and a "Continue" that hands off to the guided configuration workflow. No
// configuration generation happens here — that stays in the engine/workflow.

// Mirror a deliberate primary apply into any armed fallback plan for that client.
// Centralised so every apply path behaves identically, and dispatched only when the
// stored primary actually moved, so listeners do no redundant work.
function syncFallbackPrimary(applied) {
  try {
    if (!fallbackStore.syncPrimaryFromApplied(applied.client, applied)) return;
    window.dispatchEvent(new CustomEvent('nx-fallback', { detail: { client: applied.client, changed: true, reason: 'primary-applied' } }));
  } catch { /* fallback store unavailable — never block an apply on it */ }
}

export function openProviderConfig(providerId) {
  const provider = getProvider(providerId);
  if (!provider) return;

  // Both decisions come from one shared helper (see registry.js) so curated,
  // custom and adopted cards can never disagree about whether a provider is
  // Anthropic-compatible:
  //   anthropic → "Apply to Claude Code" writes settings.json, and the local
  //               proxy is NOT offered (it would be a second, redundant route).
  //   proxy     → only for OpenAI-shaped providers that Claude Code cannot talk
  //               to directly.
  const { anthropic: anthropicSupported, proxy: showProxy, proxyBaseUrl, proxyFormat } = claudeCodeCompatibility(provider);

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
        <span class="badge ${anthropicSupported ? 'cc' : 'browse'}">${anthropicSupported ? 'Claude Code' : 'Browse · API'}</span>
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
          ${showProxy ? '<button class="btn btn2" data-act="proxy" type="button">Use with Claude Code (via Nexference)</button>' : ''}
          <button class="btn btn-go" data-act="apply" type="button">${anthropicSupported ? 'Apply to Claude Code' : 'Show config'}</button>
        </div>

        <div data-cfg-host hidden></div>
        <div data-proxy-host hidden></div>

      <details class="intg-details">
        <summary>Provider Integration</summary>
        <div id="intgHost-${providerId}" class="intg-section">Loading integration…</div>
      </details>
    </div>`;

  const { close } = openModal({
    title: '',
    subtitle: 'Provider configuration',
    size: 'wide',
    bodyHTML: body,
    onMount: (b, ctrl) => {
      const keyInput = cpField(b, 'api-key', providerId);
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
          const m = cpField(b, 'model', providerId);
          if (m) m.value = id;
          resetTestButton();
        },
      });

      // A change of model invalidates a previous test result — reset the label.
      function resetTestButton() {
        const t = b.querySelector('[data-act="test"]');
        if (!t || t.disabled) return;
        const prev = t.textContent;
        if (prev.startsWith('Connection OK') || prev.startsWith('Failed (') || prev.startsWith('Error (')) {
          t.textContent = 'Test Connection';
        }
      }

      b.querySelector('[data-act="test"]').addEventListener('click', () => {
        // Reuse the proven global testConnection (reads the .api-key-* / .model-* /
        // .base-url-* selectors this modal renders). No behaviour change.
        const url = provider.hasCustomUrl
          ? (cpField(b, 'base-url', providerId)?.value || baseVal)
          : (provider.baseUrl || '');
        if (window.testConnection) window.testConnection(providerId, url);
        else notify.toast('Test unavailable', 'error');
      });

      // "Use with Claude Code (via Nexference)" — OpenAI-format providers only,
      // mirroring the custom-provider detail modal. The local proxy speaks the
      // OpenAI dialect and translates to Anthropic for Claude Code, so this is
      // the route that makes a hardcoded OpenAI provider usable with Claude Code.
      // Expands the Claude Code proxy panel INSIDE this dialog — previously it
      // opened a second modal that replaced this one, losing the key/model the
      // user had just entered. The panel receives this dialog's live key field so
      // connecting uses the current value.
      const proxyHost = b.querySelector('[data-proxy-host]');
      const proxyBtn = b.querySelector('[data-act="proxy"]');
        // Describe the provider the way the PROXY will actually talk to it. For a
        // dual-surface provider (Gemini: native /v1beta plus a real OpenAI
        // /v1beta/openai/ endpoint) the native base URL is the wrong target —
        // verifying and listing models against it would probe a `contents` API
        // with OpenAI payloads and always fail. Fall back to the native
        // baseUrl/format for ordinary single-surface OpenAI providers.
        const proxyProvider = {
          identity: { name: provider.name },
          name: provider.name,
          api: { baseUrl: proxyBaseUrl || provider.baseUrl, format: proxyFormat || provider.format },
        };
      const openPanel = async () => {
        const { renderProxyPanel } = await import('../ui/customProvider.js');
        await renderProxyPanel(proxyHost, proxyProvider, providerId, { getApiKey: () => keyInput.value });
      };
      proxyBtn?.addEventListener('click', async () => {
        if (!proxyHost) return;
        if (!proxyHost.hidden) {
          proxyHost.hidden = true;
          proxyBtn.textContent = 'Use with Claude Code (via Nexference)';
          return;
        }
        proxyHost.hidden = false;
        proxyBtn.textContent = 'Hide Claude Code setup';
        await openPanel();
      });
      // Surface the live connection state without making the user click.
      if (proxyHost) {
        localProxyStatus().then(async (s) => {
          if (s?.ok && s.data?.armed && s.data.providerId === providerId) {
            proxyHost.hidden = false;
            if (proxyBtn) proxyBtn.textContent = 'Hide Claude Code setup';
            await openPanel();
          }
        }).catch(() => {});
      }

      // v1.9.0: fill the Provider Integration section and wire its actions.
      const host = b.querySelector(`#intgHost-${providerId}`);
      if (host) integrationSectionHTML(providerId).then((html) => { host.innerHTML = html; });
      b.addEventListener('click', (e) => {
        const t = e.target.closest('[data-intg-action]');
        if (t && window.integrationAction) window.integrationAction(t.dataset.intgAction, t.dataset.id);
      });

      // Apply / show config — decided by Anthropic-format support (the
      // `anthropicSupported` flag derived from `provider.format`), not by
      // provider id:
      // - Anthropic-compatible providers (anthropic, agentrouter, aerolink,
      //   freemodel, custom) write the built config directly to settings.json
      //   (atomic + backup + verify on the server).
      // - OpenAI/Gemini-style clients (openrouter, nvidia, groq, gemini,
      //   tokenrouter, …) are NOT written to settings.json. The generated JSON is
      //   shown in a copyable dialog (tailored to the client by CopyableRuntime)
      //   so the user applies it manually to the right client. OpenRouter is the
      //   one exception — it is dual-compatible, so `anthropicSupported` includes
      //   it and it configures Claude Code directly.
        const applyBtn = b.querySelector('[data-act="apply"]');
        applyBtn.addEventListener('click', async () => {
        const key = keyInput.value;
        const model = (cpField(b, 'model', providerId)?.value || '').trim();
        if (!model) { notify.toast('Choose a model before applying.', 'warning'); return; }
        if (!provider.publicModels && !key) { notify.toast('Add an API key before applying.', 'warning'); return; }
        const baseUrl = provider.hasCustomUrl
          ? (cpField(b, 'base-url', providerId)?.value || baseVal)
          : (provider.baseUrl || '');
        const cfg = configEngine.buildClaudeSettings(provider, baseUrl, model, key);

        if (anthropicSupported) {
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
              // Applying from a provider card is a deliberate change of the PRIMARY
              // for this client, so an armed fallback plan follows it. Without this the
              // plan kept pointing at whatever was captured when it was first created.
              syncFallbackPrimary(workspace.applied);
            recordActivity('apply', `Applied ${provider.name} · model ${model} to Claude Code`);
            notify.toast(`Applied ${provider.name} to Claude Code!`, 'success');
            notify.log(`Applied ${provider.name} · model ${model} (backup saved)`, 't-ok');
            if (window.renderWorkspace) window.renderWorkspace();
            if (window.updateShellStatus) window.updateShellStatus();
            // Move the "active" glow onto this card immediately — the grid is not
            // re-rendered here, so without this the highlight would only appear
            // on the next full draw.
            if (window.syncAppliedHighlights) window.syncAppliedHighlights();
            ctrl.close();
          }
          return;
        }

          // Non-Claude-Code client: show the generated JSON for manual use in the
          // provider's own client.
          //
          // This used to call CopyableRuntime.show(), which calls openModal() and
          // APPENDS a second overlay. The user was left with a dialog stacked on
          // top of this one, so closing the copy view dropped them back into the
          // provider dialog rather than back to the card — which read as "the card
          // changed into something else" once the grid redrew underneath. Render
          // it inline instead, so there is exactly one dialog and closing it always
          // returns to the card.
          //
          // Be explicit about the real limitation: Claude Code reads only
          // ANTHROPIC_* vars, so an OPENAI_*/GOOGLE_* config does nothing for it.
          // Saying so is honest; silently handing over an unusable config is not.
          const cfgHost = b.querySelector('[data-cfg-host]');
          const renderInlineConfig = (config) => {
            if (!cfgHost) return;
            const { title, sub } = configClientMeta(config);
            cfgHost.hidden = false;
            cfgHost.innerHTML = `
              <div class="px-note-row">
                <span class="wizard-title">${esc(title)}</span>
                <button class="btn btn2 sm" data-act="cfg-close" type="button">Hide</button>
              </div>
              <p class="px-note">${esc(sub)}</p>
              <p class="px-hint px-hint-warn">Claude Code only reads <code>ANTHROPIC_*</code> variables, so this config has no effect on it. To use ${esc(provider.name)} with Claude Code, use the Nexference local proxy, which translates the request for you.</p>
              <pre class="code config-code pc-cfg-code">${esc(JSON.stringify(config, null, 2))}</pre>
              <div class="px-actions">
                <button class="btn btn2" data-act="cfg-copy" type="button">Copy config</button>
                ${showProxy ? '<button class="btn btn-go" data-act="cfg-to-proxy" type="button">Set up Claude Code instead</button>' : ''}
              </div>`;
            cfgHost.querySelector('[data-act="cfg-copy"]')?.addEventListener('click', async () => {
              const text = JSON.stringify(config, null, 2);
              try {
                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
                else throw new Error('no clipboard api');
                notify.toast('Config copied to clipboard', 'success');
              } catch {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try {
                  document.execCommand('copy');
                  notify.toast('Config copied to clipboard', 'success');
                } catch {
                  notify.toast('Copy failed — select the text manually', 'error');
                }
                ta.remove();
              }
            });
            cfgHost.querySelector('[data-act="cfg-close"]')?.addEventListener('click', () => {
              cfgHost.hidden = true;
              cfgHost.innerHTML = '';
              applyBtn.textContent = 'Show config';
            });
            cfgHost.querySelector('[data-act="cfg-to-proxy"]')?.addEventListener('click', async () => {
              cfgHost.hidden = true;
              cfgHost.innerHTML = '';
              applyBtn.textContent = 'Show config';
              proxyHost.hidden = false;
              if (proxyBtn) proxyBtn.textContent = 'Hide Claude Code setup';
              await openPanel();
            });
          };

          if (cfgHost) {
            if (cfgHost.hidden) renderInlineConfig(cfg);
            else { cfgHost.hidden = true; cfgHost.innerHTML = ''; }
          }
          recordActivity('copy-config', `Viewed ${provider.name} · model ${model} config (copy)`);
        });
    },
  });
}
