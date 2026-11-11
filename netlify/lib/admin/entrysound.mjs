// /api/admin/entrysound: Einlaufsounds prüfen und freigeben, ablehnen (mit oder ohne Erstattung) oder entfernen.
import { db } from '../kern/store.mjs';
import { getSettings } from '../kern/settings.mjs';
import { USER_ID, approve, cleanup, extendMonths, fmtMonths, grant, listEntries, pendingKey, reject, remove, rewardTitles } from '../belohnungen/entrysound.mjs';
import { json } from '../kern/http.mjs';
import { lookupUser } from '../kern/twitch.mjs';
import { allUsers, audioUpload, cleanName } from './common.mjs';

/** Person aus Twitch-ID oder -Namen: erst bei den Besuchern suchen, sonst bei Twitch fragen. */
async function findPerson(body) {
  const raw = String(body.login ?? body.twitchId ?? '').trim().replace(/^@/, '');
  if (USER_ID.test(raw)) return { id: raw, name: (await db.get(`user/${raw}`))?.name ?? String(body.name || raw) };
  const login = raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
  if (!login) return null;
  const known = (await allUsers()).find((u) => String(u.name).toLowerCase() === login);
  if (known) return { id: known.id, name: known.name };
  return lookupUser(login).catch(() => null);
}

export async function entrysound({ route, method, body }) {
  const settings = await getSettings();
  if (route.length === 1 && method === 'GET') {
    await cleanup(settings).catch((e) => console.warn('Aufräumen fehlgeschlagen:', e.message));
    return json({
      entries: await listEntries(settings),
      info: { titles: rewardTitles(settings), buyMonths: fmtMonths(settings.entrySoundBuyMonths), extendMonths: fmtMonths(extendMonths(settings)), maxMonths: fmtMonths(settings.entrySoundMaxMonths), maxSeconds: settings.entrySoundMaxSeconds },
    });
  }
  if (route[1] === 'grant' && method === 'POST') { // Einlaufsound von Hand vergeben (Familie, OGs): ohne Kauf, mit Laufzeit oder ewig
    const person = await findPerson(body);
    if (!person) return json({ error: 'Diese Person wurde bei Twitch nicht gefunden' }, 404);
    let file = null;
    if (body.data) {
      const up = audioUpload(body);
      if (up.error) return up.error;
      file = up;
    }
    const res = await grant(person.id, person.name, { file, soundName: cleanName(body.fileName, 'Sound'), months: Number(body.months) || 0, permanent: body.permanent === true });
    return res.error ? json({ error: res.error }, res.status ?? 400) : json({ ...res, name: person.name });
  }
  const id = route[1] ?? '';
  if (!USER_ID.test(id)) return json({ error: 'Ungültige ID' }, 404);
  const done = (res) => (res.error ? json({ error: res.error }, res.status ?? 400) : json(res));

  if (route[2] === 'pending' && method === 'GET') {
    const file = await db.get(pendingKey(id));
    return file ? json(file) : json({ error: 'Keine Datei zur Prüfung' }, 404);
  }
  if (route[2] === 'approve' && method === 'POST') return done(await approve(id, settings));
  if (route[2] === 'reject' && method === 'POST') return done(await reject(id, settings, { reason: body.reason, refund: body.refund === true }));
  if (route.length === 2 && method === 'DELETE') return done(await remove(id));
}
