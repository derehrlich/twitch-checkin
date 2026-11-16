// Umfragen im Chat und im Overlay (/umfrage).
//   poll/state                  { id, question, options: [{ label, votes }], startedAt, endsAt, minutes, status: 'open'|'closed'|'idle', closedAt, total, by }
//   poll/vote/<id>/<twitchId>   Nummer der gewählten Antwort (1 bis 6). Wer neu wählt, überschreibt die alte Stimme. Wird mit dem Ende der Umfrage gelöscht.
//   poll/history/<zeit>-<id>    beendete Umfragen (die letzten 20), nur Frage, Antworten und Ergebnis, nie wer wie gestimmt hat
// Gestartet per Chat (!umfrage 3 Welches Spiel? | Enshrouded | Satisfactory, nur Mods) oder im Admin. Abgestimmt wird mit der Zahl im Chat (1 oder !1).
import crypto from 'node:crypto';
import { db } from '../kern/store.mjs';
import { sendChat } from '../kern/twitch.mjs';
import { fill } from '../zuschauer/checkin.mjs';

export const STATE_KEY = 'poll/state';
export const MAX_OPTIONS = 6, HISTORY = 20;
const IDLE = { status: 'idle' };
const rid = () => crypto.randomBytes(6).toString('hex');
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Eine Änderung nach der anderen (ein Server-Prozess): zwei gleichzeitige Stimmen verschlucken sich nie
let tail = Promise.resolve();
const lock = (fn) => { const run = tail.then(fn, fn); tail = run.catch(() => {}); return run; };

export const getState = async () => ({ ...IDLE, ...((await db.get(STATE_KEY)) ?? {}) });

/** „3 Welches Spiel? | A | B“ -> { minutes: 3, question, options }. Die Zahl vorn (Minuten) ist optional. Ohne Antworten gibt es Ja und Nein. */
export function parseArgs(args, settings) {
  let text = String(args ?? '').trim(), minutes = null;
  const m = /^(\d{1,2})\s*(?:min\w*)?\s+(\S.*)$/i.exec(text);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 60) { minutes = Number(m[1]); text = m[2]; }
  const parts = text.split('|').map((x) => x.trim()).filter(Boolean);
  return { question: parts[0] ?? '', options: parts.length > 1 ? parts.slice(1) : ['Ja', 'Nein'], minutes: minutes ?? settings.pollMinutes };
}

export function results(s) {
  const max = Math.max(0, ...s.options.map((o) => o.votes));
  const winners = max > 0 ? s.options.filter((o) => o.votes === max).map((o) => o.label) : [];
  const pct = (n) => (s.total ? Math.round((n / s.total) * 100) : 0);
  return { winners, list: s.options.map((o) => `${o.label} ${o.votes} (${pct(o.votes)} %)`).join(' · '), pct };
}
export const startText = (s, settings) => fill(settings.pollStartTemplate, { question: s.question, options: s.options.map((o, i) => `${i + 1} = ${o.label}`).join(' · '), minutes: s.minutes });
export function resultText(s, settings) {
  if (!s.total) return fill(settings.pollNoVotesTemplate, { question: s.question });
  const r = results(s);
  return fill(settings.pollResultTemplate, { question: s.question, result: r.list, total: s.total, winner: r.winners.length > 1 ? `Gleichstand: ${r.winners.join(' und ')}` : r.winners[0] });
}

const say = async (settings, text) => { if (settings.pollChat && settings.chatEnabled) await sendChat(text).catch((e) => console.warn('Umfrage-Chat fehlgeschlagen:', e.message)); };

/** Beendet eine offene Umfrage (innerhalb des Schlosses aufrufen): Ergebnis speichern, Stimmen aufräumen, im Chat ansagen. */
async function finish(s, settings, now) {
  if (s.status !== 'open') return s;
  s.status = 'closed'; s.closedAt = now;
  await db.set(STATE_KEY, s);
  await db.set(`poll/history/${String(s.startedAt).padStart(15, '0')}-${s.id}`, s);
  for (const k of await db.list(`poll/vote/${s.id}/`)) await db.delete(k);
  const old = (await db.list('poll/history/')).sort();
  for (const k of old.slice(0, Math.max(0, old.length - HISTORY))) await db.delete(k);
  await say(settings, resultText(s, settings));
  return s;
}

export function start({ question, options, minutes, by = '' }, settings, now = Date.now()) {
  return lock(async () => {
    const q = clean(question, 120);
    const opts = (Array.isArray(options) ? options : []).map((o) => clean(o, 40)).filter(Boolean).slice(0, MAX_OPTIONS);
    if (!q) return { error: 'Bitte eine Frage angeben', status: 400 };
    if (opts.length < 2) return { error: 'Mindestens zwei Antworten werden gebraucht', status: 400 };
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return { error: 'Die Antworten müssen verschieden sein', status: 400 };
    let cur = await getState();
    if (cur.status === 'open' && now >= cur.endsAt) cur = await finish(cur, settings, now); // abgelaufen, aber noch nicht beendet
    if (cur.status === 'open') return { error: 'Es läuft schon eine Umfrage', status: 409 };
    const min = Math.min(60, Math.max(1, Math.round(Number(minutes) || settings.pollMinutes)));
    const poll = { id: rid(), question: q, options: opts.map((label) => ({ label, votes: 0 })), startedAt: now, endsAt: now + min * 60_000, minutes: min, status: 'open', closedAt: null, total: 0, by: clean(by, 40) };
    await db.set(STATE_KEY, poll);
    return { ok: true, poll };
  });
}

/** Eine Stimme (choice = 1 bis n). Eine neue Stimme derselben Person ersetzt die alte. */
export function vote(userId, choice, now = Date.now()) {
  return lock(async () => {
    const s = await getState();
    if (s.status !== 'open' || now >= s.endsAt) return { ok: false, reason: 'closed' };
    const i = Number(choice) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= s.options.length) return { ok: false, reason: 'range' };
    const key = `poll/vote/${s.id}/${userId}`, prev = await db.get(key);
    if (prev === i + 1) return { ok: true, changed: false };
    if (prev) s.options[prev - 1].votes -= 1; else s.total += 1;
    s.options[i].votes += 1;
    await db.set(key, i + 1); await db.set(STATE_KEY, s);
    return { ok: true, changed: true };
  });
}

/** Beendet die Umfrage jetzt (Chat !umfrageende oder Admin). */
export const close = (settings, now = Date.now()) => lock(async () => { const s = await getState(); return s.status === 'open' ? finish(s, settings, now) : null; });
/** Wird regelmäßig aufgerufen: beendet eine abgelaufene Umfrage genau einmal. */
export const tick = (settings, now = Date.now()) => lock(async () => { const s = await getState(); return s.status === 'open' && now >= s.endsAt ? finish(s, settings, now) : null; });
/** Nimmt die Umfrage aus dem Stream, ohne Ergebnis im Chat (Admin „Ausblenden“). Eine offene Umfrage wird verworfen. */
export const hide = () => lock(async () => {
  const s = await getState();
  if (s.status === 'open') for (const k of await db.list(`poll/vote/${s.id}/`)) await db.delete(k);
  await db.set(STATE_KEY, { ...IDLE });
});

export async function chatStart(e, args, settings, now = Date.now()) {
  const user = e.chatter_user_name, p = parseArgs(args, settings);
  if (!p.question) return fill(settings.pollUsageTemplate, { user });
  const res = await start({ ...p, by: user }, settings, now);
  if (res.status === 409) return fill(settings.pollBusyTemplate, { user });
  if (res.error) return fill(settings.pollUsageTemplate, { user });
  return settings.pollChat ? startText(res.poll, settings) : null;
}
export async function chatEnd(settings) { await close(settings); return null; } // das Ergebnis schreibt close() selbst

/** Was die OBS-Seite braucht: offene Umfrage, danach das Ergebnis noch pollShowSeconds Sekunden. */
export async function publicView(settings, now = Date.now()) {
  await tick(settings, now);
  const s = await getState();
  const show = s.status === 'open' || (s.status === 'closed' && now - s.closedAt < settings.pollShowSeconds * 1000);
  if (!show) return { show: false, now };
  const r = results(s);
  return {
    show: true, id: s.id, status: s.status, question: s.question, total: s.total, endsAt: s.endsAt, now,
    options: s.options.map((o, i) => ({ n: i + 1, label: o.label, votes: o.votes, percent: r.pct(o.votes), win: s.status === 'closed' && r.winners.includes(o.label) })),
  };
}

export async function adminView(settings, now = Date.now()) {
  const s = await getState();
  const history = [];
  for (const k of (await db.list('poll/history/')).sort().reverse().slice(0, 10)) { const h = await db.get(k); if (h) history.push({ id: h.id, question: h.question, startedAt: h.startedAt, total: h.total, options: h.options, result: results(h).list, by: h.by }); }
  return { enabled: settings.pollEnabled, command: settings.pollCommand, endCommand: settings.pollEndCommand, minutes: settings.pollMinutes, state: s.status === 'idle' ? null : { ...s, open: s.status === 'open' && now < s.endsAt, result: results(s).list }, history };
}
