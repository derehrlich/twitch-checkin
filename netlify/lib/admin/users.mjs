// /api/admin/users (Besucher, Besuche nachtragen und entfernen) und der CSV-Export.
import { db } from '../store.mjs';
import { getSettings } from '../settings.mjs';
import { streamDay } from '../checkin.mjs';
import { computeStreak, getStreamDays } from '../streak.mjs';
import { json, text } from '../http.mjs';
import { allUsers } from './common.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;

export async function users({ route, method, body }) {
  if (route.length === 1 && method === 'GET') {
    const settings = await getSettings();
    const streamDays = await getStreamDays();
    const today = streamDay(settings);
    const list = (await allUsers()).map((u) => {
      const { current, record } = computeStreak(u, streamDays, today, settings.streakGrace);
      return { ...u, streak: current, record };
    });
    return json(list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
  }

  const id = route[1];
  const user = id && (await db.get(`user/${id}`));
  if (!user) return json({ error: 'Nutzer nicht gefunden' }, 404);

  if (route[2] === 'days' && method === 'POST') { // Besuch nachtragen
    if (!DAY.test(body.day ?? '')) return json({ error: 'Datum muss YYYY-MM-DD sein' }, 400);
    if (!user.days.includes(body.day)) {
      user.days = [...user.days, body.day].sort();
      user.count = user.days.length;
      user.first ??= new Date().toISOString();
      user.last ??= user.first;
      await db.set(`user/${id}`, user);
      await db.set(`checked/${body.day}/${id}`, 1);
      await db.setIfNew(`streamday/${body.day}`, 1);
    }
    return json({ id, ...user });
  }
  if (route[2] === 'days' && route[3] && method === 'DELETE') { // Besuch entfernen
    user.days = user.days.filter((d) => d !== route[3]);
    user.count = user.days.length;
    if (user.sessions) delete user.sessions[route[3]];
    await db.set(`user/${id}`, user);
    await db.delete(`checked/${route[3]}/${id}`);
    await db.delete(`checkout/${route[3]}/${id}`);
    return json({ id, ...user });
  }
  if (route.length === 2 && method === 'DELETE') {
    for (const d of user.days) { await db.delete(`checked/${d}/${id}`); await db.delete(`checkout/${d}/${id}`); }
    await db.delete(`user/${id}`);
    return json({ ok: true });
  }
}

export async function exportCsv({ method }) {
  if (method !== 'GET') return;
  const rows = ['datum,user,besuch_nr,checkin,checkout,minuten'];
  for (const u of await allUsers()) {
    u.days.forEach((d, i) => {
      const ses = u.sessions?.[d];
      rows.push(`${d},${csvCell(u.name)},${i + 1},${ses?.in ?? ''},${ses?.out ?? ''},${ses?.minutes ?? ''}`);
    });
  }
  return text(rows.join('\n'), 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="checkins.csv"' });
}
