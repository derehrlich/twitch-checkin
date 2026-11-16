// Öffentliche Mediakit-Seite (/mediakit). Erst sichtbar, wenn sie im Admin veröffentlicht wurde; sonst 404.
// Es stehen nur die Kennzahlen und Angaben darin, die Marcel im Admin sieht und freigibt. Muss ohne Cloudflare Access erreichbar sein.
import { getSettings } from '../lib/kern/settings.mjs';
import { publicPage } from '../lib/statistik/mediakit.mjs';

export const config = { path: '/mediakit' };

export default async () => {
  const html = await publicPage(await getSettings());
  if (!html) return new Response('Diese Seite gibt es (noch) nicht.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
};
