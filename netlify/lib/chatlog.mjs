// Chat-Overlay (/chat): die letzten Chatnachrichten als waagerechte Leiste. Der Chat-Webhook legt jede Nachricht hier ab,
// das Overlay holt sie ab (siehe netlify/functions/chatlog.mjs).
//
// Speicher:
//   chatlog   [ { id, t, n: Name, c: Farbe|'', m: [ { e: Emote-Kennung } | { x: Text } ] } ]   die letzten Nachrichten, neueste zuletzt
import { db } from './store.mjs';

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

/** Nachricht merken, wenn das Overlay an ist. Befehle (!…) und ignorierte Namen (Bots) bleiben draußen. */
export async function recordChatMessage(e, settings) {
  if (!settings.chatOverlayEnabled) return false;
  const text = String(e.message?.text ?? '').trim();
  const name = String(e.chatter_user_name ?? '');
  if (!text || !name) return false;
  if (settings.chatOverlayHideCommands && text.startsWith('!')) return false;
  const ignore = String(settings.creditsIgnore ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if (ignore.includes(name.toLowerCase())) return false;
  const id = String(e.message_id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const list = ((await db.get(LOG_KEY)) ?? []).filter((x) => x.id !== id); // Twitch kann doppelt zustellen
  list.push({ id, t: Date.now(), n: name, c: /^#[0-9a-f]{6}$/i.test(e.color ?? '') ? e.color : '', m: pieces(e.message) });
  await db.set(LOG_KEY, list.slice(-KEEP));
  return true;
}

/** Für das Overlay: Nachrichten, die noch angezeigt werden sollen. */
export async function publicView(settings, now = Date.now()) {
  if (!settings.chatOverlayEnabled) return { enabled: false, seconds: settings.chatOverlaySeconds, messages: [] };
  const cutoff = now - settings.chatOverlaySeconds * 1000;
  const messages = ((await db.get(LOG_KEY)) ?? []).filter((x) => x.t >= cutoff).slice(-settings.chatOverlayMax);
  return { enabled: true, seconds: settings.chatOverlaySeconds, messages };
}
