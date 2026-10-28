// Liefert den im Admin hochgeladenen Check-in-Ton aus. Die Adresse enthält ?v=<Version>,
// dadurch darf der Browser (und OBS) die Datei dauerhaft zwischenspeichern und lädt sie nur bei Änderung neu.
import { db } from '../lib/store.mjs';

export const config = { path: '/api/sound' };

export default async () => {
  const sound = await db.get('sound/data');
  if (!sound) return new Response('Kein eigener Ton hinterlegt', { status: 404 });
  return new Response(Buffer.from(sound.data, 'base64'), {
    headers: {
      'content-type': sound.type,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
};
