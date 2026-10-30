// Öffentliche Sicht auf das Gewinnspiel für die OBS-Quelle /gewinnspiel (Ziehung live) und den VerwirrBot (Regeln, Rangliste).
//   GET /api/giveaway          Name, Zeitraum, Preise (ohne Kosten) und Gewinner der letzten Ziehung. Ohne Anmeldung.
//   GET /api/giveaway/ranking  Rangliste ohne Gewinnchancen, nur mit dem Geheimwort LINK_SECRET (für Discord)
import { getSettings } from '../lib/settings.mjs';
import { json } from '../lib/http.mjs';
import { botAuthorized, linkByTwitch, secretSet } from '../lib/community.mjs';
import { activeGiveaway, defaultAnnouncement, listDraws, listGiveaways, loadGiveaway } from '../lib/giveaway.mjs';

export const config = { path: ['/api/giveaway', '/api/giveaway/*'] };

export default async (req) => {
  const settings = await getSettings();
  const route = new URL(req.url).pathname.replace(/^\/api\/giveaway\/?/, '').split('/').filter(Boolean);
  const list = await listGiveaways();
  const g = (await activeGiveaway(settings)) ?? list[0] ?? null; // läuft keins, zählt das zuletzt begonnene (für die Anzeige nach der Ziehung)

  if (route[0] === 'ranking') {
    if (!secretSet() || !botAuthorized(req)) return json({ error: 'Nicht berechtigt' }, 401);
    if (!g) return json({ giveaway: null, rows: [] });
    const { rows } = await loadGiveaway(g, settings);
    return json({
      giveaway: { name: g.name, start: g.start, end: g.end, minStreams: g.minStreams, minWeeks: g.minWeeks, announcement: g.announcement || defaultAnnouncement(g), prizes: g.prizes.map((p) => p.title) },
      // linked: hat die Person ihr Discord-Konto freiwillig verknüpft? Der Bot kann daran entscheiden, wen er namentlich zeigt.
      rows: await Promise.all(rows.slice(0, 50).map(async (r) => ({ name: r.name, points: r.points, checkins: r.checkins, qualified: r.qualified, linked: Boolean(await linkByTwitch(r.id)) }))),
    });
  }

  if (!g) return json({ giveaway: null });
  const draw = (await listDraws(g.id)).at(-1) ?? null;
  return json({
    giveaway: { name: g.name, start: g.start, end: g.end, prizes: g.prizes.map((p, i) => ({ place: i + 1, title: p.title })) },
    draw: draw ? { at: draw.at, done: draw.done, places: draw.places, winners: draw.winners.map((w) => ({ place: w.place, name: w.name, prize: w.prize })) } : null,
  });
};
