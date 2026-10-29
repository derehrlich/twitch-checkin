// Daten für die Abspann-Seite (/abspann): Chatter, Follows, Subs, Bits und Raids des Stream-Tags. Öffentlich wie das Overlay.
import { getSettings } from '../lib/settings.mjs';
import { streamDay } from '../lib/checkin.mjs';
import { creditsFor } from '../lib/credits.mjs';
import { json } from '../lib/http.mjs';

export const config = { path: '/api/credits' };

export default async (req) => {
  const settings = await getSettings();
  const asked = new URL(req.url).searchParams.get('day');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked ?? '') ? asked : streamDay(settings);
  return json(await creditsFor(day, settings));
};
