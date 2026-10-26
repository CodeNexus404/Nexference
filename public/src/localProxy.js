// Local proxy client helpers — talk to the Nexference server's in-memory
// Claude Code proxy subsystem (/api/local-proxy/*). The upstream provider key
// is handed to arm() exactly once and is never stored anywhere on the client.

export async function localProxyStatus() {
  try {
    const r = await fetch('/api/local-proxy/status');
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message } };
  }
}

export async function armLocalProxy(payload) {
  try {
    const r = await fetch('/api/local-proxy/arm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message } };
  }
}

export async function disarmLocalProxy() {
  try {
    const r = await fetch('/api/local-proxy/disarm', { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message } };
  }
}