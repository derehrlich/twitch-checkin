// Liefert einen im Admin hochgeladenen Ton aus (?slot=follow, ohne Angabe der Check-in-Ton). Die Adresse enthält ?v=<Version>,
// dadurch darf der Browser (und OBS) die Datei dauerhaft zwischenspeichern und lädt sie nur bei Änderung neu.
import { db } from '../lib/store.mjs';
import { SLOTS, slotKey } from '../lib/sounds.mjs';

export const config = { path: '/api/sound' };

export default async (req) => {
  const slot = new URL(req.url).searchParams.get('slot') ?? 'checkin';
  if (!SLOTS.includes(slot)) return new Response('Unbekannter Ton', { status: 404 });
  const sound = await db.get(slotKey(slot));
  if (!sound) return new Response('Kein eigener Ton hinterlegt', { status: 404 });
  return new Response(Buffer.from(sound.data, 'base64'), {
    headers: {
      'content-type': sound.type,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
};
