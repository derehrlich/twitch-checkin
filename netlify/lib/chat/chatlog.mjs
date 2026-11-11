// Chat-Overlay (/chat): die letzten Chatnachrichten als waagerechte Leiste. Der Chat-Webhook legt jede Nachricht hier ab,
// das Overlay holt sie ab (siehe netlify/functions/chatlog.mjs).
//
// Speicher:
//   chatlog           [ { id, t, n: Name, c: Farbe|'', g: Verlauf, s: Glitzer, m: [ { e: Emote-Kennung } | { x: Text } ] } ]   die letzten Nachrichten, neueste zuletzt
//   chatstyle/<id>    { hex: '#rrggbb'|null, gradient, glitter, glitterUntil }   eigene Farbe und Extras einer Person (per !farbe, !verlauf, !glitter, !reset)
//                     glitterUntil: bis wann der Glitzer gekauft ist (Kanalpunkte-Reward, FOREVER = unbegrenzt); darf dann auch ohne Abo an- und ausgeschaltet werden
import { db } from '../kern/store.mjs';
import { parseColor } from '../belohnungen/alpaca.mjs';
import { sendChat, setRedemptionStatus } from '../kern/twitch.mjs';
import { fill } from '../zuschauer/checkin.mjs';

export const LOG_KEY = 'chatlog';
const KEEP = 40; // so viele Nachrichten hält die Liste höchstens
const MAX_TEXT = 200; // längere Nachrichten werden gekürzt

// Nachricht in Text- und Emote-Stücke zerlegen. Twitch liefert die Stücke fertig (fragments).
export function pieces(message) {
  const out = [];
  let left = MAX_TEXT;
  for (const f of message?.fragments ?? [{ type: 'text', text: message?.text ?? '' }]) {
    if (left <= 0) break;
    if (f.type === 'emote' && f.emote?.id) { out.push({ e: String(f.emote.id) }); left -= 3; continue; }
    const text = String(f.text ?? '').slice(0, left);
    if (text) { out.push({ x: text }); left -= text.length; }
  }
  return out;
}

const STYLE_CMD = /^!(farbe|glitter|verlauf|reset)(?:\s+(.*))?$/i;
const EXTRA_BADGES = ['subscriber', 'founder', 'vip', 'moderator', 'broadcaster']; // diese Abzeichen dürfen Glitzer und Verlauf

const FOREVER = 32_503_680_000_000; // Jahr 3000: unbegrenzt gekaufter Glitzer
const DAY = 86_400_000;

const privileged = (e, settings) => {
  const vip = String(settings.chatOverlayVip ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  return (e.badges ?? []).some((b) => EXTRA_BADGES.includes(b.set_id)) || vip.includes(String(e.chatter_user_name).toLowerCase());
};

// Eigene Farbe und Extras per Chatbefehl. Farbe darf jede Person. Glitzer und Verlauf nur Abos, VIPs, Mods, der Kanalinhaber und die Namen
// aus der Einstellung. Glitzer darf außerdem, wer ihn per Kanalpunkte-Reward gekauft hat (solange er gilt).
async function styleCommand(e, settings, cmd, arg, now = Date.now()) {
  const id = e.chatter_user_id;
  const allowed = privileged(e, settings);
  const st = { hex: null, gradient: false, glitter: false, ...((await db.get(`chatstyle/${id}`)) ?? {}) };
  if (cmd === 'farbe') { const c = parseColor(arg); if (!c) return; st.hex = c; }
  else if (cmd === 'glitter') { if (!allowed && !(st.glitterUntil > now)) return; st.glitter = !st.glitter; }
  else if (cmd === 'verlauf') { if (!allowed) return; st.gradient = !st.gradient; }
  else { st.hex = null; st.gradient = false; st.glitter = false; } // gekaufter Glitzer bleibt gekauft (glitterUntil)
  await db.set(`chatstyle/${id}`, st);
}

const untilText = (until, settings) => (until >= FOREVER ? 'unbegrenzt' : new Date(until).toLocaleDateString('de-DE', { timeZone: settings.timezone }));

/** Reward „Glitzer-Chat“: schaltet den Glitzer für glitterDays Tage frei (0 = unbegrenzt) und macht ihn gleich an. Erneutes Einlösen verlängert. */
export async function handleGlitter(redemption, settings, now = Date.now()) {
  const { id: rid, user_id: id, user_name: name, reward } = redemption;
  if (!settings.chatOverlayEnabled) { // ohne Chat-Leiste gibt es nichts zu glitzern
    if (settings.chatEnabled) await sendChat(`${name}, die Chat-Leiste ist gerade aus, der Glitzer hätte nichts bewirkt. Deine Punkte bekommst du zurück.`).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
    await setRedemptionStatus(rid, reward.id, 'CANCELED');
    return { ok: false };
  }
  const st = { hex: null, gradient: false, glitter: false, ...((await db.get(`chatstyle/${id}`)) ?? {}) };
  const base = Math.max(now, st.glitterUntil ?? 0);
  st.glitterUntil = settings.glitterDays > 0 && base < FOREVER ? base + settings.glitterDays * DAY : FOREVER;
  st.glitter = true;
  await db.set(`chatstyle/${id}`, st);
  if (settings.chatEnabled) await sendChat(fill(settings.glitterTemplate, { user: name, until: untilText(st.glitterUntil, settings) })).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
  await setRedemptionStatus(rid, reward.id, 'FULFILLED');
  return { ok: true, until: st.glitterUntil };
}

/** Nachricht merken, wenn das Overlay an ist. Befehle (!…) und ignorierte Namen (Bots) bleiben draußen. */
export async function recordChatMessage(e, settings) {
  if (!settings.chatOverlayEnabled) return false;
  const text = String(e.message?.text ?? '').trim();
  const name = String(e.chatter_user_name ?? '');
  if (!text || !name) return false;
  const ignore = String(settings.creditsIgnore ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if (ignore.includes(name.toLowerCase())) return false;
  const cmd = STYLE_CMD.exec(text);
  if (cmd) { if (!e.message_id || await db.setIfNew(`seen/chatstyle-${e.message_id}`, Date.now())) await styleCommand(e, settings, cmd[1].toLowerCase(), cmd[2] ?? ''); return false; }
  if (settings.chatOverlayHideCommands && text.startsWith('!')) return false;
  const id = String(e.message_id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const st = (await db.get(`chatstyle/${e.chatter_user_id}`)) ?? {};
  const list = ((await db.get(LOG_KEY)) ?? []).filter((x) => x.id !== id); // Twitch kann doppelt zustellen
  list.push({ id, t: Date.now(), n: name, c: st.hex ?? '', g: Boolean(st.gradient), s: Boolean(st.glitter) && (!st.glitterUntil || st.glitterUntil > Date.now() || privileged(e, settings)), m: pieces(e.message) });
  await db.set(LOG_KEY, list.slice(-KEEP));
  return true;
}

/** Für das Overlay: Nachrichten, die noch angezeigt werden sollen. */
export async function publicView(settings, now = Date.now()) {
  if (!settings.chatOverlayEnabled) return { enabled: false, seconds: settings.chatOverlaySeconds, max: settings.chatOverlayMax, messages: [] };
  const cutoff = settings.chatOverlaySeconds ? now - settings.chatOverlaySeconds * 1000 : 0; // 0 = bleibt stehen, bis neue kommen
  const messages = ((await db.get(LOG_KEY)) ?? []).filter((x) => x.t >= cutoff).slice(-settings.chatOverlayMax);
  return { enabled: true, seconds: settings.chatOverlaySeconds, max: settings.chatOverlayMax, messages };
}
