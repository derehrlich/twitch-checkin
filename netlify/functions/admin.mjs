// Admin-API (alles außer Login nur mit Session-Cookie)
import { db } from '../lib/store.mjs';
import { getSettings, saveSettings, setImage, setSound } from '../lib/settings.mjs';
import { fill, fmtDuration, pushOverlay, signText, streamDay } from '../lib/checkin.mjs';
import { raiderPackage, raidVars, raidCard } from '../lib/raid.mjs';
import { buildAlert } from '../lib/alerts.mjs';
import { SLOTS, slotKey } from '../lib/sounds.mjs';
import { MAX_ENTRIES, ID, getBoard, isActive, newId, sanitizeEntry, saveBoard, soundKey } from '../lib/soundboard.mjs';
import { IMAGE_MAX, IMAGE_SLOTS, imageKey, sniffImage } from '../lib/images.mjs';
import { computeStreak, getStreamDays } from '../lib/streak.mjs';
import { adminEnabled, checkPassword, cookie, hasSession, json, makeSession, text } from '../lib/http.mjs';
import { ensureRewards, listSubscriptions, SCOPES, deleteReward, sendChat, siteUrl, subscribe, syncSoundboardRewards, userByLogin } from '../lib/twitch.mjs';

export const config = { path: '/api/admin/*' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const SOUND_MAX = 1_500_000; // Bytes
// Dateityp an den ersten Bytes erkennen, statt dem Browser zu glauben
function sniffAudio(buf) {
  const head = buf.subarray(0, 12).toString('latin1');
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (head.startsWith('OggS')) return 'audio/ogg';
  if (head.startsWith('ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

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
        try {
          const subs = await listSubscriptions(webhookUrl);
          const expected = 1 + (state.checkoutRewardId ? 1 : 0) + (state.streakRewardId ? 1 : 0) + (await getBoard()).filter((e) => isActive(e) && e.rewardId).length + (settings.raidEnabled ? 1 : 0) + (settings.alertsEnabled ? 5 : 0);
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

    // ---- Einstellungen
    if (route[0] === 'settings') {
      if (method === 'GET') return json(await getSettings());
      if (method === 'PUT') return json(await saveSettings(body));
    }

    // ---- Rewards + Webhook einrichten
    if (route[0] === 'setup' && method === 'POST') {
      if (!process.env.EVENTSUB_SECRET) return json({ error: 'EVENTSUB_SECRET ist nicht gesetzt' }, 400);
      const settings = await getSettings();
      const board = await getBoard();
      const titles = [settings.rewardTitle, ...(settings.checkoutEnabled ? [settings.checkoutRewardTitle] : []), ...(settings.streakRescueEnabled ? [settings.streakRewardTitle] : []), ...board.map((e) => e.title)];
      if (new Set(titles).size !== titles.length) return json({ error: 'Alle Rewards (Check-in, Check-out, Streak-Retter und Soundboard-Einträge) brauchen verschiedene Namen' }, 400);
      const { checkin, checkout, streak } = await ensureRewards(settings);
      const synced = await syncSoundboardRewards(board);
      await saveBoard(synced);
      const boardIds = synced.filter((e) => isActive(e) && e.rewardId).map((e) => e.rewardId);
      await subscribe(`${siteUrl(req)}/api/twitch-webhook`, [checkin.id, ...(checkout ? [checkout.id] : []), ...(streak ? [streak.id] : []), ...boardIds], { raids: settings.raidEnabled, alerts: settings.alertsEnabled });
      await db.set('config/state', { ...((await db.get('config/state')) ?? {}), revoked: null });
      return json({ ok: true, reward: checkin.title, checkout: checkout?.title ?? null, streak: streak?.title ?? null, soundboard: boardIds.length });
    }

    // ---- Tests (verändern keine Zähler)
    if (route[0] === 'test' && method === 'POST') {
      const settings = await getSettings();
      const user = String(body.user || 'TestUser').slice(0, 40);
      const count = Math.max(1, Number(body.count) || 7);
      if (body.target === 'chat') {
        await sendChat(fill(settings.chatTemplate, { user, count }));
      } else if (body.target === 'checkout') {
        await pushOverlay({ type: 'checkout', user, minutes: 134, count });
      } else if (String(body.target).startsWith('alert-')) {
        // Beispieldaten, unabhängig vom Schalter „Alerts aktiv“, aber mit den Anzeigeregeln der Einstellungen
        const samples = {
          follow: ['channel.follow', { user_name: user }],
          sub: ['channel.subscribe', { user_name: user, tier: '1000', is_gift: false }],
          resub: ['channel.subscription.message', { user_name: user, tier: '2000', cumulative_months: count, message: { text: 'Immer wieder gerne! 🎉' } }],
          gift: ['channel.subscription.gift', { user_name: user, tier: '1000', total: Math.min(count, 100) }],
          cheer: ['channel.cheer', { user_name: user, bits: count * 10, message: 'Cheer100 für dich!' }],
        };
        const sample = samples[body.target.slice(6)];
        if (!sample) return json({ error: 'Unbekannter Alert' }, 400);
        const alert = buildAlert(sample[0], sample[1], { ...settings, alertFollow: true, alertSub: true, alertGift: true, alertCheer: true, alertCheerMin: 1 });
        await pushOverlay({ type: 'alert', ...alert.card });
        if (body.chat) await sendChat(fill(alert.template, alert.vars));
      } else if (body.target === 'raid' || body.target === 'raid-chat') {
        // Echte Daten (Spiel, Clip) vom angegebenen Kanal; Shoutout wird im Test nie ausgelöst
        const login = String(body.raider || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25) || (await db.get('config/tokens'))?.login;
        const who = login && (await userByLogin(login));
        if (!who) return json({ error: 'Kanal nicht gefunden' }, 404);
        const viewers = Math.max(1, Number(body.count) || 42);
        const pkg = await raiderPackage(who.id, who.display_name, settings);
        const raids = ((await db.get(`raid/${who.id}`))?.count ?? 0) + 1; // so würde der nächste Raid gezählt, der Test ändert nichts
        if (body.target === 'raid-chat') await sendChat(fill(settings.raidTemplate, raidVars(pkg, viewers, raids)));
        else await pushOverlay(raidCard(pkg, viewers, raids, settings));
        return json({ ok: true, clip: pkg.clip?.title ?? null });
      } else if (body.target === 'milestone' || body.target === 'milestone-chat') {
        const level = Math.max(1, Number(body.count) || 100);
        if (body.target === 'milestone') await pushOverlay({ type: 'checkin', user, count: level, streak: 12, milestone: true });
        else await sendChat(fill(settings.milestoneTemplate, { user, count: level, streak: 12, record: 15 }));
      } else if (body.target === 'soundboard') {
        const entry = (await getBoard()).find((e) => e.id === body.id);
        if (!entry || !entry.soundVersion) return json({ error: 'Eintrag hat noch keinen Ton' }, 400);
        await pushOverlay({ type: 'sound', id: entry.id, user, title: entry.title, volume: entry.volume, src: `/api/soundboard?id=${entry.id}&v=${entry.soundVersion}` });
      } else if (body.target === 'rescue') {
        await pushOverlay({ type: 'alert', kind: 'rescue', user, streak: 12, days: 2, ...signText(settings, 'rescue', { user, streak: 12, days: 2 }) });
      } else if (body.target === 'checkout-chat') {
        await sendChat(fill(settings.checkoutTemplate, { user, count, duration: fmtDuration(134) }));
      } else {
        await pushOverlay({ type: 'checkin', user, count });
      }
      return json({ ok: true });
    }

    // ---- Raid-Verlauf (Twitch liefert keinen, hier lässt sich der Stand früherer Raids nachtragen)
    if (route[0] === 'raids') {
      if (method === 'GET') {
        const keys = await db.list('raid/');
        const rows = await Promise.all(keys.map(async (k) => ({ id: k.slice(5), ...(await db.get(k)) })));
        return json(rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
      }
      if (method === 'POST') {
        const login = String(body.login || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
        const count = Math.round(Number(body.count));
        if (!login || !Number.isFinite(count) || count < 0 || count > 10_000) return json({ error: 'Kanalname und Anzahl (0 bis 10000) angeben' }, 400);
        const who = await userByLogin(login);
        if (!who) return json({ error: 'Kanal nicht gefunden' }, 404);
        const rec = (await db.get(`raid/${who.id}`)) ?? { viewers: 0, first: null, last: null };
        await db.set(`raid/${who.id}`, { ...rec, name: who.display_name, count });
        return json({ id: who.id, name: who.display_name, count });
      }
    }

    // ---- Eigene Töne (je Platz: checkin, raid, follow, ...; ohne Angabe der Check-in-Ton)
    if (route[0] === 'sound') {
      const slot = body.slot ?? 'checkin';
      if (!SLOTS.includes(slot)) return json({ error: 'Unbekannter Ton-Platz' }, 400);
      if (method === 'POST') {
        const buf = Buffer.from(typeof body.data === 'string' ? body.data : '', 'base64');
        if (!buf.length) return json({ error: 'Keine Datei empfangen' }, 400);
        if (buf.length > SOUND_MAX) return json({ error: 'Die Datei ist zu groß (maximal 1,5 MB)' }, 413);
        const type = sniffAudio(buf);
        if (!type) return json({ error: 'Nur MP3-, WAV- oder OGG-Dateien sind erlaubt' }, 400);
        await db.set(slotKey(slot), { type, data: buf.toString('base64') });
        const name = String(body.name || 'Eigener Ton').replace(/[<>"]/g, '').slice(0, 80);
        return json(await setSound({ name, version: Date.now() }, slot));
      }
      if (method === 'DELETE') {
        await db.delete(slotKey(slot));
        return json(await setSound(null, slot));
      }
    }

    // ---- Kanalpunkte-Soundboard (ein Reward mit Sounddatei je Eintrag)
    if (route[0] === 'soundboard') {
      const board = await getBoard();
      if (route.length === 1 && method === 'GET') return json(board);
      if (route.length === 1 && method === 'POST') {
        if (board.length >= MAX_ENTRIES) return json({ error: `Höchstens ${MAX_ENTRIES} Einträge` }, 400);
        const fields = sanitizeEntry(body);
        if (!fields.title) return json({ error: 'Bitte einen Namen angeben' }, 400);
        if (board.some((e) => e.title === fields.title)) return json({ error: 'Es gibt schon einen Eintrag mit diesem Namen' }, 400);
        const entry = { id: newId(), cost: 100, cooldown: 0, volume: 1, enabled: true, soundName: null, soundVersion: null, rewardId: null, ...fields };
        await saveBoard([...board, entry]);
        return json(entry);
      }
      const entry = board.find((e) => e.id === route[1]);
      if (!ID.test(route[1] ?? '') || !entry) return json({ error: 'Eintrag nicht gefunden' }, 404);
      if (route.length === 2 && method === 'PUT') {
        const fields = sanitizeEntry(body);
        if (fields.title && board.some((e) => e.id !== entry.id && e.title === fields.title)) return json({ error: 'Es gibt schon einen Eintrag mit diesem Namen' }, 400);
        Object.assign(entry, fields);
        await saveBoard(board);
        return json(entry);
      }
      if (route[2] === 'sound' && method === 'POST') {
        const buf = Buffer.from(typeof body.data === 'string' ? body.data : '', 'base64');
        if (!buf.length) return json({ error: 'Keine Datei empfangen' }, 400);
        if (buf.length > SOUND_MAX) return json({ error: 'Die Datei ist zu groß (maximal 1,5 MB)' }, 413);
        const type = sniffAudio(buf);
        if (!type) return json({ error: 'Nur MP3-, WAV- oder OGG-Dateien sind erlaubt' }, 400);
        await db.set(soundKey(entry.id), { type, data: buf.toString('base64') });
        entry.soundName = String(body.name || 'Ton').replace(/[<>"]/g, '').slice(0, 80);
        entry.soundVersion = Date.now();
        await saveBoard(board);
        return json(entry);
      }
      if (route.length === 2 && method === 'DELETE') {
        await saveBoard(board.filter((e) => e.id !== entry.id));
        await db.delete(soundKey(entry.id));
        if (entry.rewardId) await deleteReward(entry.rewardId);
        return json({ ok: true });
      }
    }

    // ---- Bilder/GIFs für die Alert-Schilder (je Platz: follow, sub, ...)
    if (route[0] === 'image') {
      const slot = body.slot;
      if (!IMAGE_SLOTS.includes(slot)) return json({ error: 'Unbekannter Bild-Platz' }, 400);
      if (method === 'POST') {
        const buf = Buffer.from(typeof body.data === 'string' ? body.data : '', 'base64');
        if (!buf.length) return json({ error: 'Keine Datei empfangen' }, 400);
        if (buf.length > IMAGE_MAX) return json({ error: 'Die Datei ist zu groß (maximal 3 MB)' }, 413);
        const type = sniffImage(buf);
        if (!type) return json({ error: 'Nur GIF-, PNG-, JPG- oder WebP-Dateien sind erlaubt' }, 400);
        await db.set(imageKey(slot), { type, data: buf.toString('base64') });
        const name = String(body.name || 'Eigenes Bild').replace(/[<>"]/g, '').slice(0, 80);
        return json(await setImage({ name, version: Date.now() }, slot));
      }
      if (method === 'DELETE') {
        await db.delete(imageKey(slot));
        return json(await setImage(null, slot));
      }
    }

    // ---- Nutzer
    if (route[0] === 'users') {
      if (route.length === 1 && method === 'GET') {
        const settings = await getSettings();
        const streamDays = await getStreamDays();
        const today = streamDay(settings);
        const users = (await allUsers()).map((u) => ({ ...u, ...(({ current, record }) => ({ streak: current, record }))(computeStreak(u, streamDays, today, settings.streakGrace)) }));
        return json(users.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
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
          await db.setIfNew(`streamday/${body.day}`, 1);
        }
        return json({ id, ...user });
      }
      if (route[2] === 'days' && route[3] && method === 'DELETE') { // Besuch entfernen
        user.days = user.days.filter((d) => d !== route[3]);
        user.count = user.days.length;
        if (user.sessions) delete user.sessions[route[3]];
        await db.set(`user/${id}`, user);
        await db.delete(`checked/${route[3]}/${id}`);
        await db.delete(`checkout/${route[3]}/${id}`);
        return json({ id, ...user });
      }
      if (route.length === 2 && method === 'DELETE') {
        for (const d of user.days) { await db.delete(`checked/${d}/${id}`); await db.delete(`checkout/${d}/${id}`); }
        await db.delete(`user/${id}`);
        return json({ ok: true });
      }
    }

    // ---- CSV-Export
    if (route[0] === 'export.csv' && method === 'GET') {
      const rows = ['datum,user,besuch_nr,checkin,checkout,minuten'];
      for (const u of await allUsers()) {
        u.days.forEach((d, i) => {
          const ses = u.sessions?.[d];
          rows.push(`${d},${csvCell(u.name)},${i + 1},${ses?.in ?? ''},${ses?.out ?? ''},${ses?.minutes ?? ''}`);
        });
      }
      return text(rows.join('\n'), 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="checkins.csv"' });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e.message }, 500);
  }
};
