// Seite „Umfragen“: Umfrage starten und beenden, Stand mit Balken, die letzten Umfragen.
import { $, api, esc, run, toast } from './core.js';

let data = null, timer = null;
const when = (ms) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
const pct = (v, total) => (total ? Math.round((v / total) * 100) : 0);

function bars(s) {
  return s.options.map((o, i) => `<div style="margin:8px 0"><div style="display:flex; justify-content:space-between; gap:12px"><span><b>${i + 1}</b> ${esc(o.label)}</span><span class="muted">${o.votes} (${pct(o.votes, s.total)} %)</span></div><progress max="100" value="${pct(o.votes, s.total)}" style="width:100%" aria-label="${esc(o.label)}"></progress></div>`).join('');
}

function render() {
  const d = data;
  $('pollHint').classList.toggle('hidden', d.enabled);
  $('pollUrl').textContent = location.origin + '/umfrage';
  $('pollCmdHelp').innerHTML = `Im Chat geht es auch: <code>${esc(d.command)} 3 Welches Spiel? | Enshrouded | Satisfactory</code> (nur Mods und du, die Zahl vorn sind Minuten) und <code>${esc(d.endCommand)}</code> zum Beenden.`;
  if (document.activeElement !== $('pollMin') && !$('pollMin').value) $('pollMin').value = d.minutes;
  const s = d.state;
  $('pollEnd').disabled = !s?.open; $('pollHide').disabled = !s;
  if (!s) $('pollNow').innerHTML = '<p class="muted" style="margin:0">Gerade läuft keine Umfrage.</p>';
  else {
    const left = Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000));
    $('pollNow').innerHTML = `<p style="margin:0 0 4px"><b>${esc(s.question)}</b></p><p class="muted" style="margin:0 0 8px">${s.open ? `● läuft, noch ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ${s.total} Stimmen` : `beendet · ${s.total} Stimmen`}</p>${bars(s)}`;
  }
  $('pollHistory').innerHTML = d.history.length
    ? `<div style="overflow-x:auto"><table class="tk"><thead><tr><th>Wann</th><th>Frage</th><th>Ergebnis</th></tr></thead><tbody>${d.history.map((h) => `<tr><td>${esc(when(h.startedAt))}</td><td>${esc(h.question)}</td><td>${h.total ? esc(h.result) : '<span class="muted">niemand hat abgestimmt</span>'}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Noch keine Umfrage beendet.</p>';
  // Solange eine Umfrage läuft und die Seite offen ist, alle 3 Sekunden aktualisieren
  clearInterval(timer); timer = null;
  if (s?.open && !$('app').classList.contains('hidden') && !document.querySelector('[data-panel=umfrage]').classList.contains('hidden')) timer = setInterval(() => load().catch(() => {}), 3000);
}

async function load() { data = await api('GET', 'umfrage'); render(); }
export const loadPoll = load;

export function initPoll() {
  $('pollStart').addEventListener('click', run(async () => {
    data = await api('POST', 'umfrage/start', { question: $('pollQ').value, optionsText: $('pollOpts').value, minutes: $('pollMin').value });
    $('pollQ').value = ''; $('pollOpts').value = ''; render(); toast('Umfrage läuft ✓');
  }));
  $('pollEnd').addEventListener('click', run(async () => { data = await api('POST', 'umfrage/end', {}); render(); toast('Beendet ✓'); }));
  $('pollHide').addEventListener('click', run(async () => { if (!confirm('Die Umfrage aus dem Stream nehmen? Eine laufende Umfrage wird verworfen.')) return; data = await api('POST', 'umfrage/hide', {}); render(); toast('Ausgeblendet ✓'); }));
  document.addEventListener('admin:tab', (e) => { if (e.detail === 'umfrage') load().catch(() => {}); else { clearInterval(timer); timer = null; } });
  document.addEventListener('admin:settings', () => { if (data) load().catch(() => {}); });
}
