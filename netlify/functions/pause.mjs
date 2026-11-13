// Daten für das Pause-Overlay (/pause). Öffentlich wie die anderen Overlays, es steht nur der Pausentext drin.
import { publicView } from '../lib/overlays/pause.mjs';
import { getSettings } from '../lib/kern/settings.mjs';
import { json } from '../lib/kern/http.mjs';

export const config = { path: '/api/pause' };

export default async () => json(await publicView(await getSettings()));
