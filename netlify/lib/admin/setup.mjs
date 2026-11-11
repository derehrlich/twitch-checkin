// POST /api/admin/setup: legt alle Rewards in Twitch an oder passt sie an und abonniert die Webhooks.
import { db } from '../kern/store.mjs';
import { getSettings, needsChat } from '../kern/settings.mjs';
import { getBoard, isActive, saveBoard } from '../belohnungen/soundboard.mjs';
import { json } from '../kern/http.mjs';
import { rewardPrompts, rewardTitles } from '../belohnungen/entrysound.mjs';
import { ensureRewards, siteUrl, subscribe, syncSoundboardRewards } from '../kern/twitch.mjs';

export async function setup({ req, method }) {
  if (method !== 'POST') return;
  if (!process.env.EVENTSUB_SECRET) return json({ error: 'EVENTSUB_SECRET ist nicht gesetzt' }, 400);
  const settings = await getSettings();
  const board = await getBoard();
  const titles = [settings.rewardTitle, ...(settings.checkoutEnabled ? [settings.checkoutRewardTitle] : []), ...(settings.streakRescueEnabled ? [settings.streakRewardTitle] : []), ...(settings.entrySoundEnabled ? Object.values(rewardTitles(settings)) : []), ...(settings.alpacaEnabled ? [settings.alpacaRewardTitle] : []), ...board.map((e) => e.title)];
  if (new Set(titles).size !== titles.length) return json({ error: 'Alle Rewards (Check-in, Check-out, Streak-Retter, Einlaufsound, Alpaka und Soundboard-Einträge) brauchen verschiedene Namen' }, 400);
  const { checkin, checkout, streak, entryBuy, entryExtend, alpaca } = await ensureRewards(settings, { titles: rewardTitles(settings), prompts: rewardPrompts(settings) });
  const synced = await syncSoundboardRewards(board);
  await saveBoard(synced);
  const boardIds = synced.filter((e) => isActive(e) && e.rewardId).map((e) => e.rewardId);
  const { warnings, notes } = await subscribe(`${siteUrl(req)}/api/twitch-webhook`, [checkin.id, ...(checkout ? [checkout.id] : []), ...(streak ? [streak.id] : []), ...(entryBuy ? [entryBuy.id, entryExtend.id] : []), ...(alpaca ? [alpaca.id] : []), ...boardIds], { raids: settings.raidEnabled || settings.creditsEnabled, alerts: settings.alertsEnabled || settings.creditsEnabled, chat: needsChat(settings) });
  await db.set('config/state', { ...((await db.get('config/state')) ?? {}), revoked: null });
  return json({ ok: true, reward: checkin.title, checkout: checkout?.title ?? null, streak: streak?.title ?? null, ...(entryBuy ? { entrySound: [entryBuy.title, entryExtend.title] } : {}), ...(alpaca ? { alpaca: alpaca.title } : {}), soundboard: boardIds.length, ...(warnings.length ? { warnings } : {}), ...(notes.length ? { notes: [...new Set(notes)] } : {}) });
}
