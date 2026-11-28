// Koch-Overlay (/kochen): Rezeptkarte, Zutaten und Küchenwecker, so gelegt, dass sie das Kamerabild frei lassen.
//   cook/state  { active, title, ingredients[], steps[], step (0-basiert), timer: { label, until (ms), seconds } | null, startedAt }
// Gesteuert per Knopf im Admin (Reiter Overlays → Kochen). Die Seite holt den Stand alle paar Sekunden.
import { db } from '../kern/store.mjs';

export const STATE_KEY = 'cook/state';
const IDLE = { active: false, title: '', ingredients: [], steps: [], step: 0, timer: null, startedAt: 0 };
const MAX = { title: 60, line: 140, ingredients: 14, steps: 20 };

export const getState = async () => ({ ...IDLE, ...((await db.get(STATE_KEY)) ?? {}) });

/** Text mit einer Zeile je Eintrag → saubere Liste (leere Zeilen, Aufzählungszeichen und führende Nummern fliegen raus). */
export const parseLines = (text, max) => String(text ?? '').split(/\r?\n/)
  .map((l) => l.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s*/, '').trim().slice(0, MAX.line)).filter(Boolean).slice(0, max);

export async function start({ title, ingredients, steps } = {}, now = Date.now()) {
  const old = await getState();
  const list = Array.isArray(steps) ? steps : parseLines(steps, MAX.steps);
  const state = {
    active: true,
    title: String(title ?? '').trim().slice(0, MAX.title) || 'Heute kochen wir',
    ingredients: Array.isArray(ingredients) ? ingredients.slice(0, MAX.ingredients) : parseLines(ingredients, MAX.ingredients),
    steps: list,
    // Beim Ändern eines laufenden Rezepts bleibt der Schritt und der Wecker, wo sie waren
    step: old.active ? Math.min(old.step, Math.max(0, list.length - 1)) : 0,
    timer: old.active ? old.timer : null,
    startedAt: old.active ? old.startedAt : now,
  };
  await db.set(STATE_KEY, state);
  return state;
}

/** Einen Schritt weiter (+1) oder zurück (-1), bleibt immer innerhalb der Liste. */
export async function move(delta) {
  const s = await getState();
  if (!s.active) return s;
  s.step = Math.min(Math.max(0, s.steps.length - 1), Math.max(0, s.step + (Number(delta) < 0 ? -1 : 1)));
  await db.set(STATE_KEY, s);
  return s;
}

export async function setTimer({ minutes, label } = {}, now = Date.now()) {
  const s = await getState();
  if (!s.active) return s;
  const seconds = Math.round(Number(minutes) * 60);
  if (!(seconds >= 5)) return s;
  s.timer = { label: String(label ?? '').trim().slice(0, 40), seconds: Math.min(seconds, 6 * 3600), until: now + Math.min(seconds, 6 * 3600) * 1000 };
  await db.set(STATE_KEY, s);
  return s;
}

export async function stopTimer() {
  const s = await getState();
  if (s.timer) { s.timer = null; await db.set(STATE_KEY, s); }
  return s;
}

export async function stop() {
  const was = await getState();
  await db.set(STATE_KEY, { ...IDLE });
  return was;
}

/** Was die OBS-Seite braucht. `now` ist die Serverzeit in Millisekunden. */
export async function publicView(now = Date.now()) {
  const s = await getState();
  return { show: s.active, title: s.title, ingredients: s.ingredients, steps: s.steps, step: s.step, timer: s.timer, now };
}
