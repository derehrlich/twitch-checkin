import { db } from './store.mjs';
import { fill, pushOverlay, signText } from './checkin.mjs';
import { channelInfo, pickClip, sendChat, shoutout } from './twitch.mjs';

// Sammelt alles, was zu einem Raider angezeigt wird. Jeder Teil ist optional: fällt einer aus, läuft der Rest weiter.
export async function raiderPackage(raiderId, fallbackName, settings) {
  const info = await channelInfo(raiderId).catch((e) => { console.warn('Raider-Info fehlgeschlagen:', e.message); return null; });
  const clip = settings.raidClip ? await pickClip(raiderId, settings.raidClipMaxSeconds).catch((e) => { console.warn('Clip-Suche fehlgeschlagen:', e.message); return null; }) : null;
  const name = info?.name || fallbackName;
  return { name, login: info?.login ?? fallbackName.toLowerCase(), game: info?.game ?? '', avatar: info?.avatar ?? null, clip };
}

// Wie oft der Kanal schon bei uns geraidet hat. Twitch bietet keinen Verlauf, gezählt wird ab dem ersten empfangenen Raid.
export async function recordRaid(raiderId, name, viewers) {
  const rec = (await db.get(`raid/${raiderId}`)) ?? { name, count: 0, viewers: 0, first: null, last: null };
  const now = new Date().toISOString();
  Object.assign(rec, { name, count: rec.count + 1, viewers: rec.viewers + viewers, first: rec.first ?? now, last: now });
  await db.set(`raid/${raiderId}`, rec);
  return rec.count;
}

// "zum ersten Mal bei uns" / "schon zum 3. Mal bei uns"
export const visitText = (n) => (n <= 1 ? 'zum ersten Mal bei uns' : `schon zum ${n}. Mal bei uns`);

export const raidVars = (pkg, viewers, raids = 1) => ({
  raids,
  visit: visitText(raids),
  raider: pkg.name,
  viewers,
  game: pkg.game || 'unbekannt',
  url: `twitch.tv/${pkg.login}`,
});

// Overlay-Ereignis eines Raids (wird auch vom Admin-Test genutzt)
export function raidCard(pkg, viewers, raids, settings) {
  const extra = [pkg.game && `zuletzt: ${pkg.game}`, raids > 1 && `${raids}. Mal bei uns`].filter(Boolean).join(' · ');
  return { type: 'raid', raider: pkg.name, viewers, game: pkg.game, avatar: pkg.avatar, raids, clip: pkg.clip, extra,
    ...signText(settings, 'raid', { user: pkg.name, viewers, raids, game: pkg.game || 'unbekannt' }) };
}

/** Eingehender Raid: Chatnachricht, offizieller Shoutout und Overlay-Karte mit Clip. */
export async function handleRaid(event, settings) {
  const viewers = Number(event.viewers) || 0;
  const raids = await recordRaid(event.from_broadcaster_user_id, event.from_broadcaster_user_name, viewers); // zählt auch bei ausgeschalteter Reaktion
  if (!settings.raidEnabled || viewers < settings.raidMinViewers) return { ok: false, skipped: true };

  const pkg = await raiderPackage(event.from_broadcaster_user_id, event.from_broadcaster_user_name, settings);
  await pushOverlay(raidCard(pkg, viewers, raids, settings));
  if (settings.chatEnabled) await sendChat(fill(settings.raidTemplate, raidVars(pkg, viewers, raids))).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
  if (settings.raidShoutout) await shoutout(event.from_broadcaster_user_id).catch((e) => console.warn('Shoutout fehlgeschlagen:', e.message));
  return { ok: true, raids, clip: pkg.clip?.id ?? null };
}
