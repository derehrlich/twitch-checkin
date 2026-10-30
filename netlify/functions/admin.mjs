// Admin-API: Anmeldung und Verteilung auf die Bereiche in netlify/lib/admin/ (alles außer Login nur mit Session-Cookie).
import { adminEnabled, checkPassword, cookie, hasSession, json, makeSession } from '../lib/http.mjs';
import { status } from '../lib/admin/status.mjs';
import { config as settingsRoute } from '../lib/admin/config.mjs';
import { setup } from '../lib/admin/setup.mjs';
import { tests } from '../lib/admin/tests.mjs';
import { raids } from '../lib/admin/raids.mjs';
import { sounds, images } from '../lib/admin/media.mjs';
import { soundboard } from '../lib/admin/soundboard.mjs';
import { entrysound } from '../lib/admin/entrysound.mjs';
import { community } from '../lib/admin/community.mjs';
import { users, exportCsv } from '../lib/admin/users.mjs';
import { backup } from '../lib/admin/backup.mjs';

export const config = { path: '/api/admin/*' };

// Erstes Pfadstück -> Bereich. Ein Bereich gibt eine Response zurück oder nichts (dann: 404).
const ROUTES = {
  state: status,
  settings: settingsRoute,
  setup,
  test: tests,
  raids,
  sound: sounds,
  image: images,
  soundboard,
  entrysound,
  community,
  users,
  'export.csv': exportCsv,
  backup,
};

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  const writes = ['POST', 'PUT', 'DELETE'].includes(method);
  const isJson = req.headers.get('content-type')?.includes('application/json');
  const body = writes && isJson ? await req.json().catch(() => ({})) : {};

  // ---- Login/Logout
  if (route[0] === 'login' && method === 'POST') {
    if (!adminEnabled()) return json({ error: 'ADMIN_PASSWORD ist nicht gesetzt' }, 503);
    if (!checkPassword(body.password)) {
      await new Promise((r) => setTimeout(r, 800)); // bremst Durchprobieren
      return json({ error: 'Falsches Passwort' }, 401);
    }
    return json({ ok: true }, 200, { 'set-cookie': cookie(req, 'session', makeSession(), 7 * 86400) });
  }
  if (route[0] === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie(req, 'session', '', 0) });

  if (!hasSession(req)) return json({ error: 'Nicht angemeldet', adminEnabled: adminEnabled() }, 401);
  // Schreibende Aufrufe nur als JSON, das schützt zusätzlich vor Formular-Angriffen von fremden Seiten
  if (writes && !isJson) return json({ error: 'Content-Type muss application/json sein' }, 415);

  try {
    const handler = ROUTES[route[0]];
    return (handler && (await handler({ req, route, method, body }))) || json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e.message }, 500);
  }
};
