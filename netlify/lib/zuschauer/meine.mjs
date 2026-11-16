// „Meine Stadtwache“: die persönliche Seite eines Zuschauers (/meine). Angemeldet mit Twitch (ohne Berechtigungen) sieht jede Person
// NUR ihre eigenen Zahlen: Besuche, Streak, Zeit im Stream, nächster Meilenstein, Punkte und Rang im Monat und den Einlaufsound.
// Es wird nichts gespeichert, alles wird aus den vorhandenen Daten berechnet.
import { db } from '../kern/store.mjs';
import { streamDay } from './checkin.mjs';
import { computeStreak, getStreamDays, parseLevels } from './streak.mjs';
import { linkByTwitch, monthBoard, monthOf, pointsOf } from '../belohnungen/community.mjs';
import { viewFor } from '../belohnungen/entrysound.mjs';
import { siteUrl } from '../kern/twitch.mjs';
import { fill } from './checkin.mjs';

let boardCache = null; // { at, month, board } die Rangliste ändert sich langsam, eine Minute Zwischenspeicher genügt
async function cachedBoard(settings, now) {
  const month = monthOf(settings, new Date(now));
  if (boardCache && boardCache.month === month && now - boardCache.at < 60_000) return boardCache.board;
  const board = await monthBoard(settings, month);
  boardCache = { at: now, month, board };
  return board;
}
export const forgetBoard = () => { boardCache = null; };

/** Punkte im Monat wie in der Rangliste: Twitch-Chat, aktive Tage, Check-ins und Bonus (Discord nur bei verknüpften Konten). */
async function monthOfPerson(settings, id, user, now) {
  const month = monthOf(settings, new Date(now));
  const link = await linkByTwitch(id);
  const [tw, dc, bonus] = await Promise.all([db.get(`cmonth/${month}/${id}`), link ? db.get(`dmonth/${month}/${link.discordId}`) : null, db.get(`bonus/${month}/${id}`)]);
  const parts = { msgs: (tw?.msgs ?? 0) + (dc?.msgs ?? 0), days: (tw?.days ?? 0) + (dc?.days ?? 0), checkins: (user?.days ?? []).filter((d) => d.startsWith(month)).length, bonus: bonus?.points ?? 0 };
  return { month, linked: Boolean(link), parts, points: pointsOf(settings, parts) + parts.bonus };
}

export async function meView(viewer, settings, now = Date.now()) {
  const user = await db.get(`user/${viewer.id}`);
  const today = streamDay(settings, new Date(now));
  const streak = user ? computeStreak(user, await getStreamDays(), today, settings.streakGrace) : { current: 0, record: 0 };
  const count = user?.count ?? 0;
  const next = parseLevels(settings.milestoneLevels).find((n) => n > count) ?? null;
  const out = {
    loggedIn: true, enabled: true, name: viewer.name,
    visits: {
      count, first: user?.first ?? null, last: user?.last ?? null, today: Boolean(await db.get(`checked/${today}/${viewer.id}`)),
      minutes: Object.values(user?.sessions ?? {}).reduce((s, x) => s + (x.minutes ?? 0), 0),
      streak: { current: streak.current, record: streak.record }, next: next ? { at: next, left: next - count } : null,
    },
    month: null,
    entrySound: settings.entrySoundEnabled ? (({ status, validUntil, soundName }) => ({ status, validUntil, soundName }))(await viewFor(viewer.id, settings)) : null,
  };
  if (settings.communityEnabled) {
    const mine = await monthOfPerson(settings, viewer.id, user, now);
    const board = await cachedBoard(settings, now);
    const i = board.rows.findIndex((r) => r.twitchId === viewer.id);
    out.month = {
      label: board.label, points: mine.points, parts: mine.parts, linked: mine.linked, total: board.rows.length,
      rank: i >= 0 ? i + 1 : null,
      // Ohne Verknüpfung steht man nicht in der Rangliste. Die Zahl zeigt, wo man mit den eigenen Punkten stünde.
      wouldRank: i < 0 && mine.points > 0 ? board.rows.filter((r) => r.points > mine.points).length + 1 : null,
    };
  }
  return out;
}

export const meText = (e, settings) => fill(settings.meineTemplate, { user: e.chatter_user_name, url: `${siteUrl()}/meine` });
