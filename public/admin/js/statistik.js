// Seite „Twitch-Statistik“: Rückblick auf den letzten Stream, Zahlen, Säulen je Stream, Follower-Verlauf und Liste der Streams. Zeigt nur an, speichert nichts außer dem Löschen.
import { $, api, esc, onAct, run, toast } from './core.js';
import { barChart, fmtNum, lineChart, wireTips } from './charts.js';

let data = null, reviewShown = false; // reviewShown: ein älterer Stream wurde gewählt
const day = (iso) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const when = (iso) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)} Std ${String(min % 60).padStart(2, '0')} Min` : `${min} Min`);
const stat = (v, label) => `<div class="stat"><b>${v}</b><span class="muted">${label}</span></div>`;
const plus = (n) => (n == null ? '–' : `${n > 0 ? '+' : ''}${fmtNum(n)}`);

const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} Std`;
function reviewHtml(r) {
  const cmp = r.compare ? (r.compare.percent === 0 ? 'so viele wie sonst' : `${r.compare.percent > 0 ? '▲' : '▼'} ${Math.abs(r.compare.percent)} % ${r.compare.percent > 0 ? 'mehr' : 'weniger'} als sonst (Ø ${fmtNum(r.compare.avg)} in den ${r.compare.streams} Streams davor)`) : 'noch kein Vergleich möglich';
  const sentence = `${r.open ? 'Du bist gerade live' : `Du warst ${dur(r.minutes)} live`}${r.game ? ` mit ${esc(r.game)}` : ''}. Im Schnitt schauten ${fmtNum(r.avg)} zu, am meisten waren ${r.peak} da${r.peakMinute != null && r.minutes > 2 ? ` (${hm(r.peakMinute)} nach dem Start)` : ''}.`;
  const e = r.events, followers = r.followerPlus;
  const tiles = stat(dur(r.minutes), 'Dauer') + `<div class="stat"><b>${fmtNum(r.avg)}</b><span class="muted">Ø Zuschauer<br>${cmp}</span></div>` + stat(r.peak, 'Rekord') + stat(plus(followers), 'neue Follower') + stat(r.checkins, 'Check-ins am Stream-Tag') + stat(r.chat.measured ? r.chat.chatters : '–', r.chat.measured ? `Chatter (${fmtNum(r.chat.messages)} Nachrichten)` : 'Chatter');
  const chatters = r.chat.measured
    ? (r.chat.top.length ? `<ol class="top-list">${r.chat.top.map((u) => `<li><b>${esc(u.name)}</b><span class="muted">${fmtNum(u.n)} Nachrichten</span></li>`).join('')}</ol>` : '<p class="muted">Niemand hat geschrieben.</p>')
    : '<p class="muted">Für diesen Stream wurde der Chat noch nicht gezählt. Das gibt es erst seit dem Update, ab dem nächsten Stream steht es hier.</p>';
  const happened = [e.follows && `${e.follows} neue${e.follows === 1 ? 'r Follower' : ' Follower'}`, e.subs && `${e.subs} ${e.subs === 1 ? 'Abo' : 'Abos'}`, e.gifts && `${e.gifts} verschenkte Abos`, e.bits && `${fmtNum(e.bits)} Bits`].filter(Boolean);
  const raids = e.raids.length ? `<p style="margin:8px 0 0"><b>Raids:</b> ${e.raids.map((x) => `${esc(x.name)} (${x.viewers} Zuschauer)`).join(', ')}</p>` : '';
  const curve = r.curve.length > 1 ? lineChart(r.curve.map(([min, v]) => ({ label: hm(min), value: v, tip: `<b>${hm(min)} nach Start</b><br>${v} Zuschauer` })), 'Zuschauer im Verlauf des Streams') : '<p class="muted">Für einen Verlauf war der Stream zu kurz.</p>';
  return `<p style="margin:0 0 4px"><b>${esc(when(r.startedAt))}</b>${r.title ? `: ${esc(r.title)}` : ''}</p><p class="muted" style="margin:0 0 12px">${sentence}</p>
    <div class="stats">${tiles}</div>
    <div class="grid2" style="margin-top:14px"><div><h3>Aktivste Chatter</h3>${chatters}</div>
      <div><h3>Was sonst passiert ist</h3>${happened.length ? `<p style="margin:0">${happened.join(' · ')}</p>` : '<p class="muted" style="margin:0">Keine neuen Follower, Abos oder Bits in dieser Zeit.</p>'}${raids}</div></div>
    <h3>Zuschauer im Verlauf</h3>${curve}`;
}
function renderReview(r, title) {
  $('stReviewTitle').textContent = title;
  $('stReview').innerHTML = r ? reviewHtml(r) : '<p class="muted">Noch kein Stream gemessen. Nach dem nächsten Stream steht hier die Zusammenfassung.</p>';
}

function render() {
  const d = data;
  $('stHint').classList.toggle('hidden', d.enabled);
  if (!reviewShown) renderReview(d.latest, d.latest?.open ? 'Rückblick: der Stream läuft gerade' : 'Rückblick auf den letzten Stream');
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
    ? `<div style="overflow-x:auto"><table class="tk"><thead><tr><th>Datum</th><th>Titel</th><th>Spiel</th><th>Dauer</th><th>Spitze</th><th>Ø</th><th>Follower</th><th></th></tr></thead><tbody>${d.sessions.map((s) => `<tr data-id="${esc(s.id)}"><td>${esc(when(s.startedAt))}</td><td>${esc(s.title)}</td><td>${esc(s.game)}</td><td>${dur(s.minutes)}${s.open ? ' ●' : ''}</td><td>${s.peak}</td><td>${fmtNum(s.avg)}</td><td>${plus(s.followerPlus)}</td><td class="tk-act"><button data-act="review" class="ghost">Rückblick</button><button data-act="del" class="danger">Löschen</button></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Noch nichts vorhanden.</p>';
}

export async function loadStats() { data = await api('GET', 'stats'); reviewShown = false; render(); }

export function initStats() {
  wireTips($('stBars')); wireTips($('stFollowers')); wireTips($('stReview'));
  $('stCheck').addEventListener('click', run(async () => { data = await api('POST', 'stats/check', {}); render(); toast('Gemessen ✓'); }));
  onAct($('stList'), '[data-id]', async (act, row) => {
    const id = row.dataset.id;
    if (act === 'review') {
      const r = await api('GET', `stats/${id}`);
      reviewShown = true; renderReview(r, `Rückblick: ${when(r.startedAt)}`);
      $('stReviewCard').scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else if (act === 'del' && confirm('Diesen Stream aus der Statistik löschen?')) { data = await api('DELETE', `stats/${id}`); reviewShown = false; render(); toast('Gelöscht ✓'); }
  });
  document.addEventListener('admin:tab', (e) => { if (e.detail === 'statistik' && data) loadStats().catch(() => {}); });
  document.addEventListener('admin:settings', () => { if (data) loadStats().catch(() => {}); });
}
