// Reiter „Events / Tickets“: Events anlegen, Teilnehmer und Warteliste verwalten, Anwesenheit abhaken, Liste exportieren.
import { $, api, esc, onAct, run, toast } from './core.js';

const LABEL = { ticket: 'Ticket', offered: 'Nachgerückt (wartet auf Antwort)', waitlist: 'Warteliste', cancelled: 'abgesagt', attended: 'erschienen', noshow: 'nicht erschienen' };
const EVENT_STATUS = { planned: 'geplant', open: 'Verkauf offen', closed: 'Verkauf geschlossen', ended: 'beendet' };
let events = [];
const open = new Set(); // Events, deren Teilnehmerliste aufgeklappt ist
const details = {};

const when = (ev) => ev.when;
const opts = (cur) => Object.entries(EVENT_STATUS).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');

export async function loadTickets() {
  const d = await api('GET', 'tickets');
  events = d.events;
  for (const id of open) details[id] = await api('GET', `tickets/${id}`).catch(() => null);
  renderTickets(d.enabled);
}

function listOf(id) {
  const d = details[id];
  if (!d) return '';
  const rows = d.entries.map((e) => {
    const seat = ['ticket', 'attended', 'noshow'].includes(e.status);
    const live = seat || e.status === 'waitlist' || e.status === 'offered';
    return `<tr data-uid="${esc(e.userId)}">
      <td>${e.status === 'waitlist' ? `<b>${e.position}.</b>` : ''}</td>
      <td><b>${esc(e.name)}</b>${e.note ? ` <span class="muted">(${esc(e.note)})</span>` : ''}</td>
      <td class="muted">${new Date(e.redeemedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td>${esc(LABEL[e.status])}</td>
      <td><input data-f="ingame" maxlength="40" value="${esc(e.ingame ?? '')}" placeholder="Ingame-/Discord-Name" ${live ? '' : 'disabled'}></td>
      <td class="tk-act">
        ${e.status === 'waitlist' ? '<button data-act="promote" class="ghost">Nachrücken</button>' : ''}
        ${seat ? `<button data-act="att" data-s="attended" class="ghost" ${e.status === 'attended' ? 'disabled' : ''}>✔ erschienen</button><button data-act="att" data-s="noshow" class="ghost" ${e.status === 'noshow' ? 'disabled' : ''}>✖ nicht da</button>` : ''}
        ${live ? '<button data-act="remove" class="danger">Entfernen</button>' : ''}
      </td></tr>`;
  }).join('');
  return `<div class="tk-list">
    <table class="tk"><thead><tr><th>Warte&shy;liste</th><th>Twitch-Name</th><th>Eingelöst</th><th>Status</th><th>Ingame / Discord</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">Noch niemand.</td></tr>'}</tbody></table>
    <div class="row" style="margin-top:12px">
      <div><label>Person von Hand hinzufügen (Twitch-Name)</label><input data-f="addname" maxlength="25" placeholder="z. B. marcel"></div>
      <button data-act="add">Hinzufügen</button>
      <a class="btn ghost" href="/api/admin/tickets/${id}/csv">CSV herunterladen</a>
      <button data-act="copy" class="ghost">Liste kopieren</button>
    </div>
  </div>`;
}

function renderTickets(enabled) {
  $('ticketHint').classList.toggle('hidden', enabled);
  $('ticketEvents').innerHTML = events.length ? events.map((ev) => `
    <div class="entry" data-id="${ev.id}">
      <h3 style="margin:0">${esc(ev.name)} <span class="muted" style="font-weight:400">· ${esc(when(ev))} · ${esc(ev.statusLabel)}</span></h3>
      <p style="margin:6px 0"><b>${ev.taken} von ${ev.seats}</b> Plätzen vergeben · Warteliste: <b>${ev.waiting}</b> · erschienen: ${ev.attended} · nicht erschienen: ${ev.noshow} · Reward: ${ev.rewardId ? 'angelegt' : '<b>noch nicht angelegt</b>'}</p>
      <div class="grid2">
        <div><label>Name</label><input data-f="name" maxlength="60" value="${esc(ev.name)}"></div>
        <div><label>Datum und Uhrzeit</label><input data-f="startsAt" type="datetime-local" value="${esc(ev.startsAt)}"></div>
        <div><label>Plätze</label><input data-f="seats" type="number" min="1" max="500" value="${ev.seats}"></div>
        <div><label>Preis (Kanalpunkte)</label><input data-f="cost" type="number" min="1" max="1000000" value="${ev.cost}"></div>
        <div><label>Plätze auf der Warteliste (0 = keine, dann wird der Reward bei „voll“ pausiert)</label><input data-f="waitlistMax" type="number" min="0" max="200" value="${ev.waitlistMax}"></div>
        <div><label>Nachrück-Frist in Minuten (0 = aus)</label><input data-f="promoteMinutes" type="number" min="0" max="240" value="${ev.promoteMinutes}"></div>
        <div><label>Status</label><select data-f="status">${opts(ev.status)}</select></div>
        <div><label>Reward-Name in Twitch (leer = „Ticket: Name“)</label><input data-f="rewardTitle" maxlength="45" value="${esc(ev.rewardTitle ?? '')}"></div>
      </div>
      <label class="check big"><input data-f="oneWeek" type="checkbox" ${ev.oneWeek ? 'checked' : ''}> Ein Ticket pro Woche (wer in derselben Woche schon ein Ticket oder einen Wartelistenplatz hat, bekommt die Punkte zurück)</label>
      <label class="check big"><input data-f="refundNoShow" type="checkbox" ${ev.refundNoShow ? 'checked' : ''}> Punkte zurück, wenn jemand nicht erscheint (Standard: aus; dann bleibt die Einlösung bis zum Abhaken offen)</label>
      <div class="row">
        <button data-act="save">Speichern</button>
        <button data-act="people" class="ghost">${open.has(ev.id) ? 'Teilnehmer ausblenden' : 'Teilnehmer anzeigen'}</button>
        <button data-act="sync" class="ghost">Reward mit Twitch abgleichen</button>
        <button data-act="del" class="danger">Event löschen</button>
      </div>
      ${open.has(ev.id) ? listOf(ev.id) : ''}
    </div>`).join('') : '<p class="muted">Noch keine Events.</p>';
}

const fieldsOf = (row) => {
  const o = {};
  for (const el of row.querySelectorAll(':scope > .grid2 [data-f], :scope > label [data-f]')) o[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
  return o;
};

const copyText = (ev, d) => d.entries.filter((e) => ['ticket', 'attended', 'noshow', 'offered'].includes(e.status)).map((e) => (e.ingame ? `${e.name} – ${e.ingame}` : e.name)).join('\n');

export function initTickets() {
  $('ticketAdd').addEventListener('click', run(async () => {
    const r = await api('POST', 'tickets', {
      name: $('tkName').value, startsAt: $('tkWhen').value, seats: $('tkSeats').value, cost: $('tkCost').value,
      status: $('tkStatus').value, oneWeek: $('tkWeek').checked,
    });
    $('tkName').value = '';
    await loadTickets();
    toast(r.warning ? `Event gespeichert, aber: ${r.warning}` : 'Event angelegt ✓', Boolean(r.warning), 7000);
  }));
  document.addEventListener('admin:synced', run(loadTickets));

  onAct($('ticketEvents'), '[data-id]', async (act, row, btn) => {
    const id = row.dataset.id, ev = events.find((x) => x.id === id);
    const tr = btn.closest('tr'), uid = tr?.dataset.uid;
    if (act === 'save') {
      const r = await api('PUT', `tickets/${id}`, fieldsOf(row));
      await loadTickets();
      toast(r.warning ? `Gespeichert, aber: ${r.warning}` : r.moved?.length ? `Gespeichert ✓ – nachgerückt: ${r.moved.join(', ')}` : 'Gespeichert ✓', Boolean(r.warning), r.warning ? 7000 : 3800);
    } else if (act === 'people') {
      if (open.has(id)) open.delete(id); else open.add(id);
      await loadTickets();
    } else if (act === 'sync') {
      const r = await api('POST', `tickets/${id}/sync`, {}); await loadTickets();
      toast(r.warning ? r.warning : 'Reward abgeglichen ✓', Boolean(r.warning), 7000);
    } else if (act === 'del') {
      if (!confirm(`„${ev.name}“ samt Reward in Twitch und allen Einträgen löschen? Offene Einlösungen der Warteliste werden storniert (Punkte zurück).`)) return;
      await api('DELETE', `tickets/${id}`); open.delete(id); await loadTickets(); toast('Gelöscht ✓');
    } else if (act === 'add') {
      const name = row.querySelector('[data-f=addname]').value;
      const r = await api('POST', `tickets/${id}/add`, { name }); await loadTickets();
      toast(r.seat ? 'Eingetragen ✓ (Platz)' : `Eingetragen ✓ (Warteliste, Position ${r.pos})`);
    } else if (act === 'remove') {
      if (!confirm('Diese Person entfernen? Der Erste auf der Warteliste rückt nach.')) return;
      const r = await api('POST', `tickets/${id}/remove`, { userId: uid }); await loadTickets();
      toast(r.moved.length ? `Entfernt ✓ – nachgerückt: ${r.moved.join(', ')}` : 'Entfernt ✓');
    } else if (act === 'promote') {
      await api('POST', `tickets/${id}/promote`, { userId: uid }); await loadTickets(); toast('Nachgerückt ✓');
    } else if (act === 'att') {
      await api('POST', `tickets/${id}/attendance`, { userId: uid, status: btn.dataset.s }); await loadTickets();
    } else if (act === 'copy') {
      await navigator.clipboard.writeText(copyText(ev, details[id])); toast('Liste kopiert ✓');
    }
  });
  $('ticketEvents').addEventListener('change', run(async (e) => {
    const input = e.target.closest('[data-f=ingame]');
    if (!input) return;
    const row = input.closest('[data-id]'), uid = input.closest('tr').dataset.uid;
    await api('POST', `tickets/${row.dataset.id}/ingame`, { userId: uid, ingame: input.value }); toast('Gespeichert ✓');
  }));
}
