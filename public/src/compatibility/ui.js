// Shared compatibility UI — renders level badges + note lists consistently
// across the Workflow, Clients page, and Workspace.
import { LEVELS } from './levels.js';
import { esc } from '../components/util.js';

export function levelBadge(levelId, extra = '') {
  const l = LEVELS[levelId] || LEVELS.UNSUPPORTED;
  return `<span class="badge ${l.cls}" title="${esc(l.description)}">${l.icon} ${esc(l.label)}</span>`;
}

export function compatNoteList(res) {
  if (!res || !res.notes || !res.notes.length) return '';
  return `<ul class="compat-notes">${res.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
}

// Short human label for a connection type.
export function connectionLabel(type) {
  return type === 'local' ? 'Local AI' : 'Cloud AI';
}
