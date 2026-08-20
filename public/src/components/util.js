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
