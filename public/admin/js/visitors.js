// Besucher-Reiter: Liste, Suche, Sortierung, Besuche nachtragen und entfernen.
import { $, api, esc, fmtDuration, run, state, toast } from './core.js';
import { loadStatus } from './status.js';

let selected = null;
const timed = (u) => Object.values(u.sessions ?? {}).filter((x) => x.minutes != null);
const durations = (u) => { const t = timed(u); const total = t.reduce((a, x) => a + x.minutes, 0); return { total, avg: t.length ? total / t.length : 0, n: t.length }; };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE') : '–');

export async function loadUsers() { state.users = await api('GET', 'users'); renderUsers(); renderDetail(); renderStats(); }

function renderStats() {
  const known = state.users.flatMap((u) => timed(u).map((x) => x.minutes));
  const checkins = state.users.reduce((s, u) => s + u.days.length, 0);
  const items = [[state.users.length, 'Besucher gesamt'], [checkins, 'Check-ins gesamt'],
    [known.length ? fmtDuration(known.reduce((a, b) => a + b, 0) / known.length) : '–', 'Ø Dauer'], [`${known.length} von ${checkins}`, 'Besuche mit Check-out']];
  $('stats').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span class="muted">${l}</span></div>`).join('');
}

function renderUsers() {
  const q = $('search').value.trim().toLowerCase();
  const key = { count: (u) => -u.count, total: (u) => -durations(u).total, avg: (u) => -durations(u).avg, name: (u) => u.name.toLowerCase() }[$('sort').value];
  const list = state.users.filter((u) => u.name.toLowerCase().includes(q)).sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0)).slice(0, 200);
  $('users').innerHTML = list.map((u) => { const d = durations(u);
    return `<tr class="user" data-id="${esc(u.id)}"><td>${esc(u.name)}</td><td>${u.count}</td><td>${u.streak ?? 0} (${u.record ?? 0})</td><td>${d.n ? fmtDuration(d.total) : '–'}</td><td>${d.n ? fmtDuration(d.avg) : '–'}</td><td>${fmtDate(u.last)}</td></tr>`; }).join('')
    || '<tr><td colspan="6" class="muted">Noch keine Besucher.</td></tr>';
}

function renderDetail() {
  const u = state.users.find((x) => x.id === selected);
  $('detail').classList.toggle('hidden', !u);
  if (!u) return;
  const d = durations(u);
  $('dName').textContent = `${u.name} – ${u.count} Besuche, Streak ${u.streak ?? 0} (Rekord ${u.record ?? 0})` + (d.n ? `, ${fmtDuration(d.total)} gesamt (Ø ${fmtDuration(d.avg)})` : '');
  const label = (day) => { const x = u.sessions?.[day]; return x ? (x.minutes != null ? ` · ${fmtDuration(x.minutes)}` : ' · ohne Check-out') : ''; };
  $('dDays').innerHTML = [...u.days].reverse().map((day) => `<span class="chip">${esc(day)}${label(day)}<button data-day="${esc(day)}" title="Besuch entfernen">×</button></span>`).join('');
}

export function initVisitors() {
  $('sort').addEventListener('change', renderUsers);
  $('search').addEventListener('input', renderUsers);
  $('users').addEventListener('click', (e) => { const tr = e.target.closest('tr.user'); if (tr) { selected = tr.dataset.id; renderDetail(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } });
  $('dDays').addEventListener('click', run(async (e) => {
    const day = e.target.dataset.day; if (!day || !confirm(`Besuch am ${day} entfernen?`)) return;
    await api('DELETE', `users/${selected}/days/${day}`); await loadUsers(); await loadStatus();
  }));
  $('addDayBtn').addEventListener('click', run(async () => {
    if (!$('addDay').value) return toast('Bitte ein Datum wählen', true);
    await api('POST', `users/${selected}/days`, { day: $('addDay').value }); await loadUsers(); await loadStatus(); toast('Besuch nachgetragen ✓');
  }));
  $('delUser').addEventListener('click', run(async () => {
    const u = state.users.find((x) => x.id === selected);
    if (!confirm(`${u.name} mit allen ${u.count} Besuchen endgültig löschen?`)) return;
    await api('DELETE', `users/${selected}`); selected = null; await loadUsers(); await loadStatus();
  }));
}
