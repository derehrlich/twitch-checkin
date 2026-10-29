// Chat-Webhook (channel.chat.message): merkt sich Chatter für den Abspann und beantwortet !streak und !top.
import { db } from './store.mjs';
import { fill, fmtDuration, streamDay } from './checkin.mjs';
import { computeStreak, getStreamDays } from './streak.mjs';
import { sendChat } from './twitch.mjs';
import { recordChatter } from './credits.mjs';
import { allUsers } from './admin/common.mjs';

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
async function cooling(cmd, seconds) {
  if (!seconds) return false;
  const last = await db.get(`cooldown/${cmd}`);
  if (last && Date.now() - last < seconds * 1000) return true;
  await db.set(`cooldown/${cmd}`, Date.now());
  return false;
}

export async function handleChat(e, settings) {
  const id = e.chatter_user_id, name = e.chatter_user_name;
  if (!id) return { ok: false };
  if (settings.creditsEnabled) await recordChatter(streamDay(settings), id, name);

  const text = String(e.message?.text ?? '').trim();
  if (!settings.chatCommands || !text.startsWith('!')) return { ok: true };
  const cmd = text.split(/\s+/)[0].toLowerCase();
  if (cmd !== settings.streakCommand && cmd !== settings.topCommand) return { ok: true };
  // Twitch kann Nachrichten doppelt zustellen
  if (e.message_id && !(await db.setIfNew(`seen/chat-${e.message_id}`, Date.now()))) return { ok: true };
  if (await cooling(cmd, settings.commandCooldown)) return { ok: true, cooldown: true };
  if (!settings.chatEnabled) return { ok: true };

  const users = await allUsers();
  const reply = cmd === settings.streakCommand ? await streakReply(id, name, settings, users) : topReply(settings, users);
  await sendChat(reply);
  return { ok: true, reply };
}
