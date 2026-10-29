// Öffentliche Ranglisten für /rangliste (Link im Twitch-Panel oder Browserquelle in OBS). Nur Namen und Zahlen.
import { getSettings } from '../lib/settings.mjs';
import { streamDay } from '../lib/checkin.mjs';
import { computeStreak, getStreamDays } from '../lib/streak.mjs';
import { allUsers } from '../lib/admin/common.mjs';
import { json } from '../lib/http.mjs';

export const config = { path: '/api/leaderboard' };

const minutesOf = (u) => Object.values(u.sessions ?? {}).reduce((s, x) => s + (x.minutes ?? 0), 0);

export default async () => {
  const settings = await getSettings();
  if (!settings.leaderboardPublic) return json({ error: 'Die Rangliste ist nicht öffentlich' }, 404);
  const n = settings.leaderboardSize;
  const today = streamDay(settings);
  const streamDays = await getStreamDays();
  const rows = (await allUsers()).map((u) => {
    const { current, record } = computeStreak(u, streamDays, today, settings.streakGrace);
    return { name: u.name, count: u.count, streak: current, record, minutes: minutesOf(u) };
  });
  const top = (key) => [...rows].filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key] || b.count - a.count || a.name.localeCompare(b.name, 'de')).slice(0, n)
    .map((r) => ({ name: r.name, value: r[key] }));
  return json(
    { updated: new Date().toISOString(), visitors: rows.length, visits: top('count'), streaks: top('streak'), records: top('record'), minutes: top('minutes') },
    200, { 'cache-control': 'public, max-age=60' },
  );
};
