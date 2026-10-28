// Das OBS-Overlay fragt hier regelmäßig nach neuen Check-ins.
// Erster Abruf (ohne ?since) liefert nur den aktuellen Stand, damit alte Ereignisse nicht erneut abgespielt werden.
import { db } from '../lib/store.mjs';
import { getSettings } from '../lib/settings.mjs';
import { json } from '../lib/http.mjs';

export const config = { path: '/api/overlay' };

export default async (req) => {
  const since = new URL(req.url).searchParams.get('since');
  const settings = await getSettings();
  const keys = await db.list('event/');
  const cursor = keys.at(-1) ?? `event/${String(Date.now()).padStart(15, '0')}`;
  const view = { volume: settings.volume, duration: settings.duration };

  if (!since) return json({ cursor, events: [], ...view });

  const events = [];
  for (const key of keys.filter((k) => k > since)) {
    const ev = await db.get(key);
    if (ev) events.push(ev);
  }
  return json({ cursor: since > cursor ? since : cursor, events, ...view });
};
