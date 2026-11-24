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

  // For Custom Gateway (id 'custom'), if it's configured for OpenAI-compatible, offer proxy
  const isCustomGateway = provider.id === 'custom';
  const gwFormat = (workspace.customFormat || provider.format || 'anthropic').toLowerCase();
  const effectiveProxy = showProxy || (isCustomGateway && (gwFormat === 'openai' || gwFormat === 'openai-compatible'));

  const key = Storage.getKey(providerId) || '';
  const model = Storage.getModel(providerId) || '';
  const baseVal = provider.hasCustomUrl ? (workspace.customUrl || provider.baseUrl || '') : (provider.baseUrl || '');

  const HISTORY_KEY = 'nexference_custom_gateway_history_v1';
  const readHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } };
  const writeHistory = (arr) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify((arr || []).slice(0, 20))); } catch {} };
  const pushHistory = (entry) => {
    if (!isCustomGateway) return;
    const arr = readHistory();
    const normv = (v) => String(v || '').trim();
    const sig = `${normv(entry.format)}|${normv(entry.baseUrl)}|${normv(entry.model)}`;
    const filtered = arr.filter(x => `${normv(x.format)}|${normv(x.baseUrl)}|${normv(x.model)}` !== sig);
    filtered.unshift({ ...entry, ts: Date.now() });
    writeHistory(filtered);
  };

  const gwHistory = isCustomGateway ? readHistory() : [];
  const historyHtml = isCustomGateway ? `
      <details class="intg-details" style="margin-top:10px">
        <summary>Gateway History</summary>
        <div class="gw-history-list" data-gw-history>
          ${gwHistory.length ? gwHistory.map((h, i) => `
            <div class="gw-hist-row" data-hidx="${i}" style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600">${esc(h.format === 'openai' || h.format === 'openai-compatible' ? 'OpenAI-compatible' : 'Anthropic')}</div>
                <div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.baseUrl || '—')}${h.model ? ' · ' + esc(h.model) : ''}</div>
              </div>
              <button class="btn btn2 sm" type="button" data-gw-restore="${i}">Restore</button>
              <button class="btn btn2 sm" type="button" data-gw-delete="${i}" style="color:var(--danger,#ef4444)">Delete</button>
            </div>
          `).join('') : '<div class="muted" style="padding:8px 0;font-size:12px">No saved history yet. Apply or test to save entries.</div>'}
        </div>
      </details>` : '';

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

      ${isCustomGateway ? `
        <label class="lbl">Provider Type</label>
        <div class="gw-type-row" style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <button type="button" class="btn btn2 gw-type-btn ${gwFormat !== 'openai' && gwFormat !== 'openai-compatible' ? 'is-on' : ''}" data-gw-type="anthropic">Anthropic</button>
          <button type="button" class="btn btn2 gw-type-btn ${gwFormat === 'openai' || gwFormat === 'openai-compatible' ? 'is-on' : ''}" data-gw-type="openai">OpenAI-compatible</button>
        </div>
        <div class="muted" style="font-size:11px;margin:-4px 0 10px">OpenAI-compatible routes through the Nexference proxy for Claude Code.</div>` : ''}

      ${provider.hasCustomUrl ? `
        <label class="lbl">Base URL</label>
        <input class="inp base-url-${providerId}" type="text" value="${esc(baseVal)}" placeholder="${isCustomGateway ? 'https://your-gateway.com/v1/' : 'Gateway base URL'}" />` : ''}

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
          ${(isCustomGateway || effectiveProxy) ? `<button class="btn btn2" data-act="proxy" type="button" ${isCustomGateway && !(gwFormat === 'openai' || gwFormat === 'openai-compatible') ? 'style="display:none"' : ''}>Use with Claude Code (via Nexference)</button>` : ''}
          <button class="btn btn-go" data-act="apply" type="button">${(isCustomGateway && (gwFormat === 'openai' || gwFormat === 'openai-compatible')) ? 'Show config / Use via Proxy' : (anthropicSupported ? 'Apply to Claude Code' : 'Show config')}</button>
        </div>

        <div data-cfg-host hidden></div>
        <div data-proxy-host hidden></div>

      ${historyHtml}

      ${( (provider.hasCustomUrl ? (baseVal || '').trim() : true) || (key || '').trim() || (model || '').trim() ) ? `<details class="intg-details">
        <summary>Provider Integration</summary>
        <div id="intgHost-${providerId}" class="intg-section">Loading integration…</div>
      </details>` : ''}
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

      // Custom Gateway: type selector, base URL persistence, history
      if (isCustomGateway) {
        let currentGwFormat = (workspace.customFormat || 'anthropic').toLowerCase();
        const baseUrlInput = cpField(b, 'base-url', providerId);
        const syncGwState = () => {
          workspace.customFormat = currentGwFormat;
          if (baseUrlInput) workspace.customUrl = baseUrlInput.value;
          Storage.setModel(providerId, (cpField(b, 'model', providerId)?.value || '').trim());
          Storage.setKey(providerId, keyInput.value || '');
        };
        baseUrlInput?.addEventListener('input', () => { workspace.customUrl = baseUrlInput.value; });
        b.querySelectorAll('[data-gw-type]').forEach(btn => {
          btn.addEventListener('click', () => {
            currentGwFormat = btn.dataset.gwType === 'openai' ? 'openai' : 'anthropic';
            workspace.customFormat = currentGwFormat;
            b.querySelectorAll('[data-gw-type]').forEach(x => x.classList.toggle('is-on', x === btn));
            const pbtn = b.querySelector('[data-act="proxy"]');
            const abtn = b.querySelector('[data-act="apply"]');
            const isOpenAI = currentGwFormat === 'openai';
            if (pbtn) pbtn.style.display = isOpenAI ? '' : 'none';
            if (abtn) abtn.textContent = isOpenAI ? 'Show config / Use via Proxy' : 'Apply to Claude Code';
            // proxy panel reads current state on open; if open, re-render
            if (proxyHost && !proxyHost.hidden) openPanel().catch(() => {});
          });
        });
        const rerenderHistory = () => {
          const host = b.querySelector('[data-gw-history]');
          if (!host) return;
          const arr = readHistory();
          host.innerHTML = arr.length ? arr.map((h, i) => `
            <div class="gw-hist-row" data-hidx="${i}" style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600">${esc(h.format === 'openai' || h.format === 'openai-compatible' ? 'OpenAI-compatible' : 'Anthropic')}</div>
                <div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.baseUrl || '—')}${h.model ? ' · ' + esc(h.model) : ''}</div>
              </div>
              <button class="btn btn2 sm" type="button" data-gw-restore="${i}">Restore</button>
              <button class="btn btn2 sm" type="button" data-gw-delete="${i}" style="color:var(--danger,#ef4444)">Delete</button>
            </div>
          `).join('') : '<div class="muted" style="padding:8px 0;font-size:12px">No saved history yet. Apply or test to save entries.</div>';
        };
        b.addEventListener('click', (e) => {
          const restore = e.target.closest('[data-gw-restore]');
          const del = e.target.closest('[data-gw-delete]');
          if (restore) {
            const idx = parseInt(restore.dataset.gwRestore, 10);
            const arr = readHistory();
            const h = arr[idx];
            if (!h) return;
            currentGwFormat = (h.format === 'openai' || h.format === 'openai-compatible') ? 'openai' : 'anthropic';
            workspace.customFormat = currentGwFormat;
            if (baseUrlInput) { baseUrlInput.value = h.baseUrl || ''; workspace.customUrl = baseUrlInput.value; }
            if (h.model) { Storage.setModel(providerId, h.model); const m = cpField(b, 'model', providerId); if (m) m.value = h.model; }
            b.querySelectorAll('[data-gw-type]').forEach(x => x.classList.toggle('is-on', x.dataset.gwType === currentGwFormat));
            const pbtn = b.querySelector('[data-act="proxy"]');
            const abtn = b.querySelector('[data-act="apply"]');
            const isOpenAI = currentGwFormat === 'openai';
            if (pbtn) pbtn.style.display = isOpenAI ? '' : 'none';
            if (abtn) abtn.textContent = isOpenAI ? 'Show config / Use via Proxy' : 'Apply to Claude Code';
            notify.toast('Custom Gateway settings restored', 'success');
          }
          if (del) {
            const idx = parseInt(del.dataset.gwDelete, 10);
            const arr = readHistory();
            arr.splice(idx, 1);
            writeHistory(arr);
            rerenderHistory();
            notify.toast('History entry deleted', 'success');
          }
        });
        // Save history on test/apply interactions (best-effort)
        const saveGwHistoryNow = () => {
          syncGwState();
          pushHistory({
            format: workspace.customFormat || currentGwFormat,
            baseUrl: (baseUrlInput?.value || workspace.customUrl || '').trim(),
            model: (cpField(b, 'model', providerId)?.value || '').trim(),
          });
          rerenderHistory();
        };
        b.querySelector('[data-act="test"]')?.addEventListener('click', () => setTimeout(saveGwHistoryNow, 0), true);
        b.querySelector('[data-act="apply"]')?.addEventListener('click', () => setTimeout(saveGwHistoryNow, 0), true);
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
        const getProxyProvider = () => {
          if (isCustomGateway) {
            const fmt = (workspace.customFormat || 'anthropic').toLowerCase() === 'openai' ? 'openai' : 'anthropic';
            const baseUrl = (cpField(b, 'base-url', providerId)?.value || workspace.customUrl || '').trim();
            return { identity: { name: provider.name }, name: provider.name, api: { baseUrl, format: fmt } };
          }
          return { identity: { name: provider.name }, name: provider.name, api: { baseUrl: proxyBaseUrl || provider.baseUrl, format: proxyFormat || provider.format } };
        };
        const openPanel = async () => {
          const { renderProxyPanel } = await import('../ui/customProvider.js');
          await renderProxyPanel(proxyHost, getProxyProvider(), providerId, { getApiKey: () => keyInput.value });
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
        // Persist custom gateway state
        if (isCustomGateway) {
          workspace.customUrl = (cpField(b, 'base-url', providerId)?.value || '').trim();
          // save history snapshot
          try {
            pushHistory({ format: workspace.customFormat || 'anthropic', baseUrl: workspace.customUrl, model });
            const hHost = b.querySelector('[data-gw-history]');
            if (hHost) {
              const arr = readHistory();
              hHost.innerHTML = arr.length ? arr.map((h, i) => `
                <div class="gw-hist-row" data-hidx="${i}" style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
                  <div style="flex:1;min-width:0">
                    <div style="font-size:12px;font-weight:600">${esc(h.format === 'openai' || h.format === 'openai-compatible' ? 'OpenAI-compatible' : 'Anthropic')}</div>
                    <div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.baseUrl || '—')}${h.model ? ' · ' + esc(h.model) : ''}</div>
                  </div>
                  <button class="btn btn2 sm" type="button" data-gw-restore="${i}">Restore</button>
                  <button class="btn btn2 sm" type="button" data-gw-delete="${i}" style="color:var(--danger,#ef4444)">Delete</button>
                </div>
              `).join('') : '<div class="muted" style="padding:8px 0;font-size:12px">No saved history yet. Apply or test to save entries.</div>';
            }
          } catch {}
        }
        const gwIsOpenAI = isCustomGateway && ((workspace.customFormat || 'anthropic').toLowerCase() === 'openai');
        const cfgProvider = gwIsOpenAI ? { ...provider, format: 'openai', claudeCode: false } : provider;
        const cfg = configEngine.buildClaudeSettings(cfgProvider, baseUrl, model, key);

        const effectiveAnthropic = isCustomGateway ? !gwIsOpenAI : anthropicSupported;
        const effectiveProxyNow = showProxy || gwIsOpenAI;

        if (effectiveAnthropic) {
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
              <p class="px-hint px-hint-warn">${gwIsOpenAI ? `This Custom Gateway is set to <strong>OpenAI-compatible</strong>. Use the Nexference proxy to connect it to Claude Code.` : `Claude Code only reads <code>ANTHROPIC_*</code> variables, so this config has no effect on it. To use ${esc(provider.name)} with Claude Code, use the Nexference local proxy, which translates the request for you.`}</p>
              <pre class="code config-code pc-cfg-code">${esc(JSON.stringify(config, null, 2))}</pre>
              <div class="px-actions">
                <button class="btn btn2" data-act="cfg-copy" type="button">Copy config</button>
                ${effectiveProxyNow ? '<button class="btn btn-go" data-act="cfg-to-proxy" type="button">Set up Claude Code instead</button>' : ''}
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
