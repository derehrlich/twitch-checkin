// /api/admin/stats und /api/admin/mediakit: Twitch-Statistik und Mediakit (alles hinter dem Admin-Login).
//   GET stats | GET stats/<id> (Rückblick auf einen Stream) | DELETE stats/<id> | POST stats/check (jetzt messen)
//   GET mediakit | PUT mediakit (Angaben) | POST mediakit/csv { text } | DELETE mediakit/csv | GET mediakit/preview
import { json } from '../kern/http.mjs';
import { getSettings } from '../kern/settings.mjs';
import * as stats from '../statistik/stats.mjs';
import * as kit from '../statistik/mediakit.mjs';

export async function statsRoute({ route, method }) {
  const settings = await getSettings();
  if (route.length === 1 && method === 'GET') return json(await stats.adminView(settings));
  if (route[1] === 'check' && method === 'POST') {
    if (!settings.statsEnabled) return json({ error: 'Die Statistik ist noch ausgeschaltet. Unten einschalten und speichern.' }, 400);
    const r = await stats.statTick(settings);
    return r.error ? json({ error: `Messung fehlgeschlagen: ${r.error}` }, 502) : json(await stats.adminView(settings));
  }
  if (route[1] && method === 'GET') { const s = await stats.reviewOf(route[1], settings); return s ? json(s) : json({ error: 'Nicht gefunden' }, 404); }
  if (route[1] && method === 'DELETE') return (await stats.deleteSession(route[1])) ? json(await stats.adminView(settings)) : json({ error: 'Nicht gefunden' }, 404);
}

export async function mediakitRoute({ route, method, body }) {
  const settings = await getSettings();
  const view = async () => json(await kit.adminView(settings));
  try {
    if (route.length === 1 && method === 'GET') return view();
    if (route.length === 1 && method === 'PUT') { await kit.saveConfig(body); return view(); }
    if (route[1] === 'csv' && method === 'POST') { await kit.importCsv(String(body?.text ?? ''), settings); return view(); }
    if (route[1] === 'csv' && method === 'DELETE') { await kit.removeCsv(); return view(); }
    if (route[1] === 'preview' && method === 'GET') return json({ html: await kit.previewPage(settings) });
  } catch (e) { return json({ error: e.message }, 400); }
}
