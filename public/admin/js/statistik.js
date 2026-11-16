// Seite „Twitch-Statistik“: Zahlen, Säulen je Stream, Follower-Verlauf und Liste der Streams. Zeigt nur an, speichert nichts außer dem Löschen.
import { $, api, esc, onAct, run, toast } from './core.js';
import { barChart, fmtNum, lineChart, wireTips } from './charts.js';

let data = null;
const day = (iso) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const when = (iso) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)} Std ${String(min % 60).padStart(2, '0')} Min` : `${min} Min`);
const stat = (v, label) => `<div class="stat"><b>${v}</b><span class="muted">${label}</span></div>`;
const plus = (n) => (n == null ? '–' : `${n > 0 ? '+' : ''}${fmtNum(n)}`);

function render() {
  const d = data;
  $('stHint').classList.toggle('hidden', d.enabled);
  const t = d.total;
  $('stTotal').innerHTML = stat(t.streams, 'Streams gemessen') + stat(fmtNum(t.hours), 'Stunden gesendet') + stat(fmtNum(t.avg), 'Ø Zuschauer je Stream') + stat(t.peak, 'Rekord') + stat(t.followers != null ? fmtNum(t.followers) : '–', 'Follower') + stat(t.subs != null ? fmtNum(t.subs) : '–', 'Abos');
  $('stState').textContent = !d.enabled ? '' : d.error ? `Letzte Messung fehlgeschlagen: ${d.error}` : d.live ? '● Stream läuft, es wird gemessen.' : d.checkedAt ? `Letzte Messung: ${when(d.checkedAt)}. Gerade läuft kein Stream.` : 'Noch keine Messung. Sie startet innerhalb einer Minute.';
  $('stState').classList.toggle('bad', Boolean(d.error));
  $('stCheck').disabled = !d.enabled;
  const m = d.last30;
  $('stMonth').innerHTML = stat(m.streamDays, 'Streamtage') + stat(fmtNum(m.avgViewers), 'Ø Zuschauer an Streamtagen') + stat(m.maxViewers, 'Rekord') + stat(fmtNum(m.hoursStreamed), 'Stunden gestreamt') + stat(fmtNum(m.hoursWatched), 'Stunden gesehen') + stat(plus(m.newFollowers), 'neue Follower');
  const recent = d.sessions.filter((s) => s.minutes > 0).slice(0, 20).reverse();
  $('stBars').innerHTML = recent.length
    ? barChart(recent.map((s) => ({ label: day(s.startedAt), peak: s.peak, avg: s.avg, tip: `<b>${esc(when(s.startedAt))}</b><br>Höchstwert ${s.peak}<br>Ø ${fmtNum(s.avg)}<br>${dur(s.minutes)}` })), 'Zuschauer pro Stream')
    : '<p class="muted">Noch kein Stream gemessen. Beim nächsten Stream geht es los.</p>';
  $('stFollowers').innerHTML = d.followers.length > 1
    ? lineChart(d.followers.map((f) => ({ label: day(f.date), value: f.followers, tip: `<b>${esc(f.date.split('-').reverse().join('.'))}</b><br>${fmtNum(f.followers)} Follower` })), 'Follower-Verlauf')
    : '<p class="muted">Der Verlauf erscheint, sobald an mindestens zwei Tagen Werte vorliegen.</p>';
  $('stList').innerHTML = d.sessions.length
    ? `<div style="overflow-x:auto"><table class="tk"><thead><tr><th>Datum</th><th>Titel</th><th>Spiel</th><th>Dauer</th><th>Spitze</th><th>Ø</th><th>Follower</th><th></th></tr></thead><tbody>${d.sessions.map((s) => `<tr data-id="${esc(s.id)}"><td>${esc(when(s.startedAt))}</td><td>${esc(s.title)}</td><td>${esc(s.game)}</td><td>${dur(s.minutes)}${s.open ? ' ●' : ''}</td><td>${s.peak}</td><td>${fmtNum(s.avg)}</td><td>${plus(s.followerPlus)}</td><td class="tk-act"><button data-act="curve" class="ghost">Verlauf</button><button data-act="del" class="danger">Löschen</button></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Noch nichts vorhanden.</p>';
}

export async function loadStats() { data = await api('GET', 'stats'); render(); }

export function initStats() {
  wireTips($('stBars')); wireTips($('stFollowers')); wireTips($('stDetail'));
  $('stCheck').addEventListener('click', run(async () => { data = await api('POST', 'stats/check', {}); render(); toast('Gemessen ✓'); }));
  onAct($('stList'), '[data-id]', async (act, row) => {
    const id = row.dataset.id;
    if (act === 'curve') {
      const s = await api('GET', `stats/${id}`);
      const pts = s.curve.map(([min, v]) => ({ label: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} Std`, value: v, tip: `<b>${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} Std nach Start</b><br>${v} Zuschauer` }));
      $('stDetail').innerHTML = `<h3>${esc(when(s.startedAt))}: ${esc(s.title || 'ohne Titel')}</h3>` + (pts.length > 1 ? lineChart(pts, 'Zuschauer im Verlauf des Streams') : '<p class="muted">Für einen Verlauf war der Stream zu kurz.</p>');
      $('stDetail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (act === 'del' && confirm('Diesen Stream aus der Statistik löschen?')) { data = await api('DELETE', `stats/${id}`); $('stDetail').innerHTML = ''; render(); toast('Gelöscht ✓'); }
  });
  document.addEventListener('admin:tab', (e) => { if (e.detail === 'statistik' && data) loadStats().catch(() => {}); });
  document.addEventListener('admin:settings', () => { if (data) loadStats().catch(() => {}); });
}
