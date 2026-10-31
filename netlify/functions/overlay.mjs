// Das OBS-Overlay fragt hier regelmäßig nach neuen Check-ins.
// Erster Abruf (ohne ?since) liefert nur den aktuellen Stand, damit alte Ereignisse nicht erneut abgespielt werden.
import { db } from '../lib/store.mjs';
import { getSettings } from '../lib/settings.mjs';
import { json } from '../lib/http.mjs';
import { SLOTS } from '../lib/sounds.mjs';
import { IMAGE_SLOTS } from '../lib/images.mjs';
import { tickTimersThrottled } from '../lib/commands.mjs';

export const config = { path: '/api/overlay' };

export default async (req) => {
  const since = new URL(req.url).searchParams.get('since');
  const settings = await getSettings();
  const keys = await db.list('event/');
  const cursor = keys.at(-1) ?? `event/${String(Date.now()).padStart(15, '0')}`;
  const view = {
    volume: settings.volume,
    duration: settings.duration,
    alertDuration: settings.alertDuration,
    raidDuration: settings.raidDuration,
    images: Object.fromEntries(IMAGE_SLOTS.flatMap((slot) => (settings.images?.[slot]?.version ? [[slot, `/api/image?slot=${slot}&v=${settings.images[slot].version}`]] : []))),
    sound: settings.soundVersion ? `/api/sound?v=${settings.soundVersion}` : null,
    // Eigene Töne je Platz (Adresse nur, wenn hochgeladen)
    sounds: Object.fromEntries(SLOTS.flatMap((slot) => {
      const v = slot === 'checkin' ? settings.soundVersion : settings.sounds?.[slot]?.version;
      return v ? [[slot, `/api/sound?slot=${slot}&v=${v}`]] : [];
    })),
  };

  // Zeitgesteuerte Commands anstoßen (ihre Ereignisse kommen beim nächsten Abruf)
  if (settings.chatCommands) await tickTimersThrottled(settings).catch((e) => console.warn('Timer fehlgeschlagen:', e.message));

  if (!since) return json({ cursor, events: [], ...view });

  const events = [];
  for (const key of keys.filter((k) => k > since)) {
    const ev = await db.get(key);
    if (ev) events.push(ev);
  }
  return json({ cursor: since > cursor ? since : cursor, events, ...view });
};
