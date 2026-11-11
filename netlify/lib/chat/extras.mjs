// Bausteine für Shoutout, Auto-Shoutout für Stammgäste und Zitate. Die Befehle selbst (!so, !quote …) stehen in befehle.mjs.
//   quote/<n>       { n, text, by, date }   (n zählt fortlaufend, gelöschte Nummern werden nicht neu vergeben)
//   quote-counter   letzte vergebene Nummer
//   shouted/<tag>/<id>  Sperre: Auto-Shoutout höchstens einmal pro Stream-Tag und Person
import { db } from '../kern/store.mjs';
import { fill, streamDay } from '../zuschauer/checkin.mjs';
import { channelInfo, sendChat, shoutout, userByLogin } from '../kern/twitch.mjs';

const list = (v) => String(v ?? '').toLowerCase().split(/[\s,;]+/).map((x) => x.replace(/^@/, '')).filter(Boolean);

// ---------- Zitate ----------
export async function addQuote(text, by, now = new Date()) {
  const n = ((await db.get('quote-counter')) ?? 0) + 1;
  await db.set('quote-counter', n);
  const date = now.toISOString().slice(0, 10);
  await db.set(`quote/${n}`, { n, text: text.slice(0, 300), by, date });
  return n;
}

export async function pickQuote(arg) {
  const keys = await db.list('quote/');
  if (!keys.length) return null;
  const wanted = /^#?(\d+)$/.exec(arg.trim());
  if (wanted) return db.get(`quote/${wanted[1]}`);
  return db.get(keys[Math.floor(Math.random() * keys.length)]);
}

const fmtDate = (iso) => iso.split('-').reverse().join('.');

/** Zitat als Chat-Text nach der Vorlage in den Einstellungen */
export const quoteText = (q, settings) => fill(settings.quoteTemplate, { n: q.n, text: q.text, by: q.by, date: fmtDate(q.date) });

/** Löscht ein Zitat, gibt false zurück wenn es die Nummer nicht gibt */
export async function deleteQuote(n) {
  if (!(await db.get(`quote/${n}`))) return false;
  await db.delete(`quote/${n}`);
  return true;
}

// ---------- Shoutout ----------
/** Offizieller Shoutout plus Chat-Nachricht für einen Kanal (Login). Gibt den Text zurück, oder null wenn es den Kanal nicht gibt. */
export async function shoutChannel(login, settings, { announce = true } = {}) {
  const user = await userByLogin(login);
  if (!user) return null;
  const info = await channelInfo(user.id).catch(() => null);
  const text = fill(settings.soTemplate, { name: user.display_name, game: info?.game || 'unbekannt', url: `twitch.tv/${user.login}` });
  await shoutout(user.id).catch((err) => console.warn('Shoutout fehlgeschlagen:', err.message));
  if (announce) await sendChat(text);
  return text;
}

/** Stammgäste aus der Liste bekommen einmal pro Stream-Tag einen Shoutout, wenn sie zum ersten Mal schreiben. */
export async function autoShoutout(e, settings, now = new Date()) {
  if (!settings.autoShoutoutEnabled || !settings.chatEnabled) return false;
  const name = String(e.chatter_user_name ?? '').toLowerCase();
  const login = String(e.chatter_user_login ?? name).toLowerCase();
  if (!list(settings.autoShoutoutUsers).some((x) => x === login || x === name)) return false;
  if (!(await db.setIfNew(`shouted/${streamDay(settings, now)}/${e.chatter_user_id}`, Date.now()))) return false;
  const text = await shoutChannel(login, settings).catch((err) => { console.warn('Auto-Shoutout fehlgeschlagen:', err.message); return null; });
  return Boolean(text);
}
