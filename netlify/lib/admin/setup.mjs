// POST /api/admin/setup: legt alle Rewards in Twitch an oder passt sie an und abonniert die Webhooks.
import { db } from '../kern/store.mjs';
import { getSettings, needsChat } from '../kern/settings.mjs';
import { getBoard, isActive, saveBoard } from '../belohnungen/soundboard.mjs';
import { activeEvents, refresh } from '../belohnungen/tickets.mjs';
import { json } from '../kern/http.mjs';
import { rewardPrompts, rewardTitles } from '../belohnungen/entrysound.mjs';
import { ensureRewards, siteUrl, subscribe, syncSoundboardRewards } from '../kern/twitch.mjs';

export async function setup({ req, method }) {
  if (method !== 'POST') return;
  if (!process.env.EVENTSUB_SECRET) return json({ error: 'EVENTSUB_SECRET ist nicht gesetzt' }, 400);
  const settings = await getSettings();
  const board = await getBoard();
  const titles = [settings.rewardTitle, ...(settings.checkoutEnabled ? [settings.checkoutRewardTitle] : []), ...(settings.streakRescueEnabled ? [settings.streakRewardTitle] : []), ...(settings.entrySoundEnabled ? Object.values(rewardTitles(settings)) : []), ...(settings.alpacaEnabled ? [settings.alpacaRewardTitle] : []), ...(settings.glitterEnabled ? [settings.glitterRewardTitle] : []), ...(settings.gradientEnabled ? [settings.gradientRewardTitle] : []), ...board.map((e) => e.title), ...(settings.ticketsEnabled ? (await activeEvents()).map((e) => e.rewardTitle || `Ticket: ${e.name}`.slice(0, 45)) : [])];
  if (new Set(titles).size !== titles.length) return json({ error: 'Alle Rewards (Check-in, Check-out, Streak-Retter, Einlaufsound, Alpaka, Glitzer, Verlauf und Soundboard-Einträge) brauchen verschiedene Namen' }, 400);
  const { checkin, checkout, streak, entryBuy, entryExtend, alpaca, glitter, gradient } = await ensureRewards(settings, { titles: rewardTitles(settings), prompts: rewardPrompts(settings) });
  const synced = await syncSoundboardRewards(board);
  await saveBoard(synced);
  const boardIds = synced.filter((e) => isActive(e) && e.rewardId).map((e) => e.rewardId);
  const ticketEvents = settings.ticketsEnabled ? await activeEvents() : [];
  const ticketWarnings = [];
  for (const ev of ticketEvents) { const w = await refresh(ev); if (w) ticketWarnings.push(`Ticket „${ev.name}“: ${w}`); } // Reward angelegt und abgeglichen; die Abos folgen gleich in einem Zug
  const ticketIds = ticketEvents.map((e) => e.rewardId).filter(Boolean);
  const { warnings, notes } = await subscribe(`${siteUrl(req)}/api/twitch-webhook`, [checkin.id, ...(checkout ? [checkout.id] : []), ...(streak ? [streak.id] : []), ...(entryBuy ? [entryBuy.id, entryExtend.id] : []), ...(alpaca ? [alpaca.id] : []), ...(glitter ? [glitter.id] : []), ...(gradient ? [gradient.id] : []), ...boardIds, ...ticketIds], { raids: settings.raidEnabled || settings.creditsEnabled, alerts: settings.alertsEnabled || settings.creditsEnabled, chat: needsChat(settings) });
  await db.set('config/state', { ...((await db.get('config/state')) ?? {}), revoked: null, webhookUrl: `${siteUrl(req)}/api/twitch-webhook` }); // Adresse merken, damit die Störungs-Prüfung ohne Anfrage weiß, wo sie nachsehen muss
  return json({ ok: true, reward: checkin.title, checkout: checkout?.title ?? null, streak: streak?.title ?? null, ...(entryBuy ? { entrySound: [entryBuy.title, entryExtend.title] } : {}), ...(alpaca ? { alpaca: alpaca.title } : {}), ...(glitter ? { glitter: glitter.title } : {}), ...(gradient ? { gradient: gradient.title } : {}), soundboard: boardIds.length, ...(warnings.length || ticketWarnings.length ? { warnings: [...warnings, ...ticketWarnings] } : {}), ...(notes.length ? { notes: [...new Set(notes)] } : {}) });
}
