// Die festen Chat-Befehle des Bots (!streak, !top, !verknuepfen, !rangliste, !so, !quote, !addquote, !delquote).
// Ein neuer Befehl braucht nur eine Zeile in BEFEHLE, Dedupe, Abklingzeit, Rollenprüfung und das Senden erledigt `fuehreAus`.
//   id      interner Name
//   wort    liefert das Befehlswort aus den Einstellungen (z. B. '!streak')
//   aktiv   optional: nur wenn diese Einstellung an ist (sonst immer)
//   rolle   optional: 'mod' = nur Mods und der Kanalinhaber (alle anderen werden still ignoriert)
//   run     liefert den Antworttext (oder null für keine Antwort)
import { db } from '../kern/store.mjs';
import { sendChat } from '../kern/twitch.mjs';
import { fill, fmtDuration, streamDay } from '../zuschauer/checkin.mjs';
import { computeStreak, getStreamDays } from '../zuschauer/streak.mjs';
import { linkReply, rankReply } from '../belohnungen/community.mjs';
import { allUsers } from '../admin/common.mjs';
import { addQuote, deleteQuote, pickQuote, quoteText, shoutChannel } from './extras.mjs';
import { allowed } from './commands.mjs';
import { PERMIT_SECONDS, permit } from './moderation.mjs';
import { submitFromTwitch } from '../belohnungen/adventures.mjs';
import { birthdayReply } from '../overlays/countdown.mjs';
import { cancelByUser, confirmByUser, ingameByUser, modCommand, mySeat, sweepOffers, ticketsInfo } from '../belohnungen/tickets.mjs';

const minutesOf = (u) => Object.values(u.sessions ?? {}).reduce((s, x) => s + (x.minutes ?? 0), 0);

// Nutzer nach Besuchen sortieren (bei Gleichstand: längere Gesamtzeit, dann Name)
const ranked = (users) => [...users].sort((a, b) => b.count - a.count || minutesOf(b) - minutesOf(a) || a.name.localeCompare(b.name, 'de'));

export async function streakReply(userId, userName, settings, users) {
  const list = ranked(users);
  const me = list.find((u) => u.id === userId);
  if (!me) return fill(settings.streakCmdNone, { user: userName });
  const today = streamDay(settings);
  const { current, record } = computeStreak(me, await getStreamDays(), today, settings.streakGrace);
  const mins = minutesOf(me);
  return fill(settings.streakCmdTemplate, {
    user: me.name, count: me.count, streak: current, record, time: mins ? fmtDuration(mins) : 'noch keine Zeit', rank: list.indexOf(me) + 1, total: list.length,
  });
}

export function topReply(settings, users) {
  const n = settings.topSize;
  const list = ranked(users).slice(0, n).map((u, i) => `${i + 1}. ${u.name} (${u.count})`);
  return fill(settings.topTemplate, { n, list: list.join(' · ') || 'noch niemand' });
}

// Befehle haben eine gemeinsame Abklingzeit, damit der Chat nicht zugespammt wird
export async function cooling(cmd, seconds) {
  if (!seconds) return false;
  const last = await db.get(`cooldown/${cmd}`);
  if (last && Date.now() - last < seconds * 1000) return true;
  await db.set(`cooldown/${cmd}`, Date.now());
  return false;
}

export const BEFEHLE = [
  { id: 'streak', wort: (s) => s.streakCommand, run: async ({ e, settings }) => streakReply(e.chatter_user_id, e.chatter_user_name, settings, await allUsers()) },
  { id: 'top', wort: (s) => s.topCommand, run: async ({ settings }) => topReply(settings, await allUsers()) },
  { id: 'verknuepfen', wort: (s) => s.communityCommand, aktiv: (s) => s.communityEnabled, run: ({ e, settings }) => linkReply(settings, e.chatter_user_name) },
  { id: 'rangliste', wort: (s) => s.communityRankCommand, aktiv: (s) => s.communityEnabled, run: ({ e, settings }) => rankReply(settings, e.chatter_user_id) },
  {
    id: 'so', wort: (s) => s.soCommand, aktiv: (s) => s.soEnabled, rolle: 'mod',
    async run({ e, args, settings }) {
      const login = args.split(/\s+/)[0]?.replace(/^@/, '').toLowerCase();
      if (!login) return `${e.chatter_user_name}, wen soll ich shouten? Zum Beispiel ${settings.soCommand} name`;
      return (await shoutChannel(login, settings, { announce: false })) ?? `${e.chatter_user_name}, den Kanal „${login}“ gibt es nicht.`;
    },
  },
  {
    id: 'quote', wort: (s) => s.quoteCommand, aktiv: (s) => s.quoteEnabled,
    async run({ e, args, settings }) {
      const q = await pickQuote(args);
      return q ? quoteText(q, settings) : fill(settings.quoteNoneTemplate, { user: e.chatter_user_name });
    },
  },
  {
    id: 'addquote', wort: (s) => s.quoteAddCommand, aktiv: (s) => s.quoteEnabled, rolle: 'mod',
    async run({ e, args, settings }) {
      if (!args) return `${e.chatter_user_name}, schreib das Zitat hinter den Befehl: ${settings.quoteAddCommand} Text`;
      return fill(settings.quoteAddedTemplate, { n: await addQuote(args, e.chatter_user_name), user: e.chatter_user_name });
    },
  },
  {
    id: 'delquote', wort: (s) => s.quoteDelCommand, aktiv: (s) => s.quoteEnabled, rolle: 'mod',
    async run({ e, args, settings }) {
      const num = /^#?(\d+)$/.exec(args)?.[1];
      if (!num || !(await deleteQuote(num))) return `${e.chatter_user_name}, dieses Zitat gibt es nicht. Beispiel: ${settings.quoteDelCommand} 3`;
      return `🗑️ Zitat #${num} ist gelöscht.`;
    },
  },
  {
    id: 'permit', wort: (s) => s.modPermitCommand, aktiv: (s) => s.modEnabled, rolle: 'mod',
    async run({ e, args, settings }) {
      const login = args.split(/\s+/)[0]?.replace(/^@/, '').toLowerCase();
      if (!login) return `${e.chatter_user_name}, für wen? Zum Beispiel ${settings.modPermitCommand} name`;
      await permit(login);
      return `✅ @${login} darf in den nächsten ${PERMIT_SECONDS} Sekunden einen Link posten.`;
    },
  },
  { id: 'geburtstag', wort: (s) => s.bdayCommand, aktiv: (s) => s.bdayEnabled, run: ({ settings }) => birthdayReply(settings) },
  { id: 'adventure', wort: (s) => s.advCommand, aktiv: (s) => s.advEnabled, run: async ({ e, args, settings }) => (await submitFromTwitch(settings, e, args)).reply },
  { id: 'tickets', wort: (s) => s.ticketsCommand, aktiv: (s) => s.ticketsEnabled, run: ({ settings }) => ticketsInfo(settings) },
  { id: 'platz', wort: (s) => s.ticketSeatCommand, aktiv: (s) => s.ticketsEnabled, run: async ({ e, settings }) => { await sweepOffers(settings); return mySeat(e.chatter_user_id, e.chatter_user_name, settings); } },
  { id: 'absagen', wort: (s) => s.ticketCancelCommand, aktiv: (s) => s.ticketsEnabled, run: ({ e, args, settings }) => cancelByUser(e, args, settings) },
  { id: 'dabei', wort: (s) => s.ticketConfirmCommand, aktiv: (s) => s.ticketsEnabled, run: async ({ e, settings }) => { await sweepOffers(settings); return confirmByUser(e, settings); } },
  { id: 'steam', wort: (s) => s.ticketIngameCommand, aktiv: (s) => s.ticketsEnabled, run: ({ e, args, settings }) => ingameByUser(e, args, settings) },
  { id: 'ticketadd', wort: (s) => s.ticketAddCommand, aktiv: (s) => s.ticketsEnabled, rolle: 'mod', run: ({ e, args, settings }) => modCommand('add', e, args, settings) },
  { id: 'ticketremove', wort: (s) => s.ticketRemoveCommand, aktiv: (s) => s.ticketsEnabled, rolle: 'mod', run: ({ e, args, settings }) => modCommand('remove', e, args, settings) },
];

export const findeBefehl = (cmd, settings) => BEFEHLE.find((b) => (b.aktiv ? b.aktiv(settings) : true) && b.wort(settings) === cmd);

/**
 * Führt den festen Befehl aus, falls die Nachricht einer ist. Gibt null zurück, wenn es keiner war.
 * Reihenfolge: Chat darf schreiben → Rolle → doppelte Zustellung von Twitch → Abklingzeit → Antwort senden.
 */
export async function fuehreAus(e, text, settings) {
  const cmd = text.split(/\s+/)[0].toLowerCase();
  const befehl = findeBefehl(cmd, settings);
  if (!befehl) return null;
  if (!settings.chatEnabled) return { ok: true };
  if (befehl.rolle === 'mod' && !allowed({ role: 'mod' }, e)) return { ok: true };
  if (e.message_id && !(await db.setIfNew(`seen/chat-${e.message_id}`, Date.now()))) return { ok: true };
  if (await cooling(cmd, settings.commandCooldown)) return { ok: true, cooldown: true };
  const args = text.split(/\s+/).slice(1).join(' ').trim();
  let reply = null;
  try { reply = await befehl.run({ e, args, settings }); } catch (err) { console.warn(`Befehl ${befehl.id} fehlgeschlagen:`, err.message); }
  if (reply) await sendChat(reply);
  return { ok: true, reply };
}
