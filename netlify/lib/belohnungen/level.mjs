// Dorf-Level: aus allen Punkten (alle Monate zusammen, wie in der Community-Rangliste gerechnet) wird eine Stufe mit Titel im Bau-Thema.
// Ein erreichtes Level geht nie wieder verloren (auch wenn Gewichte oder Stufen später geändert werden).
//   level/<twitchId>   { n, at }   höchste je erreichte Stufe
// Der VerwirrBot holt die Stufen der verknüpften Konten (GET /api/community/levels) und vergibt die Discord-Rollen.
import { db } from '../kern/store.mjs';
import { fill } from '../zuschauer/checkin.mjs';
import { allLinks, linkByTwitch, pointsOf } from './community.mjs';

export const DEFAULT_TABLE = '0 | Zaungast\n100 | Hilfsarbeiter\n300 | Handlanger\n600 | Maurerlehrling\n1000 | Geselle\n1600 | Vorarbeiter\n2500 | Polier\n4000 | Bauleiter\n6000 | Baumeister\n10000 | Dorfältester';
export const MAX_LEVELS = 20;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** „600 | Maurerlehrling“ je Zeile -> Stufen, nach Punkten sortiert, die erste beginnt bei 0. Ungültiges fliegt raus, zu wenig Gültiges ergibt die Standardtabelle. */
export function parseTable(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*(\d{1,7})\s*[|;]\s*(.{1,30}?)\s*$/.exec(line);
    if (m && !rows.some((r) => r.points === Number(m[1]))) rows.push({ points: Number(m[1]), title: m[2] });
  }
  if (rows.length < 2) return text === DEFAULT_TABLE ? [] : parseTable(DEFAULT_TABLE);
  rows.sort((a, b) => a.points - b.points);
  rows[0].points = 0;
  return rows.slice(0, MAX_LEVELS).map((r, i) => ({ n: i + 1, points: r.points, title: r.title }));
}

/** Stufe zu einer Punktzahl: { n, title, points, next: { n, title, at, left } | null, progress (0 bis 1 innerhalb der Stufe) }. `floor` = höchste je erreichte Stufe. */
export function levelFor(table, points, floor = 0) {
  let cur = table[0];
  for (const l of table) if (points >= l.points) cur = l;
  if (floor > cur.n) cur = table[Math.min(floor, table.length) - 1];
  const next = table[cur.n] ?? null;
  const span = next ? Math.max(1, next.points - cur.points) : 1;
  return { n: cur.n, title: cur.title, points, next: next ? { n: next.n, title: next.title, at: next.points, left: Math.max(0, next.points - points) } : null, progress: next ? Math.min(1, Math.max(0, (points - cur.points) / span)) : 1, total: table.length };
}

// ---- Punkte über alle Monate
let monthsCache = { at: 0, months: [] };
async function allMonths(now) {
  if (now - monthsCache.at < 300_000) return monthsCache.months;
  const set = new Set();
  for (const p of ['cmonth/', 'dmonth/', 'bonus/']) for (const k of await db.list(p)) set.add(k.split('/')[1]);
  monthsCache = { at: now, months: [...set].filter((m) => MONTH.test(m)) };
  return monthsCache.months;
}
export const forgetLevels = () => { monthsCache = { at: 0, months: [] }; peopleCache = null; };

/** Alle Punkte einer Person: je Monat Twitch-Chat, aktive Tage, Check-ins und Bonus (Discord nur bei verknüpften Konten), zusammengezählt. */
export async function lifetimePoints(settings, id, { user, link, now = Date.now() } = {}) {
  user ??= await db.get(`user/${id}`);
  link ??= await linkByTwitch(id);
  const checkins = {};
  for (const d of user?.days ?? []) checkins[d.slice(0, 7)] = (checkins[d.slice(0, 7)] ?? 0) + 1;
  const months = new Set([...(await allMonths(now)), ...Object.keys(checkins).filter((m) => MONTH.test(m))]);
  let total = 0;
  for (const m of months) {
    const [tw, dc, bonus] = await Promise.all([db.get(`cmonth/${m}/${id}`), link ? db.get(`dmonth/${m}/${link.discordId}`) : null, db.get(`bonus/${m}/${id}`)]);
    total += pointsOf(settings, { msgs: (tw?.msgs ?? 0) + (dc?.msgs ?? 0), days: (tw?.days ?? 0) + (dc?.days ?? 0), checkins: checkins[m] ?? 0 }) + (bonus?.points ?? 0);
  }
  return total;
}

// ---- Höchste erreichte Stufe merken (nur nach oben)
let tail = Promise.resolve();
const lock = (fn) => { const run = tail.then(fn, fn); tail = run.catch(() => {}); return run; };
/** Gibt { up: true, from } zurück, wenn n höher ist als die gemerkte Stufe. */
export const ratchet = (id, n, now = Date.now()) => lock(async () => {
  const cur = await db.get(`level/${id}`);
  if (cur && cur.n >= n) return { up: false, n: cur.n };
  await db.set(`level/${id}`, { n, at: new Date(now).toISOString() });
  return { up: true, from: cur?.n ?? 0, n };
});

/** Stufe einer Person (mit Merken der höchsten Stufe). */
export async function levelOf(settings, id, opts = {}) {
  const table = parseTable(settings.levelTable);
  const points = await lifetimePoints(settings, id, opts);
  const floor = (await db.get(`level/${id}`))?.n ?? 0;
  const lv = levelFor(table, points, floor);
  const r = await ratchet(id, lv.n, opts.now);
  return { ...lv, up: r.up, from: r.from ?? lv.n };
}

export const nextText = (lv) => (lv.next ? `Noch ${lv.next.left} Punkte bis ${lv.next.title}.` : 'Höchste Stufe erreicht! 🏆');
export const levelVars = (name, lv) => ({ user: name, level: lv.n, title: lv.title, points: lv.points, next: nextText(lv) });

/** Antwort auf !level. */
export async function levelReply(e, settings) {
  const lv = await levelOf(settings, e.chatter_user_id);
  return fill(settings.levelTemplate, levelVars(e.chatter_user_name, lv));
}

/** Nach einem Check-in: Text zum Feiern, wenn die Person eine neue Stufe erreicht hat (sonst null). */
export async function levelUpText(userId, name, settings, opts = {}) {
  if (!settings.levelEnabled) return null;
  const lv = await levelOf(settings, userId, opts);
  return lv.up ? fill(settings.levelUpTemplate, levelVars(name, lv)) : null;
}

// ---- Für den VerwirrBot und die Admin-Übersicht: Stufen aller verknüpften Konten (fünf Minuten zwischengespeichert)
let peopleCache = null;
export async function linkedLevels(settings, now = Date.now()) {
  if (peopleCache && now - peopleCache.at < 300_000) return peopleCache.people;
  const table = parseTable(settings.levelTable);
  const people = [];
  for (const l of (await allLinks()).slice(0, 1000)) {
    const points = await lifetimePoints(settings, l.twitchId, { link: l, now });
    const floor = (await db.get(`level/${l.twitchId}`))?.n ?? 0;
    const lv = levelFor(table, points, floor);
    await ratchet(l.twitchId, lv.n, now);
    people.push({ discordId: l.discordId, twitchId: l.twitchId, name: l.twitchName, level: lv.n, points });
  }
  peopleCache = { at: now, people };
  return people;
}

export async function botView(settings) {
  return { enabled: Boolean(settings.levelEnabled), levels: parseTable(settings.levelTable).map((l) => ({ n: l.n, title: l.title, points: l.points })), people: settings.levelEnabled ? (await linkedLevels(settings)).map((p) => ({ discordId: p.discordId, level: p.level, points: p.points })) : [] };
}

export async function adminView(settings) {
  const table = parseTable(settings.levelTable);
  const people = settings.levelEnabled ? await linkedLevels(settings) : [];
  return {
    enabled: Boolean(settings.levelEnabled), command: settings.levelCommand,
    levels: table.map((l) => ({ ...l, people: people.filter((p) => p.level === l.n).length })),
    linked: people.length, top: [...people].sort((a, b) => b.points - a.points).slice(0, 5).map((p) => ({ name: p.name, level: p.level, points: p.points })),
  };
}
