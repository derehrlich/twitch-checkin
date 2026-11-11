// Einfache Moderation: Links, gesperrte Wörter, Großbuchstaben, Wiederholungen und Emote-Spam.
// Ablauf je Nachricht: Ausnahmen prüfen -> Regeln prüfen -> bei Verstoß löschen und im Chat warnen, bei wiederholten Verstößen Timeout.
// Mit modTestMode wird nur protokolliert, nichts gelöscht. Twitch-Clips sind immer erlaubt (modAllowClips).
//   modlog/<zeit>-<zufall>   { t, user, rule, text, action }   Protokoll fürs Admin (höchstens LOG_MAX)
//   modstrike/<twitchId>     { n, last }                         Verstöße der letzten modStrikeMinutes
//   modlast/<twitchId>       { text, n, t }                      letzte Nachricht für die Wiederholungs-Regel
//   modpermit/<login>        { until }                           Link-Erlaubnis per !permit
import crypto from 'node:crypto';
import { db } from '../kern/store.mjs';
import { deleteChatMessage, sendChat, timeoutChatter } from '../kern/twitch.mjs';
import { fill } from '../zuschauer/checkin.mjs';

export const LOG_MAX = 100;
export const PERMIT_SECONDS = 60;
const REPEAT_WINDOW = 60_000; // gleiche Nachrichten innerhalb dieser Zeit zählen als Wiederholung
const WARN_GAP = 15_000; // Warnungen an dieselbe Person höchstens so oft

// ---------- Erkennung (reine Funktionen, gut testbar) ----------
const LINK = /(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9-]+\.)+(?:com|de|net|org|tv|gg|io|me|ly|co|app|xyz|info|eu|at|ch|ru|to|gl|be|link|live|shop|site|online|club|tk|ml|ga|cf)\b(?:\/[^\s<>]*)?/gi;
const TWITCH_HOSTS = ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'];

const parseLink = (raw) => {
  const cleaned = raw.replace(/[.,;:!?)\]]+$/, '');
  const m = /^(?:https?:\/\/)?([^/\s?#]+)(\/[^\s?#]*)?/i.exec(cleaned);
  return m ? { host: m[1].toLowerCase().replace(/:\d+$/, ''), path: m[2] ?? '' } : null;
};

/** Ein Twitch-Clip: clips.twitch.tv/<Kennung> oder twitch.tv/<Kanal>/clip/<Kennung> */
export const isClipLink = ({ host, path }) =>
  (host === 'clips.twitch.tv' && /^\/[A-Za-z0-9_-]{8,}/.test(path)) || (TWITCH_HOSTS.includes(host) && /^\/[^/]+\/clip\/[A-Za-z0-9_-]{8,}/i.test(path));

const list = (v) => String(v ?? '').toLowerCase().split(/[\s,;]+/).map((x) => x.replace(/^@/, '').replace(/^https?:\/\//, '').replace(/^www\./, '')).filter(Boolean);
const hostAllowed = (host, allow) => allow.some((a) => host === a || host.endsWith('.' + a));

/** Links der Nachricht, die nicht erlaubt sind (Clips und Adressen der Erlaubnisliste fallen heraus) */
export function badLinks(text, settings) {
  const allow = list(settings.modLinkAllow);
  return (text.match(LINK) ?? []).map(parseLink).filter(Boolean)
    .filter((l) => !(settings.modAllowClips && isClipLink(l)) && !hostAllowed(l.host, allow));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function badWord(text, settings) {
  return list(settings.modWords).find((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(text)) ?? null;
}

export function tooManyCaps(text, settings) {
  const letters = [...text].filter((c) => c.toLowerCase() !== c.toUpperCase());
  if (letters.length < settings.modCapsMin) return false;
  return (letters.filter((c) => c === c.toUpperCase()).length / letters.length) * 100 >= settings.modCapsPercent;
}

export const emoteCount = (e) => (e.message?.fragments ?? []).filter((f) => f.type === 'emote' || f.type === 'cheermote').length;

// ---------- Ausnahmen ----------
const badgeSet = (e) => new Set((e.badges ?? []).map((b) => b.set_id));
const FULL = ['broadcaster', 'moderator']; // nie moderiert
const TRUSTED = ['vip', 'subscriber']; // dürfen alles außer gesperrte Wörter

async function trustedViewer(e, settings) {
  if (!(settings.modTrustVisits > 0)) return false;
  const user = await db.get(`user/${e.chatter_user_id}`);
  return (user?.count ?? 0) >= settings.modTrustVisits;
}

// ---------- Protokoll ----------
export async function writeLog(entry) {
  const key = `modlog/${String(Date.now()).padStart(13, '0')}-${crypto.randomBytes(3).toString('hex')}`;
  await db.set(key, { t: Date.now(), ...entry, text: String(entry.text ?? '').slice(0, 200) });
  const keys = await db.list('modlog/');
  for (const old of keys.slice(0, Math.max(0, keys.length - LOG_MAX))) await db.delete(old);
}

export async function readLog() {
  const keys = (await db.list('modlog/')).slice(-LOG_MAX).reverse();
  return (await Promise.all(keys.map((k) => db.get(k)))).filter(Boolean);
}

export async function clearLog() {
  for (const k of await db.list('modlog/')) await db.delete(k);
}

// ---------- Permit ----------
export async function permit(login, now = Date.now()) {
  await db.set(`modpermit/${login}`, { until: now + PERMIT_SECONDS * 1000 });
}
const permitted = async (e, now) => {
  const login = String(e.chatter_user_login ?? e.chatter_user_name ?? '').toLowerCase();
  const p = login && (await db.get(`modpermit/${login}`));
  return Boolean(p && p.until > now);
};

// ---------- Hauptfunktion ----------
const REASONS = {
  link: 'bitte keine Links hier (Twitch-Clips sind erlaubt 🎬)',
  word: 'dieses Wort ist hier nicht erwünscht',
  caps: 'bitte nicht nur in Großbuchstaben schreiben',
  repeat: 'bitte keine Wiederholungen',
  emotes: 'bitte nicht so viele Emotes auf einmal',
};

/** Prüft die Regeln. Gibt den Namen der verletzten Regel zurück (link, word, caps, repeat, emotes) oder null. */
async function violation(e, text, settings, now) {
  const badges = badgeSet(e);
  const trusted = TRUSTED.some((b) => badges.has(b)) || (await trustedViewer(e, settings));
  if (settings.modWords && badWord(text, settings)) return 'word';
  if (trusted) return null;
  if (settings.modLinks && badLinks(text, settings).length && !(await permitted(e, now))) return 'link';
  if (settings.modCaps && tooManyCaps(text, settings)) return 'caps';
  if (settings.modEmotes && emoteCount(e) > settings.modEmoteMax) return 'emotes';
  if (settings.modRepeat) {
    const key = `modlast/${e.chatter_user_id}`;
    const last = await db.get(key);
    const norm = text.toLowerCase().replace(/\s+/g, ' ');
    const n = last && last.text === norm && now - last.t < REPEAT_WINDOW ? last.n + 1 : 1;
    await db.set(key, { text: norm, n, t: now });
    if (n >= settings.modRepeatCount) return 'repeat';
  }
  return null;
}

/**
 * Moderiert eine Chat-Nachricht. Gibt { rule, deleted, test, action } zurück, wenn gegen eine Regel verstoßen wurde, sonst null.
 * Im Testmodus wird nur protokolliert (deleted = false).
 */
export async function moderate(e, settings, now = Date.now()) {
  if (!settings.modEnabled) return null;
  const text = String(e.message?.text ?? '').trim();
  if (!text || !e.message_id) return null;
  const badges = badgeSet(e);
  if (FULL.some((b) => badges.has(b)) || e.chatter_user_id === e.broadcaster_user_id) return null;
  if (list(settings.creditsIgnore).includes(String(e.chatter_user_name).toLowerCase())) return null; // andere Bots

  const rule = await violation(e, text, settings, now);
  if (!rule) return null;
  const user = e.chatter_user_name;

  if (settings.modTestMode) {
    await writeLog({ user, rule, text, action: 'Test: nicht gelöscht' });
    return { rule, deleted: false, test: true, action: 'test' };
  }

  // Verstöße der letzten Zeit zählen, ab modTimeoutAfter gibt es zusätzlich einen Timeout (0 = nie)
  const sKey = `modstrike/${e.chatter_user_id}`;
  const old = await db.get(sKey);
  const n = old && now - old.last < settings.modStrikeMinutes * 60_000 ? old.n + 1 : 1;
  await db.set(sKey, { n, last: now });
  let action = 'gelöscht';
  try { await deleteChatMessage(e.message_id); } catch (err) {
    console.warn('Moderation: Löschen fehlgeschlagen:', err.message);
    await writeLog({ user, rule, text, action: 'Löschen fehlgeschlagen (Berechtigung fehlt? Bitte „Mit Twitch verbinden“)' });
    return { rule, deleted: false, error: true, action: 'fehler' };
  }
  let seconds = 0;
  if (settings.modTimeoutAfter > 0 && n >= settings.modTimeoutAfter) {
    seconds = Math.min(600, settings.modTimeoutSeconds * 2 ** (n - settings.modTimeoutAfter));
    try { await timeoutChatter(e.chatter_user_id, seconds, `Stadtwache: ${REASONS[rule]}`); action = `gelöscht + Timeout ${seconds}s`; } catch (err) { console.warn('Moderation: Timeout fehlgeschlagen:', err.message); action = 'gelöscht (Timeout fehlgeschlagen)'; }
  }
  await writeLog({ user, rule, text, action });
  if (settings.chatEnabled && !seconds && !(await warnCooling(e.chatter_user_id, now))) {
    await sendChat(fill(settings.modWarnTemplate, { user, reason: REASONS[rule], n })).catch((err) => console.warn('Moderation: Warnung fehlgeschlagen:', err.message));
  }
  return { rule, deleted: true, test: false, action: seconds ? 'timeout' : 'geloescht', strikes: n, seconds };
}

async function warnCooling(userId, now) {
  const key = `cooldown/modwarn-${userId}`;
  const last = await db.get(key);
  if (last && now - last < WARN_GAP) return true;
  await db.set(key, now);
  return false;
}
