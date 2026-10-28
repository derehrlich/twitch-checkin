// Liefert Soundboard-Töne aus (?id=<id>&v=<Version>, dauerhaft zwischenspeicherbar). Ohne id: Liste { id: Adresse }
// der aktiven Töne, damit das Overlay sie schon vor der ersten Einlösung laden kann.
import { db } from '../lib/store.mjs';
import { getBoard, ID, isActive, soundKey } from '../lib/soundboard.mjs';
import { json } from '../lib/http.mjs';

export const config = { path: '/api/soundboard' };

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id');
  if (id === null) {
    const board = (await getBoard()).filter(isActive);
    return json(Object.fromEntries(board.map((e) => [e.id, `/api/soundboard?id=${e.id}&v=${e.soundVersion}`])));
  }
  if (!ID.test(id)) return new Response('Unbekannter Ton', { status: 404 });
  const sound = await db.get(soundKey(id));
  if (!sound) return new Response('Kein Ton hinterlegt', { status: 404 });
  return new Response(Buffer.from(sound.data, 'base64'), {
    headers: { 'content-type': sound.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
  });
};
