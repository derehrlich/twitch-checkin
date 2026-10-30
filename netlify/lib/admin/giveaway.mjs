// /api/admin/giveaway: Gewinnspiele anlegen, Rangliste, Stream-Verwaltung, Ziehung und Auswertung.
//   GET    giveaway                  alle Gewinnspiele (Kurzform)
//   POST   giveaway                  anlegen
//   GET    giveaway/<id>             Einstellungen, Rangliste, Streams, Ziehungen, Auswertung
//   PUT    giveaway/<id>             ändern
//   DELETE giveaway/<id>             löschen (nur ohne Ziehung)
//   PUT    giveaway/<id>/stream      { day, cancelled } Stream als ausgefallen markieren oder zurücknehmen
//   POST   giveaway/<id>/announce    Ankündigungstext in den Chat
//   POST   giveaway/<id>/draw        { fresh? } nächsten Platz ziehen
import { getSettings } from '../settings.mjs';
import { streamDay } from '../checkin.mjs';
import { sendChat } from '../twitch.mjs';
import { json } from '../http.mjs';
import {
  RULE_DEFAULTS, addDays, announcementOk, costPer, daysBetween, defaultAnnouncement, defaultCompare, deleteGiveaway, drawNext, getGiveaway, isDay,
  listDraws, listGiveaways, loadGiveaway, newGiveawayId, periodMetrics, pct, sanitizeGiveaway, saveGiveaway, totalCost, weekdayOf, weekdayName, winnerChat,
} from '../giveaway.mjs';

/** Twitch erlaubt höchstens 500 Zeichen je Nachricht: an Satzenden in Teile bis 480 Zeichen schneiden. */
export function splitChat(text, max = 480) {
  const parts = [];
  let cur = '';
  for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]) {
    if (cur && (cur + sentence).length > max) { parts.push(cur.trim()); cur = ''; }
    cur += sentence;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.flatMap((p) => (p.length > max ? p.match(new RegExp(`.{1,${max}}`, 'g')) : [p]));
}

const summary = (g) => ({ id: g.id, name: g.name, start: g.start, end: g.end, cost: totalCost(g) });

function streamList(g, today, data) {
  const { held, allDays, stats, checkins } = data;
  const real = new Set(allDays);
  const cancelled = new Set(g.cancelled ?? []);
  const counts = {};
  for (const list of Object.values(checkins)) for (const d of list) counts[d] = (counts[d] ?? 0) + 1;
  const out = [];
  for (const day of daysBetween(g.start, g.end)) {
    const fixed = g.fixedDays.includes(weekdayOf(day));
    const took = real.has(day);
    if (!took && !fixed && !cancelled.has(day)) continue;
    const s = stats[day];
    out.push({
      day, weekday: weekdayName(day), fixed, cancelled: cancelled.has(day),
      status: cancelled.has(day) ? 'ausgefallen' : took ? 'gestreamt' : day > today ? 'geplant' : 'kein Stream',
      counts: held.includes(day), checkins: counts[day] ?? 0,
      avgViewers: s?.samples ? Math.round((s.sum / s.samples) * 10) / 10 : null, peak: s?.samples ? s.peak : null,
    });
  }
  return out;
}

async function evaluation(g, data, today) {
  const { allDays, stats, checkins } = data;
  const cmp = { from: g.compareFrom ?? defaultCompare(g.start, g.end).from, to: g.compareTo ?? defaultCompare(g.start, g.end).to };
  const loadChat = async (from, to) => {
    const { db } = await import('../store.mjs');
    const chat = {};
    for (const d of allDays.filter((x) => x >= from && x <= to)) {
      const keys = await db.list(`gwstream/${d}/`);
      if (keys.length) chat[d] = Object.fromEntries(await Promise.all(keys.map(async (k) => [k.split('/')[2], await db.get(k)])));
    }
    return chat;
  };
  // Follower-Stand: der letzte gemessene Stand am oder vor dem Tag, für den Beginn der Stand vor dem Zeitraum
  const followersAt = (day) => { const d = Object.keys(stats).filter((x) => x <= day && stats[x].followers != null).sort().at(-1); return d ? stats[d].followers : null; };
  const metrics = async (from, to) => {
    const end = to > today ? today : to;
    return periodMetrics({ from, to: end, streamDays: allDays.filter((d) => !(g.cancelled ?? []).includes(d)), stats, chat: await loadChat(from, end), checkins, followersBefore: followersAt(addDays(from, -1)), followersAfter: followersAt(end) });
  };
  const now = await metrics(g.start, g.end);
  const before = await metrics(cmp.from, cmp.to);
  const cost = totalCost(g);
  const delta = (k) => (now[k] != null && before[k] != null ? Math.round((now[k] - before[k]) * 10) / 10 : null);
  return {
    cost, period: { from: g.start, to: g.end }, compare: cmp, now, before,
    perFollower: costPer(cost, now.followers), perReturning: costPer(cost, delta('returning')),
    deltaReturning: delta('returning'),
  };
}

async function detail(g, settings) {
  const today = streamDay(settings);
  const data = await loadGiveaway(g, settings);
  const draws = await listDraws(g.id);
  const rows = data.rows.map((r) => ({ ...r, chance: pct(r.chance) }));
  const announcement = g.announcement || defaultAnnouncement(g);
  return {
    giveaway: g, today, rows,
    totals: { people: rows.length, qualified: rows.filter((r) => r.qualified).length, points: rows.filter((r) => r.qualified).reduce((s, r) => s + r.points, 0), cost: totalCost(g) },
    streams: streamList(g, today, data), draws,
    evaluation: await evaluation(g, data, today),
    announcement, announcementWarning: !announcementOk(announcement),
    defaultAnnouncement: defaultAnnouncement(g),
  };
}

export async function giveaway({ route, method, body }) {
  const settings = await getSettings();
  if (route.length === 1) {
    if (method === 'GET') return json({ giveaways: (await listGiveaways()).map(summary), defaults: RULE_DEFAULTS });
    if (method === 'POST') {
      const res = sanitizeGiveaway(body);
      if (res.error) return json({ error: res.error }, 400);
      const g = { ...res.g, id: newGiveawayId() };
      await saveGiveaway(g);
      return json({ id: g.id });
    }
    return;
  }
  const g = await getGiveaway(route[1]);
  if (!g) return json({ error: 'Gewinnspiel nicht gefunden' }, 404);

  if (route.length === 2) {
    if (method === 'GET') return json(await detail(g, settings));
    if (method === 'PUT') {
      const res = sanitizeGiveaway(body, g);
      if (res.error) return json({ error: res.error }, 400);
      await saveGiveaway({ ...res.g, id: g.id });
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      if ((await listDraws(g.id)).length) return json({ error: 'Es gibt bereits eine Ziehung, das Gewinnspiel bleibt zur Nachvollziehbarkeit erhalten' }, 409);
      await deleteGiveaway(g.id);
      return json({ ok: true });
    }
    return;
  }

  if (route[2] === 'stream' && method === 'PUT') {
    if (!isDay(body.day) || body.day < g.start || body.day > g.end) return json({ error: 'Der Tag liegt nicht im Zeitraum' }, 400);
    const set = new Set(g.cancelled ?? []);
    if (body.cancelled) set.add(body.day); else set.delete(body.day);
    g.cancelled = [...set].sort();
    await saveGiveaway(g);
    return json({ ok: true });
  }

  if (route[2] === 'announce' && method === 'POST') {
    if (!settings.chatEnabled) return json({ error: 'Chatnachrichten sind unter „Allgemein“ ausgeschaltet' }, 409);
    for (const part of splitChat(g.announcement || defaultAnnouncement(g))) await sendChat(part);
    return json({ ok: true });
  }

  if (route[2] === 'draw' && method === 'POST') {
    const res = await drawNext(g, settings, { fresh: body.fresh === true });
    if (res.error) return json({ error: res.error, draw: res.draw ?? null }, res.draw ? 200 : 409);
    if (settings.giveawayDrawChat && settings.chatEnabled) await sendChat(winnerChat(settings, res.winner)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
    return json({ draw: res.draw, winner: res.winner });
  }
}
