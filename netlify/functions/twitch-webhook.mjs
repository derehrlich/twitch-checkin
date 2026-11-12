// Empfängt EventSub-Webhooks von Twitch (Kanalpunkte-Einlösungen).
import crypto from 'node:crypto';
import { db } from '../lib/kern/store.mjs';
import { getSettings } from '../lib/kern/settings.mjs';
import { handleCheckout, handleRedemption, handleRescue } from '../lib/zuschauer/checkin.mjs';
import { handleRaid } from '../lib/ereignisse/raid.mjs';
import { handleAlert } from '../lib/ereignisse/alerts.mjs';
import { getBoard, handleSoundboard } from '../lib/belohnungen/soundboard.mjs';
import { handleEntryBuy, handleEntryExtend } from '../lib/belohnungen/entrysound.mjs';
import { eventByReward, handleTicket } from '../lib/belohnungen/tickets.mjs';
import { handleGewinnBonus, handleGewinnTicket } from '../lib/belohnungen/gewinn.mjs';
import { handleAlpaca } from '../lib/belohnungen/alpaca.mjs';
import { handleChat } from '../lib/chat/chat.mjs';
import { handleGlitter, handleGradient } from '../lib/chat/chatlog.mjs';
import { logEvent } from '../lib/overlays/credits.mjs';
import { ALERT_TYPES, CHAT_TYPE } from '../lib/kern/twitch.mjs';
import { safeEqual, text } from '../lib/kern/http.mjs';

export const config = { path: '/api/twitch-webhook' };

export default async (req) => {
  if (req.method !== 'POST') return text('Method not allowed', 405);
  const secret = process.env.EVENTSUB_SECRET;
  if (!secret) return text('EVENTSUB_SECRET fehlt', 500);

  const raw = await req.text();
  const msgId = req.headers.get('twitch-eventsub-message-id') ?? '';
  const timestamp = req.headers.get('twitch-eventsub-message-timestamp') ?? '';
  const signature = req.headers.get('twitch-eventsub-message-signature') ?? '';

  // Signatur prüfen, sonst könnte jeder Check-ins auslösen
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(msgId + timestamp + raw).digest('hex');
  if (!signature || !safeEqual(signature, expected)) return text('Invalid signature', 403);
  if (Math.abs(Date.now() - Date.parse(timestamp)) > 10 * 60_000) return text('Timestamp too old', 403);

  const body = JSON.parse(raw);
  const type = req.headers.get('twitch-eventsub-message-type');

  if (type === 'webhook_callback_verification') return text(body.challenge);

  if (type === 'revocation') {
    console.warn('EventSub widerrufen:', body.subscription?.status);
    await db.set('config/state', { ...((await db.get('config/state')) ?? {}), revoked: body.subscription?.status ?? 'unbekannt' });
    return new Response(null, { status: 204 });
  }

  if (type === 'notification') {
    const e = body.event;
    const subType = body.subscription?.type;
    if (subType === CHAT_TYPE) { // viele Nachrichten: ein Fehler soll keine Wiederholung durch Twitch auslösen
      try { await handleChat(e, await getSettings()); } catch (err) { console.error('Chat fehlgeschlagen:', err); }
      return new Response(null, { status: 204 });
    }
    if (subType === 'channel.raid' || ALERT_TYPES.includes(subType)) {
      // Diese Events haben keine eigene ID, daher dient die Nachrichten-ID der Wiederholungserkennung
      if (!(await db.setIfNew(`seen/${msgId}`, Date.now()))) return new Response(null, { status: 204 });
      try {
        const settings = await getSettings();
        if (settings.creditsEnabled) await logEvent(subType, e, msgId, settings).catch((err) => console.warn('Abspann-Eintrag fehlgeschlagen:', err.message));
        await (subType === 'channel.raid' ? handleRaid(e, settings) : handleAlert(subType, e, settings));
      } catch (err) {
        console.error(`${subType} fehlgeschlagen:`, err);
        await db.delete(`seen/${msgId}`);
        return text('error', 500);
      }
      return new Response(null, { status: 204 });
    }
    const state = (await db.get('config/state')) ?? {};
    // Nur die eigenen Check-in/Check-out-Rewards zählen; ohne gespeicherte IDs (Einrichtung fehlt) passiert nichts
    const isCheckin = Boolean(state.rewardId) && e.reward.id === state.rewardId;
    const isCheckout = Boolean(state.checkoutRewardId) && e.reward.id === state.checkoutRewardId;
    const isRescue = Boolean(state.streakRewardId) && e.reward.id === state.streakRewardId;
    const isEntryBuy = Boolean(state.entryBuyRewardId) && e.reward.id === state.entryBuyRewardId;
    const isEntryExtend = Boolean(state.entryExtendRewardId) && e.reward.id === state.entryExtendRewardId;
    const isAlpaca = Boolean(state.alpacaRewardId) && e.reward.id === state.alpacaRewardId;
    const isGlitter = Boolean(state.glitterRewardId) && e.reward.id === state.glitterRewardId;
    const isGradient = Boolean(state.gradientRewardId) && e.reward.id === state.gradientRewardId;
    const board = isCheckin || isCheckout || isRescue || isEntryBuy || isEntryExtend || isAlpaca || isGlitter || isGradient ? null : (await getBoard()).find((x) => x.rewardId === e.reward.id);
    const isGewinn = Boolean(state.gwRewardId) && e.reward.id === state.gwRewardId;
    const isGewinnBonus = Boolean(state.gwBonusRewardId) && e.reward.id === state.gwBonusRewardId;
    const ticketEvent = isCheckin || isGewinn || isGewinnBonus || isCheckout || isRescue || isEntryBuy || isEntryExtend || isAlpaca || isGlitter || isGradient || board ? null : await eventByReward(e.reward.id);
    if (!isGewinn && !isGewinnBonus && !isCheckin && !isCheckout && !isRescue && !isEntryBuy && !isEntryExtend && !isAlpaca && !isGlitter && !isGradient && !board && !ticketEvent) return new Response(null, { status: 204 });

    // Twitch wiederholt Zustellungen: jede Einlösung nur einmal verarbeiten
    if (!(await db.setIfNew(`seen/${e.id}`, Date.now()))) return new Response(null, { status: 204 });
    try {
      const redemption = { id: e.id, user_id: e.user_id, user_name: e.user_name, user_input: e.user_input, reward: e.reward };
      const settings = await getSettings();
      if (board) await handleSoundboard(redemption, board, settings);
      else if (isGewinn) await handleGewinnTicket(redemption, settings);
      else if (isGewinnBonus) await handleGewinnBonus(redemption, settings);
      else if (ticketEvent) await handleTicket(redemption, ticketEvent, settings);
      else if (isAlpaca) await handleAlpaca(redemption, settings);
      else if (isGlitter) await handleGlitter(redemption, settings);
      else if (isGradient) await handleGradient(redemption, settings);
      else if (isEntryBuy) await handleEntryBuy(redemption, settings);
      else if (isEntryExtend) await handleEntryExtend(redemption, settings);
      else await (isRescue ? handleRescue : isCheckout ? handleCheckout : handleRedemption)(redemption, settings);
    } catch (err) {
      console.error('Check-in fehlgeschlagen:', err);
      await db.delete(`seen/${e.id}`); // Twitch darf es erneut versuchen
      return text('error', 500);
    }
  }
  return new Response(null, { status: 204 });
};
