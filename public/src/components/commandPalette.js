import { router } from '../core/router.js';
import { theme } from '../core/theme.js';
import { openModal, closeModal } from './modal.js';
import { openWorkflow } from '../config/workflow.js';
import { PROVIDERS } from '../providers/registry.js';
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
    { label: 'Configure Claude Code', hint: 'Workflow', run: () => openWorkflow() },
    { label: 'Open Playground', hint: 'Page', run: () => router.navigate('playground') },
    { label: 'Toggle Theme', hint: 'Appearance', run: () => { if (window.setTheme) window.setTheme(theme.current() === 'dark' ? 'light' : 'dark'); } },
    { label: 'Toggle Sidebar', hint: 'Appearance', run: () => { if (window.toggleSidebar) window.toggleSidebar(); } },
  ];
  // Provider quick-jumps (limited to keep the list scannable).
  PROVIDERS.slice(0, 8).forEach((p) => {
    actions.push({
      label: `Provider: ${p.name}`,
      hint: 'Configure',
      run: () => { router.navigate('cloud-providers'); if (window.openProviderConfig) window.openProviderConfig(p.id); },
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
