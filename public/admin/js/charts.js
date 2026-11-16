// Kleine SVG-Diagramme ohne Bibliothek: Säulen (Höchstwert hell, Durchschnitt kräftig) und Linie.
// Farben kommen aus den Design-Werten der Seite (Hell/Dunkel folgt automatisch), Beschriftungen stehen in Textfarbe.
import { esc } from './core.js';

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
export const fmtNum = (n) => nf.format(n);

let tip = null;
function tipEl() {
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip hidden'; tip.setAttribute('role', 'tooltip'); document.body.append(tip); }
  return tip;
}
const show = (el) => {
  const t = tipEl(), r = el.getBoundingClientRect();
  t.innerHTML = el.dataset.tip; t.classList.remove('hidden');
  const w = t.offsetWidth;
  t.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  t.style.top = `${Math.max(8, r.top - t.offsetHeight - 8)}px`;
};
const hide = () => tipEl().classList.add('hidden');
/** Hover und Tastatur-Fokus auf allen Marken mit data-tip in dieser Hülle. */
export function wireTips(root) {
  root.addEventListener('mouseover', (e) => { const m = e.target.closest('[data-tip]'); if (m) show(m); });
  root.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) hide(); });
  root.addEventListener('focusin', (e) => { const m = e.target.closest('[data-tip]'); if (m) show(m); });
  root.addEventListener('focusout', hide);
}

/** Säulen je Stream: items = [{ label, peak, avg, tip }], älteste links. */
export function barChart(items, name) {
  if (!items.length) return '';
  const bw = 40, h = 170, pad = 28, top = Math.max(1, ...items.map((i) => i.peak));
  const w = pad * 2 + items.length * bw;
  const out = [`<div class="chart-scroll"><svg viewBox="0 0 ${w} ${h + 56}" style="min-width:${Math.min(w, 560)}px" role="img" aria-label="${esc(name)}" class="chart">`];
  for (const f of [0.5, 1]) out.push(`<line x1="${pad}" x2="${w - pad}" y1="${22 + h - h * f}" y2="${22 + h - h * f}" class="ch-grid"/>`);
  out.push(`<line x1="${pad}" x2="${w - pad}" y1="${22 + h}" y2="${22 + h}" class="ch-axis"/>`);
  items.forEach((it, i) => {
    const x = pad + i * bw + 4, bwid = bw - 8;
    const hp = Math.max(3, Math.round((it.peak / top) * h)), ha = Math.max(it.avg > 0 ? 3 : 0, Math.round((it.avg / top) * h));
    out.push(`<g data-tip="${esc(it.tip)}" tabindex="0" class="ch-mark"><rect x="${x - 2}" y="12" width="${bwid + 4}" height="${h + 40}" class="ch-hit"/>`
      + `<path d="${roundTop(x, 22 + h, bwid, hp, 4)}" class="ch-peak"/>`
      + (ha ? `<path d="${roundTop(x + 5, 22 + h, bwid - 10, ha, 3)}" class="ch-avg"/>` : '') + '</g>');
    out.push(`<text x="${x + bwid / 2}" y="${h + 42}" text-anchor="middle" class="ch-text">${esc(it.label)}</text>`);
  });
  out.push(`<text x="${pad}" y="14" class="ch-text">${fmtNum(top)}</text></svg></div>`);
  out.push('<p class="chart-legend"><span><i class="sw sw-peak"></i>Höchstwert</span><span><i class="sw sw-avg"></i>Durchschnitt</span></p>');
  return out.join('');
}
// Rechteck, dessen obere Ecken rund sind und das unten auf der Grundlinie steht
function roundTop(x, base, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + w - r} Q${x + w},${base - h} ${x + w},${base - h + r} V${base} Z`;
}

/** Linie über Zeit: points = [{ label, value, tip }]. */
export function lineChart(points, name, { unit = '' } = {}) {
  if (points.length < 2) return '';
  const w = 640, h = 190, px = 44, py = 22;
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo;
  const xy = points.map((p, i) => [px + (i * (w - 2 * px)) / (points.length - 1), py + (h - 2 * py) * (1 - (p.value - lo) / span)]);
  const out = [`<div class="chart-scroll"><svg viewBox="0 0 ${w} ${h + 30}" style="min-width:420px" role="img" aria-label="${esc(name)}" class="chart">`];
  for (const f of [0, 0.5, 1]) out.push(`<line x1="${px}" x2="${w - px}" y1="${py + (h - 2 * py) * f}" y2="${py + (h - 2 * py) * f}" class="ch-grid"/>`);
  out.push(`<polyline points="${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" class="ch-line" fill="none"/>`);
  const dots = points.length <= 40;
  xy.forEach(([x, y], i) => out.push(`<g data-tip="${esc(points[i].tip ?? `${points[i].label}: ${fmtNum(points[i].value)}${unit}`)}" tabindex="0" class="ch-mark"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" class="ch-hit"/>${dots ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" class="ch-dot"/>` : ''}</g>`));
  out.push(`<text x="6" y="${py + 4}" class="ch-text">${fmtNum(hi)}</text><text x="6" y="${h - py + 4}" class="ch-text">${fmtNum(lo)}</text>`);
  out.push(`<text x="${px}" y="${h + 18}" class="ch-text">${esc(points[0].label)}</text><text x="${w - px}" y="${h + 18}" text-anchor="end" class="ch-text">${esc(points.at(-1).label)}</text></svg></div>`);
  return out.join('');
}
