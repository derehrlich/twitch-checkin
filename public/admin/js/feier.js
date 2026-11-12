// Reiter „Geburtstagswoche“: Countdown und Glücksrad.
import { $, api, esc, run, toast } from './core.js';

let cd = null, rad = null, selected = null;
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' }) : '–');
const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v ?? ''; };

function renderCountdown() {
  const { config } = cd;
  $('cdUrl').textContent = location.origin + '/countdown';
  set('cdTitle', config.title); set('cdTarget', config.target); set('cdEnd', config.endText); set('cdHold', config.holdMinutes);
  $('cdShow').textContent = config.show ? 'Ausblenden' : 'Einblenden';
  $('cdShow').classList.toggle('ghost', config.show);
  $('cdInfo').textContent = config.target ? `Ziel: ${new Date(cd.view.target).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' })} (${cd.timezone}). Dieselbe Zeit nutzt der Geburtstags-Befehl.` : 'Noch keine Zielzeit gesetzt, so bleibt der Countdown unsichtbar.';
}

function currentWheel() { return rad.wheels.find((w) => w.id === selected) ?? null; }

function renderRad() {
  $('radUrl').textContent = location.origin + '/rad';
  if (!rad.wheels.some((w) => w.id === selected)) selected = rad.state.wheelId && rad.wheels.some((w) => w.id === rad.state.wheelId) ? rad.state.wheelId : rad.wheels[0]?.id ?? null;
  $('radSel').innerHTML = rad.wheels.length ? rad.wheels.map((w) => `<option value="${esc(w.id)}"${w.id === selected ? ' selected' : ''}>${esc(w.name)}${w.id === rad.state.wheelId ? ' (im Stream)' : ''}</option>`).join('') : '<option value="">Noch kein Rad</option>';
  const live = rad.state.wheelId === selected;
  $('radShow').textContent = rad.state.show ? 'Ausblenden' : 'Einblenden';
  $('radShow').classList.toggle('ghost', rad.state.show);
  $('radSpin').disabled = !rad.wheels.length;
  const w = currentWheel();
  const spin = rad.state.spin;
  $('radLast').innerHTML = spin ? `Letztes Ergebnis: <b>${esc(spin.label)}</b> (${esc(rad.wheels.find((x) => x.id === spin.wheelId)?.name ?? '')}, ${fmt(new Date(spin.startedAt).toISOString())})${live ? '' : ' · gewähltes Rad ist noch nicht im Stream, es wird beim Drehen eingeblendet'}` : (live ? 'Noch nicht gedreht.' : 'Das gewählte Rad kommt beim Drehen in den Stream.');
  $('radHistory').innerHTML = rad.state.history.length ? 'Verlauf: ' + rad.state.history.slice(0, 12).map((h) => `${esc(h.wheel)}: <b>${esc(h.label)}</b>`).join(' · ') + ' <button class="ghost" id="radClear">Verlauf leeren</button>' : '';
  if (w) { set('radName', w.name); $('radRemove').checked = w.removeWon; set('radSegs', w.segmentsText); }
  for (const id of ['radSave', 'radReset', 'radDelete']) $(id).disabled = !w;
}

const applyCd = (r) => { cd = r; renderCountdown(); };
const applyRad = (r) => { rad = r; renderRad(); };
export async function loadFeier() { applyCd(await api('GET', 'feier/countdown')); applyRad(await api('GET', 'feier/rad')); }

export function initFeier() {
  $('cdShow').addEventListener('click', run(async () => applyCd(await api('PUT', 'feier/countdown', { show: !cd.config.show }))));
  $('cdSave').addEventListener('click', run(async () => { applyCd(await api('PUT', 'feier/countdown', { title: $('cdTitle').value, target: $('cdTarget').value, endText: $('cdEnd').value, holdMinutes: $('cdHold').value })); toast('Gespeichert ✓'); }));
  $('radSel').addEventListener('change', run(async () => { selected = $('radSel').value; renderRad(); }));
  $('radSpin').addEventListener('click', run(async () => {
    if (selected && selected !== rad.state.wheelId) applyRad(await api('PUT', 'feier/rad/state', { wheelId: selected }));
    applyRad(await api('POST', 'feier/rad/spin', {})); toast('Das Rad dreht sich 🎡');
  }));
  $('radShow').addEventListener('click', run(async () => {
    const next = !rad.state.show;
    if (next && selected && selected !== rad.state.wheelId) applyRad(await api('PUT', 'feier/rad/state', { wheelId: selected }));
    applyRad(await api('PUT', 'feier/rad/state', { show: next }));
  }));
  $('radSave').addEventListener('click', run(async () => { applyRad(await api('PUT', `feier/rad/wheel/${selected}`, { name: $('radName').value, removeWon: $('radRemove').checked, segments: $('radSegs').value })); toast('Rad gespeichert ✓'); }));
  $('radReset').addEventListener('click', run(async () => { applyRad(await api('POST', `feier/rad/wheel/${selected}/reset`, {})); toast('Alle Felder wieder frei ✓'); }));
  $('radDelete').addEventListener('click', run(async () => { if (confirm(`Rad „${currentWheel().name}“ löschen?`)) { applyRad(await api('DELETE', `feier/rad/wheel/${selected}`)); toast('Gelöscht ✓'); } }));
  $('radNew').addEventListener('click', run(async () => { applyRad(await api('POST', 'feier/rad/wheel', { name: $('radNewName').value })); selected = rad.wheels.at(-1).id; $('radNewName').value = ''; renderRad(); toast('Rad angelegt ✓ Jetzt die Felder eintragen'); }));
  $('radExamples').addEventListener('click', run(async () => { applyRad(await api('POST', 'feier/rad/examples', {})); toast('Beispielräder angelegt ✓'); }));
  $('radHistory').addEventListener('click', run(async (e) => { if (e.target.id === 'radClear') applyRad(await api('DELETE', 'feier/rad/history')); }));
}
