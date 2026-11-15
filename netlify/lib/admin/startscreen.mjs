// /api/admin/startscreen: Startbildschirm steuern.
//   GET startscreen | PUT startscreen (Texte, Vorlauf, Anekdoten) | POST startscreen/start { minutes } | POST startscreen/extend { minutes }
//   POST startscreen/stop | POST startscreen/bg { name, data } | DELETE startscreen/bg
import { db } from '../kern/store.mjs';
import { json } from '../kern/http.mjs';
import * as ss from '../overlays/startscreen.mjs';
import { cleanName, imageUpload, storeFile } from './common.mjs';

export async function startscreen({ route, method, body }) {
  const view = async () => json(await ss.adminView());
  if (route.length === 1 && method === 'GET') return view();
  if (route.length === 1 && method === 'PUT') { await ss.updateConfig(body); return view(); }
  if (route[1] === 'start' && method === 'POST') { await ss.start(body?.minutes); return view(); }
  if (route[1] === 'extend' && method === 'POST') { await ss.extend(body?.minutes); return view(); }
  if (route[1] === 'stop' && method === 'POST') { await ss.stop(); return view(); }
  if (route[1] === 'bg' && method === 'POST') {
    const up = imageUpload(body);
    if (up.error) return up.error;
    await storeFile(ss.BG_KEY, up);
    await ss.updateConfig({ bgName: cleanName(body.name, 'Eigenes Bild'), bgVersion: Date.now() });
    return view();
  }
  if (route[1] === 'bg' && method === 'DELETE') { await db.delete(ss.BG_KEY); await ss.updateConfig({ bgName: null }); return view(); }
}
