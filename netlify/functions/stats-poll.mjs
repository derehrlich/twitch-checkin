// Geplanter Job: alle 5 Minuten Zuschauer und Follower für die Gewinnspiel-Auswertung erfassen.
import { pollStats } from '../lib/gwstats.mjs';

export const config = { schedule: '*/5 * * * *' };

export default async () => {
  try { await pollStats(); } catch (e) { console.warn('Statistik-Abfrage fehlgeschlagen:', e.message); }
};
