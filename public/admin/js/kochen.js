// Koch-Overlay im Reiter „Overlays“: Rezept starten, Schritte weiterschalten, Küchenwecker.
import { $, api, run, toast } from './core.js';

let k = null;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function render() {
  $('kochenUrl').textContent = location.origin + '/kochen';
  const s = k.state;
  $('kochenInfo').innerHTML = s.active
    ? `<b>Läuft:</b> „${esc(s.title)}“, Schritt ${s.steps.length ? s.step + 1 : 0} von ${s.steps.length}${s.timer ? ', Wecker gestellt' : ''}.`
    : 'Gerade läuft kein Rezept.';
  $('kochenStart').textContent = s.active ? 'Rezept ändern' : 'Rezept starten';
  for (const id of ['kochenStop', 'kochenTimerStart', 'kochenTimerStop']) $(id).disabled = !s.active;
  $('kochenPrev').disabled = !s.active || s.step <= 0;
  $('kochenNext').disabled = !s.active || s.step >= s.steps.length - 1;
}

export async function loadKochen() {
  k = await api('GET', 'kochen');
  const s = k.state;
  // Felder nur füllen, wenn ein Rezept läuft und sie noch leer sind, damit nichts Getipptes überschrieben wird
  if (s.active && !$('kochenTitle').value && !$('kochenIng').value && !$('kochenSteps').value) {
    $('kochenTitle').value = s.title; $('kochenIng').value = s.ingredients.join('\n'); $('kochenSteps').value = s.steps.join('\n');
  }
  render();
}

export function initKochen() {
  const post = (path, body, msg) => run(async () => { k = await api('POST', path, body ?? {}); render(); if (msg) toast(msg); });
  $('kochenStart').addEventListener('click', run(async () => {
    k = await api('POST', 'kochen/start', { title: $('kochenTitle').value, ingredients: $('kochenIng').value, steps: $('kochenSteps').value }); render(); toast('Rezept läuft ✓');
  }));
  $('kochenNext').disabled = !s.active || s.step >= s.steps.length - 1;
}

export async function loadKochen() {
  k = await api('GET', 'kochen');
  const s = k.state;
  // Felder nur füllen, wenn ein Rezept läuft und sie noch leer sind, damit nichts Getipptes überschrieben wird
  if (s.active && !$('kochenTitle').value && !$('kochenIng').value && !$('kochenSteps').value) {
    $('kochenTitle').value = s.title; $('kochenIng').value = s.ingredients.join('\n'); $('kochenSteps').value = s.steps.join('\n');
  }
  render();
}

export function initKochen() {
  const post = (path, body, msg) => run(async () => { k = await api('POST', path, body ?? {}); render(); if (msg) toast(msg); });
  $('kochenStart').addEventListener('click', post('kochen/start', undefined, 'Rezept läuft ✓').constructor === Function ? run(async () => {
    k = await api('POST', 'kochen/start', { title: $('kochenTitle').value, ingredients: $('kochenIng').value, steps: $('kochenSteps').value }); render(); toast('Rezept läuft ✓');
  }) : null);
  $('kochenNext').addEventListener('click', post('kochen/next'));
  $('kochenPrev').addEventListener('click', post('kochen/prev'));
  $('kochenStop').addEventListener('click', post('kochen/stop', {}, 'Beendet ✓'));
  $('kochenTimerStart').addEventListener('click', run(async () => {
    k = await api('POST', 'kochen/timer', { minutes: Number($('kochenTimerMin').value), label: $('kochenTimerLabel').value }); render(); toast('Wecker läuft ✓');
  }));
  $('kochenTimerStop').addEventListener('click', post('kochen/timer/stop', {}, 'Wecker gestoppt ✓'));
}
