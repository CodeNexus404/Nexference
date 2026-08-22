// ═══════════════════════════════════════════════════════════════
//  Minimal, safe Markdown renderer (v0.9.0)
//
//  Intentionally tiny: it escapes ALL HTML first, then renders fenced
//  code blocks, inline `code`, and paragraph / line breaks. No raw
//  HTML passes through, so model output can never inject markup.
// ═══════════════════════════════════════════════════════════════

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function miniMarkdown(src = '') {
  const lines = String(src).replace(/\r$/gm, '').split('\n');
  let html = '';
  let inCode = false;
  let codeBuf = [];
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const text = esc(para.join('\n')).replace(/\n/g, '<br>');
    html += `<p>${text}</p>`;
    para = [];
  };

  for (const line of lines) {
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      if (inCode) {
        flushPara();
        html += `<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`;
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        inCode = true;
        codeBuf = [];
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (line.trim() === '') { flushPara(); continue; }
    para.push(esc(line).replace(/`([^`]+)`/g, '<code>$1</code>'));
  }
  if (inCode) { flushPara(); html += `<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`; }
  flushPara();

  return html || '<p class="muted">(empty)</p>';
}
