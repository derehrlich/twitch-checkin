// Daten für das Chat-Overlay (/chat): die letzten Chatnachrichten. Öffentlich wie das Overlay, es steht nur der öffentliche Chat darin.
import { publicView } from '../lib/chatlog.mjs';
import { getSettings } from '../lib/settings.mjs';
import { json } from '../lib/http.mjs';

export const config = { path: '/api/chatlog' };

export default async () => json(await publicView(await getSettings()));
