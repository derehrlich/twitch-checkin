// Liefert den im Admin hochgeladenen Hintergrund des Startbildschirms aus (Bild oder animierte HTML-Datei). ?v=<Version> erlaubt dauerhaftes Zwischenspeichern.
import { db } from '../lib/kern/store.mjs';
import { BG_KEY } from '../lib/overlays/startscreen.mjs';

export const config = { path: '/api/startscreen-bg' };

export default async () => {
  const image = await db.get(BG_KEY);
  if (!image) return new Response('Kein eigenes Bild hinterlegt', { status: 404 });
  const html = image.type === 'text/html';
  return new Response(Buffer.from(image.data, 'base64'), {
    headers: {
      'content-type': html ? 'text/html; charset=utf-8' : image.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff',
      // Eine eigene HTML-Datei läuft abgeschottet (eigener Ursprung): Animationen ja, Zugriff auf Admin oder Daten nein
      ...(html ? { 'content-security-policy': 'sandbox allow-scripts' } : {}),
    },
  });
};
