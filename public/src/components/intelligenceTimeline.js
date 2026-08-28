// Vertical timeline used by the Intelligence Center for recent changes and
// activity. Accepts either an intelligence "change" event or an activity record
// and normalises both into one render. No framework, no date library — grouping
// uses local date boundaries (Today / Yesterday / earlier).
import { esc } from './util.js';

const SEV_CLASS = {
  IMPORTANT: 'sev-important',
  WARNING: 'sev-warning',
  INFO: 'sev-info',
};

function describeDetails(details) {
  if (!details) return '';
  if (typeof details === 'string') return details;
  const parts = [];
  if (details.before !== undefined) parts.push(`From ${esc(String(details.before))} → ${esc(String(details.after))}`);
  else if (details.after !== undefined) parts.push(esc(String(details.after)));
  return parts.join(' ');
}

function normalize(ev) {
  // Activity record shape (category, action, status, summary, details, timestamp)
  if (ev && ev.summary !== undefined) {
    const status = ev.status || 'success';
    const severity = status === 'error' ? 'IMPORTANT' : status === 'warning' ? 'WARNING' : 'INFO';
    return {
      id: ev.id, kind: 'activity',
      title: ev.summary,
      description: describeDetails(ev.details),
      category: ev.category, severity, confidence: null,
      timestamp: ev.timestamp, action: null,
    };
  }
  return ev;
}

function dayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.floor((startOf(now) - startOf(d)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function timeLabel(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function renderTimeline(events = [], { emptyText = 'Nothing recorded yet.' } = {}) {
  const items = events.map(normalize).filter(Boolean);
  if (!items.length) {
    return `<div class="ic-empty"><span>${esc(emptyText)}</span></div>`;
  }
  const groups = new Map();
  for (const it of items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))) {
    const lbl = dayLabel(it.timestamp);
    if (!groups.has(lbl)) groups.set(lbl, []);
    groups.get(lbl).push(it);
  }
  const html = [];
  for (const [day, list] of groups) {
    html.push(`<div class="ic-tl-day"><div class="ic-tl-dayhead">${esc(day)}</div><div class="ic-tl">`);
    for (const it of list) {
      const sev = SEV_CLASS[it.severity] || 'sev-info';
      const cat = it.category ? `<span class="chip chip-sm">${esc(String(it.category))}</span>` : '';
      const conf = it.confidence ? `<span class="badge badge-conf">${esc(String(it.confidence))}</span>` : '';
      const actionBtn = it.action
        ? `<button class="btn btn-sm ic-tl-act" onclick="intelAction('${esc(it.action)}', '${esc(JSON.stringify({ providerId: it.relatedProviderId, modelId: it.relatedModelId }))}')">View</button>`
        : '';
      html.push(`<div class="ic-tl-item">
        <span class="ic-tl-dot ${sev}"></span>
        <div class="ic-tl-content">
          <div class="ic-tl-row"><span class="ic-tl-title">${esc(it.title || '')}</span><span class="ic-tl-time">${esc(timeLabel(it.timestamp))}</span></div>
          ${it.description ? `<div class="ic-tl-desc">${esc(it.description)}</div>` : ''}
          <div class="ic-tl-meta">${cat}${conf}${actionBtn}</div>
        </div>
      </div>`);
    }
    html.push(`</div></div>`);
  }
  return html.join('');
}
