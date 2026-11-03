// Daten für das Alpaka-Overlay (/alpakas): wer gerade im Chat aktiv ist, mit Name und Farbe. Öffentlich wie das Overlay.
import { publicView } from '../lib/alpaca.mjs';
import { getSettings } from '../lib/settings.mjs';
import { json } from '../lib/http.mjs';

export const config = { path: '/api/alpakas' };

export default async () => json(await publicView(await getSettings()));
