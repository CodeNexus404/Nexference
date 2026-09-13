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
    <input class="inp mp-input" type="text" placeholder="${providerId === 'custom' ? 'Enter model name…' : 'Search models…'}" aria-label="${providerId === 'custom' ? 'Enter model name' : 'Search models'}" />
    <div class="mp-list" role="listbox"></div>`;
  host.appendChild(wrap);

  const input = wrap.querySelector('.mp-input');
  const list = wrap.querySelector('.mp-list');
  let showPaid = includePaid;
  let query = '';

  const paidToggle = wrap.querySelector('.mp-paid input');
  if (paidToggle) paidToggle.addEventListener('change', (e) => { showPaid = e.target.checked; draw({ force: true }); });

  function draw({ force = false } = {}) {
    const all = showPaid ? getModels(providerId) : getFreeModels(providerId);
    const q = query.trim().toLowerCase();
    const matches = all.filter((m) =>
      !q || (m.id || '').toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q));
    const freeIds = new Set(getFreeModels(providerId).map((m) => m.id));
    // The custom gateway has no model catalogue of its own — the user types the
    // model name manually, so don't show the generic empty states.
    const isCustom = providerId === 'custom';

    // Skip a repaint when nothing observable changed. The 800ms background poll
    // re-renders this list on every tick, which resets the scroll position of a
    // long list while the user is hovering/scrolling — that is the model-list
    // "flicker". Signing the rendered state and bailing out when identical keeps
    // the list stable; scrollTop is preserved across genuine re-renders too.
    const sig = `${showPaid}|${isFetching(providerId)}|${getModelSource(providerId) || ''}|${q}|${matches.length ? matches.map((m) => m.id).join(',') : ''}`;
    if (!force && list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    const prevScroll = list.scrollTop;

    if (!all.length) {
      if (isCustom) { list.innerHTML = ''; return; }
      const fetching = isFetching(providerId);
      list.innerHTML = `<div class="mp-empty">${fetching ? 'Loading models…' : (getModelSource(providerId) ? 'No models cached — add an API key first' : 'No models available')}</div>`;
      return;
    }
    if (!matches.length) {
      if (isCustom) { list.innerHTML = ''; return; }
      list.innerHTML = `<div class="mp-empty">No models match “${esc(query)}”.</div>`;
      return;
    }
    list.innerHTML = matches.map((m) => `
      <button type="button" class="mp-item ${current === m.id ? 'sel' : ''}" data-id="${esc(m.id)}" role="option">
        <span class="mp-name">${esc(m.name || m.id)}</span>
        ${freeIds.has(m.id) ? '<span class="mp-free">free</span>' : ''}
        <span class="mp-id">${esc(m.id)}</span>
      </button>`).join('');
    list.scrollTop = prevScroll;
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
  // Non-curated providers resolve their models via their own endpoints:
  //   cst:* → fetchCustomProviderModelsSilent (/api/custom-providers/:id/fetch-models)
  //   dyn:* → fetchProviderSilent        (/api/refresh-models)
  //   curated → fetchProviderSilent only when it makes sense (public models or a key).
  if (getModels(providerId).length === 0) {
    if (providerId.startsWith('cst:') && window.fetchCustomProviderModelsSilent) window.fetchCustomProviderModelsSilent(providerId);
    else if (providerId.startsWith('dyn:') && window.fetchProviderSilent) window.fetchProviderSilent(providerId);
    else if ((provider.publicModels || Storage.getKey(providerId)) && window.fetchProviderSilent) window.fetchProviderSilent(providerId);
    let tries = 0;
    const poll = setInterval(() => {
      draw();
      if (getModels(providerId).length || tries++ > 24) clearInterval(poll);
    }, 800);
  }
  return wrap;
}
