// Panel-Extension: holt die Ranglisten von der Stadtwache (öffentlicher Endpunkt /api/leaderboard) und zeigt sie in drei Reitern.
// Der Platzhalter in der nächsten Zeile wird beim Bauen (scripts/build-extension.mjs) durch die Adresse deiner Seite ersetzt.
const API = '__SITE_URL__/api/leaderboard';
const REFRESH_MS = 60_000;

const BOARDS = {
  visits: [{ key: 'visits', title: null, fmt: (v) => `${v}x` }],
  chatters: [{ key: 'chatters', title: null, fmt: (v) => `${v} Nachr.` }],
  streaks: [
    { key: 'streaks', title: 'Aktuelle Streak 🔥', fmt: (v) => `${v} Streams` },
    { key: 'records', title: 'Rekord', fmt: (v) => `${v} Streams` },
  ],
};

const list = document.getElementById('list');
const tabs = document.getElementById('tabs');
let board = 'visits';
let data = null;

function render() {
  list.replaceChildren();
  if (!data) return;
  for (const part of BOARDS[board]) {
    const rows = data[part.key] ?? [];
    if (part.title) { const h = document.createElement('h2'); h.textContent = part.title; list.append(h); }
    if (!rows.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Noch keine Einträge.'; list.append(p); continue; }
    const ol = document.createElement('ol');
    for (const r of rows) {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.textContent = r.name;
      const val = document.createElement('b'); val.textContent = part.fmt(r.value);
      li.append(name, val); ol.append(li);
    }
    list.append(ol);
  }
}

async function load() {
  const foot = document.getElementById('foot');
  try {
    const res = await fetch(API, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'Die Rangliste ist gerade nicht öffentlich.' : 'Nicht erreichbar.');
    data = await res.json();
    render();
    foot.textContent = `${data.visitors} Besucher · Stand ${new Date(data.updated).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
  } catch (e) {
    if (!data) { list.replaceChildren(); const p = document.createElement('p'); p.className = 'empty'; p.textContent = e.message; list.append(p); }
    foot.textContent = '';
  }
}

tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-board]');
  if (!b) return;
  board = b.dataset.board;
  for (const x of tabs.querySelectorAll('button')) x.setAttribute('aria-selected', String(x === b));
  render(); list.scrollTop = 0;
});

load();
setInterval(load, REFRESH_MS);
