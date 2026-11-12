// Chat-Overlay (/chat): die letzten Chatnachrichten als waagerechte Leiste. Der Chat-Webhook legt jede Nachricht hier ab,
// das Overlay holt sie ab (siehe netlify/functions/chatlog.mjs).
//
// Speicher:
//   chatlog           [ { id, t, u: Twitch-ID, p: darf Extras ohne Kauf, n: Name, c: Farbe|'', g: Verlauf, gc: [Verlauffarben] (optional), s: Glitzer, gl: Glitzerfarbe (optional), m: [ { e: Emote-Kennung } | { x: Text } ] } ]   die letzten Nachrichten, neueste zuletzt
//   chatstyle/<id>    { hex: '#rrggbb'|null, gradient, gradientColors: ['#rrggbb', …]|null, glitter, glitterColor: '#rrggbb'|null, glitterUntil, gradientUntil }   eigene Farbe und Extras einer Person (per !farbe, !verlauf, !glitter, !reset)
//                     glitterUntil / gradientUntil: bis wann Glitzer bzw. Verlauf gekauft sind (Kanalpunkte-Reward, FOREVER = unbegrenzt); darf dann auch ohne Abo an- und ausgeschaltet werden
import { db } from '../kern/store.mjs';
import { parseColor, parseColors } from '../belohnungen/alpaca.mjs';
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
// aus der Einstellung. Glitzer und Verlauf darf außerdem, wer sie per Kanalpunkte-Reward gekauft hat (solange sie gelten).
async function styleCommand(e, settings, cmd, arg, now = Date.now()) {
  const id = e.chatter_user_id;
  const allowed = privileged(e, settings);
  const st = { hex: null, gradient: false, glitter: false, ...((await db.get(`chatstyle/${id}`)) ?? {}) };
  if (cmd === 'farbe') { const c = parseColor(arg); if (!c) return; st.hex = c; }
  else if (cmd === 'glitter') {
    if (!allowed && !(st.glitterUntil > now)) return;
    const wish = String(arg ?? '').trim();
    if (!wish) st.glitter = !st.glitter; // ohne Farbe: an/aus
    else if (/^(auto|automatisch)$/i.test(wish)) { st.glitterColor = null; st.glitter = true; } // zurück zur Namensfarbe
    else { const c = parseColor(wish); if (!c) return; st.glitterColor = c; st.glitter = true; } // eigene Glitzerfarbe
  }
  else if (cmd === 'verlauf') {
    if (!allowed && !(st.gradientUntil > now)) return;
    const wish = String(arg ?? '').trim();
    if (!wish) st.gradient = !st.gradient; // ohne Farben: an/aus
    else if (/^(auto|automatisch)$/i.test(wish)) { st.gradientColors = null; st.gradient = true; } // zurück zum automatischen Verlauf
    else { const cols = parseColors(wish); if (!cols.length) return; st.gradientColors = cols; st.gradient = true; } // eigene Farben
  }
  else { st.hex = null; st.gradient = false; st.glitter = false; st.gradientColors = null; st.glitterColor = null; } // Gekauftes bleibt gekauft (glitterUntil, gradientUntil)
  await db.set(`chatstyle/${id}`, st);
}

// Ein Extra wird gezeigt, wenn es an ist und (falls gekauft) noch gilt oder die Person es ohnehin darf (Abo, VIP, Mod …)
const valid = (on, until, priv, now = Date.now()) => Boolean(on) && (!until || until > now || priv);

const untilText = (until, settings) => (until >= FOREVER ? 'unbegrenzt' : new Date(until).toLocaleDateString('de-DE', { timeZone: settings.timezone }));

// Die beiden kaufbaren Extras: Glitzer und Verlauf. flag = Schalter in chatstyle, until = bis wann gekauft, Einstellungen heißen <prefix>Days und <prefix>Template.
const EXTRAS = {
  glitter: { flag: 'glitter', until: 'glitterUntil', prefix: 'glitter', off: 'der Glitzer' },
  gradient: { flag: 'gradient', until: 'gradientUntil', prefix: 'gradient', off: 'der Farbverlauf' },
};

/** Reward „Glitzer-Chat“ oder „Verlauf-Chat“: schaltet das Extra für <prefix>Days Tage frei (0 = unbegrenzt) und macht es gleich an. Erneutes Einlösen verlängert. */
export async function handleStyleReward(kind, redemption, settings, now = Date.now()) {
  const x = EXTRAS[kind];
  const { id: rid, user_id: id, user_name: name, reward } = redemption;
  if (!settings.chatOverlayEnabled) { // ohne Chat-Leiste gibt es nichts zu sehen
    if (settings.chatEnabled) await sendChat(`${name}, die Chat-Leiste ist gerade aus, ${x.off} hätte nichts bewirkt. Deine Punkte bekommst du zurück.`).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
    await setRedemptionStatus(rid, reward.id, 'CANCELED');
    return { ok: false };
  }
  let colors = null; // nur beim Verlauf: Farben aus dem Text der Einlösung („auto“ oder leer = automatischer Verlauf)
  if (kind === 'gradient') {
    const wish = String(redemption.user_input ?? '').trim();
    if (wish && !/^(auto|automatisch)$/i.test(wish)) {
      colors = parseColors(wish);
      if (!colors.length) { // nichts erkannt: Hinweis und Punkte zurück, bevor etwas gutgeschrieben wird
        if (settings.chatEnabled) await sendChat(fill(settings.gradientBadTemplate, { user: name })).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
        await setRedemptionStatus(rid, reward.id, 'CANCELED');
        return { ok: false };
      }
    }
  }
  const st = { hex: null, gradient: false, glitter: false, ...((await db.get(`chatstyle/${id}`)) ?? {}) };
  if (kind === 'gradient') st.gradientColors = colors;
  const days = settings[`${x.prefix}Days`];
  const base = Math.max(now, st[x.until] ?? 0);
  st[x.until] = days > 0 && base < FOREVER ? base + days * DAY : FOREVER;
  st[x.flag] = true;
  await db.set(`chatstyle/${id}`, st);
  if (settings.chatEnabled) await sendChat(fill(settings[`${x.prefix}Template`], { user: name, until: untilText(st[x.until], settings) })).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
  await setRedemptionStatus(rid, reward.id, 'FULFILLED');
  return { ok: true, until: st[x.until], colors };
}
export const handleGlitter = (redemption, settings, now) => handleStyleReward('glitter', redemption, settings, now);
export const handleGradient = (redemption, settings, now) => handleStyleReward('gradient', redemption, settings, now);

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
  const priv = privileged(e, settings);
  list.push({ id, t: Date.now(), u: String(e.chatter_user_id ?? ''), p: priv, n: name, c: st.hex ?? '', g: valid(st.gradient, st.gradientUntil, priv), ...(st.gradientColors?.length ? { gc: st.gradientColors } : {}), s: valid(st.glitter, st.glitterUntil, priv), ...(st.glitterColor ? { gl: st.glitterColor } : {}), m: pieces(e.message) });
  await db.set(LOG_KEY, list.slice(-KEEP));
  return true;
}

/** Für das Overlay: Nachrichten, die noch angezeigt werden sollen. */
export async function publicView(settings, now = Date.now()) {
  if (!settings.chatOverlayEnabled) return { enabled: false, seconds: settings.chatOverlaySeconds, max: settings.chatOverlayMax, messages: [] };
  const cutoff = settings.chatOverlaySeconds ? now - settings.chatOverlaySeconds * 1000 : 0; // 0 = bleibt stehen, bis neue kommen
  const shown = ((await db.get(LOG_KEY)) ?? []).filter((x) => x.t >= cutoff).slice(-settings.chatOverlayMax);
  // Es gilt immer der aktuelle Stil der Person, auch für Nachrichten, die schon im Bild stehen (wer !verlauf ausschaltet, sieht es sofort).
  const styles = new Map();
  for (const u of new Set(shown.map((x) => x.u).filter(Boolean))) styles.set(u, (await db.get(`chatstyle/${u}`)) ?? {});
  const messages = shown.map(({ u, p, gc, gl, ...x }) => {
    const st = styles.get(u);
    if (!st) return { ...x, ...(gc ? { gc } : {}), ...(gl ? { gl } : {}) }; // ältere Einträge ohne Person: wie gespeichert
    return { ...x, c: st.hex ?? '', g: valid(st.gradient, st.gradientUntil, p), ...(st.gradientColors?.length ? { gc: st.gradientColors } : {}), s: valid(st.glitter, st.glitterUntil, p), ...(st.glitterColor ? { gl: st.glitterColor } : {}) };
  });
  return { enabled: true, seconds: settings.chatOverlaySeconds, max: settings.chatOverlayMax, messages };
}
