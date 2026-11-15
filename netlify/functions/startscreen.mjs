// Daten für den Startbildschirm (/startscreen). Öffentlich wie die anderen Overlays, es stehen nur Texte und Zeiten drin.
import { publicView } from '../lib/overlays/startscreen.mjs';
import { json } from '../lib/kern/http.mjs';

export const config = { path: '/api/startscreen' };

export default async () => json(await publicView());
