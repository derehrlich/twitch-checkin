// /api/admin/adventure: Adventure-Einreichungen ansehen, ergänzen, löschen und aufs Glücksrad übertragen.
import { json } from '../kern/http.mjs';
import { getSettings } from '../kern/settings.mjs';
import { adminView, clearEntries, removeEntry, submit, toWheel, updateEntry } from '../belohnungen/adventures.mjs';

export async function adventure({ route, method, body }) {
  const settings = await getSettings();
  const view = async () => json(await adminView(settings));
  if (route.length === 1 && method === 'GET') return view();
  if (route[1] === 'entry' && route.length === 2 && method === 'POST') { // von Hand ergänzen (zum Beispiel aus einem Discord-Beitrag)
    const res = await submit(settings, String(body.text ?? ''), { key: 'admin', name: String(body.name ?? '').trim().slice(0, 40) || 'Marcel' }, 'admin');
    return res.ok ? view() : json({ error: res.reply }, 400);
  }
  if (route[1] === 'entry' && route[2] && method === 'PUT') return (await updateEntry(route[2], body)) ? view() : json({ error: 'Eintrag nicht gefunden' }, 404);
  if (route[1] === 'entry' && route[2] && method === 'DELETE') return (await removeEntry(route[2])) ? view() : json({ error: 'Eintrag nicht gefunden' }, 404);
  if (route[1] === 'clear' && method === 'POST') { await clearEntries(['offen', 'gedreht', 'gespielt'].includes(body.status) ? body.status : undefined); return view(); }
  if (route[1] === 'to-wheel' && method === 'POST') {
    try { const r = await toWheel({ wheelId: body.wheelId || undefined, name: String(body.name ?? '').trim(), statuses: body.all ? ['offen', 'gedreht', 'gespielt'] : ['offen'] }); return json({ ...(await adminView(settings)), wheel: { id: r.wheel.id, name: r.wheel.name }, used: r.used, skipped: r.skipped }); }
    catch (e) { return json({ error: e.message }, 400); }
  }
}
