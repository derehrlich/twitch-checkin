// Daten für das Sport-Overlay (/sport): Summen der eingetragenen Einheiten. Öffentlich wie das Overlay, es stehen nur Zahlen drin.
import { publicView } from '../lib/sport.mjs';
import { json } from '../lib/http.mjs';

export const config = { path: '/api/sport' };

export default async () => json(await publicView());
