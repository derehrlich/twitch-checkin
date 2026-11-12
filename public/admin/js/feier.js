// Reiter „Geburtstagswoche“: Countdown und Glücksrad.
import { $, api, esc, run, toast } from './core.js';

let cd = null, rad = null, selected = null, adv = null;
const STATUS_LABEL = { offen: 'offen', gedreht: 'vom Rad gewählt', gespielt: 'gespielt' };
const SRC = { twitch: '💜 Twitch', discord: '💬 Discord', admin: '✍️ von Hand' };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' }) : '–');
const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v ?? ''; };

function renderCountdown() {
  const { config } = cd;
  $('cdUrl').textContent = location.origin + '/countdown';
  set('cdTitle', config.title); set('cdTarget', config.target); set('cdEnd', config.endText); set('cdHold', config.holdMinutes);
  $('cdShow').textContent = config.show ? 'Ausblenden' : 'Einblenden';
  $('cdShow').classList.toggle('ghost', config.show);
  $('cdInfo').textContent = config.target ? `Ziel: ${new Date(cd.view.target).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short', timeZone: cd.timezone })} (${cd.timezone}). Dieselbe Zeit nutzt der Geburtstags-Befehl.` : 'Noch keine Zielzeit gesetzt, so bleibt der Countdown unsichtbar.';
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

function renderAdv() {
  $('advCmd').textContent = adv.command;
  $('advInfo').innerHTML = !adv.enabled ? '<b class="bad">Die Einreichung ist ausgeschaltet.</b> Unten in den Einstellungen einschalten und speichern.' : `${adv.open ? '<b>Offen.</b>' : '<b class="bad">Geschlossen.</b>'} ${adv.counts.all} ${adv.counts.all === 1 ? 'Einreichung' : 'Einreichungen'}, davon ${adv.counts.offen} noch offen. Höchstens ${adv.max} je Person.`;
  $('advList').innerHTML = adv.entries.length ? `<table><thead><tr><th>Adventure</th><th>Von</th><th>Status</th><th></th></tr></thead><tbody>${adv.entries.map((e) => `
    <tr data-id="${esc(e.id)}"><td>${esc(e.title)}${e.link ? ` <a href="${esc(e.link)}" target="_blank" rel="noopener">Link</a>` : ''}</td><td>${esc(e.name)} <small class="muted">${SRC[e.source] ?? ''}</small></td>
    <td><select data-f="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}"${e.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><button data-act="del" class="danger">Löschen</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Noch keine Einreichungen.</p>';
  const keep = $('advWheel').value;
  $('advWheel').innerHTML = '<option value="">Neues Rad anlegen</option>' + (rad?.wheels ?? []).map((w) => `<option value="${esc(w.id)}">Felder von „${esc(w.name)}“ ersetzen</option>`).join('');
  $('advWheel').value = [...$('advWheel').options].some((o) => o.value === keep) ? keep : '';
  $('advWheelName').disabled = Boolean($('advWheel').value);
}

const applyAdv = (r) => { adv = r; renderAdv(); };
const applyCd = (r) => { cd = r; renderCountdown(); };
const applyRad = (r) => { rad = r; renderRad(); if (adv) renderAdv(); };
export async function loadFeier() { applyCd(await api('GET', 'feier/countdown')); applyRad(await api('GET', 'feier/rad')); applyAdv(await api('GET', 'adventure')); }

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
  $('advAdd').addEventListener('click', run(async () => { applyAdv(await api('POST', 'adventure/entry', { text: $('advText').value, name: $('advWho').value })); $('advText').value = ''; toast('Hinzugefügt ✓'); }));
  $('advWheel').addEventListener('change', () => { $('advWheelName').disabled = Boolean($('advWheel').value); });
  $('advList').addEventListener('change', run(async (e) => { const row = e.target.closest('[data-id]'); if (row && e.target.dataset.f === 'status') applyAdv(await api('PUT', `adventure/entry/${row.dataset.id}`, { status: e.target.value })); }));
  $('advList').addEventListener('click', run(async (e) => { const row = e.target.closest('[data-id]'); if (row && e.target.dataset.act === 'del' && confirm('Diese Einreichung löschen?')) applyAdv(await api('DELETE', `adventure/entry/${row.dataset.id}`)); }));
  $('advToWheel').addEventListener('click', run(async () => {
    const r = await api('POST', 'adventure/to-wheel', { wheelId: $('advWheel').value, name: $('advWheelName').value });
    adv = r; applyRad(await api('GET', 'feier/rad')); selected = r.wheel.id; renderRad();
    toast(`Rad „${r.wheel.name}“ ist fertig ✓ ${r.skipped ? `(${r.skipped} passten nicht mehr drauf, höchstens 40 Felder)` : ''}`);
  }));
  $('advClearDone').addEventListener('click', run(async () => { if (confirm('Alle gedrehten und gespielten Einträge entfernen?')) { applyAdv(await api('POST', 'adventure/clear', { status: 'gedreht' })); applyAdv(await api('POST', 'adventure/clear', { status: 'gespielt' })); } }));
  $('advClearAll').addEventListener('click', run(async () => { if (confirm('Wirklich die ganze Liste leeren?')) applyAdv(await api('POST', 'adventure/clear', {})); }));
  $('radHistory').addEventListener('click', run(async (e) => { if (e.target.id === 'radClear') applyRad(await api('DELETE', 'feier/rad/history')); }));
}
