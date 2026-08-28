// Small, dependency-free SVG trend chart for the Intelligence Center.
// Draws a responsive sparkline from a series of { t, v } points.
import { esc } from './util.js';

const COLOR = {
  IMPROVING: 'var(--success)',
  DECLINING: 'var(--error)',
  STABLE: 'var(--text-3)',
  UNKNOWN: 'var(--text-3)',
};

export function trendChart(series, { direction = 'STABLE', height = 46, color = null } = {}) {
  if (!Array.isArray(series) || series.length < 2) {
    return `<div class="ic-chart ic-chart--empty" style="height:${height}px"><span class="muted">Not enough data to chart</span></div>`;
  }
  const vals = series.map((p) => Number(p.v)).filter((n) => !Number.isNaN(n));
  if (vals.length < 2) {
    return `<div class="ic-chart ic-chart--empty" style="height:${height}px"><span class="muted">Not enough data to chart</span></div>`;
  }
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }

  const W = 100, H = 100, pad = 6;
  const n = vals.length;
  const x = (i) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (v) => (H - pad) - ((v - min) / (max - min)) * (H - 2 * pad);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = 'M' + pts.join(' L');
  const area = `M${x(0).toFixed(1)},${H - pad} L` + pts.join(' L') + ` L${x(n - 1).toFixed(1)},${H - pad} Z`;
  const stroke = color || COLOR[direction] || COLOR.STABLE;
  const gid = 'ig' + Math.random().toString(36).slice(2, 9);

  return `<div class="ic-chart" style="height:${height}px">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label="${esc(direction)} trend">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity=".30"/>
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${gid})" stroke="none"/>
      <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>
  </div>`;
}
