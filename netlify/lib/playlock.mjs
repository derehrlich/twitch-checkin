// Gemeinsame Abspiel-Reihenfolge der Overlay-Quellen (Alerts, Soundboard, Einlaufsound).
// Jede OBS-Quelle ist eine eigene Seite und weiß nichts von den anderen. Bevor sie etwas mit Ton abspielt, fragt sie hier
// "darf ich?". Es spielt immer nur eine Quelle, die übrigen warten in der Reihenfolge, in der sie sich gemeldet haben.
// Gespeichert wird nur ein Eintrag: wer gerade spielt und bis wann, plus die Wartenden.
import { db } from './store.mjs';

const KEY = 'config/playlock';
const WAITER_TTL = 8_000;   // ein Wartender, der sich so lange nicht meldet, ist weg (Seite neu geladen)
const MAX_MS = 60_000;      // so lange hält eine Sperre höchstens, falls jemand das Freigeben vergisst

export async function claim({ id, at, ms }, now = Date.now()) {
  const lock = (await db.get(KEY)) ?? { holder: null, until: 0, waiters: [] };
  lock.waiters = lock.waiters.filter((w) => now - w.seen < WAITER_TTL && w.id !== lock.holder);
  const free = lock.until <= now;
  const me = lock.waiters.find((w) => w.id === id);
  const first = [...lock.waiters].sort((a, b) => a.at - b.at)[0];
  if (free && (!first || first.id === id || !me && at <= first.at)) {
    lock.waiters = lock.waiters.filter((w) => w.id !== id);
    lock.holder = id; lock.until = now + Math.min(Math.max(Number(ms) || 0, 0), MAX_MS);
    await db.set(KEY, lock);
    return { wait: 0 };
  }
  if (me) me.seen = now; else lock.waiters.push({ id, at, seen: now });
  await db.set(KEY, lock);
  return { wait: Math.max(300, Math.min(lock.until - now, 2000)) };
}

// Fertig (Ton zu Ende): sofort wieder freigeben, statt bis zur geschätzten Länge zu warten
export async function release({ id }, now = Date.now()) {
  const lock = await db.get(KEY);
  if (lock?.holder === id && lock.until > now) { lock.until = now; await db.set(KEY, lock); }
  return { ok: true };
}
