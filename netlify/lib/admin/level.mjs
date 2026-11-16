// /api/admin/level: Dorf-Level ansehen (Stufen mit Anzahl verknüpfter Personen, die Besten) und neu berechnen lassen.
//   GET level | POST level/refresh
import { json } from '../kern/http.mjs';
import { getSettings } from '../kern/settings.mjs';
import { adminView, forgetLevels } from '../belohnungen/level.mjs';

export async function levelRoute({ route, method }) {
  const settings = await getSettings();
  if (route.length === 1 && method === 'GET') return json(await adminView(settings));
  if (route[1] === 'refresh' && method === 'POST') { forgetLevels(); return json(await adminView(settings)); }
}
