// Öffentliche Seite für den persönlichen Einlaufsound (/einlaufsound): Anmeldung mit Twitch, Status, Upload.
// Die Anmeldung vergibt keine Berechtigungen, Twitch bestätigt nur, wer die Person ist.
// /api/einlaufsound/audio?id=<twitchId>&v=<Version> liefert freigegebene Sounds ans Overlay aus.
import { db } from '../lib/store.mjs';
import { getSettings } from '../lib/settings.mjs';
import { json, cookie, viewerFrom } from '../lib/http.mjs';
import { USER_ID, UPLOAD_MAX, fileKey, submitUpload, viewFor } from '../lib/entrysound.mjs';
import { audioUploadMax, cleanName } from '../lib/admin/common.mjs';
import { CATALOG_ID, awardView, catalogKey, choose, ensureAward } from '../lib/award.mjs';

export const config = { path: ['/api/einlaufsound', '/api/einlaufsound/*'] };

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/einlaufsound\/?/, '').split('/').filter(Boolean);
  const method = req.method;

  if (route[0] === 'audio' && method === 'GET') {
    const id = url.searchParams.get('id') ?? '';
    if (!USER_ID.test(id)) return new Response('Unbekannt', { status: 404 });
    const sound = await db.get(fileKey(id));
    if (!sound) return new Response('Kein Sound hinterlegt', { status: 404 });
    return new Response(Buffer.from(sound.data, 'base64'), {
      headers: { 'content-type': sound.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
    });
  }

  if (route[0] === 'catalog-audio' && method === 'GET') { // Katalog-Sounds zum Anhören und fürs Overlay
    const id = url.searchParams.get('id') ?? '';
    const sound = CATALOG_ID.test(id) ? await db.get(catalogKey(id)) : null;
    if (!sound) return new Response('Kein Sound hinterlegt', { status: 404 });
    return new Response(Buffer.from(sound.data, 'base64'), {
      headers: { 'content-type': sound.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
    });
  }

  if (route[0] === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie(req, 'viewer', '', 0) });

  const settings = await getSettings();
  if (route[0] === 'me' && method === 'GET') {
    const viewer = viewerFrom(req);
    if (!viewer) return json({ loggedIn: false, enabled: settings.entrySoundEnabled, awardEnabled: settings.awardEnabled });
    if (settings.awardEnabled) await ensureAward(settings).catch((e) => console.warn('Monatsabschluss fehlgeschlagen:', e.message));
    const award = settings.awardEnabled ? await awardView(viewer.id, settings) : null;
    return json({ loggedIn: true, enabled: settings.entrySoundEnabled, awardEnabled: settings.awardEnabled, id: viewer.id, name: viewer.name, award, ...(await viewFor(viewer.id, settings)) });
  }

  if (route[0] === 'choose' && method === 'POST') { // Top des Monats: Sound aus dem Katalog wählen
    const viewer = viewerFrom(req);
    if (!viewer) return json({ error: 'Bitte zuerst mit Twitch anmelden' }, 401);
    if (!req.headers.get('content-type')?.includes('application/json')) return json({ error: 'Content-Type muss application/json sein' }, 415);
    const body = await req.json().catch(() => ({}));
    const res = await choose(viewer.id, viewer.name, String(body.catalogId ?? ''), settings);
    return res.error ? json({ error: res.error }, res.status) : json(res);
  }

  if (route[0] === 'upload' && method === 'POST') {
    const viewer = viewerFrom(req);
    if (!viewer) return json({ error: 'Bitte zuerst mit Twitch anmelden' }, 401);
    if (!settings.entrySoundEnabled) return json({ error: 'Der Einlaufsound ist gerade nicht aktiv' }, 403);
    if (!req.headers.get('content-type')?.includes('application/json')) return json({ error: 'Content-Type muss application/json sein' }, 415);
    const body = await req.json().catch(() => ({}));
    const up = audioUploadMax(body, UPLOAD_MAX);
    if (up.error) return up.error;
    const res = await submitUpload(viewer.id, { name: cleanName(body.name, 'Sound'), buf: up.buf, type: up.type });
    return res.error ? json({ error: res.error }, res.status) : json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
};
