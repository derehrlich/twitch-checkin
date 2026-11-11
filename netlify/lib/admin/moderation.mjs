// /api/admin/moderation: Protokoll der Moderation lesen (GET) und leeren (DELETE).
import { clearLog, readLog } from '../chat/moderation.mjs';
import { json } from '../kern/http.mjs';

export async function moderation({ method }) {
  if (method === 'GET') return json({ log: await readLog() });
  if (method === 'DELETE') { await clearLog(); return json({ log: [] }); }
}
