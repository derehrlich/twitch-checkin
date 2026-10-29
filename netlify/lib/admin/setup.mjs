// POST /api/admin/setup: legt alle Rewards in Twitch an oder passt sie an und abonniert die Webhooks.
import { db } from '../store.mjs';
import { getSettings } from '../settings.mjs';
import { getBoard, isActive, saveBoard } from '../soundboard.mjs';
import { json } from '../http.mjs';
import { ensureRewards, siteUrl, subscribe, syncSoundboardRewards } from '../twitch.mjs';

export async function setup({ req, method }) {
  if (method !== 'POST') return;
  if (!process.env.EVENTSUB_SECRET) return json({ error: 'EVENTSUB_SECRET ist nicht gesetzt' }, 400);
  const settings = await getSettings();
  const board = await getBoard();
  const titles = [settings.rewardTitle, ...(settings.checkoutEnabled ? [settings.checkoutRewardTitle] : []), ...(settings.streakRescueEnabled ? [settings.streakRewardTitle] : []), ...board.map((e) => e.title)];
  if (new Set(titles).size !== titles.length) return json({ error: 'Alle Rewards (Check-in, Check-out, Streak-Retter und Soundboard-Einträge) brauchen verschiedene Namen' }, 400);
  const { checkin, checkout, streak } = await ensureRewards(settings);
  const synced = await syncSoundboardRewards(board);
  await saveBoard(synced);
  const boardIds = synced.filter((e) => isActive(e) && e.rewardId).map((e) => e.rewardId);
  await subscribe(`${siteUrl(req)}/api/twitch-webhook`, [checkin.id, ...(checkout ? [checkout.id] : []), ...(streak ? [streak.id] : []), ...boardIds], { raids: settings.raidEnabled || settings.creditsEnabled, alerts: settings.alertsEnabled || settings.creditsEnabled, chat: settings.chatCommands || settings.creditsEnabled });
  await db.set('config/state', { ...((await db.get('config/state')) ?? {}), revoked: null });
  return json({ ok: true, reward: checkin.title, checkout: checkout?.title ?? null, streak: streak?.title ?? null, soundboard: boardIds.length });
}
