// Chat-Webhook (channel.chat.message): merkt sich Chatter für den Abspann, zählt für die Ranglisten und führt Befehle aus (siehe befehle.mjs).
import { db } from '../kern/store.mjs';
import { fill, streamDay } from '../zuschauer/checkin.mjs';
import { clipById, sendChat } from '../kern/twitch.mjs';
import { countChat, recordChatter } from '../overlays/credits.mjs';
import { countCommunityChat, linkByTwitch, secretSet } from '../belohnungen/community.mjs';
import { ensureAward } from '../belohnungen/award.mjs';
import { touchAlpaca } from '../belohnungen/alpaca.mjs';
import { recordChatMessage } from './chatlog.mjs';
import { handleCustom, recordPulse } from './commands.mjs';
import { autoShoutout } from './extras.mjs';
import { cooling, fuehreAus } from './befehle.mjs';
import { moderate } from './moderation.mjs';

// Links zu Clips: clips.twitch.tv/<Kennung> oder twitch.tv/<Kanal>/clip/<Kennung>
const CLIP_LINK = /(?:clips\.twitch\.tv\/|twitch\.tv\/\w+\/clip\/)([A-Za-z0-9_-]{8,100})/i;

/**
 * Wird im Chat ein Clip des Kanals geteilt und der Ersteller ist noch nicht mit dem Discord verknüpft, schreibt der Bot einmal pro
 * Clip einen Hinweis (Discord-Einladung und !verknuepfen). So kann der Ersteller im Discord ClipMaster werden.
 */
export async function clipHint(e, settings, text) {
  if (!settings.clipHintEnabled || !settings.communityEnabled || !settings.chatEnabled || !secretSet()) return null;
  const slug = CLIP_LINK.exec(text)?.[1];
  if (!slug) return null;
  if (!(await db.setIfNew(`cliphint/${slug}`, Date.now()))) return null; // jeder Clip nur einmal
  if (await cooling('cliphint', 20)) return null; // viele Links hintereinander: nicht den Chat füllen
  const clip = await clipById(slug).catch((err) => { console.warn('Clip-Abfrage fehlgeschlagen:', err.message); return null; });
  if (!clip || clip.broadcasterId !== e.broadcaster_user_id) return null; // nur Clips dieses Kanals
  if (clip.creatorId && (await linkByTwitch(clip.creatorId))) return null; // schon verknüpft: kein Hinweis nötig
  const reply = fill(settings.clipHintTemplate, { creator: clip.creator || e.chatter_user_name, user: e.chatter_user_name, discord: settings.discordInvite });
  await sendChat(reply);
  return reply;
}

export async function handleChat(e, settings) {
  const id = e.chatter_user_id, name = e.chatter_user_name;
  if (!id) return { ok: false };
  // Moderation zuerst: eine gelöschte Nachricht zählt nicht und löst keine Befehle aus (im Testmodus läuft alles normal weiter)
  if (settings.modEnabled) {
    const hit = await moderate(e, settings).catch((err) => { console.warn('Moderation fehlgeschlagen:', err.message); return null; });
    if (hit?.deleted) return { ok: true, moderated: hit.rule };
  }
  const ignore = String(settings.creditsIgnore ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const counted = id !== e.broadcaster_user_id && !ignore.includes(String(name).toLowerCase()); // Bots und der Kanalinhaber zählen nicht
  if (counted && (settings.creditsEnabled || settings.chatStats)) {
    const day = streamDay(settings);
    await recordChatter(day, id, name);
    if (settings.chatStats) await countChat(id, name, day);
  }
  if (settings.alpacaEnabled && !ignore.includes(String(name).toLowerCase())) await touchAlpaca(id, name, settings).catch((err) => console.warn('Alpaka fehlgeschlagen:', err.message)); // auch der Kanalinhaber bekommt eins
  if (settings.awardEnabled) await ensureAward(settings).catch((err) => console.warn('Monatsabschluss fehlgeschlagen:', err.message)); // schließt den Vormonat einmalig ab
  if (counted && settings.communityEnabled) await countCommunityChat(id, name, settings).catch((err) => console.warn('Community-Zählung fehlgeschlagen:', err.message));

  const text = String(e.message?.text ?? '').trim();
  await recordChatMessage(e, settings).catch((err) => console.warn('Chat-Overlay fehlgeschlagen:', err.message));
  if (settings.chatCommands) {
    // Eigene Commands, Stichwörter und die Aktivität für zeitgesteuerte Regeln (siehe commands.mjs)
    if (counted) await recordPulse().catch(() => {});
    await handleCustom(e, text, settings, { ignored: ignore.includes(String(name).toLowerCase()) }).catch((err) => console.warn('Command fehlgeschlagen:', err.message));
  }
  if (counted) await autoShoutout(e, settings).catch((err) => console.warn('Auto-Shoutout fehlgeschlagen:', err.message));
  if (counted) await clipHint(e, settings, text).catch((err) => console.warn('Clip-Hinweis fehlgeschlagen:', err.message));
  if (!settings.chatCommands || !text.startsWith('!')) return { ok: true };
  return (await fuehreAus(e, text, settings)) ?? { ok: true };
}
