// Koch-Overlay im Reiter „Overlays“: Schild einschalten, Countdown stellen.
import { $, api, run, toast } from './core.js';

let k = null;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const when = (ms) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

function render() {
  $('kochenUrl').textContent = location.origin + '/kochen';
  $('kochenCmd').textContent = k.commandOn ? k.command : `${k.command} (noch ausgeschaltet, siehe Chat → Rezept)`;
  const s = k.state;
  $('kochenInfo').innerHTML = s.active
    ? `<b>Schild an:</b> „${esc(s.title || '–')}“${s.countdown ? `, Countdown bis ${when(s.countdown.until)} Uhr` : ''}.`
    : 'Das Schild ist gerade aus.';
  $('kochenStart').textContent = s.active ? 'Gericht ändern' : 'Schild einschalten';
  for (const id of ['kochenStop', 'kochenCdMin', 'kochenCdAt']) $(id).disabled = !s.active;
  $('kochenCdStop').disabled = !s.active || !s.countdown;
}

export async function loadKochen() {
  k = await api('GET', 'kochen');
  if (k.state.active && !$('kochenTitle').value) $('kochenTitle').value = k.state.title;
  render();
}

export function initKochen() {
  const act = (path, body, msg) => run(async () => { k = await api('POST', path, body()); render(); if (msg) toast(msg); });
  $('kochenStart').addEventListener('click', act('kochen/start', () => ({ title: $('kochenTitle').value }), 'Schild läuft ✓'));
  $('kochenStop').addEventListener('click', act('kochen/stop', () => ({}), 'Ausgeblendet ✓'));
  $('kochenCdMin').addEventListener('click', act('kochen/countdown', () => ({ minutes: Number($('kochenMin').value), label: $('kochenLabel').value }), 'Countdown läuft ✓'));
  $('kochenCdAt').addEventListener('click', run(async () => {
    const t = new Date($('kochenAt').value).getTime(); // Ortszeit des Browsers
    if (!Number.isFinite(t)) return toast('Bitte Tag und Uhrzeit wählen');
    if (t < Date.now() + 5000) return toast('Der Zeitpunkt liegt schon in der Vergangenheit');
    k = await api('POST', 'kochen/countdown', { at: t, label: $('kochenLabel').value }); render(); toast('Countdown läuft ✓');
  }));
  $('kochenCdStop').addEventListener('click', act('kochen/countdown/stop', () => ({}), 'Countdown weggenommen ✓'));
}
