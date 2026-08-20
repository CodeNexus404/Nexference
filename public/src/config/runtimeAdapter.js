import { notify } from '../core/notifications.js';
import { esc } from '../components/util.js';
import { openModal } from '../components/modal.js';

// Runtime Adapter interface — abstracts HOW a generated config is delivered to
// the user. Two runtimes exist today (both preserved verbatim from app.js):
//   • LocalSettingsRuntime  — writes ~/.claude/settings.json via the server proxy
//     (used for Anthropic-compatible gateways Claude Code can consume directly).
//   • CopyableRuntime       — shows the config in a modal for the user to copy into
//     their own OpenAI/Gemini client (Claude Code ignores OPENAI_*/GOOGLE_* vars).
//
// Future runtimes (e.g. a native desktop write, a clipboard auto-copy) drop in
// here without touching the apply flow.
export class RuntimeAdapter {
  apply(/* config */) {
    throw new Error('apply() must be implemented by a concrete RuntimeAdapter');
  }
}

export class LocalSettingsRuntime extends RuntimeAdapter {
  // Returns true on success, false on HTTP failure (caller surfaces the toast).
  static async write(config) {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (response.ok) return true;
    let msg = `Failed to save config (HTTP ${response.status})`;
    try {
      const d = await response.json();
      if (d && d.error) msg += `: ${d.error}`;
    } catch { /* ignore parse error */ }
    notify.toast(msg, 'error');
    notify.log(msg, 't-err');
    return false;
  }
}

export class CopyableRuntime extends RuntimeAdapter {
  static show(config, name) {
    const { title, sub } = configClientMeta(config);
    openModal({
      title: `${name} — ${title}`,
      size: 'wide',
      bodyHTML:
        `<p class="modal-card-sub">${sub}</p>` +
        `<pre class="code config-code" id="configText">${esc(JSON.stringify(config, null, 2))}</pre>` +
        `<div class="modal-actions"><button class="btn btn-go" onclick="copyConfigText()">Copy config</button></div>`,
    });
  }
}

// Modal copy/title text — preserved exactly from configClientMeta.
function configClientMeta(config) {
  if (config.env?.GOOGLE_API_KEY) {
    return {
      title: 'Google Gemini config',
      sub: 'Gemini is not Anthropic-compatible, so copy this into your Gemini client (e.g. the Google Generative Language SDK) config or a <code>.env</code> file:',
    };
  }
  if (config.env?.OPENAI_BASE_URL) {
    return {
      title: 'OpenAI client config',
      sub: 'Claude Code ignores <code>OPENAI_*</code> env vars, so copy this into your OpenAI‑compatible client’s config (or a <code>.env</code> file):',
    };
  }
  return { title: 'Client config', sub: 'Copy this into your client’s config (or a <code>.env</code> file):' };
}
