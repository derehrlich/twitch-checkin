// Shoutout-Befehl, Auto-Shoutout für Stammgäste und Zitate.
//   quote/<n>       { n, text, by, date }   (n zählt fortlaufend, gelöschte Nummern werden nicht neu vergeben)
//   quote-counter   letzte vergebene Nummer
//   shouted/<tag>/<id>  Sperre: Auto-Shoutout höchstens einmal pro Stream-Tag und Person
import { db } from './store.mjs';
import { fill, streamDay } from './checkin.mjs';
import { channelInfo, sendChat, shoutout, userByLogin } from './twitch.mjs';
import { allowed } from './commands.mjs';

const isMod = (e) => allowed({ role: 'mod' }, e);
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

// ---------- Befehle ----------
/**
 * Gibt die Antwort zurück, wenn die Nachricht einer dieser Befehle war (und der Chat antworten darf), sonst null.
 * Mods und der Kanalinhaber dürfen !so, !addquote und !delquote, !quote darf jeder.
 */
export async function handleExtras(e, text, cmd, settings) {
  const args = text.split(/\s+/).slice(1).join(' ').trim();
  const mine = (settings.soEnabled && cmd === settings.soCommand)
    || (settings.quoteEnabled && [settings.quoteCommand, settings.quoteAddCommand, settings.quoteDelCommand].includes(cmd));
  if (!mine) return null;
  if (e.message_id && !(await db.setIfNew(`seen/extra-${e.message_id}`, Date.now()))) return null;
  const who = e.chatter_user_name;

  if (cmd === settings.soCommand) {
    if (!isMod(e)) return null;
    const login = args.split(/\s+/)[0]?.replace(/^@/, '').toLowerCase();
    if (!login) return say(`${who}, wen soll ich shouten? Zum Beispiel ${settings.soCommand} name`);
    return (await shoutChannel(login, settings)) ?? say(`${who}, den Kanal „${login}“ gibt es nicht.`);
  }
  if (cmd === settings.quoteCommand) {
    const q = await pickQuote(args);
    return say(q ? fill(settings.quoteTemplate, { n: q.n, text: q.text, by: q.by, date: fmtDate(q.date) }) : fill(settings.quoteNoneTemplate, { user: who }));
  }
  if (!isMod(e)) return null;
  if (cmd === settings.quoteAddCommand) {
    if (!args) return say(`${who}, schreib das Zitat hinter den Befehl: ${settings.quoteAddCommand} Text`);
    const n = await addQuote(args, who);
    return say(fill(settings.quoteAddedTemplate, { n, user: who }));
  }
  const num = /^#?(\d+)$/.exec(args)?.[1];
  if (!num || !(await db.get(`quote/${num}`))) return say(`${who}, dieses Zitat gibt es nicht. Beispiel: ${settings.quoteDelCommand} 3`);
  await db.delete(`quote/${num}`);
  return say(`🗑️ Zitat #${num} ist gelöscht.`);
}

async function say(message) { await sendChat(message); return message; }
