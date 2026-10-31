// Die Overlay-Quellen melden hier, wann sie etwas mit Ton abspielen wollen (siehe lib/playlock.mjs).
import { json } from '../lib/http.mjs';
import { claim, release } from '../lib/playlock.mjs';

export const config = { path: '/api/playlock' };

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST erwartet' }, 405);
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? '').slice(0, 80);
  if (!id) return json({ error: 'id fehlt' }, 400);
  if (body.release) return json(await release({ id }));
  return json(await claim({ id, at: Number(body.at) || Date.now(), ms: Number(body.ms) }));
};
