// „Meine Stadtwache“ (/meine): persönliche Seite für Zuschauer. Die Anmeldung läuft über /api/auth/viewer?next=/meine (Twitch bestätigt nur, wer man ist).
//   GET  /api/meine          die eigenen Zahlen (oder { loggedIn: false })
//   POST /api/meine/logout   abmelden
// Es gibt hier nie Daten anderer Personen. Muss ohne Cloudflare Access erreichbar sein.
import { getSettings } from '../lib/kern/settings.mjs';
import { json, cookie, viewerFrom } from '../lib/kern/http.mjs';
import { meView } from '../lib/zuschauer/meine.mjs';

export const config = { path: ['/api/meine', '/api/meine/*'] };

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/meine\/?/, '').split('/').filter(Boolean);
  if (route[0] === 'logout' && req.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie(req, 'viewer', '', 0) });
  if (route.length || req.method !== 'GET') return json({ error: 'Not found' }, 404);
  const settings = await getSettings();
  if (!settings.meineEnabled) return json({ loggedIn: false, enabled: false });
  const viewer = viewerFrom(req);
  return json(viewer ? await meView(viewer, settings) : { loggedIn: false, enabled: true });
};
