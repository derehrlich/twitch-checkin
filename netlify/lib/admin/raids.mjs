// /api/admin/raids: Raid-Verlauf lesen und früher erhaltene Raids nachtragen (Twitch liefert keinen Verlauf).
import { db } from '../store.mjs';
import { json } from '../http.mjs';
import { userByLogin } from '../twitch.mjs';

export async function raids({ method, body }) {
  if (method === 'GET') {
    const keys = await db.list('raid/');
    const rows = await Promise.all(keys.map(async (k) => ({ id: k.slice(5), ...(await db.get(k)) })));
    return json(rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
  }
  if (method === 'POST') {
    const login = String(body.login || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
    const count = Math.round(Number(body.count));
    if (!login || !Number.isFinite(count) || count < 0 || count > 10_000) return json({ error: 'Kanalname und Anzahl (0 bis 10000) angeben' }, 400);
    const who = await userByLogin(login);
    if (!who) return json({ error: 'Kanal nicht gefunden' }, 404);
    const rec = (await db.get(`raid/${who.id}`)) ?? { viewers: 0, first: null, last: null };
    await db.set(`raid/${who.id}`, { ...rec, name: who.display_name, count });
    return json({ id: who.id, name: who.display_name, count });
  }
}
