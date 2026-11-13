// Pause-Overlay im Reiter „Overlays“: von Hand starten und beenden.
import { $, api, run, toast } from './core.js';

let p = null;

function render() {
  $('pauseUrl').textContent = location.origin + '/pause';
  $('pauseCmd').textContent = p.command; $('pauseEndCmd').textContent = p.endCommand;
  $('pauseText').placeholder = p.defaultText;
  const s = p.state;
  $('pauseInfo').innerHTML = s.active ? `<b>Pause läuft:</b> „${s.text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}“ seit ${new Date(s.startedAt).toLocaleTimeString('de-DE', { timeStyle: 'short' })} Uhr.` : 'Gerade läuft keine Pause.';
  $('pauseStart').textContent = s.active ? 'Text ändern' : 'Pause starten';
  $('pauseStop').disabled = !s.active;
}

export async function loadPause() { p = await api('GET', 'pause'); render(); }

export function initPause() {
  $('pauseStart').addEventListener('click', run(async () => { p = await api('POST', 'pause/start', { text: $('pauseText').value, minutes: $('pauseMin').value }); render(); toast('Pause läuft ✓'); }));
  $('pauseStop').addEventListener('click', run(async () => { p = await api('POST', 'pause/stop', {}); render(); toast('Pause beendet ✓'); }));
}
