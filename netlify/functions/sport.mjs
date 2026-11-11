// Daten für das Sport-Overlay (/sport): Summen der eingetragenen Einheiten. Öffentlich wie das Overlay, es stehen nur Zahlen drin.
import { publicView } from '../lib/overlays/sport.mjs';
import { json } from '../lib/kern/http.mjs';

export const config = { path: '/api/sport' };

export default async () => json(await publicView());
