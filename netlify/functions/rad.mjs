// Daten für das Glücksrad-Overlay (/rad). Öffentlich wie die anderen Overlays, es stehen nur Felder und der aktuelle Dreh drin.
import { publicView } from '../lib/overlays/gluecksrad.mjs';
import { json } from '../lib/kern/http.mjs';

export const config = { path: '/api/rad' };

export default async () => json(await publicView());
