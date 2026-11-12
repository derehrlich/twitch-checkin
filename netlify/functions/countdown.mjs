// Daten für das Countdown-Overlay (/countdown). Öffentlich wie die anderen Overlays, es stehen nur Titel und Zielzeit drin.
import { publicView } from '../lib/overlays/countdown.mjs';
import { json } from '../lib/kern/http.mjs';

export const config = { path: '/api/countdown' };

export default async () => json(await publicView());
