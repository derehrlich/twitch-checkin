// /api/admin/catalog: Katalog für die Top des Monats (höchstens 15 Sounds) und Übersicht der Monatsgewinner.
import { db } from '../store.mjs';
import { getSettings } from '../settings.mjs';
import { CATALOG_ID, CATALOG_MAX, catalogKey, ensureAward, getCatalog, newCatalogId, recentAwards, saveCatalog } from '../award.mjs';
import { json } from '../http.mjs';
import { audioUpload, cleanName, storeFile } from './common.mjs';

const cleanTitle = (v) => String(v ?? '').trim().slice(0, 40);

export async function catalog({ route, method, body }) {
  const settings = await getSettings();
  const list = await getCatalog();
  if (route.length === 1 && method === 'GET') return json({ max: CATALOG_MAX, entries: list, awards: await recentAwards(settings), awardDays: settings.awardDays });
  if (route.length === 1 && method === 'POST') {
    if (list.length >= CATALOG_MAX) return json({ error: `Höchstens ${CATALOG_MAX} Sounds im Katalog` }, 400);
    const name = cleanTitle(body.name);
    if (!name) return json({ error: 'Bitte einen Namen angeben' }, 400);
    if (list.some((e) => e.name === name)) return json({ error: 'Es gibt schon einen Sound mit diesem Namen' }, 400);
    const entry = { id: newCatalogId(), name, soundName: null, soundVersion: null };
    await saveCatalog([...list, entry]);
    return json(entry);
  }
  if (route[1] === 'close' && method === 'POST') { // Vormonat sofort abschließen (sonst geschieht das ab dem 2. des Monats von selbst)
    if (!settings.awardEnabled) return json({ error: 'Die Auswahl der Top des Monats ist ausgeschaltet' }, 400);
    const res = await ensureAward(settings, new Date(), { force: true });
    return json({ ok: true, created: Boolean(res), winners: res?.winners.length ?? 0 });
  }
  const entry = list.find((e) => e.id === route[1]);
  if (!CATALOG_ID.test(route[1] ?? '') || !entry) return json({ error: 'Sound nicht gefunden' }, 404);
  if (route.length === 2 && method === 'PUT') {
    const name = cleanTitle(body.name);
    if (!name) return json({ error: 'Bitte einen Namen angeben' }, 400);
    if (list.some((e) => e.id !== entry.id && e.name === name)) return json({ error: 'Es gibt schon einen Sound mit diesem Namen' }, 400);
    entry.name = name;
    await saveCatalog(list);
    return json(entry);
  }
  if (route[2] === 'sound' && method === 'POST') {
    const up = audioUpload(body);
    if (up.error) return up.error;
    await storeFile(catalogKey(entry.id), up);
    entry.soundName = cleanName(body.name, 'Sound');
    entry.soundVersion = Date.now();
    await saveCatalog(list);
    return json(entry);
  }
  if (route.length === 2 && method === 'DELETE') {
    await saveCatalog(list.filter((e) => e.id !== entry.id));
    await db.delete(catalogKey(entry.id));
    return json({ ok: true });
  }
}
