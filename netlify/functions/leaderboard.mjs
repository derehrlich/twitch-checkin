// Öffentliche Ranglisten für /rangliste (Link im Twitch-Panel oder Browserquelle in OBS). Nur Namen und Zahlen.
import { getSettings } from '../lib/settings.mjs';
import { streamDay } from '../lib/checkin.mjs';
import { computeStreak, getStreamDays } from '../lib/streak.mjs';
import { allUsers } from '../lib/admin/common.mjs';
import { db } from '../lib/store.mjs';
import { json } from '../lib/http.mjs';
import { monthBoard, secretSet, weights } from '../lib/community.mjs';

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
  const chatKeys = await db.list('chatuser/');
  const chatRows = [];
  for (let i = 0; i < chatKeys.length; i += 25) {
    for (const c of await Promise.all(chatKeys.slice(i, i + 25).map((k) => db.get(k)))) if (c) chatRows.push({ name: c.name, count: c.days, messages: c.messages });
  }
  const top = (key, list = rows) => [...list].filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key] || b.count - a.count || a.name.localeCompare(b.name, 'de')).slice(0, n)
    .map((r) => ({ name: r.name, value: r[key] }));
  // Monatsrangliste: nur verknüpfte Konten (freiwillig), dazu der Hinweis, wie man mitmacht
  let month = null;
  if (settings.communityEnabled && secretSet()) {
    const board = await monthBoard(settings);
    month = {
      label: board.label, rows: board.rows.slice(0, n).map((r) => ({ name: r.name, value: r.points })), hint: settings.communityHint,
      // Legende: wie viele Punkte was bringt und ab wann gedeckelt wird (gleiche Werte wie in der Berechnung)
      rules: { ...weights(settings), msgCap: settings.communityMsgCap, msgGap: settings.communityMsgGap, bonusNote: settings.communityBonusNote },
    };
  }
  return json(
    { updated: new Date().toISOString(), visitors: rows.length, month, visits: top('count'), chatters: top('messages', chatRows), streaks: top('streak'), records: top('record'), minutes: top('minutes') },
    // Die Twitch-Panel-Extension liest die Daten von einer anderen Adresse (…ext-twitch.tv), die Zahlen sind ohnehin öffentlich
    200, { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' },
  );
};
