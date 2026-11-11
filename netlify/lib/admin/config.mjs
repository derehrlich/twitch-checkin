// GET/PUT /api/admin/settings
import { getSettings, saveSettings } from '../kern/settings.mjs';
import { json } from '../kern/http.mjs';

export async function config({ method, body }) {
  if (method === 'GET') return json(await getSettings());
  if (method === 'PUT') return json(await saveSettings(body));
}
