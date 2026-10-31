// Eigene Commands und Regeln (Admin → Commands).
// Ein Eintrag: { id, name, enabled, trigger, role, cooldown, actions }
//   trigger: { type: 'command', word: '!ant' } | { type: 'keyword', word: 'hallo' } | { type: 'timer', minutes, minMessages }
//   role:    all | sub | vip | mod | owner   (wer den Command nutzen darf, gilt für Befehl und Stichwort)
//   actions: nacheinander, je { type: 'chat', text } | { type: 'alert', title, message } | { type: 'sound', soundId }
// Platzhalter in Texten: {user} (wer ausgelöst hat), {args} (Rest der Nachricht nach dem Befehl), {channel}
import crypto from 'node:crypto';
import { db } from './store.mjs';
import { fill, pushOverlay } from './checkin.mjs';
import { sendChat } from './twitch.mjs';
import { getBoard, isActive } from './soundboard.mjs';

export const MAX_COMMANDS = 40;
export const MAX_ACTIONS = 6;
export const ROLES = ['all', 'sub', 'vip', 'mod', 'owner'];
const ROLE_BADGES = { all: null, sub: ['subscriber', 'vip', 'moderator', 'broadcaster'], vip: ['vip', 'moderator', 'broadcaster'], mod: ['moderator', 'broadcaster'], owner: ['broadcaster'] };
const KEY = 'config/commands';

export const getCommands = async () => (await db.get(KEY)) ?? [];
export const saveCommands = (list) => db.set(KEY, list);
export const newId = () => crypto.randomBytes(4).toString('hex');
export const ID = /^[a-f0-9]{8}$/;

const clamp = (n, min, max, def) => (Number.isFinite(Number(n)) && n !== '' && n != null ? Math.min(max, Math.max(min, Math.round(Number(n)))) : def);
const str = (v, max) => String(v ?? '').trim().slice(0, max);

export function cleanAction(a) {
  if (a?.type === 'chat') { const text = str(a.text, 450); return text ? { type: 'chat', text } : null; }
  if (a?.type === 'alert') {
    const title = str(a.title, 60), message = str(a.message, 200);
    return title || message ? { type: 'alert', title, message } : null;
  }
  if (a?.type === 'sound') return /^[a-f0-9]{8}$/.test(a.soundId ?? '') ? { type: 'sound', soundId: a.soundId } : null;
  return null;
}

// Bereinigt Eingaben aus dem Admin zu einem vollständigen Eintrag (oder { error })
export function sanitize(input, old = {}) {
  const t = input.trigger ?? old.trigger ?? {};
  const type = ['command', 'keyword', 'timer'].includes(t.type) ? t.type : 'command';
  let trigger;
  if (type === 'command') {
    const word = '!' + str(t.word, 30).toLowerCase().replace(/^!+/, '').replace(/\s+/g, '');
    if (word === '!') return { error: 'Bitte einen Befehl angeben, z. B. !ant' };
    trigger = { type, word };
  } else if (type === 'keyword') {
    const word = str(t.word, 40).toLowerCase();
    if (!word) return { error: 'Bitte ein Stichwort angeben' };
    trigger = { type, word };
  } else {
    trigger = { type, minutes: clamp(t.minutes, 5, 720, 20), minMessages: clamp(t.minMessages, 1, 100, 3) };
  }
  const name = str(input.name ?? old.name ?? (trigger.word ?? 'Timer'), 45) || 'Command';
  const actions = (input.actions ?? old.actions ?? []).map(cleanAction).filter(Boolean).slice(0, MAX_ACTIONS);
  if (!actions.length) return { error: 'Mindestens eine Aktion mit Inhalt angeben' };
  return {
    name, trigger, actions,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : (old.enabled ?? true),
    role: ROLES.includes(input.role) ? input.role : (old.role ?? 'all'),
    cooldown: clamp(input.cooldown ?? old.cooldown, 0, 86_400, type === 'timer' ? 0 : 10),
  };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function matches(cmd, text) {
  const { type, word } = cmd.trigger;
  if (type === 'command') return text.split(/\s+/)[0].toLowerCase() === word;
  if (type === 'keyword') return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
  return false;
}

export function allowed(cmd, e) {
  const need = ROLE_BADGES[cmd.role ?? 'all'];
  if (!need) return true;
  const have = new Set((e.badges ?? []).map((b) => b.set_id));
  if (e.chatter_user_id && e.chatter_user_id === e.broadcaster_user_id) have.add('broadcaster');
  return need.some((b) => have.has(b));
}

async function cooling(key, seconds, now) {
  if (!seconds) return false;
  const last = await db.get(`cooldown/${key}`);
  if (last && now - last < seconds * 1000) return true;
  await db.set(`cooldown/${key}`, now);
  return false;
}

/** Führt die Aktionen nacheinander aus. Die Reihenfolge im Overlay und die Abspielsperre sorgen dafür, dass sie nacheinander laufen. */
export async function runActions(cmd, ctx, settings) {
  const vars = { user: ctx.user ?? '', args: ctx.args ?? '', channel: ctx.channel ?? '' };
  const board = cmd.actions.some((a) => a.type === 'sound') ? await getBoard() : [];
  for (const a of cmd.actions) {
    try {
      if (a.type === 'chat') { if (settings.chatEnabled) await sendChat(fill(a.text, vars)); }
      else if (a.type === 'alert') await pushOverlay({ type: 'alert', kind: 'command', user: vars.user, title: fill(a.title, vars), message: fill(a.message, vars) });
      else if (a.type === 'sound') {
        const entry = board.find((x) => x.id === a.soundId);
        if (entry && isActive({ ...entry, enabled: true })) await pushOverlay({ type: 'sound', id: entry.id, user: vars.user, title: entry.title, volume: entry.volume, src: `/api/soundboard?id=${entry.id}&v=${entry.soundVersion}` });
      }
    } catch (err) { console.warn(`Command ${cmd.name}: Aktion ${a.type} fehlgeschlagen:`, err.message); }
  }
}

// ---------- Chat: Befehle und Stichwörter ----------
// Der Bot schreibt als Kanalinhaber. Stichwörter reagieren deshalb nie auf dessen Nachrichten (sonst Endlosschleife).
export async function handleCustom(e, text, settings, { ignored, now = Date.now() } = {}) {
  const list = (await getCommands()).filter((c) => c.enabled && c.trigger.type !== 'timer');
  if (!list.length) return { handled: 0 };
  const fromOwner = e.chatter_user_id === e.broadcaster_user_id;
  if (ignored) return { handled: 0 };
  if (e.message_id && !(await db.setIfNew(`seen/cmd-${e.message_id}`, now))) return { handled: 0 };
  let handled = 0;
  for (const cmd of list) {
    if (cmd.trigger.type === 'keyword' && fromOwner) continue;
    if (!matches(cmd, text) || !allowed(cmd, e)) continue;
    if (await cooling(`cmd-${cmd.id}`, cmd.cooldown, now)) continue;
    const args = cmd.trigger.type === 'command' ? text.split(/\s+/).slice(1).join(' ') : text;
    await runActions(cmd, { user: e.chatter_user_name, args, channel: e.broadcaster_user_name }, settings);
    handled++;
  }
  return { handled };
}

// ---------- Zeitgesteuert, nur bei Aktivität im Chat ----------
// Gemerkt werden die Zeitpunkte der letzten Chat-Nachrichten (ohne Bots und Kanalinhaber).
const PULSE = 'state/chatpulse';
export async function recordPulse(now = Date.now()) {
  const old = (await db.get(PULSE))?.times ?? [];
  await db.set(PULSE, { times: [...old.filter((t) => now - t < 6 * 3_600_000), now].slice(-200) });
}

/** Startet fällige Timer: Intervall vorbei und seit dem letzten Lauf genug Chat-Nachrichten im Zeitfenster. */
export async function tickTimers(settings, now = Date.now()) {
  const timers = (await getCommands()).filter((c) => c.enabled && c.trigger.type === 'timer');
  if (!timers.length) return 0;
  const times = (await db.get(PULSE))?.times ?? [];
  let ran = 0;
  for (const cmd of timers) {
    const { minutes, minMessages } = cmd.trigger;
    const last = (await db.get(`cooldown/timer-${cmd.id}`)) ?? 0;
    if (now - last < minutes * 60_000) continue;
    const since = Math.max(last, now - minutes * 60_000);
    if (times.filter((t) => t > since).length < minMessages) continue; // niemand schreibt: nichts ausspielen
    await db.set(`cooldown/timer-${cmd.id}`, now);
    await runActions(cmd, {}, settings);
    ran++;
  }
  return ran;
}

// Das Overlay fragt alle paar Sekunden nach und stößt so die Timer an (nur solange OBS offen ist, ohne eigenen Dauerlauf).
let lastTick = 0;
export async function tickTimersThrottled(settings, now = Date.now()) {
  if (now - lastTick < 20_000) return 0;
  lastTick = now;
  return tickTimers(settings, now);
}
