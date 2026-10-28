// Empfängt EventSub-Webhooks von Twitch (Kanalpunkte-Einlösungen).
import crypto from 'node:crypto';
import { db } from '../lib/store.mjs';
import { getSettings } from '../lib/settings.mjs';
import { handleRedemption } from '../lib/checkin.mjs';
import { safeEqual, text } from '../lib/http.mjs';

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
    const state = (await db.get('config/state')) ?? {};
    // Nur der eigene Check-in-Reward zählt; ohne gespeicherte ID (Einrichtung fehlt) wird nichts gezählt
    if (!state.rewardId || e.reward.id !== state.rewardId) return new Response(null, { status: 204 });

    // Twitch wiederholt Zustellungen: jede Einlösung nur einmal verarbeiten
    if (!(await db.setIfNew(`seen/${e.id}`, Date.now()))) return new Response(null, { status: 204 });
    try {
      await handleRedemption({ id: e.id, user_id: e.user_id, user_name: e.user_name, reward: e.reward }, await getSettings());
    } catch (err) {
      console.error('Check-in fehlgeschlagen:', err);
      await db.delete(`seen/${e.id}`); // Twitch darf es erneut versuchen
      return text('error', 500);
    }
  }
  return new Response(null, { status: 204 });
};
