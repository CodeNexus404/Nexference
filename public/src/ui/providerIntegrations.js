// Provider Integration UI (v1.9.0) — renders the Integration section inside a
// provider details modal, plus reusable coverage/cards for the Intelligence Center
// and dashboard. Honest by design: status is shown with a label + colour + dot so
// it is never communicated by colour alone.
//
// No secrets are ever rendered: the UI calls test/model endpoints with credentials
// supplied transiently and displays only outcomes + metadata.
import { esc } from '../components/util.js';
import { notify } from '../core/notifications.js';
import { openModal } from '../components/modal.js';
import { getProvider } from '../providers/registry.js';
import * as intg from '../providers/integrationService.js';

const STATUS_META = {
  integrated: { label: 'Integrated', badge: 'badge-ok', dot: 'dot-green' },
  supported: { label: 'Supported', badge: 'badge-info', dot: 'dot-blue' },
  partial: { label: 'Partial', badge: 'badge-warn', dot: 'dot-yellow' },
  assessing: { label: 'Assessing', badge: 'badge-info', dot: 'dot-blue' },
  'metadata-only': { label: 'Metadata only', badge: 'badge-muted', dot: 'dot-gray' },
  unsupported: { label: 'Unsupported', badge: 'badge-danger', dot: 'dot-red' },
  blocked: { label: 'Blocked', badge: 'badge-danger', dot: 'dot-red' },
  unknown: { label: 'Unknown', badge: 'badge-muted', dot: 'dot-gray' },
};

const ADAPTER_LABEL = {
  'openai-compatible': 'OpenAI-compatible',
  'anthropic-compatible': 'Anthropic-compatible',
  'gemini-compatible': 'Gemini-compatible',
  custom: 'Custom protocol',
  none: 'No adapter',
  unknown: 'Unknown',
};

export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.unknown;
}

export function integrationBadge(status) {
  const m = statusMeta(status);
  return `<span class="badge ${m.badge}"><span class="status-dot ${m.dot}"></span>${esc(m.label)}</span>`;
}

const ROUTE_LABEL = {
  'legacy-provider-bridge': 'Legacy Provider Bridge',
  'integration-adapter-bridge': 'Integration Adapter',
  'runtime-execution-bridge': 'Runtime Bridge',
  unsupported: 'Unsupported',
};

const EXEC_STATUS_META = {
  ready: { label: 'Ready', badge: 'badge-ok', dot: 'dot-green' },
  needs_credentials: { label: 'Needs credentials', badge: 'badge-warn', dot: 'dot-yellow' },
  metadata_only: { label: 'Metadata only', badge: 'badge-muted', dot: 'dot-gray' },
  unsupported: { label: 'Unsupported', badge: 'badge-danger', dot: 'dot-red' },
};

function kv(label, value, opts = {}) {
  const v = value === true ? '<span class="yes">✓</span>'
    : value === false ? '<span class="no">✗</span>'
      : value === null || value === undefined ? '<span class="muted">unknown</span>'
        : esc(String(value));
  return `<div class="eco-kv"><span>${esc(label)}</span><span>${v}</span></div>`;
}

// Build the Integration section HTML for a provider. Returns a Promise<string>.
export async function integrationSectionHTML(providerId) {
  const [rec, execStatus] = await Promise.all([
    intg.getIntegration(providerId),
    intg.getExecutionStatus(providerId).catch(() => null),
  ]);
  if (!rec && !execStatus) {
    return `<div class="eco-kv-grid"><div class="eco-kv"><span>Status</span><span>Unknown</span></div></div>
      <div class="eco-detail-actions"><button class="btn btn-sm" data-intg-action="assess" data-id="${esc(providerId)}">Assess Integration</button></div>`;
  }
  const m = rec ? statusMeta(rec.integrationStatus) : STATUS_META.unknown;
  const adapter = rec ? (ADAPTER_LABEL[rec.adapterType] || rec.adapterType || 'Unknown') : 'Unknown';
  const cap = rec?.configuration || {};
  const exec = rec?.execution || {};
  const evidence = Array.isArray(rec?.evidence) ? rec.evidence : [];
  const evidenceRows = evidence.length
    ? evidence.map((e) => `<li>${esc(e.claim || '—')} <span class="muted">· ${esc(e.sourceType || 'unknown')} · ${esc(e.confidence || 'unknown')}</span></li>`).join('')
    : '<li class="muted">No integration evidence recorded yet.</li>';

  const actions = actionButtons(rec || { providerId, integrationStatus: 'unknown' });

  // Execution routing (v2.0.0)
  const execMeta = execStatus ? (EXEC_STATUS_META[execStatus.status] || EXEC_STATUS_META.unsupported) : null;
  const routeLabel = execStatus?.route ? (ROUTE_LABEL[execStatus.route] || execStatus.route) : null;

  return `
    <div class="eco-kv-grid">
      <div class="eco-kv"><span>Status</span><span><span class="status-dot ${m.dot}"></span> ${esc(m.label)}</span></div>
      <div class="eco-kv"><span>Adapter</span><span>${esc(adapter)}</span></div>
      <div class="eco-kv"><span>Confidence</span><span>${esc(rec?.confidence || 'unknown')}</span></div>
      <div class="eco-kv"><span>Last assessed</span><span>${esc((rec?.lastAssessedAt || '').slice(0, 19).replace('T', ' ') || 'never')}</span></div>
    </div>
    <div class="intg-caps">
      <div><b>Configuration</b>${kv('API key', cap.supportsApiKey)}${kv('Base URL', cap.supportsBaseUrl)}${kv('Model selection', cap.supportsModelSelection)}${kv('Custom headers', cap.supportsCustomHeaders)}${kv('Env variables', cap.supportsEnvironmentVariables)}</div>
      <div><b>Execution</b>${kv('Chat', exec.supportsChat)}${kv('Streaming', exec.supportsStreaming)}${kv('Model listing', exec.supportsModelListing)}${kv('Connection test', exec.supportsConnectionTest)}</div>
    </div>
    ${execMeta ? `<div class="intg-exec-routing">
      <b>Execution</b>
      <div class="eco-kv-grid">
        <div class="eco-kv"><span>Status</span><span><span class="status-dot ${execMeta.dot}"></span> ${esc(execMeta.label)}</span></div>
        ${routeLabel ? `<div class="eco-kv"><span>Route</span><span>${esc(routeLabel)}</span></div>` : ''}
        ${execStatus?.adapterType ? `<div class="eco-kv"><span>Adapter</span><span>${esc(execStatus.adapterType)}</span></div>` : ''}
        ${execStatus?.statusReason ? `<div class="eco-kv"><span>Reason</span><span class="muted">${esc(execStatus.statusReason)}</span></div>` : ''}
      </div>
    </div>` : ''}
    ${rec?.warnings && rec.warnings.length ? `<div class="intg-warn">${rec.warnings.map((w) => `<div class="muted">• ${esc(w)}</div>`).join('')}</div>` : ''}
    <div id="intgEvidence-${esc(providerId)}" class="intg-evidence">
      <b>Evidence</b>
      <ul class="ic-insights">${evidenceRows}</ul>
    </div>
    <div id="intgModels-${esc(providerId)}" class="intg-models"></div>
    <div class="eco-detail-actions">${actions}</div>`;
}

function actionButtons(rec) {
  const id = esc(rec.providerId);
  const status = rec.integrationStatus || 'unknown';
  const btns = [];
  if (status === 'metadata-only' || status === 'unknown' || status === 'blocked') {
    btns.push(`<button class="btn btn-sm btn-go" data-intg-action="assess" data-id="${id}">Assess Integration</button>`);
  }
  if (status === 'integrated' || status === 'supported' || status === 'partial') {
    btns.push(`<button class="btn btn-sm" data-intg-action="configure" data-id="${id}">Configure</button>`);
    btns.push(`<button class="btn btn-sm" data-intg-action="test" data-id="${id}">Test Connection</button>`);
    if (rec.execution && rec.execution.supportsModelListing) btns.push(`<button class="btn btn-sm" data-intg-action="models" data-id="${id}">View Models</button>`);
  }
  btns.push(`<button class="btn btn-sm" data-intg-action="evidence" data-id="${id}">View Evidence</button>`);
  btns.push(`<button class="btn btn-sm" data-intg-action="refresh" data-id="${id}">Refresh</button>`);
  return btns.join('');
}

// Dispatch inline integration actions. Mounted once on window by the app shell.
export function initIntegrationActions(refreshFn) {
  window.integrationAction = async (token, id) => {
    const providerId = id;
    try {
      if (token === 'assess') {
        const rec = await intg.assess(providerId);
        if (rec) notify.toast(`Integration: ${rec.integrationStatus}`, 'success');
        if (refreshFn) refreshFn(providerId);
        return;
      }
      if (token === 'refresh') {
        const rec = await intg.assess(providerId); // re-assess (in-flight guarded)
        if (refreshFn) refreshFn(providerId);
        return;
      }
      if (token === 'evidence') {
        const el = document.getElementById(`intgEvidence-${providerId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (token === 'configure') {
        // v1.9.0: do NOT auto-write dynamic provider configuration into Claude Code
        // settings. Route to the provider's configuration modal; the config modal itself
        // honours the safe apply/show-config split and never fabricates compatibility.
        // Custom (user-created) providers have their own configuration dialog.
        if (providerId.startsWith('cst:')) {
          if (window.openCustomProvider) window.openCustomProvider(providerId);
          else if (window.navigate) window.navigate('cloud-providers');
        }
        else if (getProvider(providerId) && window.openProviderConfig) window.openProviderConfig(providerId);
        else if (window.openDynamicProvider) window.openDynamicProvider(providerId);
        else if (window.navigate) window.navigate('configuration');
        return;
      }
      if (token === 'test') return testConnectionFlow(providerId, refreshFn);
      if (token === 'models') return listModelsFlow(providerId);
    } catch (e) {
      notify.toast('Integration action failed: ' + (e.message || e), 'error');
    }
  };
}

async function testConnectionFlow(providerId, refreshFn) {
  const body = `<div class="form-row"><label>API key</label><input class="inp" id="piKey" type="password" placeholder="paste a test key (not stored)" autocomplete="off" /></div>
    <div class="form-row"><label>Base URL (optional)</label><input class="inp" id="piUrl" placeholder="https://your-instance/v1/" autocomplete="off" /></div>
    <div class="form-row"><label>Model (optional)</label><input class="inp" id="piModel" placeholder="model id" autocomplete="off" /></div>
    <div class="modal-actions"><button class="btn btn2" id="piCancel" type="button">Cancel</button><button class="btn btn-go" id="piTest" type="button">Test</button></div>`;
  openModal({
    title: 'Test provider integration', subtitle: 'Key is sent for one probe only and never persisted.',
    bodyHTML: body,
    onMount: (el, ctrl) => {
      el.querySelector('#piCancel').addEventListener('click', () => ctrl.close());
      el.querySelector('#piTest').addEventListener('click', async () => {
        const key = el.querySelector('#piKey').value;
        const baseUrl = el.querySelector('#piUrl').value;
        const model = el.querySelector('#piModel').value;
        if (!key) { notify.toast('Key required', 'warning'); return; }
        ctrl.close();
        const r = await intg.testConnection(providerId, { key, baseUrl, model });
        if (r && r.supported) {
          const ok = r.status >= 200 && r.status < 400;
          notify.toast(ok ? `Connection succeeded (HTTP ${r.status})` : `Connection responded (HTTP ${r.status})`, ok ? 'success' : 'warning');
        } else {
          notify.toast(r && r.reason ? r.reason : 'Test not supported', 'error');
        }
        if (refreshFn) refreshFn(providerId);
      });
    },
  });
}

async function listModelsFlow(providerId) {
  const body = `<div class="form-row"><label>API key</label><input class="inp" id="pmKey" type="password" placeholder="paste a key (not stored)" autocomplete="off" /></div>
    <div class="form-row"><label>Base URL (optional)</label><input class="inp" id="pmUrl" placeholder="https://your-instance/v1/" autocomplete="off" /></div>
    <div class="modal-actions"><button class="btn btn2" id="pmCancel" type="button">Cancel</button><button class="btn btn-go" id="pmList" type="button">List Models</button></div>
    <div id="pmOut" class="muted" style="margin-top:8px"></div>`;
  openModal({
    title: 'List models', subtitle: 'Key is sent for one request only and never persisted.',
    bodyHTML: body,
    onMount: (el, ctrl) => {
      el.querySelector('#pmCancel').addEventListener('click', () => ctrl.close());
      el.querySelector('#pmList').addEventListener('click', async () => {
        const key = el.querySelector('#pmKey').value;
        const baseUrl = el.querySelector('#pmUrl').value;
        const out = el.querySelector('#pmOut');
        if (!key) { notify.toast('Key required', 'warning'); return; }
        out.textContent = 'Listing…';
        const r = await intg.listModels(providerId, { key, baseUrl });
        if (r && r.supported && Array.isArray(r.models)) {
          out.innerHTML = r.models.length
            ? r.models.slice(0, 30).map((m) => `<span class="chip chip-sm">${esc(m.id || m.name || 'model')}</span>`).join(' ')
            : '<span class="muted">No models returned.</span>';
          notify.toast(`Listed ${r.models.length} model(s)`, 'success');
        } else {
          out.textContent = (r && r.reason) || 'Model listing not supported.';
        }
      });
    },
  });
}

// Coverage card used by the Intelligence Center and the dashboard.
export async function integrationCoverageHTML() {
  let cov;
  try { cov = await intg.getCoverage(); } catch { return ''; }
  if (!cov) return '';
  const c = cov.counts || {};
  const row = (label, key, dot) => `<div class="ic-dq-item"><span class="ic-dq-val"><span class="status-dot ${dot}"></span> ${c[key] || 0}</span><span class="ic-dq-label muted">${esc(label)}</span></div>`;
  return `<section class="ic-section">
    <h2 class="ic-h2">Integration Coverage</h2>
    <div class="card ic-dq">
      <div class="ic-dq-head">${integrationBadge('integrated').replace('Integrated', `Usable adapters: ${cov.usable}`)}</div>
      <div class="ic-dq-grid">
        ${row('Integrated', 'integrated', 'dot-green')}
        ${row('Supported', 'supported', 'dot-blue')}
        ${row('Partial', 'partial', 'dot-yellow')}
        ${row('Metadata only', 'metadata-only', 'dot-gray')}
        ${row('Unsupported', 'unsupported', 'dot-red')}
        ${row('Unknown', 'unknown', 'dot-gray')}
      </div>
      <div class="muted">${cov.usable} / ${cov.total} providers have a usable adapter. ${cov.needsAssessment} need assessment.</div>
    </div>
  </section>`;
}
