import { esc } from './util.js';
import { workspace, getFreeModels, getModels, getModelSource, isFetching } from '../core/state.js';
import { Storage } from '../core/storage.js';
import { getProvider } from '../providers/registry.js';

// Model picker — a searchable, free-marked model selector used by both the
// provider configuration panel and the configuration workflow. It reads from the
// existing three-tier model cache (live API → scrape → curated static) via the
// workspace state selectors, and triggers a background fetch if the cache is
// empty. Pure UI — no configuration generation happens here.
export function renderModelPicker(host, providerId, opts = {}) {
  const { onSelect = null, includePaid = false, current = '', showPaidToggle = true } = opts;
  const provider = getProvider(providerId);
  if (!provider) return host;

  const wrap = document.createElement('div');
  wrap.className = 'model-picker';
  wrap.innerHTML = `
    ${showPaidToggle ? `<label class="paid-toggle mp-paid"><input type="checkbox" ${includePaid ? 'checked' : ''}><span class="paid-track"></span><span class="paid-text">Include paid</span></label>` : ''}
    <input class="inp mp-input" type="text" placeholder="Search models…" aria-label="Search models" />
    <div class="mp-list" role="listbox"></div>`;
  host.appendChild(wrap);

  const input = wrap.querySelector('.mp-input');
  const list = wrap.querySelector('.mp-list');
  let showPaid = includePaid;
  let query = '';

  const paidToggle = wrap.querySelector('.mp-paid input');
  if (paidToggle) paidToggle.addEventListener('change', (e) => { showPaid = e.target.checked; draw(); });

  function draw() {
    const all = showPaid ? getModels(providerId) : getFreeModels(providerId);
    const q = query.trim().toLowerCase();
    const matches = all.filter((m) =>
      !q || (m.id || '').toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q));
    const freeIds = new Set(getFreeModels(providerId).map((m) => m.id));
    // The custom gateway has no model catalogue of its own, so its empty state
    // shouldn't inherit the generic picker styling.
    const emptyCls = providerId === 'custom' ? '' : 'mp-empty';

    if (!all.length) {
      const fetching = isFetching(providerId);
      list.innerHTML = `<div class="${emptyCls}">${fetching ? 'Loading models…' : (getModelSource(providerId) ? 'No models cached — add an API key first' : 'No models available')}</div>`;
      return;
    }
    if (!matches.length) {
      list.innerHTML = `<div class="${emptyCls}">No models match “${esc(query)}”.</div>`;
      return;
    }
    list.innerHTML = matches.map((m) => `
      <button type="button" class="mp-item ${current === m.id ? 'sel' : ''}" data-id="${esc(m.id)}" role="option">
        <span class="mp-name">${esc(m.name || m.id)}</span>
        ${freeIds.has(m.id) ? '<span class="mp-free">free</span>' : ''}
        <span class="mp-id">${esc(m.id)}</span>
      </button>`).join('');
    list.querySelectorAll('.mp-item').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.id;
      list.querySelectorAll('.mp-item').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      if (onSelect) onSelect(id);
    }));
  }

  input.addEventListener('input', () => { query = input.value; draw(); });
  draw();

  // Trigger a background fetch if the cache is empty (uses the global helper).
  if (getModels(providerId).length === 0 && (provider.publicModels || Storage.getKey(providerId))) {
    if (window.fetchProviderSilent) window.fetchProviderSilent(providerId);
    let tries = 0;
    const poll = setInterval(() => {
      draw();
      if (getModels(providerId).length || tries++ > 24) clearInterval(poll);
    }, 800);
  }
  return wrap;
}
