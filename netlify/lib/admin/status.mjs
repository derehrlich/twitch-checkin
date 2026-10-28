// GET /api/admin/state: Zustand von Umgebungsvariablen, Twitch-Verbindung, Rewards und Webhooks.
import { db } from '../store.mjs';
import { getSettings } from '../settings.mjs';
import { streamDay } from '../checkin.mjs';
import { getBoard, isActive } from '../soundboard.mjs';
import { json } from '../http.mjs';
import { listSubscriptions, SCOPES, siteUrl } from '../twitch.mjs';
import { allUsers } from './common.mjs';

export async function status({ req, route, method }) {
  if (route[0] !== 'state' || method !== 'GET') return;
  const settings = await getSettings();
  const tokens = await db.get('config/tokens');
  const state = (await db.get('config/state')) ?? {};
  const webhookUrl = `${siteUrl(req)}/api/twitch-webhook`;
  let subscription = null;
  let subscriptionError = null;
  if (tokens && process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) {
    try {
      const subs = await listSubscriptions(webhookUrl);
      const rewards = 1 + (state.checkoutRewardId ? 1 : 0) + (state.streakRewardId ? 1 : 0) + (await getBoard()).filter((e) => isActive(e) && e.rewardId).length;
      const expected = rewards + (settings.raidEnabled ? 1 : 0) + (settings.alertsEnabled ? 5 : 0);
      const notReady = subs.find((x) => x.status !== 'enabled');
      subscription = !subs.length ? 'keine' : notReady ? notReady.status : subs.length < expected ? 'unvollständig – bitte neu einrichten' : 'enabled';
    } catch (e) { subscriptionError = e.message; }
  }
  const users = await allUsers();
  const today = streamDay(settings);
  return json({
    env: {
      TWITCH_CLIENT_ID: Boolean(process.env.TWITCH_CLIENT_ID),
      TWITCH_CLIENT_SECRET: Boolean(process.env.TWITCH_CLIENT_SECRET),
      EVENTSUB_SECRET: Boolean(process.env.EVENTSUB_SECRET),
    },
    connectedAs: tokens?.login ?? null,
    missingScopes: tokens ? SCOPES.filter((sc) => !(tokens.scopes ?? []).includes(sc)) : [],
    alertsEnabled: settings.alertsEnabled,
    raidEnabled: settings.raidEnabled,
    rewardId: state.rewardId ?? null,
    checkoutRewardId: state.checkoutRewardId ?? null,
    streakRewardId: state.streakRewardId ?? null,
    streakRescueEnabled: settings.streakRescueEnabled,
    checkoutEnabled: settings.checkoutEnabled,
    revoked: state.revoked ?? null,
    subscription, subscriptionError,
    urls: { site: siteUrl(req), redirect: `${siteUrl(req)}/api/auth/callback`, webhook: webhookUrl, overlay: `${siteUrl(req)}/overlay` },
    totals: { users: users.length, today: users.filter((u) => u.days.includes(today)).length, checkins: users.reduce((s, u) => s + u.days.length, 0) },
    today,
  });
}
