// Dynamic Provider UI (v1.8.0) — render adopted ecosystem providers as first-class
// cards in the Providers dashboard and a details modal that surfaces honest
// integration state, provenance, models, and connection status.
//
// No secrets are ever shown: the modal displays metadata + test OUTCOME only.
  import { esc } from '../components/util.js';
  import { claudeCodeCompatibility } from '../providers/registry.js';
import { router } from '../core/router.js';
import { notify } from '../core/notifications.js';
import { openModal, closeModal, confirmModal } from '../components/modal.js';
  import { renderTimeline } from '../components/intelligenceTimeline.js';
  import { renderProxyPanel } from './customProvider.js';
import { integrationSectionHTML } from './providerIntegrations.js';

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
function badge(text, kind = '') { return `<span class="badge ${kind}">${esc(String(text))}</span>`; }
function integrationBadge(level) {
  const map = {
    'adapter-ready': 'badge-ok', configurable: 'badge-info', 'metadata-only': 'badge-muted', tested: 'badge-ok', unknown: 'badge-muted',
  };
  return badge(level || 'unknown', map[level] || 'badge-muted');
}
function logoHtml(p) {
  if (p.logo && p.logo.url && p.logo.source && p.logo.source !== 'fallback') {
    const src = '/api/ecosystem/logo?url=' + encodeURIComponent(p.logo.url);
    return `<img class="pc-logo-sm" src="${src}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;pc-logo-sm&quot;>' + ${JSON.stringify(initials(p.name))} + '</div>'" />`;
  }
  return `<div class="pc-logo-sm">${esc(initials(p.name))}</div>`;
}
function timeLabel(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'never';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Card used inside the Cloud Providers grid (mirrors the curated card silhouette).

async function openDynamicProvider(id) {
  let p;
  try {
    const r = await fetch('/api/dynamic-providers/' + encodeURIComponent(id));
    if (!r.ok) { notify.toast('Dynamic provider not found', 'error'); return; }
    p = (await r.json()).provider;
  } catch (e) { notify.toast('Failed to load provider', 'error'); return; }

  const source = p.source || {};
  const integ = p.integration || {};
  const access = p.access || {};
  const cap = p.capabilities || {};
  const models = p.modelSupport || {};
  const connectionText = integ.status === 'tested' ? 'Tested (a real connection check succeeded)' : 'Not tested';
  const actions = actionButtons(p);
  const proxyDescriptor = proxyDescriptorFor(p);

  const modelRows = (models.models && models.models.length)
    ? models.models.slice(0, 12).map((m) => `<span class="chip chip-sm">${esc(m.name || m.modelId)}</span>`).join(' ')
    : '<span class="muted">No models discovered yet.</span>';

  openModal({
    title: p.name,
    subtitle: `Ecosystem · ${p.status}`,
    size: 'wide',
    bodyHTML: `
      <div class="eco-detail">
        <div class="eco-detail-head">
          <div class="eco-logo-wrap lg">${logoHtml(p)}</div>
          <div>
            <div class="eco-detail-name">${esc(p.name)}</div>
            <div class="muted">${esc(p.compatibilityNote || '')}</div>
            <div class="eco-detail-links">
              ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : ''}
              ${p.documentationUrl ? `<a href="${esc(p.documentationUrl)}" target="_blank" rel="noopener noreferrer">Docs ↗</a>` : ''}
            </div>
            <div class="eco-detail-badges">${badge('Ecosystem')} ${integrationBadge(integ.level)} ${badge('logo: ' + (p.logo?.source || 'fallback'), 'badge-muted')}</div>
          </div>
        </div>

        <div class="eco-cols">
          <div>
            <h3>Registry</h3>
            <div class="eco-kv-grid">
              <div class="eco-kv"><span>Origin</span><span>${esc(p.origin)}</span></div>
              <div class="eco-kv"><span>Status</span><span>${esc(p.status)}</span></div>
              <div class="eco-kv"><span>Lifecycle</span><span>${esc(p.lifecycle || 'unknown')}</span></div>
              <div class="eco-kv"><span>Ecosystem ID</span><span>${esc(p.ecosystemId || '—')}</span></div>
            </div>
            <h3>Integration</h3>
            <div class="eco-kv-grid">
              <div class="eco-kv"><span>Level</span><span>${esc(integ.level)}</span></div>
              <div class="eco-kv"><span>Adapter</span><span>${esc(integ.adapterType || 'none')}</span></div>
              <div class="eco-kv"><span>Custom base URL</span><span>${cap.customBaseUrl ? 'yes' : 'unknown'}</span></div>
              <div class="eco-kv"><span>OpenAI-compatible</span><span>${cap.openaiCompatible ? 'yes' : 'no'}</span></div>
            </div>
            <h3>Access</h3>
            <div class="eco-kv-grid">
              <div class="eco-kv"><span>Type</span><span>${esc(access.type || 'unknown')}</span></div>
              <div class="eco-kv"><span>Requires API key</span><span>${access.requiresApiKey === null ? 'unknown' : (access.requiresApiKey ? 'yes' : 'no')}</span></div>
              <div class="eco-kv"><span>Pricing</span><span>${esc(access.pricingStatus || 'unknown')}</span></div>
            </div>
          </div>
          <div>
            <h3>Discovery &amp; provenance</h3>
            <div class="eco-kv-grid">
              <div class="eco-kv"><span>Source</span><span>${esc(source.name || 'unknown')}</span></div>
              <div class="eco-kv"><span>Type</span><span>${esc(source.type || 'unknown')}</span></div>
              <div class="eco-kv"><span>Confidence</span><span>${esc(source.confidence || 'unknown')}</span></div>
              <div class="eco-kv"><span>Discovered</span><span>${timeLabel(p.discoveredAt)}</span></div>
              <div class="eco-kv"><span>Adopted</span><span>${timeLabel(p.adoptedAt)}</span></div>
              <div class="eco-kv"><span>Updated</span><span>${timeLabel(p.updatedAt)}</span></div>
            </div>
            ${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">View source ↗</a>` : ''}
          </div>
        </div>

        <h3>Models</h3>
        <div>${modelRows}</div>
        <div class="muted" style="margin-top:4px">Discovery status: ${esc(models.status || 'unknown')} · ${models.count || 0} model(s)</div>

        <h3>Connection</h3>
        <div class="eco-kv-grid"><div class="eco-kv"><span>Status</span><span>${esc(connectionText)}</span></div></div>

        <h3>Actions</h3>
        <div class="eco-detail-actions">${actions}</div>

        ${proxySectionFor(p)}

        <details class="intg-details" open>
          <summary>Provider Integration (v1.9.0)</summary>
          <div data-intg-host class="intg-section">Loading integration…</div>
        </details>
      </div>`,
    onMount: (b) => {
      // "dyn:" ids contain a colon — invalid in CSS ID selectors. Use an
      // attribute selector so querySelector never throws.
      const host = b.querySelector('[data-intg-host]');
      if (host) integrationSectionHTML(id).then((html) => { host.innerHTML = html; });
      b.addEventListener('click', (e) => {
        const t = e.target.closest('[data-intg-action]');
        if (t && window.integrationAction) window.integrationAction(t.dataset.intgAction, t.dataset.id);
      });

      // "Claude Code via Nexference" — reuse the shared inline panel instead of
      // opening a second dialog, matching the curated and custom card surfaces.
      const proxyHost = b.querySelector('[data-proxy-host]');
      const proxyBtn = b.querySelector('[data-dp-proxy-toggle]');
      // The panel reads the key from a host-supplied field; without this the
      // adopted dialog had no key input and Verify/Connect dead-ended with
      // "Enter an API key for this provider first."
      const proxyKey = b.querySelector('[data-dp-proxy-key]');
      if (proxyHost && proxyBtn) {
        let rendered = false;
        proxyBtn.addEventListener('click', async () => {
          if (!rendered) {
            rendered = true;
            proxyHost.hidden = false;
            try {
              await renderProxyPanel(proxyHost, proxyDescriptor, id, {
                getApiKey: () => proxyKey?.value || '',
              });
            } catch (err) {
              rendered = false;
              proxyHost.hidden = true;
              notify.toast('Could not load proxy setup: ' + (err?.message || err), 'error');
            }
            return;
          }
          proxyHost.hidden = !proxyHost.hidden;
          proxyBtn.textContent = proxyHost.hidden ? 'Set up' : 'Hide setup';
        });
      }
    },
  });
}

// The adopted (`dyn:`) dialog is the third card surface. It previously offered
// only metadata actions + a throwaway Test Connection, so an OpenAI-compatible
// adopted provider had NO "Claude Code via Nexference" route at all — the section
// existed only on curated and custom (cst:) cards. This adds the same inline
// panel, gated by the shared claudeCodeCompatibility() rule so Anthropic-
// compatible providers don't get it either.
function proxyDescriptorFor(p) {
  // Adopted providers declare their wire format through capabilities/
  // integration metadata, not the curated `api.format` shape. Only claim the
  // proxy when the record positively says OpenAI-compatible — never guess from a
  // truthy-looking string, so we don't offer a route that cannot work.
  const openaiCompatible = p.capabilities?.openaiCompatible === true
    || String(p.integration?.adapterType || '').toLowerCase() === 'openai'
    || String(p.integration?.adapterType || '').toLowerCase() === 'openai-compatible';
  if (!openaiCompatible) return null;
  if (p.claudeCode?.anthropicCompatible === true) return null;

  const descriptor = {
    id: p.id,
    name: p.name,
    identity: { name: p.name },
    api: { baseUrl: p.integration?.baseUrl || p.baseUrl || '', format: 'openai' },
    format: 'openai',
  };
  try {
    return claudeCodeCompatibility(descriptor).proxy ? descriptor : null;
  } catch { return null; }
}

function proxySectionFor(p) {
  const descriptor = proxyDescriptorFor(p);
  if (!descriptor) return '';
  return `
    <div class="dp-proxy-wrap">
      <div class="dp-proxy-head">
        <span class="wizard-title">Claude Code via Nexference</span>
        <button class="btn btn2 sm" data-dp-proxy-toggle type="button">Set up</button>
      </div>
      <div class="form-row">
        <label>API key</label>
        <input class="inp" data-dp-proxy-key type="password" placeholder="Paste the key — held in memory only" autocomplete="off" />
      </div>
      <div data-proxy-host hidden></div>
    </div>`;
}

function actionButtons(p) {
  const id = esc(p.id);
  const cfg = p.integration?.adapterType;
  return [
    `<button class="btn btn-sm" onclick="dynamicProviderAction('refresh','${id}')">Refresh Metadata</button>`,
    `<button class="btn btn-sm" onclick="dynamicProviderAction('discover-models','${id}')">Discover Models</button>`,
    cfg ? `<button class="btn btn-sm" onclick="dynamicProviderAction('test','${id}')">Test Connection</button>` : '',
    p.status === 'active' ? `<button class="btn btn-sm" onclick="dynamicProviderAction('deactivate','${id}')">Deactivate</button>` : `<button class="btn btn-sm" onclick="dynamicProviderAction('reactivate','${id}')">Reactivate</button>`,
    `<button class="btn btn-sm btn-danger" onclick="dynamicProviderAction('remove','${id}')">Remove</button>`,
  ].join('');
}

// Global dispatcher for inline onclick handlers.
window.dynamicProviderAction = async (token, id) => {
  const map = {
    'refresh': ['refresh-metadata', 'Metadata refreshed'], 'discover-models': ['discover-models', 'Model discovery run'], 'deactivate': ['deactivate', 'Deactivated'], 'reactivate': ['reactivate', 'Reactivated'], 'remove': ['remove', 'Removed'],
  };
  if (token === 'test') return testConnection(id);
  const m = map[token];
  if (!m) { notify.toast('Unknown action', 'warning'); return; }
  try {
    let r;
    if (token === 'remove') {
      const ok = await confirmModal({ title: 'Remove dynamic provider?', message: 'This hides the adopted provider from the catalogue. Its discovery provenance is kept. This cannot be undone from the UI.', confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      r = await fetch(`/api/dynamic-providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } else {
      r = await fetch(`/api/dynamic-providers/${encodeURIComponent(id)}/${m[0]}`, { method: 'POST' });
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { notify.toast(d.error || d.message || 'Action failed', 'error'); return; }
    notify.toast(`${m[1]} ${d.provider?.name || id}`, 'success');
    if (token === 'remove') { router.navigate('cloud-providers'); return; }
    await openDynamicProvider(id);
    const root = document.getElementById('page-cloud-providers'); if (root) window.refreshCloudProviders?.();
  } catch (e) { notify.toast('Action failed: ' + (e.message || e), 'error'); }
};

async function testConnection(id) {
  // Ask for a key (never stored by the client or server) and an optional base URL.
  const body = `<div class="form-row"><label>API key</label><input class="inp" id="dpKey" type="password" placeholder="paste a test key (not stored)" autocomplete="off" /></div>
    <div class="form-row"><label>Base URL (optional)</label><input class="inp" id="dpUrl" placeholder="https://your-instance/v1/" autocomplete="off" /></div>
    <div class="form-row"><label>Model (optional)</label><input class="inp" id="dpModel" placeholder="model id" autocomplete="off" /></div>
    <div class="modal-actions">
      <button class="btn btn2" id="dpCancel" type="button">Cancel</button>
      <button class="btn btn-go" id="dpTest" type="button">Test</button>
    </div>`;
  openModal({
    title: 'Test connection', subtitle: 'Key is sent to the server for one probe only and is never persisted.',
    bodyHTML: body,
    onMount: (el, ctrl) => {
      el.querySelector('#dpCancel').addEventListener('click', () => ctrl.close());
      el.querySelector('#dpTest').addEventListener('click', async () => {
        const key = el.querySelector('#dpKey').value;
        const baseUrl = el.querySelector('#dpUrl').value;
        const model = el.querySelector('#dpModel').value;
        if (!key) { notify.toast('Key required', 'warning'); return; }
        ctrl.close();
        try {
          const r = await fetch(`/api/dynamic-providers/${encodeURIComponent(id)}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, baseUrl, model }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.ok) { notify.toast(d.error || d.message || 'Test failed', 'error'); return; }
          notify.toast(d.tested ? 'Connection test succeeded' : 'Test returned a response', 'success');
          await openDynamicProvider(id);
        } catch (e) { notify.toast('Test failed: ' + (e.message || e), 'error'); }
      });
    },
  });
}

// The confirm modal helper is imported from modal.js (confirmModal).

window.openDynamicProvider = (id) => openDynamicProvider(id);
export { openDynamicProvider };
