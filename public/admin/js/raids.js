// Raids-Reiter: Übersicht der erfassten Raider und Nachtragen früherer Raids (einzeln oder mehrere auf einmal).
import { $, api, esc, run, toast } from './core.js';

let rows = [];
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE') : '–');

export async function loadRaids() { rows = await api('GET', 'raids'); renderRaids(); }

function renderRaids() {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const live = rows.filter((r) => r.last).length;
  $('raidStats').innerHTML = [[rows.length, 'Kanäle'], [total, 'Raids gesamt'], [live, 'davon live erfasst']]
    .map(([v, l]) => `<div class="stat"><b>${v}</b><span class="muted">${l}</span></div>`).join('');
  $('raidList').innerHTML = rows.map((r) =>
    `<tr class="user" data-name="${esc(r.name)}" data-count="${r.count}"><td>${esc(r.name)}</td><td>${r.count}</td><td>${r.viewers || '–'}</td><td>${fmtDate(r.last)}</td><td>${r.last ? 'Live' : 'Nachgetragen'}</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">Noch keine Raids erfasst. Sobald jemand bei dir raidet oder du einen Stand einträgst, erscheint er hier.</td></tr>';
}

// "name 3", "name, 3", "name: 3" oder nur "name" (zählt 1). Ein führendes @ oder twitch.tv/ wird ignoriert.
export function parseBulk(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.trim().replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?twitch\.tv\//i, '').match(/^([A-Za-z0-9_]{1,25})(?:[\s,;:=]+(\d{1,5}))?\s*$/);
    if (m) out.push({ login: m[1], count: m[2] ? Number(m[2]) : 1 });
    else if (line.trim()) out.push({ login: line.trim(), count: NaN });
  }
  return out;
}

export function initRaids() {
  $('raidList').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-name]');
    if (!tr) return;
    $('raidSeedLogin').value = tr.dataset.name; $('raidSeedCount').value = tr.dataset.count;
    $('raidSeedLogin').scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  $('raidSeed').addEventListener('click', run(async () => {
    const r = await api('POST', 'raids', { login: $('raidSeedLogin').value, count: $('raidSeedCount').value });
    toast(`${r.name}: ${r.count} bisherige Raids gespeichert ✓`);
    await loadRaids();
  }));
  $('raidBulkBtn').addEventListener('click', run(async () => {
    const items = parseBulk($('raidBulk').value);
    if (!items.length) throw new Error('Bitte mindestens einen Kanal eintragen');
    const done = [], failed = [], rest = [];
    for (const it of items) {
      if (!Number.isFinite(it.count)) { failed.push(`${it.login} (Zeile nicht lesbar)`); rest.push(it.login); continue; }
      try { const r = await api('POST', 'raids', it); done.push(r.name); } catch (e) { failed.push(`${it.login} (${e.message})`); rest.push(`${it.login} ${it.count}`); }
    }
    $('raidBulk').value = rest.join('\n');
    $('raidBulkInfo').textContent = `${done.length} eingetragen` + (failed.length ? `, ${failed.length} nicht: ${failed.join('; ')}. Diese Zeilen stehen noch im Feld.` : '.');
    toast(failed.length ? `${done.length} eingetragen, ${failed.length} fehlgeschlagen` : `${done.length} Kanäle eingetragen ✓`, failed.length > 0);
    await loadRaids();
  }));
}
