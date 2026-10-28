// Liefert ein im Admin hochgeladenes Alert-Bild aus (?slot=follow). ?v=<Version> erlaubt dauerhaftes Zwischenspeichern.
import { db } from '../lib/store.mjs';
import { IMAGE_SLOTS, imageKey } from '../lib/images.mjs';

export const config = { path: '/api/image' };

export default async (req) => {
  const slot = new URL(req.url).searchParams.get('slot') ?? '';
  if (!IMAGE_SLOTS.includes(slot)) return new Response('Unbekanntes Bild', { status: 404 });
  const image = await db.get(imageKey(slot));
  if (!image) return new Response('Kein eigenes Bild hinterlegt', { status: 404 });
  return new Response(Buffer.from(image.data, 'base64'), {
    headers: { 'content-type': image.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
  });
};
