// Sonderziehung (Geburtstags-Gewinnspiel): Ticket per Kanalpunkte, Wochenpunkte als Bonuslose, gewichtete Ziehung,
// Gewinner-Links mit Meldefrist und Nachziehen. Alles lokal, keine Drittdienste.
//
// Speicher (alles unter gw/, ohne Adressen):
//   gw/current                   { id }  die Ziehung, für die Tickets eingelöst werden
//   gw/draw/<id>                 Einstellungen der Ziehung (Zeiten, Lose-Rechnung, Preise, Sperrliste, Bedingungen)
//   gw/<id>/pts/<twitchId>       Wochenpunkte { name, checkinDays, streakPts, chatCount, chatDay, dayMsgs, lastAt, points }
//   gw/<id>/ticket/<twitchId>    eingelöstes Ticket { name, at, points, redemptionId } (setIfNew = genau eines pro Person)
//   gw/<id>/result               Ziehungsprotokoll, wird nur einmal geschrieben und nie geändert
//   gw/<id>/redraw/<zeit>        Protokoll je Nachziehen (ebenfalls unveränderlich)
//   gw/<id>/w/<winnerId>         Gewinner eines Preises { status, code, deadline, ... }
//   gw/overlay                   Zustand der OBS-Anzeige
//   gwcode/<sha256(code)>        { drawId, winnerId }  (Suche nach dem Link-Code)
//   gwdm/<winnerId>              Discord-Nachricht, die der VerwirrBot abholen soll
//   gwaddr/<winnerId>            Adresse, AES-256-GCM verschlüsselt. Liegt bewusst NICHT in den Sicherungen und wird nach Versand gelöscht.
import crypto from 'node:crypto';
import { db } from '../kern/store.mjs';
import { fill, streamDay } from '../zuschauer/checkin.mjs';
import { helix, sendChat, sendWhisper, setRedemptionStatus, siteUrl, userToken } from '../kern/twitch.mjs';
import { linkByTwitch } from './community.mjs';

export const STATUS = ['gezogen', 'link_verschickt', 'gemeldet', 'adresse_erhalten', 'versendet', 'abgeschlossen', 'verfallen'];
export const STATUS_LABEL = { gezogen: 'Gezogen', link_verschickt: 'Link verschickt', gemeldet: 'Gemeldet', adresse_erhalten: 'Adresse erhalten', versendet: 'Versendet', abgeschlossen: 'Abgeschlossen', verfallen: 'Verfallen (nachgezogen)' };
export const COUNTRIES = { DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz' };
const ID = /^[a-f0-9]{12}$/;
export const isId = (v) => ID.test(String(v ?? ''));
const rid = () => crypto.randomBytes(6).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const DEFAULT_TERMS = `ENTWURF – bitte vor der Veröffentlichung selbst prüfen oder gegenlesen lassen (keine Rechtsberatung).

Veranstalter
Marcel Ehrlich (EhrlichVerwirrt), Anschrift laut Impressum. Twitch ist weder Veranstalter noch Sponsor dieses Gewinnspiels.

Teilnahme
Teilnehmen kann, wer im Zeitraum des Ticket-Fensters im Twitch-Kanal das Geburtstags-Ticket mit Kanalpunkten einlöst. Pro Person gibt es genau ein Ticket. Kanalpunkte sind kostenlos verdienbar, es ist kein Geld nötig. Teilnahme ab 18 Jahren, Minderjährige nur mit Zustimmung der Erziehungsberechtigten. Ein Account pro Person. Mehrfach-Accounts und Manipulation führen zum Ausschluss.

Gewinnchance
Das Ticket zählt als ein Los. Wer in der Geburtstagswoche aktiv war (Check-in, Chat, Streak), bekommt Bonuslose, höchstens bis zur eingestellten Obergrenze. Abos und Bits haben keinen Einfluss auf Punkte, Lose oder Gewinnchance.

Ziehung
Die Ziehung erfolgt live im Stream per Zufall durch den Bot, gewichtet nach Losen, ohne Zurücklegen. Das Protokoll wird gespeichert. Der Rechtsweg ist ausgeschlossen, eine Barauszahlung ist nicht möglich.

Meldefrist
Gewinner bekommen einen persönlichen Link (per Twitch-Flüsternachricht oder Discord-DM). Wer sich nicht innerhalb von 24 Stunden meldet, verliert den Preis, es wird nachgezogen.

Datenschutz
Es werden nur nötige Daten verarbeitet: Twitch-Name, Zeitpunkt des Tickets, Wochenpunkte. Die Adresse wird nur bei Gewinnern von Sachpreisen gespeichert, verschlüsselt, nur für den Versand und danach automatisch gelöscht. Keine Weitergabe an Dritte außer dem Versanddienstleister.`;

// ---- Zeit

const parts = (ms, tz) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
};
const offset = (ms, tz) => { const p = parts(ms, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };

/** „2026-11-30T20:00“ in der Zeitzone -> ISO-Zeit (UTC), ungültig -> null */
export function parseLocal(str, tz) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(str ?? ''))) return null;
  const asUtc = Date.parse(`${str}:00Z`);
  if (Number.isNaN(asUtc)) return null;
  const t = asUtc - offset(asUtc - offset(asUtc, tz), tz);
  return new Date(t).toISOString();
}
/** ISO-Zeit -> „2026-11-30T20:00“ in der Zeitzone (für das Eingabefeld) */
export function toLocal(iso, tz) {
  if (!iso) return '';
  const p = parts(Date.parse(iso), tz);
  const z = (n) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

// ---- Ziehung anlegen und lesen

const drawKey = (id) => `gw/draw/${id}`;
let currentCache = null; // { at, id } spart Zugriffe bei jeder Chat-Nachricht
export const forgetCache = () => { currentCache = null; };

export function defaultDraw(settings, now = new Date()) {
  const tz = settings.timezone;
  return {
    id: rid(), name: 'Geburtstags-Ziehung 2026', createdAt: now.toISOString(),
    pointsFrom: parseLocal('2026-11-23T00:00', tz), ticketOpen: parseLocal('2026-11-30T00:00', tz), ticketClose: null, manualClosed: false, plannedDraw: null,
    perPoints: 100, maxLots: 10,
    weights: { checkin: 50, streak: 10, streakCap: 7, chat: 2, chatDayCap: 20, chatGap: 20 },
    prizes: [
      { id: rid(), name: 'Enshrouded (Premium Edition)', kind: 'key', key: '' },
      { id: rid(), name: '3D-Druck: Pixel-Lama mit Bauhelm', kind: 'item', key: '' },
      { id: rid(), name: '3D-Druck (Platz 3)', kind: 'item', key: '' },
    ],
    blocked: [], winnerHours: 24, addressDays: 7, keepDays: 30, countries: ['DE'],
    terms: DEFAULT_TERMS, termsPublished: false, drawnAt: null,
  };
}

export const getDraw = (id) => (isId(id) ? db.get(drawKey(id)) : null);
export const saveDraw = (draw) => db.set(drawKey(draw.id), draw);

export async function createDraw(settings, now = new Date()) {
  const draw = defaultDraw(settings, now);
  await saveDraw(draw);
  await db.set('gw/current', { id: draw.id });
  forgetCache();
  return draw;
}

export async function currentDraw() {
  const cur = await db.get('gw/current');
  return cur ? getDraw(cur.id) : null;
}
export async function listDraws() {
  const out = [];
  for (const k of await db.list('gw/draw/')) { const d = await db.get(k); if (d) out.push({ id: d.id, name: d.name, drawn: Boolean(d.drawnAt), createdAt: d.createdAt }); }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
export async function setCurrent(id) {
  if (!(await getDraw(id))) return false;
  await db.set('gw/current', { id });
  forgetCache();
  return true;
}

const cachedCurrent = async (now) => {
  if (currentCache && now - currentCache.at < 5000) return currentCache.draw;
  const draw = await currentDraw();
  currentCache = { at: now, draw };
  return draw;
};

/** Zustand des Ticket-Fensters: 'vorher' | 'offen' | 'zu' (inkl. nach der Ziehung) */
export function windowState(draw, now = Date.now()) {
  if (!draw || draw.drawnAt || draw.manualClosed) return 'zu';
  if (draw.ticketOpen && now < Date.parse(draw.ticketOpen)) return 'vorher';
  if (draw.ticketClose && now >= Date.parse(draw.ticketClose)) return 'zu';
  return draw.ticketOpen ? 'offen' : 'vorher';
}

// ---- Einstellungen der Ziehung prüfen

const num = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const str = (v, max) => String(v ?? '').trim().slice(0, max);

/** Übernimmt Eingaben aus dem Dashboard. Nach der Ziehung sind nur Fristen, Länder, Texte und Keys änderbar (die Gewichtung bleibt, wie sie war). */
export function applyConfig(draw, input, settings) {
  const tz = settings.timezone;
  const next = { ...draw, weights: { ...draw.weights } };
  const locked = Boolean(draw.drawnAt);
  const i = input ?? {};
  const time = (v) => (v === '' || v == null ? null : parseLocal(v, tz));
  if (!locked) {
    if ('name' in i) next.name = str(i.name, 60) || draw.name;
    for (const k of ['pointsFrom', 'ticketOpen', 'ticketClose', 'plannedDraw']) if (k in i) next[k] = time(i[k]);
    if ('perPoints' in i) next.perPoints = num(i.perPoints, 1, 100000, draw.perPoints);
    if ('maxLots' in i) next.maxLots = num(i.maxLots, 1, 1000, draw.maxLots);
    const w = i.weights ?? {};
    for (const [k, max] of [['checkin', 10000], ['streak', 10000], ['streakCap', 365], ['chat', 10000], ['chatDayCap', 1000], ['chatGap', 3600]]) if (k in w) next.weights[k] = num(w[k], 0, max, draw.weights[k]);
    if (Array.isArray(i.prizes)) {
      const old = new Map(draw.prizes.map((p) => [p.id, p]));
      next.prizes = i.prizes.slice(0, 10).map((p) => ({ id: isId(p?.id) ? p.id : rid(), name: str(p?.name, 80) || 'Preis', kind: p?.kind === 'item' ? 'item' : 'key', key: p?.key === undefined ? (old.get(p?.id)?.key ?? '') : str(p.key, 200) })).filter(Boolean);
      if (!next.prizes.length) throw new Error('Mindestens ein Preis wird gebraucht');
    }
  } else if (Array.isArray(i.prizes)) { // nur die Keys dürfen nachgetragen werden
    next.prizes = draw.prizes.map((p) => { const n = i.prizes.find((x) => x?.id === p.id); return n && p.kind === 'key' && 'key' in n ? { ...p, key: str(n.key, 200) } : p; });
  }
  if ('winnerHours' in i) next.winnerHours = num(i.winnerHours, 1, 720, draw.winnerHours);
  if ('addressDays' in i) next.addressDays = num(i.addressDays, 1, 90, draw.addressDays);
  if ('keepDays' in i) next.keepDays = num(i.keepDays, 1, 365, draw.keepDays);
  if (Array.isArray(i.countries)) next.countries = i.countries.filter((c) => c in COUNTRIES).slice(0, 3);
  if (!next.countries.length) next.countries = ['DE'];
  if ('terms' in i) next.terms = String(i.terms ?? '').slice(0, 12000);
  if ('termsPublished' in i) next.termsPublished = Boolean(i.termsPublished);
  return next;
}

// ---- Wochenpunkte

const ptsKey = (did, id) => `gw/${did}/pts/${id}`;
const computePoints = (w, rec) => rec.checkinDays.length * w.checkin + rec.streakPts + rec.chatCount * w.chat;
const blank = (name) => ({ name, checkinDays: [], streakPts: 0, chatCount: 0, chatDay: null, dayMsgs: 0, lastAt: 0, points: 0 });

/** Zählt nur, solange eine Ziehung läuft, die Wochenpunkt-Zeit begonnen hat und noch nicht gezogen wurde. */
async function countingDraw(now) {
  const draw = await cachedCurrent(now);
  return draw && !draw.drawnAt && draw.pointsFrom && now >= Date.parse(draw.pointsFrom) ? draw : null;
}

export async function countChat(id, name, settings, now = Date.now()) {
  const draw = await countingDraw(now);
  if (!draw) return false;
  const w = draw.weights, day = streamDay(settings, new Date(now));
  const rec = (await db.get(ptsKey(draw.id, id))) ?? blank(name);
  if (now - rec.lastAt < w.chatGap * 1000) return false;
  const same = rec.chatDay === day;
  if (same && rec.dayMsgs >= w.chatDayCap) return false;
  rec.name = name; rec.chatCount += 1; rec.chatDay = day; rec.dayMsgs = same ? rec.dayMsgs + 1 : 1; rec.lastAt = now;
  rec.points = computePoints(w, rec);
  await db.set(ptsKey(draw.id, id), rec);
  return true;
}

/** Check-in: Punkte pro Tag und ein Streak-Bonus (Streak-Tage, gedeckelt). Pro Stream-Tag nur einmal. */
export async function countCheckin(id, name, streak, settings, now = Date.now()) {
  const draw = await countingDraw(now);
  if (!draw) return false;
  const w = draw.weights, day = streamDay(settings, new Date(now));
  const rec = (await db.get(ptsKey(draw.id, id))) ?? blank(name);
  if (rec.checkinDays.includes(day)) return false;
  rec.name = name; rec.checkinDays.push(day);
  rec.streakPts += Math.min(Math.max(0, streak), w.streakCap) * w.streak;
  rec.points = computePoints(w, rec);
  await db.set(ptsKey(draw.id, id), rec);
  return true;
}

export const lotsFor = (draw, points) => Math.min(draw.maxLots, 1 + Math.floor(Math.max(0, points) / draw.perPoints));
const pointsOf = async (did, id) => (await db.get(ptsKey(did, id)))?.points ?? 0;

// ---- Sperrliste

const norm = (s) => String(s ?? '').trim().replace(/^@/, '').toLowerCase();
export const isBlocked = (draw, id, name) => (draw.blocked ?? []).some((b) => (b.id && b.id === String(id)) || norm(b.name) === norm(name));

// ---- Ticket einlösen

const say = async (settings, template, vars) => {
  if (settings.chatEnabled) await sendChat(fill(template, vars)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
};
const refund = (r) => setRedemptionStatus(r.id, r.reward.id, 'CANCELED');

/** Reward „Geburtstags-Ticket“: genau ein Ticket pro Person, nur im Ticket-Fenster. Sonst Hinweis und Punkte zurück. */
export async function handleGewinnTicket(redemption, settings, now = Date.now()) {
  const { id: rid_, user_id: id, user_name: name } = redemption;
  const draw = await currentDraw();
  const vars = { user: name, cost: settings.gwRewardCost };
  if (!draw || windowState(draw, now) !== 'offen') { await say(settings, settings.gwClosedTemplate, vars); await refund(redemption); return { ok: false, reason: 'closed' }; }
  if (isBlocked(draw, id, name)) { await say(settings, settings.gwBlockedTemplate, vars); await refund(redemption); return { ok: false, reason: 'blocked' }; }
  const points = await pointsOf(draw.id, id);
  // Atomar: nur das erste Ticket zählt, auch wenn zwei Einlösungen gleichzeitig ankommen
  if (!(await db.setIfNew(`gw/${draw.id}/ticket/${id}`, { name, at: new Date(now).toISOString(), points, redemptionId: rid_ }))) {
    await say(settings, settings.gwDuplicateTemplate, vars); await refund(redemption); return { ok: false, reason: 'duplicate' };
  }
  await say(settings, settings.gwTicketTemplate, { ...vars, lots: lotsFor(draw, points) });
  await setRedemptionStatus(rid_, redemption.reward.id, 'FULFILLED');
  return { ok: true, points, lots: lotsFor(draw, points) };
}

// ---- Teilnehmer und Lose

async function readAll(prefix) {
  const out = [];
  const keys = await db.list(prefix);
  for (let i = 0; i < keys.length; i += 25) out.push(...(await Promise.all(keys.slice(i, i + 25).map(async (k) => [k, await db.get(k)]))));
  return out.filter(([, v]) => v);
}

export async function broadcasterId() {
  try { return String((await userToken()).user_id ?? ''); } catch { return ''; }
}

/** Alle Teilnehmer mit aktuellem Punktestand und Losen. `eligible` = zählt bei der Ziehung (nicht gesperrt, nicht der Kanalinhaber). */
export async function participants(draw) {
  const owner = await broadcasterId();
  const pts = new Map((await readAll(`gw/${draw.id}/pts/`)).map(([k, v]) => [k.split('/').pop(), v]));
  const rows = (await readAll(`gw/${draw.id}/ticket/`)).map(([k, t]) => {
    const id = k.split('/').pop();
    const points = pts.get(id)?.points ?? 0;
    const blocked = isBlocked(draw, id, t.name);
    return { id, name: t.name, at: t.at, pointsAtTicket: t.points, points, lots: lotsFor(draw, points), blocked, eligible: !blocked && id !== owner };
  });
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/** Aufwand gegen Wirkung: je Losanzahl, wie viele Personen, wie viel Anteil an allen Losen und wie hoch die Chance auf Platz 1 ist. */
export function distribution(rows) {
  const el = rows.filter((r) => r.eligible);
  const total = el.reduce((s, r) => s + r.lots, 0);
  const by = new Map();
  for (const r of el) by.set(r.lots, (by.get(r.lots) ?? 0) + 1);
  return { participants: el.length, totalLots: total, rows: [...by.entries()].sort((a, b) => a[0] - b[0]).map(([lots, persons]) => ({ lots, persons, share: total ? (lots * persons) / total : 0, chance: total ? lots / total : 0 })) };
}

// ---- Zufall: gewichtet, ohne Zurücklegen, mit Seed nachvollziehbar

/** Zufallszahl i aus dem Seed (HMAC-SHA256, 48 Bit) in [0,1). Dieselbe Eingabe ergibt immer dieselbe Zahl. */
export const rand = (seed, i) => crypto.createHmac('sha256', String(seed)).update(String(i)).digest().readUIntBE(0, 6) / 2 ** 48;

/** Zieht n Gewinner aus entries [{id,name,lots}] ohne Zurücklegen. Die Eingabe wird nach id sortiert, damit der Seed allein das Ergebnis bestimmt. */
export function weightedDraw(entries, n, seed, startIndex = 0) {
  const pool = [...entries].sort((a, b) => (a.id < b.id ? -1 : 1));
  const winners = [], log = [];
  for (let k = 0; k < n && pool.length; k++) {
    const total = pool.reduce((s, e) => s + e.lots, 0);
    const r = rand(seed, startIndex + k);
    let target = r * total, idx = 0;
    while (idx < pool.length - 1 && target >= pool[idx].lots) { target -= pool[idx].lots; idx++; }
    const [w] = pool.splice(idx, 1);
    winners.push({ id: w.id, name: w.name, lots: w.lots });
    log.push({ pick: startIndex + k, r, totalLots: total, remaining: pool.length, id: w.id });
  }
  return { winners, log };
}

// ---- Ziehung

const resultKey = (did) => `gw/${did}/result`;
export const getResult = (did) => db.get(resultKey(did));
const winnerKey = (did, wid) => `gw/${did}/w/${wid}`;
export const getWinner = (did, wid) => (isId(did) && isId(wid) ? db.get(winnerKey(did, wid)) : null);
export const saveWinner = (w) => db.set(winnerKey(w.drawId, w.id), w);
export async function winnersOf(did) {
  return (await readAll(`gw/${did}/w/`)).map(([, w]) => w).sort((a, b) => a.place - b.place || a.createdAt.localeCompare(b.createdAt));
}

const eligibleEntries = (rows) => rows.filter((r) => r.eligible).map((r) => ({ id: r.id, name: r.name, lots: r.lots, points: r.points }));

/** Probe: zieht nur zur Ansicht, speichert nichts. */
export async function testDraw(draw, seed) {
  const entries = eligibleEntries(await participants(draw));
  const useSeed = String(seed || crypto.randomBytes(8).toString('hex'));
  const { winners } = weightedDraw(entries, Math.min(draw.prizes.length, entries.length), useSeed);
  return { seed: useSeed, participants: entries.length, winners: winners.map((w, i) => ({ place: i + 1, prize: draw.prizes[i].name, name: w.name, lots: w.lots })) };
}

const newCode = () => crypto.randomBytes(32).toString('base64url');

/** Legt einen neuen Link-Code an (der alte wird ungültig) und setzt die Meldefrist neu. */
export async function issueLink(draw, winner, now = Date.now()) {
  if (winner.code) await db.delete(`gwcode/${sha(winner.code)}`);
  winner.code = newCode();
  winner.linkAt = new Date(now).toISOString();
  winner.deadline = new Date(now + draw.winnerHours * 3_600_000).toISOString();
  winner.sentVia = null; winner.sendError = null; winner.dmQueued = false;
  await db.set(`gwcode/${sha(winner.code)}`, { drawId: draw.id, winnerId: winner.id });
  await saveWinner(winner);
  return winner;
}
export const linkOf = (winner) => (winner.code ? `${siteUrl()}/gewinn/${winner.code}` : '');
const note = (w, text, now = Date.now()) => { w.history = [...(w.history ?? []), { at: new Date(now).toISOString(), text }].slice(-30); };

async function makeWinner(draw, prize, place, pick, now) {
  const w = { id: rid(), drawId: draw.id, prizeId: prize.id, prizeName: prize.name, kind: prize.kind, place, twitchId: pick.id, name: pick.name, lots: pick.lots, status: 'gezogen', createdAt: new Date(now).toISOString(), history: [], code: null };
  note(w, 'Gezogen', now);
  return issueLink(draw, w, now);
}

/** Link per Twitch-Flüstern schicken. Klappt das nicht und das Konto ist mit Discord verknüpft, wartet eine DM auf den VerwirrBot.
 *  Sonst muss der Link von Hand geschickt werden (steht im Dashboard). */
export async function deliverLink(draw, winner, settings, now = Date.now()) {
  const text = fill(settings.gwWhisperTemplate, { user: winner.name, prize: winner.prizeName, hours: draw.winnerHours, url: linkOf(winner) });
  try {
    await sendWhisper(winner.twitchId, text);
    winner.sentVia = 'whisper'; winner.status = winner.status === 'gezogen' ? 'link_verschickt' : winner.status; note(winner, 'Link per Twitch-Flüstern geschickt', now);
  } catch (e) {
    winner.sendError = String(e.message).slice(0, 160);
    const link = await linkByTwitch(winner.twitchId).catch(() => null);
    if (link) {
      await db.set(`gwdm/${winner.id}`, { drawId: draw.id, winnerId: winner.id, discordId: link.discordId, message: text, at: new Date(now).toISOString() });
      winner.dmQueued = true; note(winner, 'Flüstern fehlgeschlagen, Discord-DM vorgemerkt', now);
    } else note(winner, 'Flüstern fehlgeschlagen, Link bitte von Hand schicken', now);
  }
  await saveWinner(winner);
  return winner;
}

/** Ziehung durchführen: Protokoll schreiben (einmalig), Gewinner anlegen, Overlay starten, Chat und Links nacheinander. */
export async function runDraw(settings, { seed, now = Date.now(), announceNow = false } = {}) {
  const draw = await currentDraw();
  if (!draw) return { error: 'Es gibt keine Ziehung', status: 404 };
  if (draw.drawnAt || (await getResult(draw.id))) return { error: 'Diese Ziehung ist schon gelaufen', status: 409 };
  const rows = await participants(draw);
  const entries = eligibleEntries(rows);
  if (!entries.length) return { error: 'Es gibt noch keine gültigen Teilnehmer', status: 400 };
  const useSeed = String(seed || crypto.randomBytes(16).toString('hex'));
  const n = Math.min(draw.prizes.length, entries.length);
  const { winners, log } = weightedDraw(entries, n, useSeed);
  const body = {
    drawId: draw.id, name: draw.name, at: new Date(now).toISOString(), seed: useSeed, algorithm: 'v1: gewichtet nach Losen, ohne Zurücklegen, Zufallszahl i = HMAC-SHA256(seed, i), Teilnehmer nach Twitch-ID sortiert',
    rules: { perPoints: draw.perPoints, maxLots: draw.maxLots, weights: draw.weights, pointsFrom: draw.pointsFrom },
    participants: entries.length, totalLots: entries.reduce((s, e) => s + e.lots, 0), excluded: rows.filter((r) => !r.eligible).map((r) => ({ id: r.id, name: r.name, blocked: r.blocked })),
    entries: entries.sort((a, b) => (a.id < b.id ? -1 : 1)),
    winners: winners.map((w, i) => ({ place: i + 1, prizeId: draw.prizes[i].id, prize: draw.prizes[i].name, twitchId: w.id, name: w.name, lots: w.lots })), log,
  };
  body.hash = sha(JSON.stringify(body)); // Prüfsumme über das ganze Protokoll
  if (!(await db.setIfNew(resultKey(draw.id), body))) return { error: 'Diese Ziehung ist schon gelaufen', status: 409 };
  draw.drawnAt = body.at; draw.manualClosed = true;
  await saveDraw(draw); forgetCache();
  const made = [];
  for (const [i, w] of winners.entries()) made.push(await makeWinner(draw, draw.prizes[i], i + 1, w, now));
  await db.set('gw/overlay', { drawId: draw.id, startedAt: now, hidden: false });
  await announce(draw, made, settings, { now, immediate: announceNow });
  return { ok: true, result: body };
}

const revealMs = (settings) => Math.max(0, settings.gwRevealSeconds) * 1000;

/** Chat-Nachricht je Platz (vom letzten zum ersten Platz, im Takt des Overlays) und danach der persönliche Link. */
async function announce(draw, winners, settings, { now, immediate = false } = {}) {
  const order = [...winners].sort((a, b) => b.place - a.place);
  const gap = revealMs(settings);
  const step = async (w) => {
    await say(settings, settings.gwWinnerTemplate, { user: w.name, prize: w.prizeName, place: w.place, hours: draw.winnerHours });
    const fresh = (await getWinner(draw.id, w.id)) ?? w;
    if (fresh.status === 'verfallen') return;
    await deliverLink(draw, fresh, settings);
  };
  if (immediate || gap === 0) { for (const w of order) await step(w); return; }
  order.forEach((w, i) => setTimeout(() => step(w).catch((e) => console.warn('Ankündigung fehlgeschlagen:', e.message)), i * gap + gap * 0.8).unref?.());
}

/** Was die OBS-Anzeige braucht: nur die schon aufgedeckten Plätze (der Zeitplan läuft auf dem Server, nichts wird vorab verraten). */
export async function overlayView(settings, now = Date.now()) {
  const st = await db.get('gw/overlay');
  if (!st || st.hidden) return { active: false };
  const result = await getResult(st.drawId);
  if (!result) return { active: false };
  const gap = revealMs(settings) || 1;
  const order = [...result.winners].sort((a, b) => b.place - a.place);
  const shown = Math.min(order.length, Math.floor((now - st.startedAt) / gap) + 1);
  return { active: true, title: result.name, startedAt: st.startedAt, now, revealMs: gap, total: order.length, winners: order.slice(0, Math.max(0, shown)).map((w) => ({ place: w.place, prize: w.prize, name: w.name })) };
}
export async function setOverlay(action, now = Date.now()) {
  const st = await db.get('gw/overlay');
  const draw = await currentDraw();
  if (!draw?.drawnAt) return { error: 'Es wurde noch nicht gezogen' };
  if (action === 'hide') await db.set('gw/overlay', { ...(st ?? { drawId: draw.id }), hidden: true });
  else await db.set('gw/overlay', { drawId: draw.id, startedAt: now, hidden: false }); // „show“ und „replay“ spielen die Aufdeckung neu ab
  return { ok: true };
}

// ---- Nachziehen

/** Ersetzt einen Gewinner (nicht gemeldet oder auf Wunsch) durch den Nächsten aus der Verlosung: gleiche Lose, ohne die bisherigen Gewinner. */
export async function redraw(settings, winnerId, { reason = 'manuell nachgezogen', now = Date.now() } = {}) {
  const draw = await currentDraw();
  const old = draw ? await getWinner(draw.id, winnerId) : null;
  if (!old) return { error: 'Diesen Gewinner gibt es nicht', status: 404 };
  if (old.status === 'verfallen') return { error: 'Dieser Gewinner ist schon ersetzt', status: 409 };
  const result = await getResult(draw.id);
  const all = await winnersOf(draw.id);
  const taken = new Set(all.map((w) => w.twitchId));
  const owner = await broadcasterId();
  const entries = result.entries.filter((e) => !taken.has(e.id) && e.id !== owner && !isBlocked(draw, e.id, e.name));
  old.status = 'verfallen'; note(old, `Verfallen (${reason})`, now);
  if (old.code) await db.delete(`gwcode/${sha(old.code)}`);
  old.code = null;
  if (!entries.length) { await saveWinner(old); return { ok: true, replacement: null }; }
  const seed = crypto.randomBytes(16).toString('hex');
  const { winners, log } = weightedDraw(entries, 1, seed);
  const prize = draw.prizes.find((p) => p.id === old.prizeId) ?? { id: old.prizeId, name: old.prizeName, kind: old.kind };
  await db.set(`gw/${draw.id}/redraw/${String(now).padStart(15, '0')}-${rid()}`, { at: new Date(now).toISOString(), replaced: { winnerId: old.id, twitchId: old.twitchId, name: old.name }, reason, seed, candidates: entries.length, totalLots: entries.reduce((s, e) => s + e.lots, 0), winner: winners[0], log });
  const fresh = await makeWinner(draw, prize, old.place, winners[0], now);
  old.replacedBy = fresh.id; await saveWinner(old);
  await say(settings, settings.gwRedrawTemplate, { user: fresh.name, prize: fresh.prizeName, place: fresh.place, hours: draw.winnerHours, old: old.name });
  await deliverLink(draw, fresh, settings, now);
  return { ok: true, replacement: fresh };
}

// ---- Adresse (verschlüsselt)

const secretKey = () => crypto.scryptSync(process.env.GEWINN_KEY || process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'unsicher', 'stadtwache-gewinn-v1', 32);
export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function decrypt(rec) {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(rec.iv, 'base64'));
    d.setAuthTag(Buffer.from(rec.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(rec.data, 'base64')), d.final()]).toString('utf8'));
  } catch { return null; }
}
export const readAddress = async (winnerId) => { const r = isId(winnerId) ? await db.get(`gwaddr/${winnerId}`) : null; return r ? decrypt(r) : null; };
export async function deleteAddress(winner, now = Date.now()) {
  await db.delete(`gwaddr/${winner.id}`);
  winner.hasAddress = false; note(winner, 'Adresse gelöscht', now);
  await saveWinner(winner);
}

// ---- Öffentlicher Link /gewinn/<code>

export async function byCode(code) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(code ?? ''))) return null;
  const ref = await db.get(`gwcode/${sha(code)}`);
  if (!ref) return null;
  const draw = await getDraw(ref.drawId), winner = await getWinner(ref.drawId, ref.winnerId);
  return draw && winner && winner.code === code ? { draw, winner } : null;
}

/** Was der Link gerade erlaubt: 'confirm' (melden), 'address' (Adresse senden), 'done' (schon gemeldet), 'expired' (abgelaufen). */
export function codeState({ draw, winner }, now = Date.now()) {
  if (winner.status === 'verfallen') return 'expired';
  if (winner.status === 'gezogen' || winner.status === 'link_verschickt') return now > Date.parse(winner.deadline) ? 'expired' : 'confirm';
  if (winner.status === 'gemeldet' && winner.kind === 'item') return now > Date.parse(winner.addressUntil) ? 'expired' : 'address';
  return 'done';
}

export async function publicView(code, now = Date.now()) {
  const hit = await byCode(code);
  if (!hit) return null;
  const state = codeState(hit, now);
  const { draw, winner } = hit;
  return { state, name: winner.name, prize: winner.prizeName, kind: winner.kind, deadline: state === 'address' ? winner.addressUntil : winner.deadline, countries: draw.countries.map((c) => ({ code: c, name: COUNTRIES[c] })), termsPublished: draw.termsPublished };
}

/** Meldung per Link. Key-Preis: Seite zeigt den Key. Sachpreis: gemeldet, danach kommt das Adressformular. */
export async function confirmCode(code, settings, now = Date.now()) {
  const hit = await byCode(code);
  if (!hit) return { error: 'Link ungültig', status: 404 };
  const { draw, winner } = hit;
  if (codeState(hit, now) !== 'confirm') return { error: 'Dieser Link kann nicht mehr genutzt werden', status: 410 };
  // Atomar: genau eine Meldung, auch bei Doppelklick
  if (!(await db.setIfNew(`gw/${draw.id}/confirmed/${winner.id}`, now))) return { error: 'Schon gemeldet', status: 409 };
  winner.reportedAt = new Date(now).toISOString();
  if (winner.kind === 'key') {
    const prize = draw.prizes.find((p) => p.id === winner.prizeId);
    const key = prize?.key ?? '';
    winner.status = key ? 'abgeschlossen' : 'gemeldet'; winner.keyShownAt = key ? winner.reportedAt : null;
    note(winner, key ? 'Gemeldet, Key angezeigt' : 'Gemeldet, Key fehlt noch (Dashboard)', now);
    await saveWinner(winner);
    if (key) await sendWhisper(winner.twitchId, `Dein Key für ${winner.prizeName}: ${key}`).catch(() => {}); // Sicherheitskopie, falls die Seite geschlossen wird
    return { ok: true, kind: 'key', key: key || null };
  }
  winner.status = 'gemeldet'; winner.addressUntil = new Date(now + draw.addressDays * 86_400_000).toISOString();
  note(winner, 'Gemeldet, Adresse fehlt noch', now);
  await saveWinner(winner);
  return { ok: true, kind: 'item', addressUntil: winner.addressUntil };
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Adresse speichern (verschlüsselt). Danach ist der Link verbraucht. */
export async function submitAddress(code, input, now = Date.now()) {
  const hit = await byCode(code);
  if (!hit) return { error: 'Link ungültig', status: 404 };
  const { draw, winner } = hit;
  if (codeState(hit, now) !== 'address') return { error: 'Dieser Link kann nicht mehr genutzt werden', status: 410 };
  const a = { name: clean(input?.name, 80), street: clean(input?.street, 100), zip: clean(input?.zip, 12), city: clean(input?.city, 60), country: clean(input?.country, 2).toUpperCase(), email: clean(input?.email, 120) };
  if (!a.name || !a.street || !a.zip || !a.city) return { error: 'Bitte Name, Straße, PLZ und Ort ausfüllen', status: 400 };
  if (!draw.countries.includes(a.country)) return { error: 'Dorthin verschicken wir leider nicht', status: 400 };
  if (a.email && !/^[^\s@]{1,64}@[^\s@]{1,120}\.[^\s@]{2,}$/.test(a.email)) return { error: 'Die E-Mail-Adresse sieht nicht richtig aus', status: 400 };
  if (input?.consent !== true) return { error: 'Bitte stimme der Speicherung deiner Adresse zu', status: 400 };
  if (!(await db.setIfNew(`gw/${draw.id}/addressed/${winner.id}`, now))) return { error: 'Schon abgeschickt', status: 409 };
  await db.set(`gwaddr/${winner.id}`, encrypt({ ...a, at: new Date(now).toISOString() }));
  winner.status = 'adresse_erhalten'; winner.hasAddress = true; winner.addressAt = new Date(now).toISOString();
  note(winner, 'Adresse erhalten', now);
  await saveWinner(winner);
  return { ok: true };
}

// ---- Dashboard-Aktionen am Gewinner

export async function winnerAction(settings, winnerId, action, now = Date.now()) {
  const draw = await currentDraw();
  const w = draw ? await getWinner(draw.id, winnerId) : null;
  if (!w) return { error: 'Diesen Gewinner gibt es nicht', status: 404 };
  if (action === 'redraw') return redraw(settings, winnerId, { now });
  if (w.status === 'verfallen') return { error: 'Dieser Gewinner ist schon ersetzt', status: 409 };
  if (action === 'link') { // neuer Link, neue Frist
    if (!['gezogen', 'link_verschickt', 'gemeldet'].includes(w.status)) return { error: 'Für diesen Stand braucht es keinen neuen Link', status: 409 };
    await db.delete(`gw/${draw.id}/confirmed/${w.id}`);
    if (w.status === 'gemeldet' && w.kind === 'item') { // schon gemeldet: der neue Link gilt für die Adresse
      await issueLink(draw, w, now); w.addressUntil = new Date(now + draw.addressDays * 86_400_000).toISOString(); w.deadline = w.addressUntil;
    } else { w.status = 'gezogen'; await issueLink(draw, w, now); }
    note(w, 'Neuer Link erzeugt', now);
    await saveWinner(w);
    return { ok: true, winner: await deliverLink(draw, w, settings, now) };
  }
  if (action === 'sent') { if (w.status === 'gezogen') w.status = 'link_verschickt'; w.sentVia = w.sentVia ?? 'manuell'; note(w, 'Link von Hand verschickt', now); }
  else if (action === 'reported') {
    if (!['gezogen', 'link_verschickt'].includes(w.status)) return { error: 'Schon gemeldet', status: 409 };
    w.reportedAt = new Date(now).toISOString();
    if (w.kind === 'key') w.status = 'abgeschlossen';
    else { w.status = 'gemeldet'; w.addressUntil = new Date(now + draw.addressDays * 86_400_000).toISOString(); }
    await db.setIfNew(`gw/${draw.id}/confirmed/${w.id}`, now);
    note(w, 'Von Hand als gemeldet markiert (z. B. im Chat)', now);
  } else if (action === 'shipped') {
    if (w.kind !== 'item') return { error: 'Nur Sachpreise werden versendet', status: 400 };
    w.status = 'versendet'; w.shippedAt = new Date(now).toISOString(); note(w, 'Als versendet markiert', now);
  } else if (action === 'complete') { w.status = 'abgeschlossen'; note(w, 'Als abgeschlossen markiert', now); }
  else if (action === 'delete-address') { await deleteAddress(w, now); return { ok: true, winner: await getWinner(draw.id, w.id) }; }
  else return { error: 'Unbekannte Aktion', status: 400 };
  await saveWinner(w);
  return { ok: true, winner: w };
}

// ---- Regelmäßige Aufgaben (jede Minute)

/** Ticket-Reward in Twitch pausieren, solange das Fenster zu ist (Best Effort). */
async function syncTicketReward(draw, now) {
  const state = (await db.get('config/state')) ?? {};
  if (!state.gwRewardId) return;
  const paused = windowState(draw, now) !== 'offen';
  if (state.gwPaused === paused) return;
  try {
    const { user_id } = await userToken();
    await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: state.gwRewardId }, body: { is_paused: paused } });
    await db.set('config/state', { ...((await db.get('config/state')) ?? {}), gwPaused: paused });
  } catch (e) { console.warn('Ticket-Reward nicht pausiert:', e.message); }
}

/** Nicht gemeldet nach der Frist -> verfallen und nachziehen. Adressen nach Ablauf der Aufbewahrung löschen. Ticket-Fenster abgleichen. */
export async function gewinnTick(settings, now = Date.now()) {
  const draw = await currentDraw();
  if (!draw) return { redrawn: 0, deleted: 0 };
  let redrawn = 0, deleted = 0;
  if (settings.gwEnabled) await syncTicketReward(draw, now);
  if (draw.drawnAt) {
    for (const w of await winnersOf(draw.id)) {
      if (['gezogen', 'link_verschickt'].includes(w.status) && now > Date.parse(w.deadline)) {
        const res = await redraw(settings, w.id, { reason: `keine Meldung in ${draw.winnerHours} Stunden`, now });
        if (res.ok) redrawn++;
      } else if (w.hasAddress && w.shippedAt && now >= Date.parse(w.shippedAt) + draw.keepDays * 86_400_000) {
        await deleteAddress(w, now);
        const fresh = await getWinner(draw.id, w.id); fresh.status = 'abgeschlossen'; note(fresh, 'Automatisch abgeschlossen', now); await saveWinner(fresh);
        deleted++;
      }
    }
  }
  return { redrawn, deleted };
}

// ---- Zusammenfassung für den Admin

export async function adminView(settings, now = Date.now()) {
  const draw = await currentDraw();
  const tz = settings.timezone;
  const draws = await listDraws();
  if (!draw) return { enabled: settings.gwEnabled, draw: null, draws };
  const rows = await participants(draw);
  const result = await getResult(draw.id);
  const winners = (await winnersOf(draw.id)).map((w) => ({ ...w, statusLabel: STATUS_LABEL[w.status], link: ['gezogen', 'link_verschickt', 'gemeldet'].includes(w.status) ? linkOf(w) : '', expired: ['gezogen', 'link_verschickt'].includes(w.status) && now > Date.parse(w.deadline), code: undefined }));
  const view = { ...draw, ticketOpen: toLocal(draw.ticketOpen, tz), ticketClose: toLocal(draw.ticketClose, tz), pointsFrom: toLocal(draw.pointsFrom, tz), plannedDraw: toLocal(draw.plannedDraw, tz), drawnAt: draw.drawnAt };
  return {
    enabled: settings.gwEnabled, draws, draw: view, window: windowState(draw, now), timezone: tz,
    tickets: rows, stats: distribution(rows), result: result ? { ...result, entries: undefined, log: undefined, entryCount: result.entries.length } : null, winners,
    overlay: await overlayView(settings, now), rewardReady: Boolean(((await db.get('config/state')) ?? {}).gwRewardId),
  };
}

export const protocol = async (did) => (isId(did) ? getResult(did) : null);
export const redrawLog = async (did) => (await readAll(`gw/${did}/redraw/`)).map(([, v]) => v);

// ---- Discord-Nachrichten für den VerwirrBot (wenn Flüstern nicht klappt und das Konto verknüpft ist)

export async function pendingDms() {
  return (await readAll('gwdm/')).map(([, v]) => v).filter(Boolean);
}
/** Der VerwirrBot meldet zurück: DM verschickt (ok) oder nicht zustellbar (failed, z. B. DMs gesperrt). Dann bleibt nur der Link von Hand. */
export async function ackDm(winnerId, { failed = false } = {}, now = Date.now()) {
  if (!isId(winnerId)) return false;
  const dm = await db.get(`gwdm/${winnerId}`);
  if (!dm) return false;
  const w = await getWinner(dm.drawId, winnerId);
  if (w && w.status !== 'verfallen') {
    w.dmQueued = false;
    if (failed) { w.sendError = 'Discord-DM nicht zustellbar'; note(w, 'Discord-DM nicht zustellbar, Link bitte von Hand schicken', now); }
    else { if (w.status === 'gezogen') w.status = 'link_verschickt'; w.sentVia = 'discord'; note(w, 'Link per Discord-DM geschickt', now); }
    await saveWinner(w);
  }
  await db.delete(`gwdm/${winnerId}`);
  return true;
}
