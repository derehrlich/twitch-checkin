// /api/admin/entrysound: Einlaufsounds prüfen und freigeben, ablehnen (mit oder ohne Erstattung) oder entfernen.
import { db } from '../store.mjs';
import { getSettings } from '../settings.mjs';
import { USER_ID, approve, cleanup, extendMonths, fmtMonths, listEntries, pendingKey, reject, remove, rewardTitles } from '../entrysound.mjs';
import { json } from '../http.mjs';

export async function entrysound({ route, method, body }) {
  const settings = await getSettings();
  if (route.length === 1 && method === 'GET') {
    await cleanup(settings).catch((e) => console.warn('Aufräumen fehlgeschlagen:', e.message));
    return json({
      entries: await listEntries(settings),
      info: { titles: rewardTitles(settings), buyMonths: fmtMonths(settings.entrySoundBuyMonths), extendMonths: fmtMonths(extendMonths(settings)), maxMonths: fmtMonths(settings.entrySoundMaxMonths), maxSeconds: settings.entrySoundMaxSeconds },
    });
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
