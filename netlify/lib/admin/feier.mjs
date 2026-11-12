// /api/admin/feier: Geburtstagswoche – Countdown und Glücksrad.
//   GET  countdown | PUT countdown
//   GET  rad | POST rad/wheel | PUT rad/wheel/<id> | DELETE rad/wheel/<id> | POST rad/examples
//   PUT  rad/state | POST rad/spin | POST rad/wheel/<id>/reset | DELETE rad/history
import { json } from '../kern/http.mjs';
import { getSettings } from '../kern/settings.mjs';
import * as countdown from '../overlays/countdown.mjs';
import * as rad from '../overlays/gluecksrad.mjs';

const fail = (e) => json({ error: e.message }, 400);

export async function feier({ route, method, body }) {
  const settings = await getSettings();
  if (route[1] === 'countdown') {
    if (method === 'PUT') { try { await countdown.updateConfig(body, settings); } catch (e) { return fail(e); } }
    else if (method !== 'GET') return;
    return json(await countdown.adminView(settings));
  }
  if (route[1] !== 'rad') return;
  const view = async () => json(await rad.adminView());
  if (route.length === 2 && method === 'GET') return view();
  if (route[2] === 'wheel' && route.length === 3 && method === 'POST') { try { await rad.createWheel(body); } catch (e) { return fail(e); } return view(); }
  if (route[2] === 'examples' && method === 'POST') { try { for (const ex of rad.EXAMPLES) await rad.createWheel(ex); } catch (e) { return fail(e); } return view(); }
  if (route[2] === 'wheel' && rad.isWheelId(route[3])) {
    if (route.length === 4 && method === 'PUT') { let w; try { w = await rad.updateWheel(route[3], body); } catch (e) { return fail(e); } return w ? view() : json({ error: 'Rad nicht gefunden' }, 404); }
    if (route.length === 4 && method === 'DELETE') return (await rad.deleteWheel(route[3])) ? view() : json({ error: 'Rad nicht gefunden' }, 404);
    if (route[4] === 'reset' && method === 'POST') return (await rad.resetUsed(route[3])) ? view() : json({ error: 'Rad nicht gefunden' }, 404);
  }
  if (route[2] === 'state' && method === 'PUT') { try { await rad.updateState(body); } catch (e) { return fail(e); } return view(); }
  if (route[2] === 'spin' && method === 'POST') { const r = await rad.spin(settings); return r.error ? json({ error: r.error }, r.status) : view(); }
  if (route[2] === 'history' && method === 'DELETE') { await rad.clearHistory(); return view(); }
}
