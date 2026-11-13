// /api/admin/pause: Pause-Overlay von Hand steuern.
//   GET pause | POST pause/start { text, minutes } | POST pause/stop
import { json } from '../kern/http.mjs';
import { getSettings } from '../kern/settings.mjs';
import * as pause from '../overlays/pause.mjs';

export async function pauseRoute({ route, method, body }) {
  const settings = await getSettings();
  const view = async () => json({ state: await pause.getState(), defaultText: settings.pauseDefaultText, command: settings.pauseCommand, endCommand: settings.pauseEndCommand, enabled: settings.pauseEnabled });
  if (route.length === 1 && method === 'GET') return view();
  if (route[1] === 'start' && method === 'POST') { await pause.start({ text: body?.text, minutes: body?.minutes }, settings); return view(); }
  if (route[1] === 'stop' && method === 'POST') { await pause.stop(); return view(); }
}
