// Admin-API (alles außer Login nur mit Session-Cookie)
import { db } from '../lib/store.mjs';
import { getSettings, saveSettings } from '../lib/settings.mjs';
import { fill, pushOverlay, streamDay } from '../lib/checkin.mjs';
import { adminEnabled, checkPassword, cookie, hasSession, json, makeSession, text } from '../lib/http.mjs';
import { ensureReward, listSubscriptions, sendChat, siteUrl, subscribe } from '../lib/twitch.mjs';

export const config = { path: '/api/admin/*' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function allUsers() {
  const keys = await db.list('user/');
  const users = [];
  for (let i = 0; i < keys.length; i += 25) { // in Blöcken laden
    const chunk = await Promise.all(keys.slice(i, i + 25).map(async (k) => ({ id: k.slice(5), ...(await db.get(k)) })));
    users.push(...chunk);
  }
  return users;
}

const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  const body = ['POST', 'PUT', 'DELETE'].includes(method) && req.headers.get('content-type')?.includes('application/json')
    ? await req.json().catch(() => ({})) : {};

  // ---- Login/Logout
  if (route[0] === 'login' && method === 'POST') {
    if (!adminEnabled()) return json({ error: 'ADMIN_PASSWORD ist nicht gesetzt' }, 503);
    if (!checkPassword(body.password)) {
      await new Promise((r) => setTimeout(r, 800)); // bremst Durchprobieren
      return json({ error: 'Falsches Passwort' }, 401);
    }
    return json({ ok: true }, 200, { 'set-cookie': cookie(req, 'session', makeSession(), 7 * 86400) });
  }
  if (route[0] === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie(req, 'session', '', 0) });

  if (!hasSession(req)) return json({ error: 'Nicht angemeldet', adminEnabled: adminEnabled() }, 401);
  // Schreibende Aufrufe nur als JSON, das schützt zusätzlich vor Formular-Angriffen von fremden Seiten
  if (['POST', 'PUT', 'DELETE'].includes(method) && !req.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type muss application/json sein' }, 415);
  }

  try {
    // ---- Status
    if (route[0] === 'state' && method === 'GET') {
      const settings = await getSettings();
      const tokens = await db.get('config/tokens');
      const state = (await db.get('config/state')) ?? {};
      const webhookUrl = `${siteUrl(req)}/api/twitch-webhook`;
      let subscription = null;
      let subscriptionError = null;
      if (tokens && process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) {
        try { subscription = (await listSubscriptions(webhookUrl))[0]?.status ?? 'keine'; } catch (e) { subscriptionError = e.message; }
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
        rewardId: state.rewardId ?? null,
        revoked: state.revoked ?? null,
        subscription, subscriptionError,
        urls: { site: siteUrl(req), redirect: `${siteUrl(req)}/api/auth/callback`, webhook: webhookUrl, overlay: `${siteUrl(req)}/overlay` },
        totals: { users: users.length, today: users.filter((u) => u.days.includes(today)).length, checkins: users.reduce((s, u) => s + u.days.length, 0) },
        today,
      });
    }

    // ---- Einstellungen
    if (route[0] === 'settings') {
      if (method === 'GET') return json(await getSettings());
      if (method === 'PUT') return json(await saveSettings(body));
    }

    // ---- Reward + Webhook einrichten
    if (route[0] === 'setup' && method === 'POST') {
      if (!process.env.EVENTSUB_SECRET) return json({ error: 'EVENTSUB_SECRET ist nicht gesetzt' }, 400);
      const reward = await ensureReward(await getSettings());
      await subscribe(`${siteUrl(req)}/api/twitch-webhook`, reward.id);
      await db.set('config/state', { ...((await db.get('config/state')) ?? {}), rewardId: reward.id, revoked: null });
      return json({ ok: true, reward: reward.title });
    }

    // ---- Tests (verändern keine Zähler)
    if (route[0] === 'test' && method === 'POST') {
      const settings = await getSettings();
      const user = String(body.user || 'TestUser').slice(0, 40);
      const count = Math.max(1, Number(body.count) || 7);
      if (body.target === 'chat') {
        await sendChat(fill(settings.chatTemplate, { user, count }));
      } else {
        await pushOverlay({ type: 'checkin', user, count });
      }
      return json({ ok: true });
    }

    // ---- Nutzer
    if (route[0] === 'users') {
      if (route.length === 1 && method === 'GET') {
        const users = (await allUsers()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        return json(users);
      }
      const id = route[1];
      const user = id && (await db.get(`user/${id}`));
      if (!user) return json({ error: 'Nutzer nicht gefunden' }, 404);

      if (route[2] === 'days' && method === 'POST') { // Besuch nachtragen
        if (!DAY.test(body.day ?? '')) return json({ error: 'Datum muss YYYY-MM-DD sein' }, 400);
        if (!user.days.includes(body.day)) {
          user.days = [...user.days, body.day].sort();
          user.count = user.days.length;
          user.first ??= new Date().toISOString();
          user.last ??= user.first;
          await db.set(`user/${id}`, user);
          await db.set(`checked/${body.day}/${id}`, 1);
        }
        return json({ id, ...user });
      }
      if (route[2] === 'days' && route[3] && method === 'DELETE') { // Besuch entfernen
        user.days = user.days.filter((d) => d !== route[3]);
        user.count = user.days.length;
        await db.set(`user/${id}`, user);
        await db.delete(`checked/${route[3]}/${id}`);
        return json({ id, ...user });
      }
      if (route.length === 2 && method === 'DELETE') {
        for (const d of user.days) await db.delete(`checked/${d}/${id}`);
        await db.delete(`user/${id}`);
        return json({ ok: true });
      }
    }

    // ---- CSV-Export
    if (route[0] === 'export.csv' && method === 'GET') {
      const rows = ['datum,user,besuch_nr'];
      for (const u of await allUsers()) u.days.forEach((d, i) => rows.push(`${d},${csvCell(u.name)},${i + 1}`));
      return text(rows.join('\n'), 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="checkins.csv"' });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e.message }, 500);
  }
};
