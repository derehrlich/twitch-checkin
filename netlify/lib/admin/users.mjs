// /api/admin/users (Besucher, Besuche nachtragen und entfernen) und der CSV-Export.
import { db } from '../kern/store.mjs';
import { getSettings } from '../kern/settings.mjs';
import { streamDay } from '../zuschauer/checkin.mjs';
import { computeStreak, getStreamDays } from '../zuschauer/streak.mjs';
import { json, text } from '../kern/http.mjs';
import { lookupUser } from '../kern/twitch.mjs';
import { allUsers } from './common.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;

const LOGIN = /^[a-z0-9_]{1,25}$/;
const MAX_STREAK = 9999;
const MAX_ROWS = 300;

/**
 * Streaks von Hand übernehmen (z. B. aus Twitch): body = { rows: [{ name, count }], asOf? }.
 * count gilt bis einschließlich dem Stream-Tag asOf (leer = heute); 0 nimmt eine übernommene Streak wieder weg.
 * Bekannte Zuschauer werden am Namen erkannt, unbekannte bei Twitch nachgeschlagen und neu angelegt (ohne Besuche).
 */
async function importStreaks(body) {
  const settings = await getSettings();
  const today = streamDay(settings);
  const asOf = body.asOf || today;
  if (!DAY.test(asOf) || asOf > today) return json({ error: 'Der Stand muss ein Datum sein (YYYY-MM-DD), das nicht in der Zukunft liegt' }, 400);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return json({ error: 'Keine Zeilen zum Übernehmen' }, 400);
  if (rows.length > MAX_ROWS) return json({ error: `Höchstens ${MAX_ROWS} Zuschauer auf einmal` }, 400);

  const byName = new Map((await allUsers()).map((u) => [String(u.name).toLowerCase(), u.id]));
  const results = [];
  for (const row of rows) {
    const login = String(row?.name ?? '').trim().replace(/^@/, '').toLowerCase();
    const count = Number(row?.count);
    const fail = (status) => results.push({ name: String(row?.name ?? ''), ok: false, status });
    if (!LOGIN.test(login)) { fail('Name ungültig'); continue; }
    if (!Number.isInteger(count) || count < 0 || count > MAX_STREAK) { fail(`Streak muss eine ganze Zahl von 0 bis ${MAX_STREAK} sein`); continue; }

    let id = byName.get(login);
    let found = null;
    if (!id) { // unbekannter Name: bei Twitch nachschlagen (die Person kann auch unter anderem Anzeigenamen gespeichert sein)
      found = await lookupUser(login).catch(() => null);
      if (!found) { fail(count > 0 ? 'Bei Twitch nicht gefunden' : 'Kein Eintrag, nichts zu entfernen'); continue; }
      id = found.id;
    }
    let user = await db.get(`user/${id}`);
    if (!user && count === 0) { fail('Kein Eintrag, nichts zu entfernen'); continue; }
    const created = !user;
    user ??= { name: found.name, count: 0, first: null, last: null, days: [] };
    if (count > 0) user.streakImport = { count, asOf };
    else delete user.streakImport;
    await db.set(`user/${id}`, user);
    byName.set(login, id);
    results.push({ name: user.name, ok: true, status: count > 0 ? `Streak ${count} bis ${asOf}` : 'übernommene Streak entfernt', created });
  }
  return json({ asOf, results });
}

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

  if (route.length === 2 && route[1] === 'streaks' && method === 'POST') return importStreaks(body);

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
