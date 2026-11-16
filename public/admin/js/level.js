// Seite „Dorf-Level“: Stufen mit Titel und Anzahl der verknüpften Personen je Stufe, die Besten.
import { $, api, esc, run, toast } from './core.js';

let data = null;
const nf = new Intl.NumberFormat('de-DE');

function render() {
  const d = data;
  $('lvHint').classList.toggle('hidden', d.enabled);
  const max = Math.max(1, ...d.levels.map((l) => l.people));
  $('lvTable').innerHTML = `<div style="overflow-x:auto"><table class="tk"><thead><tr><th>Stufe</th><th>Titel</th><th>ab Punkten</th><th>Personen</th></tr></thead><tbody>${d.levels.map((l) => `<tr><td><b>${l.n}</b></td><td>${esc(l.title)}</td><td>${nf.format(l.points)}</td><td>${d.enabled ? `<span style="display:inline-block; vertical-align:middle; height:10px; width:${Math.round((l.people / max) * 120)}px; background:var(--gelb); border-radius:5px; margin-right:8px"></span>${l.people}` : '–'}</td></tr>`).join('')}</tbody></table></div>`;
  $('lvInfo').textContent = d.enabled ? `${d.linked} verknüpfte Konten. Personen ohne Verknüpfung haben auch ein Level (sie sehen es mit ${d.command} und auf „Meine Stadtwache“), werden hier aber nicht gezählt.` : 'Eingeschaltet siehst du hier, wie viele verknüpfte Personen auf welcher Stufe stehen.';
  $('lvTop').innerHTML = d.top.length ? `<ol class="top-list">${d.top.map((p) => `<li><b>${esc(p.name)}</b><span class="muted">Level ${p.level} · ${nf.format(p.points)} Punkte</span></li>`).join('')}</ol>` : '<p class="muted">Noch niemand verknüpft oder das Level ist ausgeschaltet.</p>';
}
async function load() { data = await api('GET', 'level'); render(); }
export const loadLevel = load;

export function initLevel() {
  $('lvRefresh').addEventListener('click', run(async () => { data = await api('POST', 'level/refresh', {}); render(); toast('Neu berechnet ✓'); }));
  document.addEventListener('admin:tab', (e) => { if (e.detail === 'level' && data) load().catch(() => {}); });
  document.addEventListener('admin:settings', () => { if (data) load().catch(() => {}); });
}
