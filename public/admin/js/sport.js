// Sport-Reiter: Einheiten eintragen und löschen, Scoreboard ein- und ausblenden.
import { $, api, esc, onAct, run, toast } from './core.js';

let data = null;
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} Std ${pad(m)} Min` : `${m} Min`; };
const km = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toLocaleDateString('en-CA');

function render() {
  const { config, log, totals } = data;
  $('sportUrl').textContent = location.origin + '/sport';
  $('sportShow').textContent = config.show ? 'Ausblenden' : 'Einblenden';
  $('sportShow').classList.toggle('ghost', config.show);
  if (document.activeElement !== $('sportTitle')) $('sportTitle').value = config.title;
  $('sportPeriod').value = config.period;
  $('sportTotals').textContent = totals.count
    ? `Alle: ${totals.count} ${totals.count === 1 ? 'Einheit' : 'Einheiten'} · ${fmtTime(totals.seconds)} · ${km(totals.distanceKm)} km · ${totals.calories.toLocaleString('de-DE')} kcal${totals.heartRate ? ` · Ø Puls ${totals.heartRate}` : ''}`
    : 'Noch keine Einheiten eingetragen.';
  $('sportLog').innerHTML = log.length ? `<table><thead><tr><th>Datum</th><th>Art</th><th>Zeit</th><th>Ø Puls</th><th>Strecke</th><th>Kalorien</th><th></th></tr></thead><tbody>${log.map((e) => `
    <tr data-id="${esc(e.id)}"><td>${esc(new Date(e.day + 'T12:00:00').toLocaleDateString('de-DE'))}</td><td>${esc(e.title)}</td><td>${fmtTime(e.seconds)}</td><td>${e.heartRate || '–'}</td><td>${km(e.distanceKm)} km</td><td>${e.calories} kcal</td><td><button data-act="del" class="danger">Löschen</button></td></tr>`).join('')}</tbody></table>` : '';
}

const apply = (res) => { data = res; render(); };
export async function loadSport() { apply(await api('GET', 'sport')); if (!$('sportDay').value) $('sportDay').value = today(); }

export function initSport() {
  $('sportShow').addEventListener('click', run(async () => apply(await api('PUT', 'sport/config', { show: !data.config.show }))));
  $('sportCfg').addEventListener('click', run(async () => { apply(await api('PUT', 'sport/config', { title: $('sportTitle').value, period: $('sportPeriod').value })); toast('Gespeichert ✓'); }));
  $('sportAdd').addEventListener('click', run(async () => {
    apply(await api('POST', 'sport/log', { day: $('sportDay').value, title: $('sportName').value, minutes: $('sportMinutes').value, heartRate: $('sportHr').value, distanceKm: $('sportKm').value, calories: $('sportKcal').value }));
    for (const id of ['sportMinutes', 'sportHr', 'sportKm', 'sportKcal']) $(id).value = '';
    toast('Eingetragen ✓');
  }));
  onAct($('sportLog'), '[data-id]', async (act, row) => {
    if (act === 'del' && confirm('Diese Einheit löschen?')) { apply(await api('DELETE', `sport/log/${row.dataset.id}`)); toast('Gelöscht ✓'); }
  });
}
