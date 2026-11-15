// Liefert das im Admin hochgeladene Hintergrundbild des Startbildschirms aus. ?v=<Version> erlaubt dauerhaftes Zwischenspeichern.
import { db } from '../lib/kern/store.mjs';
import { BG_KEY } from '../lib/overlays/startscreen.mjs';

export const config = { path: '/api/startscreen-bg' };

export default async () => {
  const image = await db.get(BG_KEY);
  if (!image) return new Response('Kein eigenes Bild hinterlegt', { status: 404 });
  return new Response(Buffer.from(image.data, 'base64'), {
    headers: { 'content-type': image.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
  });
};
