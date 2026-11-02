// /api/admin/sport: Scoreboard steuern (Werte, Stoppuhr, Einblenden) und Verlauf der gespeicherten Einheiten.
import { db } from '../store.mjs';
import { LOG_ID, LOG_PREFIX, getLive, publicView, saveSession, sessions, timer, totals, updateLive } from '../sport.mjs';
import { json } from '../http.mjs';

const state = async () => { const list = await sessions(); return { live: publicView(await getLive()), log: list, totals: totals(list) }; };

export async function sport({ route, method, body }) {
  if (route.length === 1 && method === 'GET') return json(await state());
  if (route[1] === 'live' && method === 'PUT') { await updateLive(body); return json(await state()); }
  if (route[1] === 'timer' && method === 'POST') {
    try { await timer(body.action); } catch (e) { return json({ error: e.message }, 400); }
    return json(await state());
  }
  if (route[1] === 'save' && method === 'POST') {
    try { if (!(await saveSession())) return json({ error: 'Es gibt noch nichts zu speichern' }, 400); } catch (e) { return json({ error: e.message }, 400); }
    return json(await state());
  }
  if (route[1] === 'log' && route.length === 3 && method === 'DELETE') {
    if (!LOG_ID.test(route[2])) return json({ error: 'Einheit nicht gefunden' }, 404);
    await db.delete(LOG_PREFIX + route[2]);
    return json(await state());
  }
}
