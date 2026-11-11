// Sport-Scoreboard: eingetragene Einheiten, aufbereitet für das Overlay (/sport).
//   sport/config      { show, title, period }   period: 'all' | 'month' | 'week'
//   sport/log/<id>    { id, savedAt, day, title, seconds, heartRate, distanceKm, calories }
import crypto from 'node:crypto';
import { db } from '../kern/store.mjs';
import { getSettings } from '../kern/settings.mjs';
import { streamDay } from '../zuschauer/checkin.mjs';

export const CONFIG_KEY = 'sport/config';
export const LOG_PREFIX = 'sport/log/';
export const LOG_ID = /^[a-f0-9]{8}$/;
export const MAX_LOG = 500;
export const PERIODS = ['all', 'month', 'week'];
export const PERIOD_LABEL = { all: 'Gesamt', month: 'Dieser Monat', week: 'Diese Woche' };

const DEFAULT_CONFIG = { show: false, title: 'Sport-Scoreboard', period: 'all' };
export const getConfig = async () => ({ ...DEFAULT_CONFIG, ...((await db.get(CONFIG_KEY)) ?? {}) });

export async function updateConfig(input) {
  const cfg = await getConfig();
  if (typeof input.show === 'boolean') cfg.show = input.show;
  if (typeof input.title === 'string' && input.title.trim()) cfg.title = input.title.trim().slice(0, 40);
  if (PERIODS.includes(input.period)) cfg.period = input.period;
  await db.set(CONFIG_KEY, cfg);
  return cfg;
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const toNum = (v) => (v === '' || v == null ? NaN : Number(String(v).replace(',', '.')));

/** Neue Einheit eintragen. Fehler als Text (wird im Admin angezeigt). */
export async function addSession(input, now = Date.now()) {
  const settings = await getSettings();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(input.day ?? '') && !Number.isNaN(Date.parse(input.day)) ? input.day : streamDay(settings, new Date(now));
  const minutes = toNum(input.minutes), hr = toNum(input.heartRate), km = toNum(input.distanceKm), kcal = toNum(input.calories);
  if (!(minutes > 0)) throw new Error('Bitte die Zeit in Minuten angeben');
  if ((await db.list(LOG_PREFIX)).length >= MAX_LOG) throw new Error(`Der Verlauf ist voll (${MAX_LOG} Einheiten), bitte alte löschen`);
  const entry = {
    id: crypto.randomBytes(4).toString('hex'), savedAt: now, day,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 40) : 'Training',
    seconds: Math.round(clamp(minutes, 0, 1440) * 60),
    heartRate: Number.isFinite(hr) ? Math.round(clamp(hr, 0, 250)) : 0,
    distanceKm: Number.isFinite(km) ? Math.round(clamp(km, 0, 1000) * 100) / 100 : 0,
    calories: Number.isFinite(kcal) ? Math.round(clamp(kcal, 0, 20_000)) : 0,
  };
  await db.set(LOG_PREFIX + entry.id, entry);
  return entry;
}

/** Neueste zuerst (nach Tag, bei gleichem Tag nach Eintragszeit). */
export async function sessions() {
  const keys = await db.list(LOG_PREFIX);
  const out = [];
  for (let i = 0; i < keys.length; i += 25) out.push(...(await Promise.all(keys.slice(i, i + 25).map((k) => db.get(k)))));
  return out.filter(Boolean).sort((a, b) => b.day.localeCompare(a.day) || b.savedAt - a.savedAt);
}

/** Nur Einheiten des Zeitraums. today = Stream-Tag als YYYY-MM-DD; die Woche beginnt am Montag. */
export function inPeriod(list, period, today) {
  if (period === 'month') return list.filter((s) => s.day.slice(0, 7) === today.slice(0, 7));
  if (period === 'week') {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const monday = d.toISOString().slice(0, 10);
    return list.filter((s) => s.day >= monday && s.day <= today);
  }
  return list;
}

/** Summen. Der Puls ist der Durchschnitt, gewichtet nach Dauer (Einheiten ohne Pulswert zählen nicht mit). */
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

/** Was das Overlay braucht (öffentlich, nur Zahlen): Summen des Zeitraums und die letzten Einheiten. */
export async function publicView() {
  const cfg = await getConfig();
  const list = inPeriod(await sessions(), cfg.period, streamDay(await getSettings()));
  return {
    show: cfg.show, title: cfg.title, period: cfg.period, periodLabel: PERIOD_LABEL[cfg.period],
    totals: totals(list),
    recent: list.slice(0, 3).map((s) => ({ day: s.day, title: s.title, seconds: s.seconds, heartRate: s.heartRate, distanceKm: s.distanceKm, calories: s.calories })),
  };
}
