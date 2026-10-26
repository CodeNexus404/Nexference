import { router } from '../core/router.js';
import { theme } from '../core/theme.js';
import { openModal, closeModal } from './modal.js';
import { openWorkflow } from '../config/workflow.js';
import { PROVIDERS } from '../providers/registry.js';
import { CLIENTS, getClient } from '../clients/registry.js';
import { modelService } from '../models/modelService.js';
import { notify } from '../core/notifications.js';
import { esc } from './util.js';
import { assess as assessIntegration, getIntegrations } from '../providers/integrationService.js';

// Command Palette — a lightweight ⌘K / Ctrl+K launcher. Pure navigation/action
// dispatch using the existing router, theme, and workflow modules. No framework,
// no large dependency. Provider entries jump straight into the provider panel.
let paletteOpen = false;

export function toggleCommandPalette() {
  if (paletteOpen) {
    closeModal();
    paletteOpen = false;
    return;
  }
  const actions = [
    { label: 'Go to Workspace', hint: 'Page', run: () => router.navigate('workspace') },
    { label: 'Go to Cloud Providers', hint: 'Page', run: () => router.navigate('cloud-providers') },
    { label: 'Go to Local AI', hint: 'Page', run: () => router.navigate('localai') },
    { label: 'Go to Models', hint: 'Page', run: () => router.navigate('models') },
    { label: 'Go to Clients', hint: 'Page', run: () => router.navigate('clients') },
    { label: 'Go to Settings', hint: 'Page', run: () => router.navigate('settings') },
    { label: 'Go to Intelligence Center', hint: 'Page', run: () => router.navigate('intelligence') },
    { label: 'Refresh Intelligence', hint: 'Intelligence', run: () => { router.navigate('intelligence'); if (window.intelRefresh) window.intelRefresh(); } },
    { label: 'Go to Ecosystem Discovery', hint: 'Page', run: () => router.navigate('ecosystem') },
    { label: 'Refresh Ecosystem Discovery', hint: 'Ecosystem', run: () => { router.navigate('ecosystem'); if (window.ecosystemDiscover) window.ecosystemDiscover(); } },
    { label: 'Review Discovered Providers', hint: 'Ecosystem', run: () => { router.navigate('ecosystem'); const f = document.querySelector('.eco-filter [data-f="review"]'); if (f) f.click(); } },
    { label: 'View Adopted Providers', hint: 'Providers', run: () => { router.navigate('cloud-providers'); const reg = document.querySelector('.chip-filter.reg[data-reg="adopted"]'); if (reg) reg.click(); } },
    { label: 'View Custom Providers', hint: 'Providers', run: () => { router.navigate('cloud-providers'); const reg = document.querySelector('.chip-filter.reg[data-reg="custom"]'); if (reg) reg.click(); } },
    { label: 'Add Custom Provider', hint: 'Providers', run: () => { if (window.openAddCustomProviderWizard) window.openAddCustomProviderWizard(); } },
    { label: 'Refresh Dynamic Provider Registry', hint: 'Providers', run: () => { if (window.refreshCloudProviders) window.refreshCloudProviders(); else router.navigate('cloud-providers'); } },
    { label: 'Configure a client', hint: 'Workflow', run: () => openWorkflow() },
    { label: 'Open Configuration Workspace', hint: 'Page', run: () => { router.navigate('configuration'); if (window.setCfgTab) window.setCfgTab('config'); } },
    { label: 'Open Profiles', hint: 'Page', run: () => { router.navigate('configuration'); if (window.setCfgTab) window.setCfgTab('profiles'); } },
    { label: 'Open Compatibility Explorer', hint: 'Page', run: () => { if (window.openCompatibilityExplorer) window.openCompatibilityExplorer(); } },
    { label: 'Refresh Environment', hint: 'Environment', run: () => { if (window.refreshWorkspace) window.refreshWorkspace(); else router.navigate('workspace'); } },
    { label: 'Check Workspace Health', hint: 'Health', run: () => { if (window.openHealthModal) window.openHealthModal(); else router.navigate('workspace'); } },
    { label: 'View Activity', hint: 'Activity', run: () => { if (window.openActivityModal) window.openActivityModal(); else router.navigate('workspace'); } },
    { label: 'View Installed Models', hint: 'Environment', run: () => { if (window.navigate) window.navigate('localai'); } },
    { label: 'Open Local Runtimes', hint: 'Page', run: () => router.navigate('localai') },
    { label: 'Create Profile', hint: 'Profiles', run: () => { if (window.navigate) window.navigate('configuration'); if (window.setCfgTab) window.setCfgTab('profiles'); } },
    { label: 'Open Playground', hint: 'Page', run: () => router.navigate('playground') },
    { label: 'Open Execution History', hint: 'Playground', run: () => { if (window.openExecutionHistory) window.openExecutionHistory(); else router.navigate('playground'); } },
    { label: 'Clear Playground', hint: 'Playground', run: () => { if (window.clearPlayground) window.clearPlayground(); else router.navigate('playground'); } },
    { label: 'New Execution', hint: 'Playground', run: () => router.navigate('playground') },
    { label: 'Open Model Library', hint: 'Models', run: () => router.navigate('models') },
    { label: 'Refresh Model Catalogue', hint: 'Models', run: async () => { await modelService.refresh(); notify.toast('Model catalogue refreshed', 'success'); } },
    { label: 'Refresh Provider Intelligence', hint: 'Providers', run: async () => { if (window.refreshProviderIntelligence) await window.refreshProviderIntelligence(); else router.navigate('cloud-providers'); } },
    { label: 'Refresh Provider Monitoring', hint: 'Providers', run: async () => { if (window.refreshProviderMonitoring) await window.refreshProviderMonitoring(); else router.navigate('cloud-providers'); } },
    { label: 'View Provider Changes', hint: 'Providers', run: () => { if (window.openProviderChangesModal) window.openProviderChangesModal(); else router.navigate('cloud-providers'); } },
    { label: 'View Integration Coverage', hint: 'Integration', run: () => { router.navigate('intelligence'); } },
    { label: 'Assess Provider Integration', hint: 'Integration', run: () => openIntegrationAssessModal() },
    { label: 'View Execution Coverage', hint: 'Execution', run: () => { router.navigate('intelligence'); } },
    { label: 'View Executable Providers', hint: 'Execution', run: async () => { try { const cov = await (await import('../providers/integrationService.js')).getExecutionCoverage(); if (cov) notify.toast(`${cov.executable} executable providers`, 'info'); } catch {} router.navigate('intelligence'); } },
    { label: 'View Providers Needing Credentials', hint: 'Execution', run: async () => { try { const cov = await (await import('../providers/integrationService.js')).getExecutionCoverage(); if (cov) notify.toast(`${cov.needsCredentials} providers need credentials`, 'info'); } catch {} router.navigate('intelligence'); } },
    { label: 'Open Execution Diagnostics', hint: 'Execution', run: () => { router.navigate('playground'); } },
    { label: 'Refresh OpenRouter Models', hint: 'Providers', run: async () => { if (window.refreshProviderModels) await window.refreshProviderModels('openrouter'); else router.navigate('cloud-providers'); } },
    { label: 'Recommended Models', hint: 'Models', run: () => { router.navigate('models'); } },
    { label: 'Toggle Theme', hint: 'Appearance', run: () => { if (window.setTheme) window.setTheme(theme.current() === 'dark' ? 'light' : 'dark'); } },
    { label: 'Toggle Sidebar', hint: 'Appearance', run: () => { if (window.toggleSidebar) window.toggleSidebar(); } },
  ];
  // Client quick-launch (start the wizard pre-selected to that client).
  CLIENTS.filter((c) => !c.hidden && c.support !== 'unsupported').forEach((c) => {
    actions.push({
      label: `Configure: ${c.name}`,
      hint: 'Workflow',
      run: () => openWorkflow({ initialClient: c.id }),
    });
  });
  // Provider quick-jumps (limited to keep the list scannable).
  PROVIDERS.slice(0, 8).forEach((p) => {
    actions.push({
      label: `Provider: ${p.name}`,
      hint: 'Configure',
      run: () => { router.navigate('cloud-providers'); if (window.openProviderConfig) window.openProviderConfig(p.id); },
    });
    actions.push({
      label: `Monitor: ${p.name}`,
      hint: 'Providers',
      run: async () => { if (window.refreshProviderMonitoring) await window.refreshProviderMonitoring(p.id); else router.navigate('cloud-providers'); },
    });
  });

  // Detect the right modifier label instead of hardcoding ⌘K — on Windows and
  // Linux the same shortcut is Ctrl+K, and telling a PC user to press ⌘ is wrong.
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  const modKey = isMac ? '⌘K' : 'Ctrl K';

  const { close } = openModal({
    title: 'Command Palette',
    subtitle: `${modKey} · type to filter`,
    size: 'wide',
    bodyHTML: `<div class="palette">
        <div class="palette-search">
          <span class="palette-search-ico" aria-hidden="true">${isMac ? '⌘' : 'Ctrl'}</span>
          <input class="inp palette-input" placeholder="Type a command or page name…" aria-label="Command filter"
                 role="combobox" aria-expanded="true" aria-controls="paletteList" aria-autocomplete="list" />
        </div>
        <div class="palette-meta"><span id="paletteCount"></span></div>
        <div class="palette-list" id="paletteList" role="listbox" aria-label="Commands"></div>
        <div class="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>`,
    onMount: (body, ctrl) => {
      paletteOpen = true;
      const input = body.querySelector('.palette-input');
      const list = body.querySelector('#paletteList');
      const count = body.querySelector('#paletteCount');
      let active = 0;

      // Subsequence matching, not just substring: "gcp" then finds
      // "Go to Cloud Providers" without the user having to type every letter.
      // Exact substring matches still rank first so the obvious thing stays on top.
      const fuzzy = (hay, needle) => {
        let i = 0;
        for (const ch of hay) if (ch === needle[i]) i += 1;
        return i === needle.length;
      };
      const filtered = () => {
        const q = input.value.trim().toLowerCase();
        if (!q) return actions.map((a, i) => ({ a, i }));
        return actions
          .map((a, i) => {
            const label = a.label.toLowerCase();
            const hint = a.hint.toLowerCase();
            if (label.includes(q)) return { a, i, rank: 0 };
            if (label.startsWith(q)) return { a, i, rank: 1 };
            if (hint.includes(q)) return { a, i, rank: 2 };
            if (fuzzy(label, q)) return { a, i, rank: 3 };
            return null;
          })
          .filter(Boolean)
          .sort((x, y) => x.rank - y.rank);
      };
      function draw() {
        const fa = filtered();
        if (active >= fa.length) active = Math.max(0, fa.length - 1);
        if (count) {
          count.textContent = fa.length
            ? `${fa.length} command${fa.length === 1 ? '' : 's'}${input.value.trim() ? ' matched' : ''}`
            : '';
        }
        if (!fa.length) {
          list.innerHTML = `<div class="palette-empty">
            <b>No commands match “${esc(input.value.trim())}”</b>
            <span class="muted">Try a page name, a provider, or “refresh”.</span>
          </div>`;
          return;
        }
        list.innerHTML = fa.map((x, i) => `
          <button type="button" class="palette-item ${i === active ? 'active' : ''}" data-i="${i}"
                  role="option" aria-selected="${i === active}">
            <span class="palette-label">${esc(x.a.label)}</span>
            <span class="palette-hint">${esc(x.a.hint)}</span>
          </button>`).join('');
        list.querySelectorAll('.palette-item').forEach((b) => {
          const i = parseInt(b.dataset.i, 10);
          b.addEventListener('click', () => runAction(i));
          // Hovering must move the keyboard cursor too, otherwise mouse and keyboard
          // highlight disagree and Enter runs something other than what is pointed at.
          b.addEventListener('mousemove', () => {
            if (active === i) return;
            active = i;
            list.querySelectorAll('.palette-item').forEach((x) => {
              const on = parseInt(x.dataset.i, 10) === active;
              x.classList.toggle('active', on);
              x.setAttribute('aria-selected', String(on));
            });
          });
        });
        // Keep the keyboard cursor visible when arrowing past the fold.
        const cur = list.querySelector('.palette-item.active');
        if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
      }
      function runAction(i) {
        const fa = filtered();
        const entry = fa[i];
        if (!entry) return;
        const a = entry.a;
        ctrl.close();
        paletteOpen = false;
        a.run();
      }

      input.addEventListener('input', () => { active = 0; draw(); });
      input.addEventListener('keydown', (e) => {
        const fa = filtered();
        if (e.key === 'ArrowDown') { active = Math.min(active + 1, fa.length - 1); draw(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
        else if (e.key === 'Home' && fa.length) { active = 0; draw(); e.preventDefault(); }
        else if (e.key === 'End' && fa.length) { active = fa.length - 1; draw(); e.preventDefault(); }
        else if (e.key === 'Enter') { runAction(active); }
      });
      draw();
      input.focus();
    },
    onClose: () => { paletteOpen = false; },
  });
}

// Manual, on-demand integration assessment launcher (no background polling).
async function openIntegrationAssessModal() {
  let list = [];
  try { list = await getIntegrations(); } catch { /* non-fatal */ }
  const rows = (list && list.length)
    ? list.map((r) => `<div class="palette-item">
        <span class="palette-label">${esc(r.name || r.providerId)}</span>
         <span class="palette-hint" data-intg-status="${esc(r.providerId)}">${esc(r.integrationStatus || 'unknown')}</span>
        <button class="btn btn-sm" data-assess="${esc(r.providerId)}">Assess</button>
      </div>`).join('')
    : '<div class="muted">No providers found.</div>';
  openModal({
    title: 'Assess Provider Integration',
    subtitle: 'Runs once, on demand. Never infers compatibility from name or marketing.',
    size: 'wide',
    bodyHTML: `<div class="palette"><div class="palette-list">${rows}</div></div>`,
    onMount: (b) => {
      b.querySelectorAll('[data-assess]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = btn.dataset.assess;
        try {
          const rec = await assessIntegration(id);
          if (rec) {
            notify.toast(`Integration: ${rec.integrationStatus}`, 'success');
            const lbl = b.querySelector(`[data-intg-status="${btn.dataset.assess}"]`);
            if (lbl) lbl.textContent = rec.integrationStatus;
          } else {
            notify.toast('Assessment failed', 'error');
          }
        } catch (e) { notify.toast('Assessment failed: ' + (e.message || e), 'error'); }
      }));
    },
  });
}
