// Community-Rangliste des Monats und Konto-Verknüpfung Discord <-> Twitch.
//
// Verknüpft wird nur freiwillig: Der VerwirrBot schickt per /verknuepfen einen signierten Link, die Person meldet sich auf
// /verknuepfen mit Twitch an und stimmt ausdrücklich zu. Öffentlich erscheinen nur verknüpfte Konten. Löschen geht jederzeit.
// Bot und Stadtwache teilen ein Geheimwort (LINK_SECRET): Der Bot signiert damit die Links und meldet sich damit bei den
// Bot-Endpunkten an.
//
// Speicher:
//   link/discord/<discordId>  und  link/twitch/<twitchId>   { discordId, discordName, twitchId, twitchName, at }
//   cmonth/<YYYY-MM>/<twitchId>   Twitch-Chat im Monat { name, msgs, days, lastDay, dayMsgs, lastAt }
//   dmonth/<YYYY-MM>/<discordId>  Discord im Monat, vom Bot gemeldet { msgs, days }
//   linktip/<YYYY-MM>/<twitchId>  Tipp wurde schon gezeigt
import crypto from 'node:crypto';
import { db } from './store.mjs';
import { safeEqual } from './http.mjs';
import { siteUrl } from './twitch.mjs';

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
export const DISCORD_ID = /^\d{5,25}$/;
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---- Geheimwort, Link-Token, Bot-Anmeldung

export const secretSet = () => Boolean(process.env.LINK_SECRET);
const hmac = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

/** Token wie ihn der Bot baut: base64url(JSON {d, n, exp}) + "." + HMAC-SHA256 (base64url) */
export function signLinkToken({ discordId, discordName, exp }, secret = process.env.LINK_SECRET) {
  const p = Buffer.from(JSON.stringify({ d: discordId, n: discordName, exp })).toString('base64url');
  return `${p}.${hmac(p, secret)}`;
}

export function verifyLinkToken(token) {
  if (!secretSet() || typeof token !== 'string' || token.length > 1500) return null;
  const [p, sig] = token.split('.');
  if (!p || !sig || !safeEqual(sig, hmac(p, process.env.LINK_SECRET))) return null;
  try {
    const v = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!(v.exp > Date.now()) || !DISCORD_ID.test(String(v.d))) return null;
    return { discordId: String(v.d), discordName: String(v.n ?? '').slice(0, 60) };
  } catch { return null; }
}

export const botAuthorized = (req) => secretSet() && safeEqual((req.headers.get('authorization') ?? '').replace(/^Bearer /, ''), process.env.LINK_SECRET);

// ---- Verknüpfungen

const dKey = (id) => `link/discord/${id}`;
const tKey = (id) => `link/twitch/${id}`;
export const linkByTwitch = (id) => db.get(tKey(id));
export const linkByDiscord = (id) => db.get(dKey(id));

/** Speichert die Verknüpfung; frühere Verknüpfungen beider Konten werden dabei gelöst. */
export async function saveLink({ discordId, discordName, twitchId, twitchName }) {
  const oldByDiscord = await db.get(dKey(discordId));
  if (oldByDiscord && oldByDiscord.twitchId !== twitchId) await db.delete(tKey(oldByDiscord.twitchId));
  const oldByTwitch = await db.get(tKey(twitchId));
  if (oldByTwitch && oldByTwitch.discordId !== discordId) await db.delete(dKey(oldByTwitch.discordId));
  const rec = { discordId, discordName, twitchId, twitchName, at: new Date().toISOString() };
  await db.set(dKey(discordId), rec);
  await db.set(tKey(twitchId), rec);
  return rec;
}

/** Löscht die Verknüpfung (per Discord- oder Twitch-ID). Die Zählstände bleiben, werden aber nirgends mehr gezeigt. */
export async function removeLink({ discordId, twitchId }) {
  const rec = discordId ? await db.get(dKey(discordId)) : await db.get(tKey(twitchId));
  if (!rec) return false;
  await db.delete(dKey(rec.discordId));
  await db.delete(tKey(rec.twitchId));
  return true;
}

export async function allLinks() {
  const out = [];
  const keys = await db.list('link/twitch/');
  for (let i = 0; i < keys.length; i += 25) out.push(...(await Promise.all(keys.slice(i, i + 25).map((k) => db.get(k)))).filter(Boolean));
  return out;
}

// ---- Zählen

const dayOf = (settings, date) => new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(new Date(date.getTime() - settings.dayRolloverHour * 3_600_000));
export const monthOf = (settings, date = new Date()) => dayOf(settings, date).slice(0, 7);

export function monthLabel(month) {
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
}

/** Twitch-Chat: Mindestabstand und Tageslimit, damit Spam nicht belohnt wird. Gibt zurück, ob gezählt wurde. */
export async function countCommunityChat(userId, name, settings, now = new Date()) {
  const key = `cmonth/${monthOf(settings, now)}/${userId}`;
  const day = dayOf(settings, now);
  const rec = (await db.get(key)) ?? { name, msgs: 0, days: 0, lastDay: null, dayMsgs: 0, lastAt: 0 };
  if (now.getTime() - rec.lastAt < settings.communityMsgGap * 1000) return false;
  const sameDay = rec.lastDay === day;
  if (sameDay && rec.dayMsgs >= settings.communityMsgCap) return false;
  await db.set(key, { name, msgs: rec.msgs + 1, days: rec.days + (sameDay ? 0 : 1), lastDay: day, dayMsgs: sameDay ? rec.dayMsgs + 1 : 1, lastAt: now.getTime() });
  return true;
}

/** Discord-Zahlen vom Bot übernehmen (nur aktueller oder vorheriger Monat, Werte begrenzt). */
export async function saveDiscordMonth(settings, month, rows, now = new Date()) {
  const current = monthOf(settings, now);
  const prev = monthOf(settings, new Date(now.getTime() - 32 * 86_400_000));
  if (!MONTH.test(month ?? '') || (month !== current && month !== prev)) return { error: 'Ungültiger Monat' };
  let saved = 0;
  for (const r of Array.isArray(rows) ? rows.slice(0, 2000) : []) {
    if (!DISCORD_ID.test(String(r?.discordId))) continue;
    if (!(await linkByDiscord(String(r.discordId)))) continue; // nur für Verknüpfte speichern, nur sie haben zugestimmt
    const clamp = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
    await db.set(`dmonth/${month}/${r.discordId}`, { msgs: clamp(r.msgs, settings.communityMsgCap * 31), days: clamp(r.days, 31) });
    saved++;
  }
  return { ok: true, saved };
}

// ---- Rangliste

export const weights = (s) => ({ msg: s.communityWeightMsg, day: s.communityWeightDay, checkin: s.communityWeightCheckin });
export const pointsOf = (s, { msgs = 0, days = 0, checkins = 0 }) => msgs * s.communityWeightMsg + days * s.communityWeightDay + checkins * s.communityWeightCheckin;

/** Rangliste des Monats: nur verknüpfte Konten, Twitch-Chat + Discord + Check-ins. */
export async function monthBoard(settings, month = monthOf(settings)) {
  const rows = [];
  for (const l of (await allLinks()).slice(0, 1000)) {
    const [tw, dc, user] = await Promise.all([db.get(`cmonth/${month}/${l.twitchId}`), db.get(`dmonth/${month}/${l.discordId}`), db.get(`user/${l.twitchId}`)]);
    const checkins = (user?.days ?? []).filter((d) => d.startsWith(month)).length;
    const points = pointsOf(settings, { msgs: (tw?.msgs ?? 0) + (dc?.msgs ?? 0), days: (tw?.days ?? 0) + (dc?.days ?? 0), checkins });
    if (points > 0) rows.push({ discordId: l.discordId, twitchId: l.twitchId, name: l.twitchName, points, twitchMsgs: tw?.msgs ?? 0, discordMsgs: dc?.msgs ?? 0, checkins });
  }
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'de'));
  return { month, label: monthLabel(month), rows };
}

// ---- Hinweise

export const linkUrl = () => `${siteUrl()}/verknuepfen`;

/** Tipp für Unverknüpfte beim Check-in: höchstens einmal pro Monat und Person. Sonst null. */
export async function linkTip(userId, userName, settings) {
  if (!settings.communityEnabled || !settings.communityTip || !secretSet()) return null;
  if (await linkByTwitch(userId)) return null;
  const fresh = await db.setIfNew(`linktip/${monthOf(settings)}/${userId}`, 1);
  return fresh ? fill(settings.communityTipTemplate, { user: userName, url: linkUrl() }) : null;
}

export const linkReply = (settings, userName) => fill(settings.communityLinkTemplate, { user: userName, url: linkUrl() });

/** Antwort auf !rangliste: Top-Plätze des Monats, bei verknüpften Chattern außerhalb der Liste auch der eigene Platz. */
export async function rankReply(settings, chatterId) {
  const board = await monthBoard(settings);
  const url = `${siteUrl()}/rangliste`;
  if (!board.rows.length) return fill(settings.communityRankEmpty, { month: board.label, url });
  const n = settings.communityRankSize;
  const list = board.rows.slice(0, n).map((r, i) => `${i + 1}. ${r.name} (${r.points})`).join(' · ');
  const i = board.rows.findIndex((r) => r.twitchId === chatterId);
  const me = i >= n ? ` · Du: Platz ${i + 1} (${board.rows[i].points})` : '';
  return fill(settings.communityRankTemplate, { month: board.label, list, me, n, url });
}
