// /api/admin/kochen: Koch-Overlay von Hand steuern.
//   GET kochen | POST kochen/start { title } | POST kochen/countdown { minutes | at, label } | POST kochen/countdown/stop | POST kochen/stop
import { json } from '../kern/http.mjs';
import { getSettings } from '../kern/settings.mjs';
import * as cook from '../overlays/kochen.mjs';

export async function kochenRoute({ route, method, body }) {
  const view = async () => { const s = await getSettings(); return json({ state: await cook.getState(), command: s.rezeptCommand, commandOn: s.rezeptEnabled }); };
  if (route.length === 1 && method === 'GET') return view();
  if (method !== 'POST') return;
  if (route[1] === 'start') { await cook.start({ title: body?.title }); return view(); }
  if (route[1] === 'countdown' && route[2] === 'stop') { await cook.stopCountdown(); return view(); }
  if (route[1] === 'countdown') {
    // „at“ kommt als Ortszeit des Browsers ohne Zeitzone; der Browser rechnet vorher in Millisekunden um
    await cook.setCountdown({ minutes: body?.minutes, at: body?.at, label: body?.label }); return view();
  }
  if (route[1] === 'stop') { await cook.stop(); return view(); }
}
