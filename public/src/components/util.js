// Pure UI helpers — HTML escaping, URL normalisation, and logo rendering.
// Extracted verbatim from the original app.js so every module shares one
// implementation (no behaviour change).

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function norm(u) {
  return u && u.endsWith('/') ? u : (u || '') + '/';
}

// Mask a secret for display (e.g. sk-ant-••••••••1234). Never used for storage
// or transmission — only for UI text where a key may be shown.
export function maskKey(key) {
  if (!key) return '';
  const s = String(key);
  if (s.length <= 8) return '•'.repeat(s.length);
  return s.slice(0, Math.min(6, s.length - 4)) + '••••••••' + s.slice(-4);
}

export function monoOf(p) {
  const parts = p.name.replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/);
  return parts.length > 1
    ? parts[0][0] + parts[1][0]
    : p.name.replace(/[^A-Za-z]/g, '').slice(0, 2);
}

export function svgLogo(p) {
  const mono = esc(monoOf(p));
  const a = p.accent || '#5b8def';
  return `<svg viewBox="0 0 48 48" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(p.name)}">
    <rect x="3" y="3" width="42" height="42" rx="13" fill="${a}16" stroke="${a}" stroke-opacity=".55" stroke-width="1.5"/>
    <text x="24" y="25.5" dominant-baseline="central" text-anchor="middle" font-family="Sora, system-ui, sans-serif" font-weight="800" font-size="17" letter-spacing="-.5" fill="${a}">${mono}</text>
  </svg>`;
}

export function logoHtml(p) {
  if (p.logo) {
    return `<img src="${p.logo}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display=''" /><span class="mono-fallback" style="display:none">${svgLogo(p)}</span>`;
  }
  return `<span class="mono-fallback">${svgLogo(p)}</span>`;
}

// Client logo renderer — mirrors logoHtml but uses the client fields
// (logo / color / monogram). Shows the original logo when available, with a
// graceful monogram fallback if the image fails to load.
export function clientLogoHtml(c) {
  const mono = esc(c.monogram || c.name || '?');
  const a = c.color || '#5b8def';
  const fallback = `<svg viewBox="0 0 48 48" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(c.name || '')}">
    <rect x="3" y="3" width="42" height="42" rx="13" fill="${a}16" stroke="${a}" stroke-opacity=".55" stroke-width="1.5"/>
    <text x="24" y="25.5" dominant-baseline="central" text-anchor="middle" font-family="Sora, system-ui, sans-serif" font-weight="800" font-size="17" letter-spacing="-.5" fill="${a}">${mono}</text>
  </svg>`;
  if (c.logo) {
    return `<img src="${c.logo}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display=''" /><span class="mono-fallback" style="display:none">${fallback}</span>`;
  }
  return `<span class="mono-fallback">${fallback}</span>`;
}

// Lightweight JSON syntax highlighter for config previews. Returns HTML with
// <span> wrappers — the input is JSON (already safe), and the preview path masks
// secrets before this runs, so no raw key is ever emitted.
export function highlightJSON(json) {
  return json
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = 'b';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) cls = 'k';
        else cls = 's';
      } else if (/true|false/.test(match)) {
        cls = 'b';
      } else if (/null/.test(match)) {
        cls = 'b';
      } else if (!isNaN(match)) {
        cls = 's';
      }
      return `<span class="${cls}">${match}</span>`;
    });
}
