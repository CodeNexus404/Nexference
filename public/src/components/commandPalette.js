import { router } from '../core/router.js';
import { theme } from '../core/theme.js';
import { openModal, closeModal } from './modal.js';
import { openWorkflow } from '../config/workflow.js';
import { PROVIDERS } from '../providers/registry.js';
import { CLIENTS, getClient } from '../clients/registry.js';
import { modelService } from '../models/modelService.js';
import { notify } from '../core/notifications.js';
import { esc } from './util.js';

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
    { label: 'Refresh OpenRouter Models', hint: 'Providers', run: async () => { if (window.refreshProviderModels) await window.refreshProviderModels('openrouter'); else router.navigate('cloud-providers'); } },
    { label: 'Recommended Models', hint: 'Models', run: () => { router.navigate('models'); } },
    { label: 'Toggle Theme', hint: 'Appearance', run: () => { if (window.setTheme) window.setTheme(theme.current() === 'dark' ? 'light' : 'dark'); } },
    { label: 'Toggle Sidebar', hint: 'Appearance', run: () => { if (window.toggleSidebar) window.toggleSidebar(); } },
  ];
  // Client quick-launch (start the wizard pre-selected to that client).
  CLIENTS.filter((c) => c.support !== 'unsupported').forEach((c) => {
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

  const { close } = openModal({
    title: 'Command Palette',
    subtitle: '⌘K · type to filter',
    size: 'wide',
    bodyHTML: `<div class="palette">
        <input class="inp palette-input" placeholder="Type a command…" aria-label="Command filter" />
        <div class="palette-list" id="paletteList" role="listbox"></div>
      </div>`,
    onMount: (body, ctrl) => {
      paletteOpen = true;
      const input = body.querySelector('.palette-input');
      const list = body.querySelector('#paletteList');
      let active = 0;

      const filtered = () => {
        const q = input.value.toLowerCase();
        return actions.filter((a) => !q || a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q));
      };
      function draw() {
        const fa = filtered();
        if (active >= fa.length) active = Math.max(0, fa.length - 1);
        list.innerHTML = fa.map((a, i) => `
          <button type="button" class="palette-item ${i === active ? 'active' : ''}" data-i="${i}" role="option">
            <span class="palette-label">${esc(a.label)}</span>
            <span class="palette-hint">${esc(a.hint)}</span>
          </button>`).join('');
        list.querySelectorAll('.palette-item').forEach((b) => b.addEventListener('click', () => runAction(parseInt(b.dataset.i, 10))));
      }
      function runAction(i) {
        const fa = filtered();
        const a = fa[i];
        if (!a) return;
        ctrl.close();
        paletteOpen = false;
        a.run();
      }

      input.addEventListener('input', () => { active = 0; draw(); });
      input.addEventListener('keydown', (e) => {
        const fa = filtered();
        if (e.key === 'ArrowDown') { active = Math.min(active + 1, fa.length - 1); draw(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
        else if (e.key === 'Enter') { runAction(active); }
      });
      draw();
      input.focus();
    },
    onClose: () => { paletteOpen = false; },
  });
}
