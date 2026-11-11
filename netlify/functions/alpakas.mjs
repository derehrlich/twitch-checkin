// Daten für das Alpaka-Overlay (/alpakas): wer gerade im Chat aktiv ist, mit Name und Farbe. Öffentlich wie das Overlay.
import { publicView } from '../lib/belohnungen/alpaca.mjs';
import { getSettings } from '../lib/kern/settings.mjs';
import { json } from '../lib/kern/http.mjs';

export const config = { path: '/api/alpakas' };

export default async () => json(await publicView(await getSettings()));
