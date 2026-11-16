// /api/admin/umfrage: Umfrage von Hand steuern.
//   GET umfrage | POST umfrage/start { question, options: [..] oder optionsText, minutes } | POST umfrage/end | POST umfrage/hide
import { json } from '../kern/http.mjs';
import { getSettings } from '../kern/settings.mjs';
import * as poll from '../overlays/umfrage.mjs';

export async function umfrageRoute({ route, method, body }) {
  const settings = await getSettings();
  const view = async () => json(await poll.adminView(settings));
  if (route.length === 1 && method === 'GET') return view();
  if (route[1] === 'start' && method === 'POST') {
    const options = Array.isArray(body?.options) ? body.options : String(body?.optionsText ?? '').split('\n');
    const res = await poll.start({ question: body?.question, options: options.filter((o) => String(o).trim()).length ? options : ['Ja', 'Nein'], minutes: body?.minutes, by: 'Admin' }, settings);
    if (res.error) return json({ error: res.error }, res.status ?? 400);
    if (settings.pollChat && settings.chatEnabled) await import('../kern/twitch.mjs').then((t) => t.sendChat(poll.startText(res.poll, settings))).catch((e) => console.warn('Umfrage-Chat fehlgeschlagen:', e.message));
    return view();
  }
  if (route[1] === 'end' && method === 'POST') { await poll.close(settings); return view(); }
  if (route[1] === 'hide' && method === 'POST') { await poll.hide(); return view(); }
}
