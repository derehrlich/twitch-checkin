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
  const bg = c.bgName ? `Hintergrund: ${esc(c.bgName)}${c.bgKind === 'html' ? ' (animierte HTML-Datei)' : ''}` : 'Hintergrund: eingebauter Bauplan';
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
  // Auswählen lädt gleich hoch. Bilder über 800 KB werden vorher im Browser auf höchstens 1920 Pixel Breite verkleinert,
  // damit auch Vermittler (Proxy, Tunnel) mit kleiner Größengrenze nichts abweisen. Fehler bleiben sichtbar stehen.
  const upload = async () => {
    const input = $('ssBg'); let file = input.files[0];
    const err = (msg) => { $('ssErr').textContent = msg ? '⚠️ ' + msg : ''; };
    err('');
    try {
      if (!file) throw new Error('Bitte zuerst eine Datei auswählen');
      const mb = (n) => (n / 1e6).toFixed(1).replace('.', ',') + ' MB';
      $('ssErr').textContent = `Lade „${file.name}“ (${mb(file.size)}) hoch …`;
      if (file.size > 800_000 && file.type.startsWith('image/') && file.type !== 'image/gif') file = await shrink(file);
      const data = await readUpload(file, 8_000_000);
      v = await api('POST', 'startscreen/bg', { name: file.name, data }); render(); input.value = ''; err('');
      toast('Hintergrund hochgeladen ✓');
    } catch (e) { err(`Hochladen von „${(input.files[0] ?? file)?.name ?? ''}“ hat nicht geklappt: ${e.message}`); toast(e.message, true); }
  };
  $('ssBg').addEventListener('change', upload);
  $('ssBgUp').addEventListener('click', upload);
  $('ssBgReset').addEventListener('click', run(async () => { if (!confirm('Eigenen Hintergrund entfernen und wieder den Bauplan zeigen?')) return; v = await api('DELETE', 'startscreen/bg', {}); render(); toast('Bauplan aktiv ✓'); }));
}

// Verkleinert ein Bild auf höchstens 1920 Pixel Breite: erst als PNG (Pixel-Art bleibt scharf), ist das noch über 1,2 MB, als JPG.
async function shrink(file) {
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('Das Bild konnte nicht gelesen werden. Bitte als PNG oder JPG neu abspeichern.'); });
  const k = Math.min(1, 1920 / bmp.width);
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const base = file.name.replace(/\.\w+$/, '');
  const toBlob = (type, q) => new Promise((r) => cv.toBlob(r, type, q));
  let blob = await toBlob('image/png'); let ext = 'png';
  if (!blob || blob.size > 1_200_000) { blob = await toBlob('image/jpeg', 0.9); ext = 'jpg'; }
  if (!blob) throw new Error('Das Bild konnte nicht verkleinert werden.');
  return blob.size < file.size ? new File([blob], `${base}.${ext}`, { type: blob.type }) : file;
}
