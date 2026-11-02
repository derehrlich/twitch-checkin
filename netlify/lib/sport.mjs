// Sport-Scoreboard: Stand der laufenden Einheit und Verlauf der gespeicherten Einheiten.
//   sport/live        { show, title, running, startedAt, elapsedMs, heartRate, distanceKm, calories }
//   sport/log/<id>    { id, savedAt, day, title, seconds, heartRate, distanceKm, calories }
import crypto from 'node:crypto';
import { db } from './store.mjs';
import { getSettings } from './settings.mjs';
import { streamDay } from './checkin.mjs';

export const LIVE_KEY = 'sport/live';
export const LOG_PREFIX = 'sport/log/';
export const LOG_ID = /^[a-f0-9]{8}$/;
export const MAX_LOG = 500;

const EMPTY = { show: false, title: 'Training', running: false, startedAt: null, elapsedMs: 0, heartRate: 0, distanceKm: 0, calories: 0 };

export const getLive = async () => ({ ...EMPTY, ...((await db.get(LIVE_KEY)) ?? {}) });
export const elapsedMs = (live, now = Date.now()) => live.elapsedMs + (live.running && live.startedAt ? Math.max(0, now - live.startedAt) : 0);

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Was das Overlay braucht (öffentlich, nur Zahlen). serverNow hilft gegen falsch gehende Uhren. */
export function publicView(live, now = Date.now()) {
  return { show: live.show, title: live.title, running: live.running, seconds: Math.floor(elapsedMs(live, now) / 1000), heartRate: live.heartRate, distanceKm: live.distanceKm, calories: live.calories, serverNow: now };
}

/** Werte von Hand ändern. Unbekannte oder ungültige Felder werden ignoriert. */
export async function updateLive(input, now = Date.now()) {
  const live = await getLive();
  const num = (k, min, max, digits = 0) => {
    if (input[k] === '' || input[k] == null) return;
    const v = Number(String(input[k]).replace(',', '.'));
    if (Number.isFinite(v)) live[k] = Math.round(clamp(v, min, max) * 10 ** digits) / 10 ** digits;
  };
  num('heartRate', 0, 250); num('distanceKm', 0, 1000, 2); num('calories', 0, 20_000);
  if (typeof input.title === 'string' && input.title.trim()) live.title = input.title.trim().slice(0, 40);
  if (typeof input.show === 'boolean') live.show = input.show;
  if (input.minutes !== '' && input.minutes != null && Number.isFinite(Number(input.minutes))) { // Zeit von Hand setzen
    live.elapsedMs = Math.round(clamp(Number(input.minutes), 0, 1440) * 60_000);
    if (live.running) live.startedAt = now;
  }
  await db.set(LIVE_KEY, live);
  return live;
}

/** Stoppuhr: start, pause oder reset (reset setzt alle Zahlen auf 0, Titel und Sichtbarkeit bleiben). */
export async function timer(action, now = Date.now()) {
  const live = await getLive();
  if (action === 'start' && !live.running) { live.running = true; live.startedAt = now; }
  else if (action === 'pause' && live.running) { live.elapsedMs = elapsedMs(live, now); live.running = false; live.startedAt = null; }
  else if (action === 'reset') Object.assign(live, { ...EMPTY, show: live.show, title: live.title });
  else if (!['start', 'pause', 'reset'].includes(action)) throw new Error('Unbekannte Aktion');
  await db.set(LIVE_KEY, live);
  return live;
}

/** Aktuelle Einheit in den Verlauf schreiben und die Anzeige auf 0 setzen. Null, wenn noch nichts erfasst wurde. */
export async function saveSession(now = Date.now()) {
  const live = await getLive();
  const seconds = Math.floor(elapsedMs(live, now) / 1000);
  if (!seconds && !live.heartRate && !live.distanceKm && !live.calories) return null;
  if ((await db.list(LOG_PREFIX)).length >= MAX_LOG) throw new Error(`Der Verlauf ist voll (${MAX_LOG} Einheiten), bitte alte löschen`);
  const entry = { id: crypto.randomBytes(4).toString('hex'), savedAt: now, day: streamDay(await getSettings(), new Date(now)), title: live.title, seconds, heartRate: live.heartRate, distanceKm: live.distanceKm, calories: live.calories };
  await db.set(LOG_PREFIX + entry.id, entry);
  await db.set(LIVE_KEY, { ...EMPTY, show: live.show, title: live.title });
  return entry;
}

export async function sessions() {
  const keys = await db.list(LOG_PREFIX);
  const out = [];
  for (let i = 0; i < keys.length; i += 25) out.push(...(await Promise.all(keys.slice(i, i + 25).map((k) => db.get(k)))));
  return out.filter(Boolean).sort((a, b) => b.savedAt - a.savedAt);
}

/** Summen über alle Einheiten. Der Puls ist der Durchschnitt, gewichtet nach Dauer (Einheiten ohne Pulswert zählen nicht mit). */
export function totals(list) {
  const t = { count: list.length, seconds: 0, distanceKm: 0, calories: 0, heartRate: 0 };
  let hrSeconds = 0, hrSum = 0;
  for (const s of list) {
    t.seconds += s.seconds; t.distanceKm += s.distanceKm; t.calories += s.calories;
    if (s.heartRate > 0) { hrSeconds += s.seconds || 1; hrSum += s.heartRate * (s.seconds || 1); }
  }
  t.distanceKm = Math.round(t.distanceKm * 100) / 100;
  t.heartRate = hrSeconds ? Math.round(hrSum / hrSeconds) : 0;
  return t;
}
