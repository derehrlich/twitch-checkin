// Sport-Reiter: Scoreboard steuern (Zahlen, Stoppuhr, Einblenden) und Verlauf der gespeicherten Einheiten.
import { $, api, esc, onAct, run, toast } from './core.js';

let data = null, fetchedAt = 0;
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} Std ${pad(m)} Min` : `${m} Min ${pad(s % 60)} s`; };
const clock = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`; };
const km = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function tick() {
  if (!data) return;
  const s = data.live.running ? data.live.seconds + Math.floor((Date.now() - fetchedAt) / 1000) : data.live.seconds;
  $('sportClock').textContent = clock(s);
}

function render() {
  const { live, log, totals } = data;
  fetchedAt = Date.now();
  $('sportUrl').textContent = location.origin + '/sport';
  $('sportShow').textContent = live.show ? 'Ausblenden' : 'Einblenden';
  $('sportShow').classList.toggle('ghost', live.show);
  $('sportState').textContent = live.show ? (live.running ? 'läuft · im Stream sichtbar' : 'pausiert · im Stream sichtbar') : (live.running ? 'läuft · nicht sichtbar' : 'pausiert · nicht sichtbar');
  $('sportStart').disabled = live.running; $('sportPause').disabled = !live.running;
  // Eingabefelder nur füllen, wenn man gerade nicht darin tippt
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  set('sportTitle', live.title); set('sportHr', live.heartRate || ''); set('sportKm', live.distanceKm ? String(live.distanceKm).replace('.', ',') : ''); set('sportKcal', live.calories || ''); set('sportMinutes', '');
  $('sportTotals').textContent = totals.count
    ? `${totals.count} ${totals.count === 1 ? 'Einheit' : 'Einheiten'} · ${fmtTime(totals.seconds)} · ${km(totals.distanceKm)} km · ${totals.calories.toLocaleString('de-DE')} kcal${totals.heartRate ? ` · Ø Puls ${totals.heartRate}` : ''}`
    : 'Noch keine gespeicherten Einheiten.';
  $('sportLog').innerHTML = log.length ? `<table><thead><tr><th>Datum</th><th>Titel</th><th>Zeit</th><th>Ø Puls</th><th>Strecke</th><th>Kalorien</th><th></th></tr></thead><tbody>${log.map((e) => `
    <tr data-id="${esc(e.id)}"><td>${esc(new Date(e.day + 'T12:00:00').toLocaleDateString('de-DE'))}</td><td>${esc(e.title)}</td><td>${fmtTime(e.seconds)}</td><td>${e.heartRate || '–'}</td><td>${km(e.distanceKm)} km</td><td>${e.calories} kcal</td><td><button data-act="del" class="danger">Löschen</button></td></tr>`).join('')}</tbody></table>` : '';
  tick();
}

const fields = () => ({ title: $('sportTitle').value, minutes: $('sportMinutes').value, heartRate: $('sportHr').value, distanceKm: $('sportKm').value, calories: $('sportKcal').value });
const apply = (res) => { data = res; render(); };

export async function loadSport() { apply(await api('GET', 'sport')); }

export function initSport() {
  setInterval(tick, 500);
  $('sportShow').addEventListener('click', run(async () => apply(await api('PUT', 'sport/live', { show: !data.live.show }))));
  for (const [id, action] of [['sportStart', 'start'], ['sportPause', 'pause']]) $(id).addEventListener('click', run(async () => apply(await api('POST', 'sport/timer', { action }))));
  $('sportReset').addEventListener('click', run(async () => {
    if (!confirm('Stoppuhr und alle Zahlen der aktuellen Einheit auf 0 setzen? Es wird nichts im Verlauf gespeichert.')) return;
    apply(await api('POST', 'sport/timer', { action: 'reset' }));
  }));
  $('sportApply').addEventListener('click', run(async () => { apply(await api('PUT', 'sport/live', fields())); toast('Übernommen ✓'); }));
  $('sportSave').addEventListener('click', run(async () => {
    await api('PUT', 'sport/live', fields()); // Zahlen aus den Feldern gelten mit
    apply(await api('POST', 'sport/save', {})); toast('Einheit gespeichert ✓');
  }));
  onAct($('sportLog'), '[data-id]', async (act, row) => {
    if (act === 'del' && confirm('Diese Einheit aus dem Verlauf löschen?')) { apply(await api('DELETE', `sport/log/${row.dataset.id}`)); toast('Gelöscht ✓'); }
  });
}
