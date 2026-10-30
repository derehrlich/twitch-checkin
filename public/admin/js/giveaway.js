// Gewinnspiele-Reiter: anlegen und bearbeiten, Live-Rangliste, Streams verwalten, Ziehung und Auswertung.
import { $, api, esc, onAct, run, toast } from './core.js';

let current = null; // zuletzt geladenes Detail
let prizes = [];
const WEEKDAYS = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [0, 'So']];
const fmtDate = (d) => `${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const money = (v) => `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
const num = (v, digits = 1) => (v == null ? '–' : Number(v).toLocaleString('de-DE', { maximumFractionDigits: digits }));
const FIELD_IDS = { minStreams: 'gwMinStreams', minWeeks: 'gwMinWeeks', checkinPts: 'gwCheckinPts', chatPts: 'gwChatPts', chatMinMsgs: 'gwChatMinMsgs', chatMinSpanMin: 'gwChatMinSpanMin', highPts: 'gwHighPts', chatHighMsgs: 'gwChatHighMsgs', streakBonus: 'gwStreakBonus' };

export async function loadGiveaways(selectId) {
  const { giveaways, defaults } = await api('GET', 'giveaway');
  const keep = selectId ?? $('gwSelect').value;
  $('gwSelect').innerHTML = giveaways.length ? giveaways.map((g) => `<option value="${esc(g.id)}">${esc(g.name)} (${fmtDate(g.start)}–${fmtDate(g.end)})</option>`).join('') : '<option value="">Noch kein Gewinnspiel</option>';
  $('gwSelect').dataset.defaults = JSON.stringify(defaults);
  if (giveaways.some((g) => g.id === keep)) $('gwSelect').value = keep;
  await loadDetail();
}

async function loadDetail() {
  const id = $('gwSelect').value;
  $('gwBody').classList.toggle('hidden', !id);
  if (!id) { current = null; return; }
  current = await api('GET', `giveaway/${id}`);
  renderForm(current.giveaway);
  $('gwAnnouncement').value = current.announcement;
  $('gwAnnWarn').textContent = current.announcementWarning ? '⚠️ Im Text fehlt der Hinweis, dass die Teilnahme kostenlos ist und Abos und Bits keinen Einfluss haben. Bitte ergänzen.' : '✅ Enthält den Hinweis: Teilnahme kostenlos, Abos und Bits ohne Einfluss.';
  $('gwObsUrl').textContent = `${location.origin}/gewinnspiel`;
  renderRows(); renderStreams(); renderDraw(); renderEval();
}

// ---- Formular

function renderForm(g) {
  $('gwName').value = g.name; $('gwStart').value = g.start; $('gwEnd').value = g.end;
  for (const [k, id] of Object.entries(FIELD_IDS)) $(id).value = g[k];
  $('gwNeedsCheckin').checked = g.chatNeedsCheckin;
  $('gwCmpFrom').value = g.compareFrom ?? ''; $('gwCmpTo').value = g.compareTo ?? '';
  $('gwFixed').innerHTML = WEEKDAYS.map(([d, l]) => `<label class="check"><input type="checkbox" data-day="${d}" ${g.fixedDays.includes(d) ? 'checked' : ''}> ${l}</label>`).join('');
  prizes = g.prizes.map((p) => ({ ...p }));
  renderPrizes();
}

function renderPrizes() {
  $('gwPrizes').innerHTML = prizes.map((p, i) => `<div class="row" data-i="${i}"><div><label>Platz ${i + 1}</label><input data-f="title" value="${esc(p.title)}" maxlength="120"></div><div style="flex:0 1 150px"><label>Kosten (€)</label><input data-f="cost" type="number" min="0" step="0.01" value="${esc(p.cost)}"></div><button data-act="rm" class="ghost">Entfernen</button></div>`).join('');
}

function readForm() {
  const body = { name: $('gwName').value, start: $('gwStart').value, end: $('gwEnd').value, chatNeedsCheckin: $('gwNeedsCheckin').checked, compareFrom: $('gwCmpFrom').value, compareTo: $('gwCmpTo').value, announcement: $('gwAnnouncement').value };
  for (const [k, id] of Object.entries(FIELD_IDS)) body[k] = $(id).value;
  body.fixedDays = [...$('gwFixed').querySelectorAll('input:checked')].map((i) => Number(i.dataset.day));
  body.prizes = [...$('gwPrizes').querySelectorAll('[data-i]')].map((r) => ({ title: r.querySelector('[data-f=title]').value, cost: r.querySelector('[data-f=cost]').value }));
  return body;
}

// ---- Anzeige

function renderRows() {
  const { rows, totals } = current;
  $('gwStats').innerHTML = [[totals.people, 'Personen mit Punkten'], [totals.qualified, 'Qualifiziert'], [totals.points, 'Lose im Topf'], [money(totals.cost), 'Preiskosten']]
    .map(([v, l]) => `<div class="stat"><b>${v}</b><span class="muted">${l}</span></div>`).join('');
  $('gwRows').innerHTML = rows.length ? rows.map((r, i) =>
    `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td><b>${r.points}</b></td><td>${r.checkins}</td><td>${r.weeks}</td><td>${r.chatPts}</td><td>${r.streakPts}</td><td>${r.qualified ? '✅ qualifiziert' : `noch ${r.missingStreams ? `${r.missingStreams} Stream(s)` : ''}${r.missingStreams && r.missingWeeks ? ', ' : ''}${r.missingWeeks ? `${r.missingWeeks} Woche(n)` : ''}`}</td><td>${r.qualified ? `${num(r.chance)} %` : '–'}</td></tr>`).join('')
    : '<tr><td colspan="9" class="muted">Noch keine Punkte im Zeitraum.</td></tr>';
}

function renderStreams() {
  $('gwStreams').innerHTML = current.streams.map((s) =>
    `<tr data-day="${esc(s.day)}"><td>${s.weekday} ${fmtDate(s.day)}</td><td>${esc(s.status)}</td><td>${s.fixed ? 'ja' : '–'}</td><td>${s.checkins || '–'}</td><td>${num(s.avgViewers)}</td><td>${num(s.peak, 0)}</td><td>${
      s.cancelled ? '<button data-act="restore" class="ghost">Zurücknehmen</button>' : s.status === 'gestreamt' || s.status === 'geplant' ? '<button data-act="cancel" class="ghost">Als ausgefallen markieren</button>' : ''}</td></tr>`).join('')
    || '<tr><td colspan="7" class="muted">Noch keine Streams im Zeitraum.</td></tr>';
}

function renderDraw() {
  const { draws } = current;
  const last = draws.at(-1);
  const placesDone = last?.winners.length ?? 0;
  $('gwDraw').textContent = last && !last.done ? `Platz ${placesDone + 1} ziehen` : last ? 'Ziehung abgeschlossen' : 'Platz 1 ziehen';
  $('gwDraw').disabled = Boolean(last?.done);
  $('gwDrawFresh').classList.toggle('hidden', !last?.done);
  const view = (d) => `<ol>${d.winners.map((w) => `<li><b>Platz ${w.place}: ${esc(w.name)}</b> – ${esc(w.prize)} <span class="muted">(${w.points} Punkte, ${num(w.chance)} % Chance bei ${w.pool} im Topf)</span></li>`).join('')}</ol>`;
  $('gwWinners').innerHTML = last ? `<h3>Aktuelle Ziehung vom ${new Date(last.at).toLocaleString('de-DE')}</h3>${view(last)}` : '';
  $('gwLog').innerHTML = draws.length ? draws.slice().reverse().map((d) => `<details><summary>${new Date(d.at).toLocaleString('de-DE')} – ${d.winners.length} von ${d.places} Plätzen${d.done ? '' : ' (nicht beendet)'}</summary>${view(d)}<p class="muted">Teilnehmer beim Start (${d.participants.length}): ${d.participants.map((p) => `${esc(p.name)} ${p.points}`).join(' · ')}</p></details>`).join('') : '<p class="muted">Noch keine Ziehung.</p>';
}

const EVAL_ROWS = [['streams', 'Streams', 0], ['avgViewers', 'Ø Zuschauer', 1], ['peakViewers', 'Spitze Zuschauer', 0], ['messages', 'Chatnachrichten', 0], ['chatters', 'Verschiedene Chatter', 0], ['checkins', 'Check-ins', 0], ['returning', 'Wiederkehrende Zuschauer (mind. 3 Streams)', 0], ['followers', 'Follower-Zuwachs', 0]];

function renderEval() {
  const e = current.evaluation;
  $('gwEvalInfo').textContent = `Gewinnspiel ${fmtDate(e.period.from)}–${fmtDate(e.period.to)} im Vergleich zu ${fmtDate(e.compare.from)}–${fmtDate(e.compare.to)}. Die Zahlen hängen auch von der Anzahl der Streams ab, deshalb steht sie oben.`;
  $('gwEvalNow').textContent = 'Gewinnspiel'; $('gwEvalBefore').textContent = 'Vergleich';
  $('gwEval').innerHTML = EVAL_ROWS.map(([k, label, digits]) => {
    const a = e.now[k], b = e.before[k];
    const d = a != null && b != null ? a - b : null;
    return `<tr><td>${label}</td><td>${num(a, digits)}</td><td>${num(b, digits)}</td><td>${d == null ? '–' : `${d > 0 ? '+' : ''}${num(d, digits)}`}</td></tr>`;
  }).join('');
  $('gwCosts').innerHTML = [[money(e.cost), 'Kosten (Summe der Preise)'], [e.perFollower == null ? '–' : money(e.perFollower), 'Kosten pro neuem Follower'], [e.perReturning == null ? '–' : money(e.perReturning), 'Kosten pro zusätzlichem wiederkehrendem Zuschauer']]
    .map(([v, l]) => `<div class="stat"><b>${v}</b><span class="muted">${l}</span></div>`).join('');
}

// ---- Aktionen

export function initGiveaway() {
  $('gwSelect').addEventListener('change', run(loadDetail));
  $('gwNew').addEventListener('click', run(async () => {
    const d = JSON.parse($('gwSelect').dataset.defaults || '{}');
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const pad = (n) => String(n).padStart(2, '0');
    const last = new Date(y, m + 1, 0).getDate();
    const res = await api('POST', 'giveaway', { ...d, name: `Gewinnspiel ${now.toLocaleString('de-DE', { month: 'long', year: 'numeric' })}`, start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(last)}`,
      prizes: [{ title: 'Enshrouded Premium Edition (Key)', cost: 10 }, { title: 'Wunschbau im Stream', cost: 0 }, { title: 'Namensschild / Namenswand im Spiel', cost: 0 }] });
    await loadGiveaways(res.id); toast('Gewinnspiel angelegt ✓ – bitte Zeitraum und Preise prüfen');
  }));
  $('gwAddPrize').addEventListener('click', () => { prizes = readForm().prizes; prizes.push({ title: '', cost: 0 }); renderPrizes(); });
  onAct($('gwPrizes'), '[data-i]', (act, row) => { prizes = readForm().prizes; prizes.splice(Number(row.dataset.i), 1); renderPrizes(); });
  $('gwSave').addEventListener('click', run(async () => { await api('PUT', `giveaway/${$('gwSelect').value}`, readForm()); await loadGiveaways(); toast('Gespeichert ✓'); }));
  $('gwDelete').addEventListener('click', run(async () => {
    if (!confirm('Dieses Gewinnspiel löschen? Das geht nur, solange noch nicht gezogen wurde.')) return;
    await api('DELETE', `giveaway/${$('gwSelect').value}`); await loadGiveaways(''); toast('Gelöscht ✓');
  }));
  $('gwAnnReset').addEventListener('click', () => { $('gwAnnouncement').value = current.defaultAnnouncement; $('gwAnnWarn').textContent = 'Vorlage eingesetzt – zum Übernehmen speichern.'; });
  $('gwAnnChat').addEventListener('click', run(async () => {
    await api('PUT', `giveaway/${$('gwSelect').value}`, readForm());
    await api('POST', `giveaway/${$('gwSelect').value}/announce`, {});
    toast('Im Chat gepostet ✓');
  }));
  onAct($('gwStreams'), 'tr[data-day]', async (act, row) => {
    await api('PUT', `giveaway/${$('gwSelect').value}/stream`, { day: row.dataset.day, cancelled: act === 'cancel' });
    await loadDetail(); toast(act === 'cancel' ? 'Als ausgefallen markiert ✓' : 'Zurückgenommen ✓');
  });
  const draw = (fresh) => run(async () => {
    if (fresh && !confirm('Eine neue Ziehung starten? Die bisherige bleibt im Protokoll.')) return;
    const res = await api('POST', `giveaway/${$('gwSelect').value}/draw`, { fresh });
    await loadDetail();
    if (res.winner) toast(`Platz ${res.winner.place}: ${res.winner.name} 🎉`);
  });
  $('gwDraw').addEventListener('click', draw(false));
  $('gwDrawFresh').addEventListener('click', draw(true));
}
