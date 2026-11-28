// Koch-Overlay (/kochen): Schild „Heute in der Küche“ mit Gericht und !rezept-Befehl, dazu ein Countdown.
//   cook/state  { active, title, countdown: { until (ms), label } | null }
// Gesteuert per Knopf im Admin (Reiter Overlays → Kochen). Die Seite holt den Stand alle paar Sekunden.
import { db } from '../kern/store.mjs';

export const STATE_KEY = 'cook/state';
const IDLE = { active: false, title: '', countdown: null };

export const getState = async () => ({ ...IDLE, ...((await db.get(STATE_KEY)) ?? {}) });

/** Schild einschalten oder das Gericht ändern (der Countdown bleibt, wie er ist). */
export async function start({ title } = {}) {
  const old = await getState();
  const state = { active: true, title: String(title ?? '').trim().slice(0, 60), countdown: old.active ? old.countdown : null };
  await db.set(STATE_KEY, state);
  return state;
}

/**
 * Countdown stellen: entweder `minutes` ab jetzt oder `at` (Datum und Uhrzeit als Text, z. B. „2026-11-29T18:30“,
 * gilt in der Zeitzone des Servers) bzw. Millisekunden. Zu kleine oder vergangene Zeiten werden ignoriert.
 */
export async function setCountdown({ minutes, at, label, doneText } = {}, now = Date.now()) {
  const s = await getState();
  if (!s.active) return s;
  let until = null;
  if (at !== undefined && at !== null && at !== '') {
    const t = typeof at === 'number' ? at : new Date(at).getTime();
    if (Number.isFinite(t)) until = t;
  } else if (Number(minutes) > 0) until = now + Math.round(Number(minutes) * 60_000);
  if (until === null || until < now + 5000 || until > now + 366 * 86_400_000) return s;
  s.countdown = { until, label: String(label ?? '').trim().slice(0, 40), doneText: String(doneText ?? '').trim().slice(0, 30) || 'Guten Appetit!' };
  await db.set(STATE_KEY, s);
  return s;
}

export async function stopCountdown() {
  const s = await getState();
  if (s.countdown) { s.countdown = null; await db.set(STATE_KEY, s); }
  return s;
}

export async function stop() {
  const was = await getState();
  await db.set(STATE_KEY, { ...IDLE });
  return was;
}

/** Was die OBS-Seite braucht. `now` ist die Serverzeit in Millisekunden. */
export async function publicView(settings, now = Date.now()) {
  const s = await getState();
  return { show: s.active, title: s.title, command: settings.rezeptEnabled ? settings.rezeptCommand : '', countdown: s.countdown, now };
}
