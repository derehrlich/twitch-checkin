// Startbildschirm im Reiter „Overlays“: Vorlauf starten, verlängern, beenden, Texte, Anekdoten und Hintergrundbild.
import { $, api, esc, readUpload, run, toast } from './core.js';

let v = null;
const set = (id, val) => { if (document.activeElement !== $(id)) $(id).value = val ?? ''; };

function render() {
  const { config: c, state: s } = v;
  $('ssUrl').textContent = location.origin + '/startscreen';
  $('ssUrl2').textContent = location.origin + '/startscreen?rahmen&bg=0';
  set('ssMin', c.minutes); set('ssRot', c.rotateSeconds); set('ssTitle', c.title); set('ssSub', c.subtitle); set('ssEnd', c.endText); set('ssFacts', c.anecdotes);
  $('ssProg').checked = c.showProgress;
  const bg = c.bgName ? `Hintergrund: ${esc(c.bgName)}` : 'Hintergrund: eingebauter Bauplan';
  const left = s.active ? Math.round((s.until - Date.now()) / 60_000) : 0;
  $('ssInfo').innerHTML = `${bg}. ` + (s.active ? (left > 0 ? `<b>Läuft:</b> noch etwa ${left} Min bis ${new Date(s.until).toLocaleTimeString('de-DE', { timeStyle: 'short' })} Uhr.` : '<b>Läuft:</b> Zeit ist um, der Schlusstext steht. Beenden blendet ihn aus.') : 'Gerade ausgeblendet.');
  $('ssStart').textContent = s.active ? `Neu starten (${c.minutes} Min)` : `Startbildschirm starten (${c.minutes} Min)`;
  $('ssStop').disabled = !s.active; $('ssPlus').disabled = !s.active;
  $('ssBgReset').disabled = !c.bgName;
}

const form = () => ({ minutes: $('ssMin').value, rotateSeconds: $('ssRot').value, title: $('ssTitle').value, subtitle: $('ssSub').value, endText: $('ssEnd').value, showProgress: $('ssProg').checked, anecdotes: $('ssFacts').value });

export async function loadStartscreen() { v = await api('GET', 'startscreen'); render(); }

export function initStartscreen() {
  $('ssSave').addEventListener('click', run(async () => { v = await api('PUT', 'startscreen', form()); render(); toast('Gespeichert ✓'); }));
  // Starten speichert die Felder gleich mit, damit der Vorlauf aus dem Formular gilt
  $('ssStart').addEventListener('click', run(async () => { await api('PUT', 'startscreen', form()); v = await api('POST', 'startscreen/start', { minutes: $('ssMin').value }); render(); toast('Startbildschirm läuft ✓'); }));
  $('ssPlus').addEventListener('click', run(async () => { v = await api('POST', 'startscreen/extend', { minutes: 5 }); render(); toast('5 Minuten dazu ✓'); }));
  $('ssStop').addEventListener('click', run(async () => { v = await api('POST', 'startscreen/stop', {}); render(); toast('Ausgeblendet ✓'); }));
  $('ssDefault').addEventListener('click', run(async () => { if (!confirm('Die Textliste durch die Beispiel-Anekdoten ersetzen? (Erst mit „Texte speichern“ gilt es.)')) return; $('ssFacts').value = v.defaultAnecdotes; }));
  $('ssBgUp').addEventListener('click', run(async () => {
    const file = $('ssBg').files[0];
    const data = await readUpload(file, 3_000_000);
    v = await api('POST', 'startscreen/bg', { name: file.name, data }); render(); toast('Hintergrund hochgeladen ✓');
  }));
  $('ssBgReset').addEventListener('click', run(async () => { if (!confirm('Eigenes Bild entfernen und wieder den Bauplan zeigen?')) return; v = await api('DELETE', 'startscreen/bg', {}); render(); toast('Bauplan aktiv ✓'); }));
}
