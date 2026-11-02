// Daten für das Sport-Overlay (/sport): Zeit, Puls, Strecke und Kalorien. Öffentlich wie das Overlay, es stehen nur Zahlen drin.
import { getLive, publicView } from '../lib/sport.mjs';
import { json } from '../lib/http.mjs';

export const config = { path: '/api/sport' };

export default async () => json(publicView(await getLive()));
