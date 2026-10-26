// Workspace topology — renders the live request path as a graph rather than a
// flat row of labels.
//
// Why this exists: the old "Current Workspace" strip was a 4-node chain
// (Client → AI Source → Provider → Model) rendered as a flex row of cards. That
// was actively misleading for OpenAI-compatible providers, because the Nexference
// local proxy is a REAL hop in the request path — Claude Code talks to
// 127.0.0.1:3000, the proxy translates Anthropic→OpenAI, and only then does the
// upstream provider see the traffic. The old strip showed "Client → Provider"
// as if they were talking directly, and it had no way to say whether the proxy
// was armed, orphaned, or idle.
//
// The topology fixes that by:
//   • inserting the proxy as a first-class node whenever it is actually in the
//     path (armed), and flagging the orphaned case where Claude Code still points
//     at a proxy that no longer has a session;
//   • giving every node an explicit state (live / empty / blocked) instead of
//     inferring health from whether a value happens to be non-empty;
//   • collapsing to a vertical flow on narrow viewports, because a 5-node
//     horizontal chain wraps into unreadable orphan nodes on a phone.
//
// Rendering is pure: it takes a plain state object and returns HTML. All I/O
// (reading proxy status) happens in the caller so this stays testable and does
// not re-fetch on every keystroke.

import { esc } from './util.js';

// Node states drive the accent colour and the status dot, so every hop reports
// the same three visual states. "blocked" is reserved for a genuine failure
// (orphaned proxy) as opposed to "empty" (nothing configured yet).
export const TOPO_STATE = { LIVE: 'live', EMPTY: 'empty', BLOCKED: 'blocked' };

function node({ key, label, value, state = TOPO_STATE.EMPTY, icon = '', page = null, title = '', badge = '', mono = false, slim = false }) {
  const cls = `topo-node topo-${state}${page ? ' topo-click' : ''}${slim ? ' is-slim' : ''}`;
  const label2 = title || (page ? `Open ${label}` : label);
  const attrs = page
    ? ` role="button" tabindex="0" onclick="navigate('${esc(page)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"`
    : '';
  return `
    <div class="${cls}"${attrs} aria-label="${esc(label2)}"${title ? ` title="${esc(title)}"` : ''}>
      ${badge ? `<span class="topo-badge${badge !== 'active' ? ` is-${badge}` : ''}">${esc(badge)}</span>` : ''}
      <span class="topo-ico" aria-hidden="true">${icon}</span>
      <span class="topo-text">
        <span class="topo-label">${esc(label)}</span>
        <b class="topo-value${mono ? ' mono' : ''}">${esc(value || '—')}</b>
      </span>
      <span class="topo-dot" aria-hidden="true"></span>
    </div>`;
}

// A labelled connector. The label is what turns this from decoration into
// information: the user can see that one hop is a translation boundary.
function link(text) {
  return `<div class="topo-link" aria-hidden="true"><span class="topo-link-line"></span>${text ? `<span class="topo-link-tag">${esc(text)}</span>` : ''}<span class="topo-link-line"></span></div>`;
}

// ── Fallback as a compact spine under the active provider ──────────
//
// This is deliberately NOT a second row of full-size nodes. The main chain is the
// diagram; the ladder is a quiet annotation hanging off the provider node, because
// those tiers are not hops the request is on right now — they are where it MIGHT go.
//
// So each tier is one single line (dot · provider · model · route) on a vertical
// spine, roughly a third the height of a real node. Reading it top-to-bottom still
// gives the exact order the monitor will walk, and the active tier is filled in
// place. The extra nodes only appear when a fallback plan is actually armed.
function fallbackBranch(fb, s0) {
  const tiers = (fb.tiers || []).filter((t) => t && t.provider);
  if (!tiers.length) return '';
  const state = fb.degraded ? 'degraded' : 'armed';

  // Match on planIndex, never the loop counter: fb.tiers is a filtered display
  // list, so a disabled tier shifts every position after it. Using the position
  // highlighted the wrong tier whenever an earlier one was switched off.
  const activePlan = Number.isInteger(fb.activeTier) ? fb.activeTier : 0;

  const rows = tiers.map((t) => {
    const isActive = t.planIndex === activePlan;
    const kind = t.isPrimary ? 'Primary' : `Fallback ${t.planIndex}`;
    const route = t.viaProxy ? 'via proxy' : 'direct';
    const routeTitle = t.viaProxy
      ? 'OpenAI-compatible \u2014 reached through the Nexference proxy'
      : 'Anthropic-compatible \u2014 read directly by Claude Code';
    return `
      <li class="topo-t${isActive ? ' is-active' : ''}" title="${esc(routeTitle)}">
        <span class="topo-t-dot" aria-hidden="true"></span>
        <span class="topo-t-kind">${esc(kind)}</span>
        <span class="topo-t-provider">${esc(t.providerName || t.provider || '\u2014')}</span>
        <span class="topo-t-model mono">${esc(t.model || '\u2014')}</span>
        <span class="topo-t-route${t.viaProxy ? ' is-proxy' : ''}">${esc(route)}</span>
      </li>`;
  }).join('');

  return `
    <div class="topo-spine" data-state="${state}">
      <div class="topo-spine-head">
        <span class="topo-spine-title">Auto-switch</span>
        <span class="topo-spine-pill">${fb.degraded ? 'Degraded' : 'Armed'}</span>
        <span class="topo-spine-note">${fb.degraded
          ? 'all tiers failed \u2014 retrying primary'
          : `${fb.failThreshold} failures then switch${fb.cooldownMin ? ` \u00b7 ${fb.cooldownMin} min cooldown` : ''}`}</span>
      </div>
      <ol class="topo-tiers">${rows}</ol>
    </div>`;
}

/**
 * renderTopology(state) -> HTML string
 *
 * state = {
 *   client:    { name, page,    icon },
 *   provider:  { name, page,    icon } | null,
 *   runtime:   { name, page,    icon } | null,   // local runtime alternative
 *   model:     string,
 *   proxy:     { armed, providerName, model, orphaned, orphanedModel, url },
 *   configPath:string,
 *   providerIcon: string,
 *   fallback:  { enabled, activeTier, degraded, failThreshold, cooldownMin,
 *                tiers: [{ provider, providerName, model, enabled }] } | null,
 * }
 */
export function renderTopology(state) {
  const s = state || {};
  const client = s.client || {};
  const proxy = s.proxy || {};
  const provider = s.provider || null;
  const runtime = s.runtime || null;
  const source = provider || runtime;

  // Claude Code is pointed at the local proxy whenever ANTHROPIC_BASE_URL is
  // loopback — whether or not a session is armed. That distinction is the whole
  // point: "armed" is a live path, "orphaned" is a broken one, and neither is the
  // same as "not using the proxy at all".

  const fb = s.fallback && s.fallback.enabled ? s.fallback : null;
  // With fallback armed the provider the client is actually talking to is the
  // ACTIVE tier, which is not necessarily the primary: the monitor switches on
  // failure. Drawing the primary here would show a stale provider immediately
  // after every auto-switch — exactly when an accurate picture matters most.
  // activeTier is a PLAN index while fb.tiers is a FILTERED display list (a disabled
  // tier is absent from it). Indexing the display array by the plan index read the
  // wrong provider whenever an earlier tier was disabled, so after a switch to
  // "Fallback 2" the chain could display "Fallback 1". Match on planIndex.
  const activeTier = fb && Array.isArray(fb.tiers)
    ? (fb.tiers.find((t) => t && t.planIndex === fb.activeTier)
       || fb.tiers.find((t) => t && t.isPrimary)
       || fb.tiers[0]
       || null)
    : null;
  const liveProvider = fb && activeTier && activeTier.provider
    ? { name: activeTier.providerName || activeTier.provider, icon: s.providerIcon }
    : source;

  const sourceValue = liveProvider ? liveProvider.name : '—';
  const sourceState = liveProvider ? TOPO_STATE.LIVE : TOPO_STATE.EMPTY;

  // The effective hop order changes depending on the path. When the proxy is in
  // play the client NEVER talks to the provider directly, so we must not draw it
  // as if it does.
  const hops = [node({
    key: 'client', label: 'Client', value: client.name || '—',
    state: client.name ? TOPO_STATE.LIVE : TOPO_STATE.EMPTY,
    icon: client.icon || '', page: 'clients',
  })];

  // ── Is the proxy genuinely in the request path? ────────────────────
  // `armed` alone is NOT enough to draw a hop. A proxy session can stay armed
  // after the user reconfigures Claude Code to an Anthropic-compatible provider
  // that needs no translation at all, and showing "Nexference proxy → Armed" then
  // claimed a hop that was not there.
  //
  // The proxy is drawn only when it actually carries traffic:
  //   • orphaned — the settings file still points at 127.0.0.1, so the client IS
  //     trying to reach it. That is a broken path and must be shown.
  //   • the ACTIVE provider needs it — an OpenAI-compatible (or Gemini-via-OpenAI)
  //     tier, which Claude Code cannot read without translation.
  // A merely-configured-but-unused session is deliberately not drawn.
  const needsProxyForActive = fb ? !!fb.activeViaProxy : !!s.proxy?.requiredForActive;
  const viaProxy = !!(proxy.orphaned || (proxy.armed && needsProxyForActive));
  const proxyState = proxy.armed ? TOPO_STATE.LIVE : proxy.orphaned ? TOPO_STATE.BLOCKED : TOPO_STATE.EMPTY;

  // The armed session's model is only the model in play when the proxy is actually
  // carrying traffic. With a stale armed session the config's own model is the
  // truth, so gate on viaProxy rather than on `armed` alone.
  const modelValue = (viaProxy && proxy.armed && proxy.model) ? proxy.model
    : (fb && activeTier && activeTier.model) || (s.model || '—');
  const modelState = modelValue && modelValue !== '—' ? TOPO_STATE.LIVE : TOPO_STATE.EMPTY;

  if (viaProxy) {
    hops.push(link(proxy.armed ? 'HTTP' : 'broken'));
    hops.push(node({
      key: 'proxy', label: 'Nexference proxy',
      value: proxy.armed ? 'Armed' : 'Not armed',
      state: proxyState, icon: proxy.icon || '',
      page: 'cloud-providers', slim: true,
      title: proxy.armed
        ? (proxy.url || 'Local proxy is armed — requests are translated here')
        : (proxy.orphaned
            ? `Claude Code still points at the proxy, but no session is armed. Reconnect from the provider card.${proxy.orphanedModel ? ` (${proxy.orphanedModel})` : ''}`
            : 'Local proxy'),
    }));
  }

  hops.push(link(viaProxy ? 'translate' : 'HTTP'));
  // The Active provider node is the FAILOVER POINT, so with a fallback plan armed
  // it becomes a hub: the ladder descends directly out of this node via the same
  // `link()` flow lines used along the main chain. Previously the ladder was a
  // sibling block pinned to the left edge, which left it visually disconnected —
  // it read as a separate table rather than as a branch of this graph.
  const sourceNode = node({
    key: 'source',
    label: fb ? 'Active provider' : (provider ? 'Provider' : (runtime ? 'Local runtime' : 'AI source')),
    value: sourceValue, state: sourceState,
    icon: (liveProvider && liveProvider.icon) || (source && source.icon) || '',
    page: (provider || fb) ? 'cloud-providers' : (runtime ? 'localai' : 'configuration'),
    badge: fb ? 'hub' : '',
  });

  // Hand the whole plan to the branch renderer so the ladder is drawn as part of
  // the graph. Icons are threaded through because the branch builds real nodes and
  // must match the main chain's visual language exactly.
  const branch = fb ? fallbackBranch(fb, s) : '';

  if (branch) {
    // .topo-hub keeps the provider node in the horizontal flow while the tier
    // spine hangs beneath it, so the spine is visually anchored to THIS node
    // instead of floating at the left edge of the card.
    hops.push(`<div class="topo-hub">${sourceNode}${branch}</div>`);
  } else {
    hops.push(sourceNode);
  }
  hops.push(link('model'));
  hops.push(node({
    key: 'model', label: 'Model', value: modelValue, state: modelState,
    icon: (s.modelIcon) || '', page: 'models', mono: true,
  }));

  const banner = proxy.orphaned
    ? `<div class="topo-alert" role="status">
         <span class="topo-alert-ico" aria-hidden="true">!</span>
         <span>Claude Code is pointed at the local proxy but it isn't armed${proxy.orphanedModel ? ` (<b class="mono">${esc(proxy.orphanedModel)}</b>)` : ''} — reconnect from the provider card or requests will fail.</span>
       </div>`
    : proxy.armed
      ? `<div class="topo-note" role="status">Requests are translated from Anthropic to the provider's OpenAI dialect by the local proxy. The provider key stays in memory and is never written to disk.</div>`
      : '';

  return `
    <div class="topo" role="group" aria-label="Request path topology">
      <div class="topo-flow">${hops.join('')}</div>
      ${banner}
      <div class="topo-foot">
        <span class="topo-foot-item">Config: <span class="mono">${esc(s.configPath || '~/.claude/settings.json')}</span></span>
        ${proxy.armed && proxy.url ? `<span class="topo-foot-item">Proxy: <span class="mono">${esc(proxy.url)}</span></span>` : ''}
      </div>
    </div>`;
}

// Reads live proxy state and returns it in the shape renderTopology expects.
// Kept separate from the renderer so a failed status fetch degrades to "no
// proxy" instead of blanking the whole topology.
export async function readProxyState() {
  try {
    const { ok, data } = await localProxyStatusRef();
    if (!ok || !data) return { armed: false, orphaned: false };
    return {
      armed: !!data.armed,
      orphaned: !!data.settingsOrphaned,
      providerName: data.providerName || '',
      model: data.model || '',
      orphanedModel: data.orphanedModel || '',
      url: data.proxyUrl || '',
    };
  } catch {
    return { armed: false, orphaned: false };
  }
}

// Imported lazily to keep this module free of a hard dependency on the proxy
// client (the topology is useful even when the proxy module is unavailable).
async function localProxyStatusRef() {
  const mod = await import('../localProxy.js');
  return mod.localProxyStatus();
}
