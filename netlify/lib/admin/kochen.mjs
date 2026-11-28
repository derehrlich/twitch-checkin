// /api/admin/kochen: Koch-Overlay von Hand steuern.
//   GET kochen | POST kochen/start { title, ingredients, steps } | POST kochen/next | POST kochen/prev
//   POST kochen/timer { minutes, label } | POST kochen/timer/stop | POST kochen/stop
import { json } from '../kern/http.mjs';
import * as cook from '../overlays/kochen.mjs';

export async function kochenRoute({ route, method, body }) {
  const view = async () => json({ state: await cook.getState() });
  if (route.length === 1 && method === 'GET') return view();
  if (method !== 'POST') return;
  if (route[1] === 'start') { await cook.start({ title: body?.title, ingredients: body?.ingredients, steps: body?.steps }); return view(); }
  if (route[1] === 'next') { await cook.move(1); return view(); }
  if (route[1] === 'prev') { await cook.move(-1); return view(); }
  if (route[1] === 'timer' && route[2] === 'stop') { await cook.stopTimer(); return view(); }
  if (route[1] === 'timer') { await cook.setTimer({ minutes: body?.minutes, label: body?.label }); return view(); }
  if (route[1] === 'stop') { await cook.stop(); return view(); }
}
