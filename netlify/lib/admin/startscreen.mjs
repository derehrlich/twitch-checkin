// /api/admin/startscreen: Startbildschirm steuern.
//   GET startscreen | PUT startscreen (Texte, Vorlauf, Anekdoten) | POST startscreen/start { minutes } | POST startscreen/extend { minutes }
//   POST startscreen/stop | POST startscreen/bg { name, data } (Bild oder HTML-Datei) | DELETE startscreen/bg
import { db } from '../kern/store.mjs';
import { json } from '../kern/http.mjs';
import * as ss from '../overlays/startscreen.mjs';
import { BG_MAX, bgUpload, cleanName, isHtml, storeFile } from './common.mjs';

export async function startscreen({ route, method, body }) {
  const view = async () => json(await ss.adminView());
  if (route.length === 1 && method === 'GET') return view();
  if (route.length === 1 && method === 'PUT') { await ss.updateConfig(body); return view(); }
  if (route[1] === 'start' && method === 'POST') { await ss.start(body?.minutes); return view(); }
  if (route[1] === 'extend' && method === 'POST') { await ss.extend(body?.minutes); return view(); }
  if (route[1] === 'stop' && method === 'POST') { await ss.stop(); return view(); }
  if (route[1] === 'bg' && method === 'POST') {
    // Animierter Hintergrund als HTML-Datei, sonst ein Bild
    const raw = Buffer.from(typeof body.data === 'string' ? body.data : '', 'base64');
    const html = raw.length > 0 && raw.length <= BG_MAX && isHtml(raw);
    const up = html ? { buf: raw, type: 'text/html' } : bgUpload(body);
    if (up.error) return up.error;
    await storeFile(ss.BG_KEY, up);
    await ss.updateConfig({ bgName: cleanName(body.name, html ? 'Eigene Animation' : 'Eigenes Bild'), bgVersion: Date.now(), bgKind: html ? 'html' : 'image' });
    return view();
  }
  if (route[1] === 'bg' && method === 'DELETE') { await db.delete(ss.BG_KEY); await ss.updateConfig({ bgName: null }); return view(); }
}
