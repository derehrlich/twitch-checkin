// Öffentliche Daten für die Wochenplan-Seite (/woche). Ohne Anmeldung erreichbar, es stehen nur Plan und Zielzeit drin.
import { weekView } from '../lib/overlays/countdown.mjs';
import { getSettings } from '../lib/kern/settings.mjs';
import { json } from '../lib/kern/http.mjs';

export const config = { path: '/api/woche' };

export default async () => json(await weekView(await getSettings()));
