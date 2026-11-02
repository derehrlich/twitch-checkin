// /api/admin/sport: Einheiten eintragen und löschen, Scoreboard ein- und ausblenden.
import { db } from '../store.mjs';
import { LOG_ID, LOG_PREFIX, addSession, getConfig, publicView, sessions, totals, updateConfig } from '../sport.mjs';
import { json } from '../http.mjs';

const state = async () => { const log = await sessions(); return { config: await getConfig(), log, totals: totals(log), view: await publicView() }; };

export async function sport({ route, method, body }) {
  if (route.length === 1 && method === 'GET') return json(await state());
  if (route[1] === 'config' && method === 'PUT') { await updateConfig(body); return json(await state()); }
  if (route[1] === 'log' && route.length === 2 && method === 'POST') {
    try { await addSession(body); } catch (e) { return json({ error: e.message }, 400); }
    return json(await state());
  }
  if (route[1] === 'log' && route.length === 3 && method === 'DELETE') {
    if (!LOG_ID.test(route[2])) return json({ error: 'Einheit nicht gefunden' }, 404);
    await db.delete(LOG_PREFIX + route[2]);
    return json(await state());
  }
}
