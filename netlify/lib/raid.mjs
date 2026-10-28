import { fill, pushOverlay } from './checkin.mjs';
import { channelInfo, pickClip, sendChat, shoutout } from './twitch.mjs';

// Sammelt alles, was zu einem Raider angezeigt wird. Jeder Teil ist optional: fällt einer aus, läuft der Rest weiter.
export async function raiderPackage(raiderId, fallbackName, settings) {
  const info = await channelInfo(raiderId).catch((e) => { console.warn('Raider-Info fehlgeschlagen:', e.message); return null; });
  const clip = settings.raidClip ? await pickClip(raiderId, settings.raidClipMaxSeconds).catch((e) => { console.warn('Clip-Suche fehlgeschlagen:', e.message); return null; }) : null;
  const name = info?.name || fallbackName;
  return { name, login: info?.login ?? fallbackName.toLowerCase(), game: info?.game ?? '', avatar: info?.avatar ?? null, clip };
}

export const raidVars = (pkg, viewers) => ({
  raider: pkg.name,
  viewers,
  game: pkg.game || 'unbekannt',
  url: `twitch.tv/${pkg.login}`,
});

/** Eingehender Raid: Chatnachricht, offizieller Shoutout und Overlay-Karte mit Clip. */
export async function handleRaid(event, settings) {
  const viewers = Number(event.viewers) || 0;
  if (!settings.raidEnabled || viewers < settings.raidMinViewers) return { ok: false, skipped: true };

  const pkg = await raiderPackage(event.from_broadcaster_user_id, event.from_broadcaster_user_name, settings);
  await pushOverlay({ type: 'raid', raider: pkg.name, viewers, game: pkg.game, avatar: pkg.avatar, clip: pkg.clip });
  if (settings.chatEnabled) await sendChat(fill(settings.raidTemplate, raidVars(pkg, viewers))).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
  if (settings.raidShoutout) await shoutout(event.from_broadcaster_user_id).catch((e) => console.warn('Shoutout fehlgeschlagen:', e.message));
  return { ok: true, clip: pkg.clip?.id ?? null };
}
