// Daten für das Umfrage-Overlay (/umfrage). Öffentlich wie die anderen Overlays: es stehen nur Frage, Antworten und Zahlen darin, nie wer wie gestimmt hat.
import { publicView } from '../lib/overlays/umfrage.mjs';
import { getSettings } from '../lib/kern/settings.mjs';
import { json } from '../lib/kern/http.mjs';

export const config = { path: '/api/umfrage' };

export default async () => json(await publicView(await getSettings()));
