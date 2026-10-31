// Chat-Webhook (channel.chat.message): merkt sich Chatter für den Abspann und beantwortet !streak und !top.
import { db } from './store.mjs';
import { fill, fmtDuration, streamDay } from './checkin.mjs';
import { computeStreak, getStreamDays } from './streak.mjs';
import { sendChat } from './twitch.mjs';
import { countChat, recordChatter } from './credits.mjs';
import { allUsers } from './admin/common.mjs';
import { countCommunityChat, linkReply, rankReply } from './community.mjs';
import { ensureAward } from './award.mjs';
import { handleCustom, recordPulse } from './commands.mjs';

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
  const ignore = String(settings.creditsIgnore ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const counted = id !== e.broadcaster_user_id && !ignore.includes(String(name).toLowerCase()); // Bots und der Kanalinhaber zählen nicht
  if (counted && (settings.creditsEnabled || settings.chatStats)) {
    const day = streamDay(settings);
    await recordChatter(day, id, name);
    if (settings.chatStats) await countChat(id, name, day);
  }
  if (settings.awardEnabled) await ensureAward(settings).catch((err) => console.warn('Monatsabschluss fehlgeschlagen:', err.message)); // schließt den Vormonat einmalig ab
  if (counted && settings.communityEnabled) await countCommunityChat(id, name, settings).catch((err) => console.warn('Community-Zählung fehlgeschlagen:', err.message));

  const text = String(e.message?.text ?? '').trim();
  if (settings.chatCommands) {
    // Eigene Commands, Stichwörter und die Aktivität für zeitgesteuerte Regeln (siehe commands.mjs)
    if (counted) await recordPulse().catch(() => {});
    await handleCustom(e, text, settings, { ignored: ignore.includes(String(name).toLowerCase()) }).catch((err) => console.warn('Command fehlgeschlagen:', err.message));
  }
  if (!settings.chatCommands || !text.startsWith('!')) return { ok: true };
  const cmd = text.split(/\s+/)[0].toLowerCase();
  if (cmd !== settings.streakCommand && cmd !== settings.topCommand && !(settings.communityEnabled && (cmd === settings.communityCommand || cmd === settings.communityRankCommand))) return { ok: true };
  // Twitch kann Nachrichten doppelt zustellen
  if (e.message_id && !(await db.setIfNew(`seen/chat-${e.message_id}`, Date.now()))) return { ok: true };
  if (await cooling(cmd, settings.commandCooldown)) return { ok: true, cooldown: true };
  if (!settings.chatEnabled) return { ok: true };

  if (cmd === settings.communityCommand) { const reply = linkReply(settings, name); await sendChat(reply); return { ok: true, reply }; }
  if (cmd === settings.communityRankCommand) { const reply = await rankReply(settings, id); await sendChat(reply); return { ok: true, reply }; }
  const users = await allUsers();
  const reply = cmd === settings.streakCommand ? await streakReply(id, name, settings, users) : topReply(settings, users);
  await sendChat(reply);
  return { ok: true, reply };
}
