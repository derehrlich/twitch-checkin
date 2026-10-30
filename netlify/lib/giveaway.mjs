// Gewinnspiele: Punkte pro Stream, Teilnahmeschwelle, gewichtete Ziehung und Auswertung.
// Die Rechenlogik (oberer Teil) ist rein und ohne Speicher testbar; darunter liegen Laden, Speichern und Ziehen.
//
// Schlüssel:
//   gwstream/<tag>/<twitchId>   { name, msgs, all, first, last }  gezählte Nachrichten (Abstand beachtet), alle Nachrichten, Zeit der ersten und letzten gezählten (ms)
//   gwstats/<tag>               { samples, sum, peak, followers, followersAt, lastLive }  Zuschauer und Follower, vom Abfrage-Job gefüllt
//   giveaway/<id>               Einstellungen eines Gewinnspiels (Zeitraum, Preise, Regeln, ausgefallene Streams)
//   gwdraw/<id>/<zeit>          Protokoll einer Ziehung: Teilnehmer mit Punkten, Gewinner, Zeitstempel
// Check-ins stehen schon in user/<id>.days, daraus wird je Stream „eingecheckt ja/nein“ gelesen.
import crypto from 'node:crypto';
import { db } from './store.mjs';
import { fill, streamDay } from './checkin.mjs';
import { getStreamDays } from './streak.mjs';
import { allUsers } from './admin/common.mjs';

// ---- Tage und Wochen (Tage als 'YYYY-MM-DD', Wochen beginnen am Montag)

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s) => typeof s === 'string' && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().startsWith(s);
const at = (day) => new Date(`${day}T12:00:00Z`);
export const addDays = (day, n) => new Date(at(day).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** 0 = Sonntag, 1 = Montag, … 6 = Samstag */
export const weekdayOf = (day) => at(day).getUTCDay();
/** Montag der Kalenderwoche, dient als Schlüssel der Woche */
export const weekOf = (day) => addDays(day, -((weekdayOf(day) + 6) % 7));
export const daysBetween = (from, to) => { const out = []; for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d); return out; };
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const weekdayName = (day) => WEEKDAYS[weekdayOf(day)];
export const fmtDate = (day) => `${day.slice(8)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

// ---- Regeln

export const RULE_DEFAULTS = {
  minStreams: 6, minWeeks: 3,
  fixedDays: [1, 5], // Montag und Freitag
  checkinPts: 1, chatPts: 1, highPts: 1, streakBonus: 2,
  chatMinMsgs: 3, chatMinSpanMin: 30, chatHighMsgs: 10,
  chatNeedsCheckin: true, // Chatpunkte nur in Streams, in denen die Person auch eingecheckt war
};

/** Chatpunkte eines Streams: { chat, high } (je 0 oder 1, mal Punktewert) aus den gezählten Nachrichten. */
export function chatPointsFor(rec, rules) {
  if (!rec || rec.msgs < rules.chatMinMsgs) return { chat: 0, high: 0 };
  if ((rec.last ?? 0) - (rec.first ?? 0) < rules.chatMinSpanMin * 60_000) return { chat: 0, high: 0 }; // genau 30 Minuten reichen
  return { chat: rules.chatPts, high: rec.msgs >= rules.chatHighMsgs ? rules.highPts : 0 };
}

/** Feste Streams je Kalenderwoche: { wochenMontag: [Tage] }, nur Streams, die stattgefunden haben (und nicht ausgefallen sind). */
export function requiredByWeek(streamDays, fixedDays) {
  const weeks = {};
  for (const d of streamDays) if (fixedDays.includes(weekdayOf(d))) (weeks[weekOf(d)] ??= []).push(d);
  return weeks;
}

/**
 * Punktestand aller Personen.
 *  rules       Regeln des Gewinnspiels
 *  streamDays  Tage im Zeitraum, an denen gestreamt wurde (ausgefallene schon abgezogen)
 *  checkins    { id: [Tage] }
 *  chat        { id: { tag: { msgs, first, last } } }
 *  names       { id: Name }
 * Rückgabe: Zeilen nach Punkten absteigend, mit Qualifikation und Gewinnchance in Prozent.
 */
export function computeStandings({ rules, streamDays, checkins, chat = {}, names = {} }) {
  const held = new Set(streamDays);
  const required = Object.values(requiredByWeek(streamDays, rules.fixedDays)).filter((l) => l.length);
  const ids = new Set([...Object.keys(checkins), ...Object.keys(chat)]);
  const rows = [];
  for (const id of ids) {
    const days = new Set((checkins[id] ?? []).filter((d) => held.has(d)));
    let chatPts = 0;
    for (const [d, rec] of Object.entries(chat[id] ?? {})) {
      if (!held.has(d) || (rules.chatNeedsCheckin && !days.has(d))) continue;
      const p = chatPointsFor(rec, rules);
      chatPts += p.chat + p.high;
    }
    const streakWeeks = required.filter((list) => list.every((d) => days.has(d))).length;
    const weeks = new Set([...days].map(weekOf)).size;
    const checkinPts = days.size * rules.checkinPts;
    const streakPts = streakWeeks * rules.streakBonus;
    const points = checkinPts + chatPts + streakPts;
    if (!days.size && !points) continue;
    const qualified = days.size >= rules.minStreams && weeks >= rules.minWeeks;
    rows.push({
      id, name: names[id] ?? id, checkins: days.size, weeks, checkinPts, chatPts, streakPts, streakWeeks, points, qualified,
      missingStreams: Math.max(0, rules.minStreams - days.size), missingWeeks: Math.max(0, rules.minWeeks - weeks),
    });
  }
  const total = rows.filter((r) => r.qualified).reduce((s, r) => s + r.points, 0);
  for (const r of rows) r.chance = r.qualified && total ? (r.points / total) * 100 : 0;
  return rows.sort((a, b) => b.points - a.points || b.checkins - a.checkins || a.name.localeCompare(b.name, 'de'));
}

// ---- Ziehung

/** Eine Person gewichtet ziehen: jeder Punkt ist ein Los. rand(n) liefert eine ganze Zahl von 0 bis n-1. */
export function drawOne(pool, rand = crypto.randomInt) {
  const total = pool.reduce((s, p) => s + p.points, 0);
  if (!pool.length || total <= 0) return null;
  let r = rand(total);
  for (const p of pool) { if (r < p.points) return { winner: p, tickets: total }; r -= p.points; }
  return null;
}

// ---- Auswertung

/** Anteil in Prozent, auf eine Nachkommastelle */
export const pct = (v) => Math.round(v * 10) / 10;

/**
 * Kennzahlen eines Zeitraums. Fehlen Daten (z. B. weil der Bot noch nicht mitgezählt hat), ist der Wert null statt 0.
 *  stats     { tag: gwstats }, chat { tag: { id: gwstream } }, checkins { id: [Tage] }, streamDays alle Streamtage des Zeitraums
 */
export function periodMetrics({ from, to, streamDays, stats, chat, checkins, followersBefore = null, followersAfter = null }) {
  const days = streamDays.filter((d) => d >= from && d <= to);
  const sampled = days.map((d) => stats[d]).filter((s) => s?.samples > 0);
  const samples = sampled.reduce((s, x) => s + x.samples, 0);
  const chatDays = days.filter((d) => chat[d]);
  const chatters = new Set();
  let messages = 0;
  for (const d of chatDays) for (const [id, rec] of Object.entries(chat[d])) { messages += rec.all ?? rec.msgs; chatters.add(id); }
  const inRange = new Set(days);
  let checkinCount = 0, returning = 0;
  for (const list of Object.values(checkins)) {
    const n = list.filter((d) => inRange.has(d)).length;
    checkinCount += n;
    if (n >= 3) returning++;
  }
  return {
    streams: days.length,
    avgViewers: samples ? Math.round((sampled.reduce((s, x) => s + x.sum, 0) / samples) * 10) / 10 : null,
    peakViewers: sampled.length ? Math.max(...sampled.map((x) => x.peak)) : null,
    messages: chatDays.length ? messages : null,
    chatters: chatDays.length ? chatters.size : null,
    checkins: days.length ? checkinCount : null,
    returning: days.length ? returning : null,
    followers: followersBefore != null && followersAfter != null ? followersAfter - followersBefore : null,
  };
}

/** Vergleichszeitraum: liegt das Gewinnspiel in einem Kalendermonat ab dem 1., ist es der Vormonat; sonst der gleich lange Zeitraum davor. */
export function defaultCompare(start, end) {
  if (start.endsWith('-01') && start.slice(0, 7) === end.slice(0, 7)) {
    const last = addDays(start, -1);
    return { from: `${last.slice(0, 7)}-01`, to: last };
  }
  const len = daysBetween(start, end).length;
  return { from: addDays(start, -len), to: addDays(start, -1) };
}

/** Kosten je Wirkung; null, wenn nichts dazugekommen ist. */
export const costPer = (cost, delta) => (delta != null && delta > 0 && cost > 0 ? Math.round((cost / delta) * 100) / 100 : null);

// ---- Texte

export const prizeText = (g, place) => g.prizes[place - 1]?.title ?? '';
export const totalCost = (g) => Math.round(g.prizes.reduce((s, p) => s + (Number(p.cost) || 0), 0) * 100) / 100;

export function defaultAnnouncement(g) {
  const fixed = g.fixedDays.map((d) => WEEKDAYS[d]).join(' und ');
  const prizes = g.prizes.map((p, i) => `${i + 1}. Platz: ${p.title}`).join(' · ');
  return `🎁 ${g.name}: Vom ${fmtDate(g.start)} bis ${fmtDate(g.end)} verlosen wir ${prizes}. `
    + `So geht’s: Check-in per Kanalpunkte = 1 Punkt pro Stream. Wer im Chat aktiv ist (mindestens ${g.chatMinMsgs} Nachrichten über mindestens ${g.chatMinSpanMin} Minuten), bekommt +${g.chatPts}, ab ${g.chatHighMsgs} Nachrichten noch +${g.highPts}. `
    + `Wer in einer Woche bei allen festen Streams (${fixed}) dabei ist, bekommt +${g.streakBonus}. `
    + `Teilnehmen darf, wer an mindestens ${g.minStreams} Streams in mindestens ${g.minWeeks} verschiedenen Wochen eingecheckt war. Jeder Punkt ist ein Los. `
    + `Die Teilnahme ist kostenlos. Abos und Bits haben keinen Einfluss auf die Gewinnchance. Lurken ist ausdrücklich okay! 💛`;
}

/** Hinweis für das Dashboard, wenn der Pflichttext fehlt. */
export const announcementOk = (text) => /kostenlos/i.test(text) && /abo/i.test(text) && /bits/i.test(text);

// ---- Gewinnspiele speichern

const gKey = (id) => `giveaway/${id}`;
const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);
const clampInt = (v, min, max, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback; };

/** Eingaben aus dem Dashboard prüfen. Fehler als Text, sonst das bereinigte Gewinnspiel. */
export function sanitizeGiveaway(input, base = {}) {
  const g = { ...RULE_DEFAULTS, prizes: [], cancelled: [], ...base };
  if (input.name !== undefined) g.name = cleanText(input.name, 80);
  if (!g.name) return { error: 'Bitte einen Namen eintragen' };
  for (const k of ['start', 'end']) if (input[k] !== undefined) g[k] = input[k];
  if (!isDay(g.start) || !isDay(g.end)) return { error: 'Bitte Beginn und Ende als Datum eintragen' };
  if (g.start > g.end) return { error: 'Das Ende liegt vor dem Beginn' };
  if (daysBetween(g.start, g.end).length > 366) return { error: 'Der Zeitraum ist länger als ein Jahr' };
  if (Array.isArray(input.prizes)) {
    g.prizes = input.prizes.slice(0, 10).map((p) => ({ title: cleanText(p?.title, 120), cost: Math.min(100_000, Math.max(0, Math.round((Number(String(p?.cost ?? 0).replace(',', '.')) || 0) * 100) / 100)) })).filter((p) => p.title);
    if (!g.prizes.length) return { error: 'Bitte mindestens einen Preis eintragen' };
  }
  if (!g.prizes.length) return { error: 'Bitte mindestens einen Preis eintragen' };
  g.minStreams = clampInt(input.minStreams, 1, 100, g.minStreams);
  g.minWeeks = clampInt(input.minWeeks, 1, 60, g.minWeeks);
  if (Array.isArray(input.fixedDays)) g.fixedDays = [...new Set(input.fixedDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  for (const k of ['checkinPts', 'chatPts', 'highPts', 'streakBonus']) g[k] = clampInt(input[k], 0, 100, g[k]);
  g.chatMinMsgs = clampInt(input.chatMinMsgs, 1, 1000, g.chatMinMsgs);
  g.chatHighMsgs = clampInt(input.chatHighMsgs, 1, 1000, g.chatHighMsgs);
  g.chatMinSpanMin = clampInt(input.chatMinSpanMin, 0, 600, g.chatMinSpanMin);
  if (typeof input.chatNeedsCheckin === 'boolean') g.chatNeedsCheckin = input.chatNeedsCheckin;
  for (const k of ['compareFrom', 'compareTo']) { if (input[k] === '' || input[k] === null) delete g[k]; else if (input[k] !== undefined) { if (!isDay(input[k])) return { error: 'Vergleichszeitraum: bitte Daten eintragen' }; g[k] = input[k]; } }
  if (g.compareFrom && g.compareTo && g.compareFrom > g.compareTo) return { error: 'Vergleichszeitraum: Ende liegt vor dem Beginn' };
  if (input.announcement !== undefined) g.announcement = cleanText(input.announcement, 1500);
  return { g };
}

export async function listGiveaways() {
  const out = [];
  for (const k of await db.list('giveaway/')) { const g = await db.get(k); if (g) out.push(g); }
  return out.sort((a, b) => b.start.localeCompare(a.start) || b.id.localeCompare(a.id));
}
export const getGiveaway = (id) => db.get(gKey(id));
export const saveGiveaway = (g) => db.set(gKey(g.id), g);
export const newGiveawayId = () => `g${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
export const deleteGiveaway = (id) => db.delete(gKey(id));

/** Laufendes Gewinnspiel (Heute liegt im Zeitraum); mehrere: das zuletzt begonnene. */
export async function activeGiveaway(settings, now = new Date()) {
  const today = streamDay(settings, now);
  return (await listGiveaways()).find((g) => g.start <= today && today <= g.end) ?? null;
}

// ---- Daten sammeln

/** Chat-Nachricht erfassen (nur Text ohne „!“-Befehl, nie vom Streamer oder von Bots). Gezählt wird höchstens eine Nachricht pro Abstand. */
export async function recordGiveawayChat(day, userId, name, settings, now = new Date()) {
  const key = `gwstream/${day}/${userId}`;
  const rec = (await db.get(key)) ?? { name, msgs: 0, all: 0, first: null, last: null };
  const t = now.getTime();
  rec.name = name;
  rec.all++;
  const counted = rec.last == null || t - rec.last >= settings.giveawayMsgGap * 1000;
  if (counted) { rec.msgs++; rec.first ??= t; rec.last = t; }
  await db.set(key, rec);
  return counted;
}

/** Personen, die weder punkten noch gezogen werden: der Streamer und die eingetragenen Bots. */
export async function excludedNames(settings) {
  const names = new Set(String(settings.creditsIgnore ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean));
  const tokens = await db.get('config/tokens');
  if (tokens?.login) names.add(String(tokens.login).toLowerCase());
  return { names, ids: new Set(tokens?.user_id ? [String(tokens.user_id)] : []) };
}

async function loadMany(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 25) out.push(...(await Promise.all(keys.slice(i, i + 25).map(async (k) => [k, await db.get(k)]))));
  return out.filter(([, v]) => v != null);
}

/** Alle Tage, an denen gestreamt wurde: Tage mit Check-in oder mit gemessenen Zuschauern. */
export async function allStreamDays() {
  const live = (await db.list('gwstats/')).map((k) => k.slice(8));
  const stats = {};
  for (const [k, v] of await loadMany((await db.list('gwstats/')))) stats[k.slice(8)] = v;
  const days = new Set([...(await getStreamDays()), ...live.filter((d) => stats[d]?.samples > 0)]);
  return { days: [...days].sort(), stats };
}

async function chatByDay(days) {
  const out = {};
  for (const d of days) {
    const rows = await loadMany(await db.list(`gwstream/${d}/`));
    if (rows.length) out[d] = Object.fromEntries(rows.map(([k, v]) => [k.split('/')[2], v]));
  }
  return out;
}

/** Alles, was für Rangliste, Stream-Verwaltung und Auswertung eines Gewinnspiels nötig ist. */
export async function loadGiveaway(g, settings) {
  const { days: allDays, stats } = await allStreamDays();
  const excluded = await excludedNames(settings);
  const users = (await allUsers()).filter((u) => !excluded.ids.has(u.id) && !excluded.names.has(String(u.name).toLowerCase()));
  const cancelled = new Set(g.cancelled ?? []);
  const held = allDays.filter((d) => d >= g.start && d <= g.end && !cancelled.has(d));
  const chatAll = await chatByDay(held);
  const checkins = Object.fromEntries(users.map((u) => [u.id, u.days ?? []]));
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const chat = {};
  for (const [d, byId] of Object.entries(chatAll)) for (const [id, rec] of Object.entries(byId)) {
    if (excluded.ids.has(id) || excluded.names.has(String(rec.name).toLowerCase())) continue;
    (chat[id] ??= {})[d] = rec;
    names[id] ??= rec.name;
  }
  const rows = computeStandings({ rules: g, streamDays: held, checkins, chat, names });
  return { rows, held, allDays, stats, checkins, cancelled };
}

// ---- Ziehung durchführen

const pad = (n) => String(n).padStart(15, '0');
const dKey = (gid, at) => `gwdraw/${gid}/${pad(at)}`;

export async function listDraws(gid) {
  return (await loadMany(await db.list(`gwdraw/${gid}/`))).map(([, v]) => v).sort((a, b) => a.at - b.at);
}

/**
 * Zieht den nächsten Platz. Läuft keine Ziehung (oder ist die letzte fertig und fresh gesetzt), beginnt eine neue mit eingefrorenem Punktestand.
 * Teilnehmerliste, Punkte, Gewinner und Zeitstempel landen im Protokoll. Der Platz wird atomar reserviert, ein Doppelklick zieht nicht doppelt.
 */
export async function drawNext(g, settings, { fresh = false, rand = crypto.randomInt, now = Date.now() } = {}) {
  const draws = await listDraws(g.id);
  let draw = draws.at(-1);
  if (!draw || draw.done) {
    if (draw && !fresh) return { error: 'Die Ziehung ist abgeschlossen. Für eine neue Ziehung bitte „Neue Ziehung“ wählen.' };
    const { rows } = await loadGiveaway(g, settings);
    const participants = rows.filter((r) => r.qualified && r.points > 0).map((r) => ({ id: r.id, name: r.name, points: r.points, checkins: r.checkins, weeks: r.weeks, chatPts: r.chatPts, streakPts: r.streakPts }));
    if (!participants.length) return { error: 'Niemand ist qualifiziert, es gibt nichts zu ziehen' };
    draw = { id: pad(now), gid: g.id, name: g.name, at: now, rules: { ...g, announcement: undefined, cancelled: g.cancelled }, places: g.prizes.length, participants, winners: [], done: false };
  }
  const place = draw.winners.length + 1;
  if (!(await db.setIfNew(`gwlock/${g.id}/${draw.id}/${place}`, 1))) return { error: 'Es wird gerade gezogen, bitte kurz warten' };
  const pool = draw.participants.filter((p) => !draw.winners.some((w) => w.id === p.id));
  const res = drawOne(pool, rand);
  if (!res) { draw.done = true; await db.set(dKey(g.id, draw.at), draw); return { draw, error: 'Es sind nicht genug qualifizierte Teilnehmer übrig' }; }
  const w = res.winner;
  draw.winners.push({ place, id: w.id, name: w.name, points: w.points, chance: pct((w.points / res.tickets) * 100), pool: pool.length, prize: prizeText(g, place), at: now });
  draw.done = draw.winners.length >= draw.places || pool.length === 1;
  await db.set(dKey(g.id, draw.at), draw);
  return { draw, winner: draw.winners.at(-1) };
}

export const winnerChat = (settings, w) => fill(settings.giveawayDrawTemplate, { place: w.place, user: w.name, prize: w.prize });
