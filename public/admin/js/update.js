// Updates (Reiter „Allgemein“): zeigt die laufende Version und stößt über Watchtower ein Update an.
import { $, api, run, toast } from './core.js';

const short = (v) => (v?.commit ? `${v.commit.slice(0, 7)}${v.builtAt ? `, gebaut am ${new Date(v.builtAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}` : 'unbekannt');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = () => api('GET', 'update').catch((e) => (e.message === 'Nicht angemeldet' ? Promise.reject(e) : null)); // null = Stadtwache gerade nicht erreichbar

export async function loadUpdate() {
  const v = await get();
  if (!v) return;
  $('updVersion').textContent = short(v);
  $('updSetup').classList.toggle('hidden', v.configured);
  $('updBtn').disabled = !v.configured;
}

export function initUpdate() {
  $('updBtn').addEventListener('click', run(async () => {
    const before = await get();
    const status = (t) => { $('updStatus').textContent = t; };
    $('updBtn').disabled = true;
    try {
      status('Prüfe …');
      let res = null;
      try { res = await api('POST', 'update'); } catch (e) { if (!(e instanceof TypeError)) throw e; } // Verbindung weg = die Stadtwache wird gerade ersetzt
      if (res?.done) { status(`Bereits aktuell (${short(before)}).`); return; }
      status('Update läuft, die Stadtwache startet neu …');
      let wasDown = !res;
      for (let i = 0; i < 40; i++) { // bis zu etwa 2 Minuten
        await sleep(3000);
        const now = await get();
        if (!now) { wasDown = true; continue; }
        if (now.commit !== before?.commit) { $('updVersion').textContent = short(now); status(`Aktualisiert auf ${short(now)}.`); toast('Update eingespielt'); return; }
        if (wasDown) { status(`Neu gestartet, es läuft ${short(now)}. Gab es nichts Neues, ist das normal.`); return; }
        if (i >= 5) { status(`Bereits aktuell (${short(now)}).`); return; }
      }
      status('Das dauert ungewöhnlich lange. Seite neu laden und die Version prüfen.');
    } finally { $('updBtn').disabled = false; }
  }));
}
