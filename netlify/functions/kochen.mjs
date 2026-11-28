// Daten für das Koch-Overlay (/kochen). Öffentlich wie die anderen Overlays, es steht nur das Rezept drin.
import { publicView } from '../lib/overlays/kochen.mjs';
import { json } from '../lib/kern/http.mjs';

export const config = { path: '/api/kochen' };

export default async () => json(await publicView());
