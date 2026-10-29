// Ende-zu-Ende-Test der Functions mit simulierter Twitch-API und Dateispeicher.  npm test
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LOCAL_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-test-'));
Object.assign(process.env, {
  TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: 'csecret', EVENTSUB_SECRET: 'hooksecret1234',
  ADMIN_PASSWORD: 'geheim', SITE_URL: 'https://beispiel.netlify.app',
});

// ---- Twitch simulieren
const calls = [];
const rewards = []; // vom Mock angelegte Rewards
let shoutoutFails = false;
let deletedRewards = 0; // damit neue Reward-IDs nie mit gelöschten kollidieren
let clipsFail = false, channelsFail = false;
let clips = [
  { id: 'LangClip', title: 'zu lang', duration: 55, creator_name: 'x' },
  { id: 'GutClip', title: 'Krasser Moment', duration: 14.2, creator_name: 'Fan' },
];
let subs = []; // aktive Webhook-Subscriptions
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const entry = { method: init.method || 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body && !String(init.body).includes('=') ? JSON.parse(init.body) : init.body };
  calls.push(entry);
  const ok = (data, status = 200) => new Response(JSON.stringify(data), { status });
  if (u.host === 'id.twitch.tv') {
    if (u.pathname.endsWith('/validate')) return ok({ user_id: '999', login: 'streamerin' });
    return ok({ access_token: 'tok', refresh_token: 'ref', expires_in: 3600 });
  }
  if (u.pathname.endsWith('/chat/shoutouts')) return shoutoutFails ? ok({ error: 'cooldown' }, 429) : new Response(null, { status: 204 });
  if (u.pathname.endsWith('/helix/users')) return ok({ data: [{ id: entry.query.id ?? '777', login: entry.query.login ?? 'raiderin', display_name: 'RaiderIn', profile_image_url: 'https://img/a.png' }] });
  if (u.pathname.endsWith('/helix/channels') && channelsFail) return ok({ error: 'boom' }, 500);
  if (u.pathname.endsWith('/helix/clips') && clipsFail) return ok({ error: 'boom' }, 500);
  if (u.pathname.endsWith('/helix/channels')) return ok({ data: [{ broadcaster_name: 'RaiderIn', broadcaster_login: 'raiderin', game_name: 'Hades' }] });
  if (u.pathname.endsWith('/helix/clips')) return ok({ data: clips });
  if (u.pathname.endsWith('/chat/messages')) return ok({ data: [{ is_sent: true }] });
  if (u.pathname.endsWith('/custom_rewards') && entry.method === 'GET') return ok({ data: rewards });
  const cooldown = (r, b) => { if ('is_global_cooldown_enabled' in b) r.global_cooldown_setting = { is_enabled: b.is_global_cooldown_enabled, global_cooldown_seconds: b.global_cooldown_seconds ?? 0 }; return r; };
  if (u.pathname.endsWith('/custom_rewards') && entry.method === 'POST') {
    const r = cooldown({ id: 'reward' + (rewards.length + 1 + deletedRewards), title: entry.body.title, cost: entry.body.cost, is_enabled: entry.body.is_enabled ?? true }, entry.body);
    rewards.push(r);
    return ok({ data: [r] });
  }
  if (u.pathname.endsWith('/custom_rewards') && entry.method === 'PATCH') {
    const r = rewards.find((x) => x.id === entry.query.id); Object.assign(r, entry.body); cooldown(r, entry.body); return ok({ data: [r] });
  }
  if (u.pathname.endsWith('/custom_rewards') && entry.method === 'DELETE') {
    const i = rewards.findIndex((x) => x.id === entry.query.id); if (i >= 0) { rewards.splice(i, 1); deletedRewards++; } return new Response(null, { status: 204 });
  }
  if (u.pathname.endsWith('/redemptions')) return ok({ data: [{}] });
  if (u.pathname.endsWith('/eventsub/subscriptions')) {
    if (entry.method === 'GET') return ok({ data: subs });
    if (entry.method === 'DELETE') { subs = subs.filter((x) => x.id !== entry.query.id); return ok({}); }
    const sub = { id: 's' + (subs.length + 1) + calls.length, status: 'webhook_callback_verification_pending', condition: entry.body.condition, transport: entry.body.transport };
    subs.push(sub);
    return ok({ data: [sub] });
  }
  return ok({}, 404);
};

const { db } = await import('../netlify/lib/store.mjs');
const webhook = (await import('../netlify/functions/twitch-webhook.mjs')).default;
const overlay = (await import('../netlify/functions/overlay.mjs')).default;
const admin = (await import('../netlify/functions/admin.mjs')).default;
const auth = (await import('../netlify/functions/auth.mjs')).default;
const sound = (await import('../netlify/functions/sound.mjs')).default;
const image = (await import('../netlify/functions/image.mjs')).default;
const board = (await import('../netlify/functions/soundboard.mjs')).default;
const { streamDay, handleCheckout, fmtDuration } = await import('../netlify/lib/checkin.mjs');
const { getSettings } = await import('../netlify/lib/settings.mjs');
const { computeStreak, findRescue, parseLevels } = await import('../netlify/lib/streak.mjs');

const BASE = 'https://beispiel.netlify.app';
let n = 0;
const test = async (name, fn) => { await fn(); console.log('✓', name); n++; };

function signed(type, payload, { secret = process.env.EVENTSUB_SECRET, id = crypto.randomUUID() } = {}) {
  const raw = JSON.stringify(payload);
  const ts = new Date().toISOString();
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(id + ts + raw).digest('hex');
  return new Request(BASE + '/api/twitch-webhook', {
    method: 'POST', body: raw,
    headers: { 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': ts, 'twitch-eventsub-message-signature': sig, 'twitch-eventsub-message-type': type },
  });
}
const redemption = (id, userId, name, reward = 'reward1') => ({ event: { id, user_id: userId, user_name: name, reward: { id: reward, title: 'Check-in' } } });
const adminReq = (method, p, body, cookie) => new Request(BASE + '/api/admin/' + p, {
  method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const chats = () => calls.filter((c) => c.path.endsWith('/chat/messages')).map((c) => c.body.message);

// ---- Admin-Zugang
let cookie;
await test('Admin: ohne Login 401, falsches Passwort 401, richtiges Passwort liefert Session', async () => {
  assert.equal((await admin(adminReq('GET', 'state'))).status, 401);
  assert.equal((await admin(adminReq('POST', 'login', { password: 'falsch' }))).status, 401);
  const res = await admin(adminReq('POST', 'login', { password: 'geheim' }));
  assert.equal(res.status, 200);
  cookie = res.headers.get('set-cookie').split(';')[0];
  assert.equal((await admin(adminReq('GET', 'state', null, cookie))).status, 200);
  assert.equal((await admin(adminReq('GET', 'state', null, cookie.slice(0, -3) + 'xxx'))).status, 401, 'manipulierte Session muss abgelehnt werden');
});

await test('Twitch verbinden: Login-Redirect und Callback speichern Tokens', async () => {
  assert.equal((await auth(new Request(BASE + '/api/auth/login'))).status, 401, 'ohne Admin-Session gesperrt');
  const login = await auth(new Request(BASE + '/api/auth/login', { headers: { cookie } }));
  assert.equal(login.status, 302);
  const location = new URL(login.headers.get('location'));
  assert.equal(location.searchParams.get('redirect_uri'), BASE + '/api/auth/callback');
  assert.match(location.searchParams.get('scope'), /user:write:chat/);
  assert.match(location.searchParams.get('scope'), /moderator:manage:shoutouts/);
  const stateCookie = login.headers.get('set-cookie').split(';')[0];
  const state = location.searchParams.get('state');

  const bad = await auth(new Request(`${BASE}/api/auth/callback?code=c&state=falsch`, { headers: { cookie: `${cookie}; ${stateCookie}` } }));
  assert.equal(bad.status, 400);
  const good = await auth(new Request(`${BASE}/api/auth/callback?code=c&state=${state}`, { headers: { cookie: `${cookie}; ${stateCookie}` } }));
  assert.equal(good.status, 302);
  assert.equal((await db.get('config/tokens')).login, 'streamerin');
});

await test('Setup legt beide Rewards an und abonniert je einen Webhook mit reward_id', async () => {
  const res = await admin(adminReq('POST', 'setup', {}, cookie));
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), { ok: true, reward: 'Check-in', checkout: 'Check-out', streak: 'Streak-Retter', soundboard: 0 });
  const created = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/eventsub/subscriptions'));
  assert.deepEqual(created.map((c) => c.body.condition.reward_id).filter(Boolean).sort(), ['reward1', 'reward2', 'reward3']);
  const raidSub = created.find((c) => c.body.type === 'channel.raid');
  assert.deepEqual(raidSub.body.condition, { to_broadcaster_user_id: '999' }, 'Raid-Subscription für den eigenen Kanal');
  assert.ok(created.every((c) => c.body.transport.method === 'webhook' && c.body.transport.callback === BASE + '/api/twitch-webhook'));
  const state = await db.get('config/state');
  assert.equal(state.rewardId, 'reward1');
  assert.equal(state.checkoutRewardId, 'reward2');
  assert.equal(state.streakRewardId, 'reward3');
  // Zweites Einrichten legt nichts doppelt an und ersetzt die Subscriptions
  await admin(adminReq('POST', 'setup', {}, cookie));
  assert.equal(rewards.length, 3);
  assert.equal(subs.length, 4);
});

await test('Admin-Status warnt bei fehlender Shoutout-Berechtigung', async () => {
  assert.ok((await (await admin(adminReq('GET', 'state', null, cookie))).json()).missingScopes.includes('moderator:manage:shoutouts'), 'Tokens ohne scopes');
  await db.set('config/tokens', { ...(await db.get('config/tokens')), scopes: ['channel:read:redemptions', 'channel:manage:redemptions', 'user:write:chat', 'moderator:manage:shoutouts', 'moderator:read:followers', 'channel:read:subscriptions', 'bits:read'] });
  assert.deepEqual((await (await admin(adminReq('GET', 'state', null, cookie))).json()).missingScopes, []);
});

await test('Setup lehnt gleiche Namen für die Rewards ab', async () => {
  await admin(adminReq('PUT', 'settings', { checkoutRewardTitle: 'Check-in' }, cookie));
  assert.equal((await admin(adminReq('POST', 'setup', {}, cookie))).status, 400);
  await admin(adminReq('PUT', 'settings', { checkoutRewardTitle: 'Check-out', streakRewardTitle: 'Check-out' }, cookie));
  assert.equal((await admin(adminReq('POST', 'setup', {}, cookie))).status, 400);
  await admin(adminReq('PUT', 'settings', { streakRewardTitle: 'Streak-Retter' }, cookie));
});

// ---- Webhook
await test('Webhook: Verifizierung gibt Challenge zurück, falsche Signatur wird abgelehnt', async () => {
  const res = await webhook(signed('webhook_callback_verification', { challenge: 'abc123' }));
  assert.equal(await res.text(), 'abc123');
  assert.equal((await webhook(signed('notification', redemption('r0', '1', 'Max'), { secret: 'falsch' }))).status, 403);
  assert.equal((await db.get('user/1')), null);
});

await test('Check-in: zählt, schickt Chat, Overlay-Ereignis, schließt Einlösung ab', async () => {
  const before = calls.length;
  const res = await webhook(signed('notification', redemption('r1', '1', 'Max')));
  assert.equal(res.status, 204);
  const user = await db.get('user/1');
  assert.equal(user.count, 1);
  assert.deepEqual(chats(), ['✅ Max ist eingecheckt – du warst jetzt schon 1x dabei! 🎉']);
  const patch = calls.slice(before).find((c) => c.method === 'PATCH');
  assert.equal(patch.body.status, 'FULFILLED');
  assert.equal(patch.query.id, 'r1');
});

await test('Doppelte Zustellung derselben Einlösung wird ignoriert', async () => {
  const n0 = chats().length;
  await webhook(signed('notification', redemption('r1', '1', 'Max')));
  assert.equal(chats().length, n0);
  assert.equal((await db.get('user/1')).count, 1);
});

await test('Zweite Einlösung am selben Tag: Duplikat-Hinweis und Erstattung', async () => {
  const before = calls.length;
  await webhook(signed('notification', redemption('r2', '1', 'Max')));
  assert.equal((await db.get('user/1')).count, 1);
  assert.match(chats().at(-1), /schon eingecheckt/);
  assert.equal(calls.slice(before).find((c) => c.method === 'PATCH').body.status, 'CANCELED');
});

await test('Anderer Reward wird nicht gezählt', async () => {
  await webhook(signed('notification', redemption('r3', '2', 'Anna', 'anderer')));
  assert.equal(await db.get('user/2'), null);
});

await test('Gleichzeitige Einlösungen desselben Users zählen nur einmal', async () => {
  await Promise.all([1, 2, 3].map((i) => webhook(signed('notification', redemption('p' + i, '3', 'Zoe')))));
  assert.equal((await db.get('user/3')).count, 1);
});

await test('Besuch an späterem Tag erhöht den Zähler (Admin-Nachtrag + neuer Tag)', async () => {
  let res = await admin(adminReq('POST', 'users/1/days', { day: '2020-01-01' }, cookie));
  assert.equal((await res.json()).count, 2);
  res = await admin(adminReq('POST', 'users/1/days', { day: '2020-01-01' }, cookie));
  assert.equal((await res.json()).count, 2, 'derselbe Tag zählt nicht doppelt');
  assert.equal((await admin(adminReq('POST', 'users/1/days', { day: 'kaputt' }, cookie))).status, 400);
  // Simuliert "nächster Stream": Sperre für heute löschen, Tag verschieben
  const settings = await getSettings();
  await db.delete(`checked/${streamDay(settings)}/1`);
  const u = await db.get('user/1'); u.days = u.days.filter((d) => d !== streamDay(settings)); u.count = u.days.length; await db.set('user/1', u);
  await webhook(signed('notification', redemption('r4', '1', 'Max')));
  assert.equal((await db.get('user/1')).count, 2);
  assert.match(chats().at(-1), /2x dabei/);
});

const checkoutNotification = (id, userId, name) => signed('notification', redemption(id, userId, name, 'reward2'));
await test('Check-out: berechnet Dauer, speichert sie, Chat, Overlay, schließt Einlösung ab', async () => {
  // Max (Nutzer 1) ist heute eingecheckt; Check-in auf vor 134 Minuten zurückdatieren
  const u = await db.get('user/1');
  const day = Object.keys(u.sessions).sort().at(-1);
  assert.equal(u.sessions[day].out, null, 'Check-in legt eine offene Sitzung an');
  u.sessions[day].in = new Date(Date.now() - 134 * 60_000).toISOString();
  await db.set('user/1', u);

  const before = calls.length;
  assert.equal((await webhook(checkoutNotification('o1', '1', 'Max'))).status, 204);
  const after = await db.get('user/1');
  assert.equal(after.sessions[day].minutes, 134);
  assert.ok(after.sessions[day].out);
  assert.equal(chats().at(-1), '👋 Max geht – 2 Std 14 Min dabei gewesen. Bis zum nächsten Mal!');
  assert.equal(calls.slice(before).find((c) => c.method === 'PATCH').body.status, 'FULFILLED');
  assert.equal(after.count, u.count, 'Check-out verändert den Besuchszähler nicht');

  const ev = await (await overlay(new Request(BASE + '/api/overlay?since=event/000000000000000'))).json();
  assert.deepEqual(ev.events.at(-1), { type: 'checkout', user: 'Max', minutes: 134, count: after.count });
});

await test('Zweiter Check-out am selben Tag: Hinweis und Erstattung, Dauer bleibt', async () => {
  const before = calls.length;
  await webhook(checkoutNotification('o2', '1', 'Max'));
  assert.match(chats().at(-1), /schon ausgecheckt/);
  assert.equal(calls.slice(before).find((c) => c.method === 'PATCH').body.status, 'CANCELED');
  const day = Object.keys((await db.get('user/1')).sessions).sort().at(-1);
  assert.equal((await db.get('user/1')).sessions[day].minutes, 134);
});

await test('Check-out ohne Check-in: Hinweis und Erstattung, kein Nutzer wird angelegt', async () => {
  const before = calls.length;
  await webhook(checkoutNotification('o3', '77', 'Neuling'));
  assert.match(chats().at(-1), /nicht eingecheckt/);
  assert.equal(calls.slice(before).find((c) => c.method === 'PATCH').body.status, 'CANCELED');
  assert.equal(await db.get('user/77'), null);
});

await test('Gleichzeitige Check-outs zählen nur einmal', async () => {
  await webhook(signed('notification', redemption('c1', '5', 'Eva')));
  const u = await db.get('user/5'); const day = Object.keys(u.sessions)[0];
  u.sessions[day].in = new Date(Date.now() - 30 * 60_000).toISOString(); await db.set('user/5', u);
  const n0 = chats().filter((c) => c.includes('Eva geht')).length;
  await Promise.all([1, 2, 3].map((i) => webhook(checkoutNotification('co' + i, '5', 'Eva'))));
  assert.equal(chats().filter((c) => c.includes('Eva geht')).length - n0, 1);
  assert.equal((await db.get('user/5')).sessions[day].minutes, 30);
});

await test('Check-out nach Tageswechsel findet die offene Sitzung der letzten 24 Stunden', async () => {
  await webhook(signed('notification', redemption('d1', '6', 'Nacht')));
  const u = await db.get('user/6'); const day = Object.keys(u.sessions)[0];
  u.sessions[day].in = new Date(Date.now() - 7 * 3_600_000).toISOString(); await db.set('user/6', u); // 7 Std her
  const r = await handleCheckout({ id: 'x', user_id: '6', user_name: 'Nacht', reward: { id: 'reward2' } }, await getSettings());
  assert.equal(r.minutes, 420);
  assert.equal(fmtDuration(420), '7 Std');
  assert.equal(fmtDuration(0), '0 Min');
  assert.equal(fmtDuration(61), '1 Std 1 Min');
  // Sitzungen, die älter als 24 Stunden sind, zählen nicht mehr
  await webhook(signed('notification', redemption('d2', '8', 'Alt')));
  const old = await db.get('user/8'); const oday = Object.keys(old.sessions)[0];
  old.sessions[oday].in = new Date(Date.now() - 30 * 3_600_000).toISOString(); await db.set('user/8', old);
  assert.equal((await handleCheckout({ id: 'y', user_id: '8', user_name: 'Alt', reward: { id: 'reward2' } }, await getSettings())).ok, false);
});

await test('Check-out für einen Check-in von vor dem Update (ohne Sitzung): Zeit kommt aus "zuletzt"', async () => {
  const settings = await getSettings();
  const day = streamDay(settings);
  // Alter Datensatz: Besuchstag und "zuletzt" vorhanden, aber keine sessions
  const ninety = new Date(Date.now() - 90 * 60_000).toISOString();
  await db.set('user/90', { name: 'Altbestand', count: 1, first: ninety, last: ninety, days: [day] });
  await db.set(`checked/${day}/90`, 1);
  const before = calls.length;
  await webhook(checkoutNotification('l1', '90', 'Altbestand'));
  const u = await db.get('user/90');
  assert.equal(u.sessions[day].minutes, 90);
  assert.equal(chats().at(-1), '👋 Altbestand geht – 1 Std 30 Min dabei gewesen. Bis zum nächsten Mal!');
  assert.equal(calls.slice(before).find((c) => c.method === 'PATCH').body.status, 'FULFILLED');
  // Zweiter Check-out: schon ausgecheckt
  await webhook(checkoutNotification('l2', '90', 'Altbestand'));
  assert.match(chats().at(-1), /schon ausgecheckt/);

  // Letzter Check-in länger als 24 Stunden her: gilt nicht als eingecheckt
  const old = new Date(Date.now() - 30 * 3_600_000).toISOString();
  await db.set('user/91', { name: 'Gestern', count: 1, first: old, last: old, days: [streamDay(settings, new Date(old))] });
  await webhook(checkoutNotification('l3', '91', 'Gestern'));
  assert.match(chats().at(-1), /nicht eingecheckt/);
  assert.equal((await db.get('user/91')).sessions, undefined);
});

await test('Overlay: erster Abruf ohne Altlasten, danach nur neue Ereignisse', async () => {
  const first = await (await overlay(new Request(BASE + '/api/overlay'))).json();
  assert.deepEqual(first.events, []);
  await admin(adminReq('POST', 'test', { user: 'Tester', count: 5 }, cookie));
  const next = await (await overlay(new Request(BASE + '/api/overlay?since=' + encodeURIComponent(first.cursor)))).json();
  assert.deepEqual(next.events, [{ type: 'checkin', user: 'Tester', count: 5 }]);
  const again = await (await overlay(new Request(BASE + '/api/overlay?since=' + encodeURIComponent(next.cursor)))).json();
  assert.deepEqual(again.events, []);
  assert.equal((await db.get('user/Tester')), null, 'Test verändert keine Zähler');
});

await test('Einstellungen werden bereinigt und gespeichert', async () => {
  const res = await admin(adminReq('PUT', 'settings', { chatTemplate: 'Hi {user} #{count}', volume: 7, duration: 1, timezone: 'Quatsch/Zone', evil: 'x' }, cookie));
  const s = await res.json();
  assert.equal(s.chatTemplate, 'Hi {user} #{count}');
  assert.equal(s.volume, 1);
  assert.equal(s.duration, 2000);
  assert.equal(s.timezone, 'Europe/Berlin');
  assert.equal(s.evil, undefined);
  assert.equal(s.checkoutRewardCost, 1);
  const co = await (await admin(adminReq('PUT', 'settings', { checkoutEnabled: false, checkoutRewardCost: 5, checkoutTemplate: 'Tschüss {user}, {duration}!' }, cookie))).json();
  assert.deepEqual([co.checkoutEnabled, co.checkoutRewardCost, co.checkoutTemplate], [false, 5, 'Tschüss {user}, {duration}!']);
  await admin(adminReq('PUT', 'settings', { checkoutEnabled: true, checkoutRewardCost: 1 }, cookie));
});

await test('Eigener Ton: Upload, Auslieferung ans Overlay, Zurücksetzen, Schutz vor falschen Dateien', async () => {
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2000, 7)]);
  const upload = (cookieHeader, data, name = 'ding.mp3') => admin(adminReq('POST', 'sound', { name, data: data.toString('base64') }, cookieHeader));

  assert.equal((await upload(undefined, mp3)).status, 401, 'ohne Login gesperrt');
  assert.equal((await upload(cookie, Buffer.from('<html>kein Audio</html>'))).status, 400, 'Nicht-Audio abgelehnt');
  assert.equal((await upload(cookie, Buffer.alloc(0))).status, 400, 'leere Datei abgelehnt');
  assert.equal((await upload(cookie, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(1_600_000)]))).status, 413, 'zu große Datei abgelehnt');
  assert.equal((await db.get('sound/data')), null, 'abgelehnte Dateien werden nicht gespeichert');

  const ok = await upload(cookie, mp3, '<b>ding</b>.mp3');
  assert.equal(ok.status, 200);
  const settings = await ok.json();
  assert.equal(settings.soundName, 'bding/b.mp3', 'spitze Klammern im Namen entfernt');
  assert.ok(settings.soundVersion);

  const poll = await (await overlay(new Request(BASE + '/api/overlay'))).json();
  assert.equal(poll.sound, `/api/sound?v=${settings.soundVersion}`);
  const served = await sound(new Request(BASE + poll.sound));
  assert.equal(served.headers.get('content-type'), 'audio/mpeg');
  assert.match(served.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), mp3);

  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(100)]);
  assert.equal((await (await upload(cookie, wav, 'x.wav')).json()).soundName, 'x.wav', 'zweiter Upload ersetzt den ersten');
  assert.equal((await sound(new Request(BASE + '/api/sound'))).headers.get('content-type'), 'audio/wav');

  const afterSave = await (await admin(adminReq('PUT', 'settings', { volume: 0.3 }, cookie))).json();
  assert.equal(afterSave.soundName, 'x.wav', 'Einstellungen speichern lässt den Ton unberührt');

  const reset = await (await admin(adminReq('DELETE', 'sound', null, cookie))).json();
  assert.equal(reset.soundName, null);
  assert.equal((await (await overlay(new Request(BASE + '/api/overlay'))).json()).sound, null);
  assert.equal((await sound(new Request(BASE + '/api/sound'))).status, 404);
});

await test('Rangliste, Entfernen eines Besuchs, CSV-Export, Löschen', async () => {
  const users = await (await admin(adminReq('GET', 'users', null, cookie))).json();
  assert.equal(users[0].name, 'Max');
  const csv = await (await admin(adminReq('GET', 'export.csv', null, cookie))).text();
  assert.match(csv, /^datum,user,besuch_nr,checkin,checkout,minuten\n/);
  assert.match(csv, /2020-01-01,"Max",1,,,/);
  assert.match(csv, /"Max",2,[^,]+,[^,]+,134/);
  let res = await admin(adminReq('DELETE', 'users/1/days/2020-01-01', null, cookie));
  assert.equal((await res.json()).count, 1);
  res = await admin(adminReq('DELETE', 'users/3', null, cookie));
  assert.equal((await res.json()).ok, true);
  assert.equal(await db.get('user/3'), null);
});

await test('Schreibende Admin-Aufrufe ohne JSON werden abgelehnt', async () => {
  const res = await admin(new Request(BASE + '/api/admin/settings', { method: 'PUT', headers: { cookie }, body: 'volume=0' }));
  assert.equal(res.status, 415);
});

// ---- Töne pro Alert
await test('Töne pro Alert: Upload je Platz, Auslieferung, Overlay-Liste, Zurücksetzen, ungültiger Platz', async () => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVE'), Buffer.alloc(40)]);
  const up = (slot, name) => admin(adminReq('POST', 'sound', { slot, name, data: wav.toString('base64') }, cookie));
  assert.equal((await up('quatsch', 'x.wav')).status, 400);
  const r = await (await up('follow', 'follow.wav')).json();
  assert.equal(r.sounds.follow.name, 'follow.wav');
  assert.equal(r.soundName, null, 'der Check-in-Ton bleibt unberührt');
  await up('raid', 'horn.wav');
  const poll = await (await overlay(new Request(BASE + '/api/overlay'))).json();
  assert.deepEqual(Object.keys(poll.sounds).sort(), ['follow', 'raid']);
  assert.match(poll.sounds.follow, /^\/api\/sound\?slot=follow&v=\d+$/);
  assert.equal(poll.sound, null);
  const served = await sound(new Request(BASE + poll.sounds.raid));
  assert.equal(served.headers.get('content-type'), 'audio/wav');
  assert.equal((await sound(new Request(BASE + '/api/sound?slot=cheer'))).status, 404, 'nichts hinterlegt');
  assert.equal((await sound(new Request(BASE + '/api/sound?slot=quatsch'))).status, 404);
  assert.equal((await admin(adminReq('PUT', 'settings', { volume: 0.5 }, cookie)).then((x) => x.json())).sounds.follow.name, 'follow.wav', 'Einstellungen speichern lässt die Töne unberührt');
  const del = await (await admin(adminReq('DELETE', 'sound', { slot: 'follow' }, cookie))).json();
  assert.equal(del.sounds.follow, undefined);
  assert.equal(del.sounds.raid.name, 'horn.wav');
  assert.equal((await sound(new Request(BASE + '/api/sound?slot=follow'))).status, 404);
  await admin(adminReq('DELETE', 'sound', { slot: 'raid' }, cookie));
  assert.deepEqual((await (await overlay(new Request(BASE + '/api/overlay'))).json()).sounds, {});
});

// ---- Raids
const eventsSince = async (cur) => (await (await overlay(new Request(BASE + '/api/overlay?since=' + encodeURIComponent(cur)))).json()).events;
const cursor = async () => (await (await overlay(new Request(BASE + '/api/overlay'))).json()).cursor;
const raidEvent = (viewers = 42) => ({ subscription: { type: 'channel.raid' }, event: { from_broadcaster_user_id: '777', from_broadcaster_user_name: 'raiderin', to_broadcaster_user_id: '999', viewers } });
await test('Raid: Chat, Shoutout und Overlay-Karte mit passendem Clip', async () => {
  const cur = (await (await overlay(new Request(BASE + '/api/overlay'))).json()).cursor;
  const before = calls.length;
  const res = await webhook(signed('notification', raidEvent(42), { id: 'raid-msg-1' }));
  assert.equal(res.status, 204);
  const mine = calls.slice(before);
  assert.ok(mine.some((c) => c.path.endsWith('/chat/shoutouts') && c.query.to_broadcaster_id === '777' && c.query.from_broadcaster_id === '999' && c.query.moderator_id === '999'), 'Shoutout');
  assert.ok(chats().at(-1).includes('RaiderIn') && chats().at(-1).includes('42') && chats().at(-1).includes('Hades') && chats().at(-1).includes('twitch.tv/raiderin'), chats().at(-1));
  const { events } = await (await overlay(new Request(BASE + '/api/overlay?since=' + encodeURIComponent(cur)))).json();
  const raid = events.find((e) => e.type === 'raid');
  assert.equal(raid.raider, 'RaiderIn');
  assert.equal(raid.viewers, 42);
  assert.equal(raid.game, 'Hades');
  assert.equal(raid.clip.id, 'GutClip', 'zu langer Clip wird ausgelassen');
  assert.equal(raid.clip.duration, 15);
});

await test('Raid ohne Clip: leere Liste, nur zu lange Clips, Fehler bei Clips oder Kanal-Abfrage – Karte, Chat und Shoutout kommen trotzdem', async () => {
  const saveClips = clips;
  const cases = [
    ['keine Clips', () => { clips = []; }],
    ['nur zu lange Clips', () => { clips = [{ id: 'a', title: 'x', duration: 59, creator_name: 'y' }]; }],
    ['Clip-Abfrage schlägt fehl', () => { clips = saveClips; clipsFail = true; }],
    ['Kanal-Abfrage schlägt fehl', () => { clips = []; clipsFail = false; channelsFail = true; }],
  ];
  let i = 0;
  for (const [label, setup] of cases) {
    clipsFail = false; channelsFail = false; setup();
    const cur = await cursor(); const n = chats().length; const before = calls.length;
    assert.equal((await webhook(signed('notification', raidEvent(30), { id: 'noclip-' + i++ }))).status, 204, label);
    const raid = (await eventsSince(cur)).find((e) => e.type === 'raid');
    assert.ok(raid, label + ': Overlay-Karte fehlt');
    assert.equal(raid.clip, null, label);
    assert.equal(raid.viewers, 30, label);
    assert.equal(chats().length, n + 1, label + ': Chatnachricht fehlt');
    assert.ok(calls.slice(before).some((c) => c.path.endsWith('/chat/shoutouts')), label + ': Shoutout fehlt');
  }
  clipsFail = false; channelsFail = false; clips = saveClips;
});

await test('Raid: Wiederholte Zustellung wird nur einmal verarbeitet', async () => {
  const n = chats().length;
  await webhook(signed('notification', raidEvent(42), { id: 'raid-msg-1' }));
  assert.equal(chats().length, n);
});

await test('Raid: Shoutout-Fehler (Cooldown) stoppt den Rest nicht', async () => {
  shoutoutFails = true;
  const n = chats().length;
  assert.equal((await webhook(signed('notification', raidEvent(5), { id: 'raid-msg-2' }))).status, 204);
  assert.equal(chats().length, n + 1);
  shoutoutFails = false;
});

await test('Raid: unter Mindestzahl, ausgeschaltet oder ohne Clip', async () => {
  await admin(adminReq('PUT', 'settings', { raidMinViewers: 10 }, cookie));
  const n = chats().length;
  await webhook(signed('notification', raidEvent(3), { id: 'raid-msg-3' }));
  assert.equal(chats().length, n, 'zu klein');
  await admin(adminReq('PUT', 'settings', { raidMinViewers: 1, raidEnabled: false }, cookie));
  await webhook(signed('notification', raidEvent(50), { id: 'raid-msg-4' }));
  assert.equal(chats().length, n, 'ausgeschaltet');
  await admin(adminReq('PUT', 'settings', { raidEnabled: true, raidClip: false, raidShoutout: false }, cookie));
  const cur = (await (await overlay(new Request(BASE + '/api/overlay'))).json()).cursor;
  const before = calls.length;
  await webhook(signed('notification', raidEvent(50), { id: 'raid-msg-5' }));
  assert.ok(!calls.slice(before).some((c) => c.path.endsWith('/clips') || c.path.endsWith('/chat/shoutouts')));
  const { events } = await (await overlay(new Request(BASE + '/api/overlay?since=' + encodeURIComponent(cur)))).json();
  assert.equal(events.find((e) => e.type === 'raid').clip, null);
  await admin(adminReq('PUT', 'settings', { raidClip: true, raidShoutout: true }, cookie));
});

await test('Raid-Test im Admin nutzt echte Kanaldaten, löst aber keinen Shoutout aus', async () => {
  const before = calls.length;
  const res = await admin(adminReq('POST', 'test', { target: 'raid', raider: 'RaiderIn', count: 9 }, cookie));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).clip, 'Krasser Moment');
  assert.ok(!calls.slice(before).some((c) => c.path.endsWith('/chat/shoutouts')));
  assert.equal((await admin(adminReq('POST', 'test', { target: 'raid-chat', raider: 'RaiderIn' }, cookie))).status, 200);
});

await test('Raid: zählt, wie oft der Kanal schon geraidet hat, im Chat und im Overlay', async () => {
  assert.equal((await db.get('raid/777')).count, 9, 'alle neun eingegangenen Raids zählen, auch zu kleine und bei ausgeschalteter Reaktion');
  const cur = await cursor();
  await webhook(signed('notification', raidEvent(20), { id: 'raid-count-1' }));
  assert.equal((await db.get('raid/777')).count, 10);
  assert.match(chats().at(-1), /schon zum 10\. Mal bei uns/);
  assert.equal((await eventsSince(cur)).find((e) => e.type === 'raid').raids, 10);
});

await test('Raid: Erster Raid heißt „zum ersten Mal“, Nachtragen im Admin und Test ändern keine Zähler', async () => {
  const { visitText } = await import('../netlify/lib/raid.mjs');
  assert.equal(visitText(1), 'zum ersten Mal bei uns');
  assert.equal((await admin(adminReq('POST', 'raids', { login: 'RaiderIn', count: 10 }, cookie))).status, 200);
  assert.equal((await db.get('raid/777')).count, 10);
  assert.equal((await admin(adminReq('POST', 'raids', { login: 'x', count: -1 }, cookie))).status, 400);
  const cur = await cursor();
  await admin(adminReq('POST', 'test', { target: 'raid', raider: 'RaiderIn' }, cookie));
  assert.equal((await db.get('raid/777')).count, 10);
  assert.equal((await eventsSince(cur)).find((e) => e.type === 'raid').raids, 11, 'Test zeigt den nächsten Stand');
  const list = await (await admin(adminReq('GET', 'raids', null, cookie))).json();
  assert.equal(list[0].count, 10);
});

// ---- Schild-Texte, Bilder, Anzeigedauern
await test('Schild-Texte und Dauern: anpassbar, Nachricht darf leer sein, Raid-Karte bringt Texte mit', async () => {
  const saved = await (await admin(adminReq('PUT', 'settings', { followMessage: 'Schön, dass du da bist', subTitle: 'Neuer Held!', raidMessage: '', alertDuration: 99_999, raidDuration: 12000 }, cookie))).json();
  assert.equal(saved.followMessage, 'Schön, dass du da bist');
  assert.equal(saved.raidMessage, '', 'leere Nachricht wird gespeichert');
  assert.equal(saved.alertDuration, 30_000, 'Dauer wird begrenzt');
  const poll = await (await overlay(new Request(BASE + '/api/overlay'))).json();
  assert.equal(poll.alertDuration, 30_000); assert.equal(poll.raidDuration, 12_000);
  const cur = await cursor();
  await admin(adminReq('POST', 'test', { target: 'raid', raider: 'RaiderIn', count: 9 }, cookie));
  const raid = (await eventsSince(cur)).find((e) => e.type === 'raid');
  assert.deepEqual([raid.title, raid.message], ['Raid-Alarm!', '']);
  assert.match(raid.extra, /^zuletzt: Hades · \d+\. Mal bei uns$/);
  await admin(adminReq('PUT', 'settings', { followMessage: '', subTitle: 'Neues Abo!', raidMessage: 'Bringt {viewers} Leute mit!', alertDuration: 8000, raidDuration: 11000 }, cookie));
});

await test('Alert-Bilder: Upload je Platz mit Typprüfung, Auslieferung, Overlay-Liste, Zurücksetzen', async () => {
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30)]);
  const up = (slot, buf, name = 'lama.gif') => admin(adminReq('POST', 'image', { slot, name, data: buf.toString('base64') }, cookie));
  assert.equal((await up('quatsch', gif)).status, 400);
  assert.equal((await up('follow', Buffer.from('<svg onload=alert(1)>'))).status, 400, 'nur echte Bilder');
  assert.equal((await up('follow', Buffer.alloc(3_100_000, 1))).status, 413);
  const r = await (await up('follow', gif, 'f<o>llow.gif')).json();
  assert.equal(r.images.follow.name, 'follow.gif');
  await up('raid', Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG'), Buffer.alloc(20)]), 'raid.png');
  const poll = await (await overlay(new Request(BASE + '/api/overlay'))).json();
  assert.deepEqual(Object.keys(poll.images).sort(), ['follow', 'raid']);
  const served = await image(new Request(BASE + poll.images.follow));
  assert.equal(served.headers.get('content-type'), 'image/gif');
  assert.equal((await image(new Request(BASE + '/api/image?slot=cheer'))).status, 404);
  assert.equal((await admin(adminReq('PUT', 'settings', { volume: 0.5 }, cookie)).then((x) => x.json())).images.follow.name, 'follow.gif', 'Einstellungen speichern lässt Bilder unberührt');
  assert.equal((await (await admin(adminReq('DELETE', 'image', { slot: 'follow' }, cookie))).json()).images.follow, undefined);
  await admin(adminReq('DELETE', 'image', { slot: 'raid' }, cookie));
  assert.deepEqual((await (await overlay(new Request(BASE + '/api/overlay'))).json()).images, {});
});

// ---- Streak, Meilensteine, Streak-Retter
const D = (n) => `2030-01-${String(n).padStart(2, '0')}`; // Stream-Tag n im Januar 2030
const allDays = Array.from({ length: 12 }, (_, i) => D(i + 1));

await test('Streak: Schonfrist verzeiht einen verpassten Stream, zwei reißen sie, Rekord bleibt, heute zählt erst nach Ende', async () => {
  const run = (days, saved, today = D(12), grace = 1) => computeStreak({ days, saved }, allDays, today, grace);
  assert.deepEqual(run(allDays.slice(0, 5), [], D(5)), { current: 5, record: 5 });
  assert.deepEqual(run([D(1), D(2), D(3), D(5), D(6)], [], D(6)), { current: 5, record: 5 }, 'ein verpasster Stream wird verziehen, zählt aber nicht mit');
  assert.deepEqual(run([D(1), D(2), D(3), D(6), D(7)], [], D(7)), { current: 2, record: 3 }, 'zwei verpasste reißen, Rekord 3 bleibt');
  assert.deepEqual(run([D(1), D(2), D(3)], [], D(5)), { current: 3, record: 3 }, 'zwei verpasste seit D3 aber noch nicht gerissen: nur D4 ist vorbei');
  assert.deepEqual(run([D(1), D(2), D(3)], [], D(6)), { current: 0, record: 3 }, 'D4 und D5 verpasst');
  assert.deepEqual(run([D(1), D(2), D(3)], [], D(4)), { current: 3, record: 3 }, 'heute noch nicht eingecheckt ist kein Fehltag');
  assert.deepEqual(run([D(1), D(2), D(3), D(6), D(7)], [D(4), D(5)], D(7)), { current: 5, record: 5 }, 'gerettete Tage überbrücken');
  assert.deepEqual(run([D(1), D(3)], [], D(3), 0), { current: 1, record: 1 }, 'ohne Schonfrist reißt jeder verpasste Stream');
});

await test('Streak-Retter: findet nur die jüngste, rettbare Lücke', async () => {
  const f = (days, saved, today, max = 3) => findRescue({ days, saved }, allDays, today, 1, max);
  assert.deepEqual(f([D(1), D(2), D(3), D(6), D(7)], [], D(8)), { status: 'ok', days: [D(4), D(5)] });
  assert.equal(f([D(1), D(2), D(3), D(4)], [], D(5)).status, 'none', 'nichts verpasst');
  assert.equal(f([D(1), D(2), D(4)], [], D(5)).status, 'none', 'ein Stream ist verziehen, kein Retter nötig');
  assert.equal(f([D(1), D(7)], [], D(8)).status, 'toolong', 'fünf verpasste sind mehr als drei');
  assert.equal(f([D(1), D(2), D(3), D(6), D(7)], [D(4), D(5)], D(8)).status, 'none', 'schon gerettet');
  assert.deepEqual(parseLevels('10, 25;50 abc -3 25'), [10, 25, 50]);
});

await test('Meilenstein: bei der eingestellten Zahl eigene Karte und eigener Chattext, sonst normal', async () => {
  await admin(adminReq('PUT', 'settings', { milestoneLevels: '3,10' }, cookie));
  await db.set('user/40', { name: 'Treu', count: 2, first: '2030-01-01T10:00:00Z', last: '2030-01-02T10:00:00Z', days: ['2030-01-01', '2030-01-02'] });
  const cur = await cursor();
  await webhook(signed('notification', redemption('m1', '40', 'Treu')));
  const ev = (await eventsSince(cur)).find((e) => e.type === 'checkin');
  assert.equal(ev.milestone, true);
  assert.equal(ev.count, 3);
  assert.match(chats().at(-1), /🏆 Treu ist zum 3\. Mal dabei/);
  const cur2 = await cursor();
  await webhook(signed('notification', redemption('m2', '41', 'Neu')));
  assert.equal((await eventsSince(cur2)).find((e) => e.type === 'checkin').milestone, false);
  assert.match(chats().at(-1), /Hi Neu #1/);
  await admin(adminReq('PUT', 'settings', { milestoneEnabled: false }, cookie));
  await db.set('user/42', { name: 'Aus', count: 2, first: 'x', last: 'x', days: ['2030-01-01', '2030-01-02'] });
  const cur3 = await cursor();
  await webhook(signed('notification', redemption('m3', '42', 'Aus')));
  assert.equal((await eventsSince(cur3)).find((e) => e.type === 'checkin').milestone, false, 'ausgeschaltet');
  await admin(adminReq('PUT', 'settings', { milestoneEnabled: true }, cookie));
});

await test('Streak-Retter-Einlösung: rettet die Lücke einmalig, sonst Hinweis und Punkte zurück', async () => {
  // Stream-Tage 2031-03-01 bis -08, Person war an 1, 2, 3 und 8 da (4 bis 7 fehlen): zu lang für 3
  const sd = (n) => `2031-03-0${n}`;
  for (let n = 1; n <= 8; n++) await db.setIfNew(`streamday/${sd(n)}`, 1);
  await db.set('user/50', { name: 'Retter', count: 4, first: 'x', last: 'x', days: [sd(1), sd(2), sd(3), sd(8)] });
  const status = () => calls.filter((c) => c.path.endsWith('/redemptions')).at(-1).body.status;
  const day = (n) => new Date(`2031-03-0${n}T12:00:00+01:00`);
  const { handleRescue } = await import('../netlify/lib/checkin.mjs');
  const rd = (id) => ({ id, user_id: '50', user_name: 'Retter', reward: { id: 'reward3' } });

  let r = await handleRescue(rd('s1'), await getSettings(), day(9));
  assert.equal(r.ok, false);
  assert.equal(status(), 'CANCELED');
  assert.match(chats().at(-1), /zu lang oder zu lange her/);

  await db.set('user/50', { name: 'Retter', count: 4, first: 'x', last: 'x', days: [sd(1), sd(2), sd(3), sd(6), sd(7), sd(8)] }); // nur 4 und 5 fehlen
  const cur = await cursor();
  r = await handleRescue(rd('s2'), await getSettings(), day(9));
  assert.deepEqual([r.ok, r.saved], [true, 2]);
  assert.equal(status(), 'FULFILLED');
  assert.deepEqual((await db.get('user/50')).saved, [sd(4), sd(5)]);
  assert.match(chats().at(-1), /Retter rettet die Streak! 2 verpasste/);
  assert.equal((await eventsSince(cur)).find((e) => e.type === 'alert').kind, 'rescue');

  r = await handleRescue(rd('s3'), await getSettings(), day(9));
  assert.equal(r.ok, false, 'dieselbe Lücke nicht zweimal');
  assert.match(chats().at(-1), /nicht in Gefahr/);
  assert.equal(status(), 'CANCELED');
});

await test('Streak-Retter über den Webhook: nutzt die Reward-ID aus dem Setup', async () => {
  const before = calls.length;
  await db.set('user/51', { name: 'Neuling', count: 1, first: 'x', last: 'x', days: [D(1)] });
  assert.equal((await webhook(signed('notification', redemption('hook-s1', '51', 'Neuling', 'reward3')))).status, 204);
  assert.ok(calls.slice(before).some((c) => c.path.endsWith('/redemptions') && c.body.status === 'CANCELED'), 'nicht nötig: Punkte zurück');
  assert.equal(await db.get('seen/hook-s1') !== null, true);
});

await test('Admin: Nutzerliste zeigt Streak und Rekord, Einstellungen bereinigen Meilenstein-Stufen', async () => {
  const users = await (await admin(adminReq('GET', 'users', null, cookie))).json();
  assert.ok(users.every((u) => Number.isInteger(u.streak) && Number.isInteger(u.record)));
  const saved = await (await admin(adminReq('PUT', 'settings', { milestoneLevels: '100, 5 ,abc, 5, 0, 50', streakGrace: 99 }, cookie))).json();
  assert.equal(saved.milestoneLevels, '5,50,100');
  assert.equal(saved.streakGrace, 5);
  await admin(adminReq('PUT', 'settings', { milestoneLevels: '10,25,50,100,250,500,1000', streakGrace: 1 }, cookie));
  const cur = await cursor();
  assert.equal((await admin(adminReq('POST', 'test', { target: 'milestone', user: 'T', count: 100 }, cookie))).status, 200);
  assert.equal((await eventsSince(cur)).find((e) => e.type === 'checkin').milestone, true);
});

// ---- Alerts
const alertEvent = (type, event) => ({ subscription: { type }, event: { user_name: 'Fan', ...event } });
let alertN = 0;
const sendAlert = async (type, event) => {
  const cur = await cursor();
  assert.equal((await webhook(signed('notification', alertEvent(type, event), { id: 'alert-' + alertN++ }))).status, 204);
  return (await eventsSince(cur)).filter((e) => e.type === 'alert');
};

await test('Alerts: standardmäßig aus, nichts im Overlay', async () => {
  assert.equal((await getSettings()).alertsEnabled, false);
  assert.deepEqual(await sendAlert('channel.follow', {}), []);
});

await test('Setup abonniert Alert-Events mit richtiger Version und Bedingung', async () => {
  await admin(adminReq('PUT', 'settings', { alertsEnabled: true }, cookie));
  assert.equal((await admin(adminReq('POST', 'setup', {}, cookie))).status, 200);
  const created = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/eventsub/subscriptions')).slice(-6);
  const follow = created.find((c) => c.body.type === 'channel.follow');
  assert.equal(follow.body.version, '2');
  assert.deepEqual(follow.body.condition, { broadcaster_user_id: '999', moderator_user_id: '999' });
  for (const t of ['channel.subscribe', 'channel.subscription.message', 'channel.subscription.gift', 'channel.cheer']) {
    assert.deepEqual(created.find((c) => c.body.type === t).body.condition, { broadcaster_user_id: '999' }, t);
  }
  assert.equal(subs.length, 9);
});

await test('Alerts: Follow, Sub, Resub, Gift und Bits erzeugen die richtigen Karten', async () => {
  assert.deepEqual(await sendAlert('channel.follow', {}), [{ type: 'alert', kind: 'follow', user: 'Fan', title: 'Neuer Follower!', message: '' }]);
  const [sub] = await sendAlert('channel.subscribe', { tier: '1000', is_gift: false });
  assert.equal(sub.kind, 'sub'); assert.equal(sub.tier, 'Stufe 1');
  assert.deepEqual([sub.title, sub.message], ['Neues Abo!', 'Tier 1 (1 Monate)'], 'Schild-Texte wie im alten Meld-Alert');
  const [resub] = await sendAlert('channel.subscription.message', { tier: '2000', cumulative_months: 9, message: { text: 'Weiter so!' } });
  assert.deepEqual([resub.kind, resub.months, resub.tier, resub.extra, resub.message], ['resub', 9, 'Stufe 2', 'Weiter so!', 'Tier 2 (9 Monate)']);
  const [gift] = await sendAlert('channel.subscription.gift', { tier: '1000', total: 5, is_anonymous: true, user_name: null });
  assert.deepEqual([gift.kind, gift.total, gift.user, gift.message], ['gift', 5, 'Anonym', 'verschenkt 5 Sub(s)!']);
  const [cheer] = await sendAlert('channel.cheer', { bits: 250, message: 'Cheer250 hi' });
  assert.deepEqual([cheer.kind, cheer.bits, cheer.extra, cheer.message, cheer.title], ['cheer', 250, 'Cheer250 hi', '250 Bits', 'Neuer Cheer!']);
});

await test('Alerts: geschenkter Sub zählt nicht doppelt, Schalter und Mindest-Bits wirken, Wiederholung nur einmal', async () => {
  assert.deepEqual(await sendAlert('channel.subscribe', { tier: '1000', is_gift: true }), []);
  await admin(adminReq('PUT', 'settings', { alertCheerMin: 100, alertGift: false }, cookie));
  assert.deepEqual(await sendAlert('channel.cheer', { bits: 50 }), [], 'unter Mindestwert');
  assert.deepEqual(await sendAlert('channel.subscription.gift', { total: 2 }), [], 'Gift ausgeschaltet');
  const cur = await cursor();
  const dup = signed('notification', alertEvent('channel.follow', {}), { id: 'dup-1' });
  const dup2 = signed('notification', alertEvent('channel.follow', {}), { id: 'dup-1' });
  await webhook(dup); await webhook(dup2);
  assert.equal((await eventsSince(cur)).filter((e) => e.type === 'alert').length, 1);
  await admin(adminReq('PUT', 'settings', { alertCheerMin: 1, alertGift: true }, cookie));
});

await test('Alerts: Chat-Dank nur wenn eingeschaltet; Admin-Test erzeugt Karten', async () => {
  const n = chats().length;
  await sendAlert('channel.follow', {});
  assert.equal(chats().length, n);
  await admin(adminReq('PUT', 'settings', { alertChat: true }, cookie));
  await sendAlert('channel.subscription.gift', { total: 3, user_name: 'Gönner' });
  assert.match(chats().at(-1), /Gönner verschenkt 3 Sub/);
  await admin(adminReq('PUT', 'settings', { alertChat: false, alertsEnabled: false }, cookie));
  const cur = await cursor();
  assert.equal((await admin(adminReq('POST', 'test', { target: 'alert-cheer', user: 'Tester', count: 7 }, cookie))).status, 200);
  assert.equal((await admin(adminReq('POST', 'test', { target: 'alert-quatsch' }, cookie))).status, 400);
  const [card] = (await eventsSince(cur)).filter((e) => e.type === 'alert');
  assert.deepEqual([card.kind, card.user, card.bits], ['cheer', 'Tester', 70]);
});

// ---- Kanalpunkte-Soundboard
await test('Soundboard: Einträge anlegen, bereinigen und begrenzen, Namen müssen eindeutig sein', async () => {
  const add = (b) => admin(adminReq('POST', 'soundboard', b, cookie));
  assert.equal((await add({ cost: 100 })).status, 400, 'ohne Namen');
  const airhorn = await (await add({ title: '  Airhorn  ', cost: 99_999_999, cooldown: -5, volume: 7 })).json();
  assert.deepEqual([airhorn.title, airhorn.cost, airhorn.cooldown, airhorn.volume, airhorn.enabled, airhorn.soundVersion], ['Airhorn', 1_000_000, 0, 1, true, null]);
  assert.equal((await add({ title: 'Airhorn' })).status, 400, 'doppelter Name');
  const boo = await (await add({ title: 'Buh!', cost: 150, cooldown: 60, volume: 0.5 })).json();
  assert.deepEqual([boo.cost, boo.cooldown, boo.volume], [150, 60, 0.5]);
  assert.equal((await admin(adminReq('PUT', `soundboard/${boo.id}`, { title: 'Airhorn' }, cookie))).status, 400, 'Umbenennen auf vergebenen Namen');
  const ok = await (await admin(adminReq('PUT', `soundboard/${boo.id}`, { cost: 250, volume: 0.01 }, cookie))).json();
  assert.deepEqual([ok.cost, ok.volume], [250, 0.1], 'Lautstärke wird auf 0,1 angehoben');
  assert.equal((await admin(adminReq('PUT', 'soundboard/zzzzzzzz', { cost: 1 }, cookie))).status, 404);
  for (let i = 0; i < 18; i++) assert.equal((await add({ title: 'Füller ' + i })).status, 200);
  assert.equal((await add({ title: 'Einer zu viel' })).status, 400, 'Obergrenze 20');
  for (const e of (await (await admin(adminReq('GET', 'soundboard', null, cookie))).json()).filter((x) => x.title.startsWith('Füller'))) await admin(adminReq('DELETE', `soundboard/${e.id}`, {}, cookie));
  assert.equal((await (await admin(adminReq('GET', 'soundboard', null, cookie))).json()).length, 2);
});

await test('Soundboard: Upload mit Typprüfung, Auslieferung und Liste nur für aktive Töne', async () => {
  const list = await (await admin(adminReq('GET', 'soundboard', null, cookie))).json();
  const [air, boo] = [list.find((e) => e.title === 'Airhorn'), list.find((e) => e.title === 'Buh!')];
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVE'), Buffer.alloc(40)]);
  const up = (id, buf, name = 'horn.wav') => admin(adminReq('POST', `soundboard/${id}/sound`, { name, data: buf.toString('base64') }, cookie));
  assert.equal((await up(air.id, Buffer.from('<html>böse</html>'))).status, 400, 'nur Audio');
  assert.equal((await up(air.id, Buffer.alloc(1_600_000, 1))).status, 413);
  const r = await (await up(air.id, wav, 'h<o>rn.wav')).json();
  assert.equal(r.soundName, 'horn.wav');
  assert.ok(r.soundVersion);
  assert.deepEqual(await (await board(new Request(BASE + '/api/soundboard'))).json(), { [air.id]: `/api/soundboard?id=${air.id}&v=${r.soundVersion}` }, 'Buh! hat noch keinen Ton');
  const served = await board(new Request(BASE + `/api/soundboard?id=${air.id}&v=1`));
  assert.equal(served.headers.get('content-type'), 'audio/wav');
  assert.equal((await board(new Request(BASE + `/api/soundboard?id=${boo.id}`))).status, 404);
  assert.equal((await board(new Request(BASE + '/api/soundboard?id=../../x'))).status, 404);
});

await test('Soundboard: Einrichten legt Rewards mit Abklingzeit an und abonniert nur Einträge mit Ton', async () => {
  const list = await (await admin(adminReq('GET', 'soundboard', null, cookie))).json();
  const air = list.find((e) => e.title === 'Airhorn');
  await admin(adminReq('PUT', `soundboard/${air.id}`, { cost: 300, cooldown: 120 }, cookie));
  const res = await admin(adminReq('POST', 'setup', {}, cookie));
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).soundboard, 1);
  const reward = rewards.find((r) => r.title === 'Airhorn');
  assert.deepEqual([reward.cost, reward.is_enabled, reward.global_cooldown_setting], [300, true, { is_enabled: true, global_cooldown_seconds: 120 }]);
  assert.equal(rewards.find((r) => r.title === 'Buh!'), undefined, 'ohne Ton wird nichts angelegt');
  const saved = (await (await admin(adminReq('GET', 'soundboard', null, cookie))).json()).find((e) => e.id === air.id);
  assert.equal(saved.rewardId, reward.id);
  assert.ok(subs.some((x) => x.condition.reward_id === reward.id), 'Webhook für den Reward');
  assert.equal(subs.filter((x) => x.condition.reward_id).length, 4, 'Check-in, Check-out, Streak-Retter und Airhorn');
  const state = await (await admin(adminReq('GET', 'state', null, cookie))).json();
  assert.ok(state.subscription !== 'unvollständig – bitte neu einrichten', 'Status zählt den Soundboard-Webhook mit');
  const sameTitle = await (await admin(adminReq('POST', 'soundboard', { title: 'Check-in' }, cookie))).json();
  assert.equal((await admin(adminReq('POST', 'setup', {}, cookie))).status, 400, 'Name wie ein anderer Reward');
  await admin(adminReq('DELETE', `soundboard/${sameTitle.id}`, {}, cookie));
});

await test('Soundboard: Einlösung spielt den Sound im Overlay, schließt ab und schreibt nur auf Wunsch in den Chat', async () => {
  const air = (await (await admin(adminReq('GET', 'soundboard', null, cookie))).json()).find((e) => e.title === 'Airhorn');
  const status = () => calls.filter((c) => c.path.endsWith('/redemptions')).at(-1).body.status;
  const cur = await cursor(); const n = chats().length;
  assert.equal((await webhook(signed('notification', redemption('sb1', '7', 'Hörer', air.rewardId)))).status, 204);
  const ev = (await eventsSince(cur)).find((e) => e.type === 'sound');
  assert.deepEqual([ev.id, ev.user, ev.title, ev.volume], [air.id, 'Hörer', 'Airhorn', 1]);
  assert.match(ev.src, new RegExp(`^/api/soundboard\\?id=${air.id}&v=\\d+$`));
  assert.equal(status(), 'FULFILLED');
  assert.equal(chats().length, n, 'Chat ist aus');
  await admin(adminReq('PUT', 'settings', { soundboardChat: true, soundboardTemplate: '🔊 {user} spielt „{title}“' }, cookie));
  await webhook(signed('notification', redemption('sb2', '7', 'Hörer', air.rewardId)));
  assert.equal(chats().at(-1), '🔊 Hörer spielt „Airhorn“');
  await admin(adminReq('PUT', 'settings', { soundboardChat: false }, cookie));
  assert.equal(await db.get('user/7'), null, 'ein Soundboard-Reward zählt nicht als Check-in');
  await webhook(signed('notification', redemption('sb3', '7', 'Hörer', 'rewardFremd')));
  assert.equal((await eventsSince(cur)).filter((e) => e.type === 'sound').length, 2, 'fremder Reward wird ignoriert');
});

await test('Soundboard: ausgeschalteter Eintrag wird in Twitch deaktiviert, Einlösung bekommt Punkte zurück; Test im Admin; Löschen räumt auf', async () => {
  const air = (await (await admin(adminReq('GET', 'soundboard', null, cookie))).json()).find((e) => e.title === 'Airhorn');
  const cur = await cursor();
  assert.equal((await admin(adminReq('POST', 'test', { target: 'soundboard', id: air.id, user: 'Tester' }, cookie))).status, 200);
  assert.equal((await eventsSince(cur)).find((e) => e.type === 'sound').user, 'Tester');
  await admin(adminReq('PUT', `soundboard/${air.id}`, { enabled: false }, cookie));
  await admin(adminReq('POST', 'setup', {}, cookie));
  assert.equal(rewards.find((r) => r.id === air.rewardId).is_enabled, false, 'in Twitch ausgeschaltet');
  assert.deepEqual(await (await board(new Request(BASE + '/api/soundboard'))).json(), {}, 'nicht mehr in der Overlay-Liste');
  const n = (await eventsSince(cur)).filter((e) => e.type === 'sound').length;
  await webhook(signed('notification', redemption('sb4', '7', 'Hörer', air.rewardId)));
  assert.equal(calls.filter((c) => c.path.endsWith('/redemptions')).at(-1).body.status, 'CANCELED');
  assert.equal((await eventsSince(cur)).filter((e) => e.type === 'sound').length, n, 'kein Sound');
  const before = calls.length;
  assert.equal((await (await admin(adminReq('DELETE', `soundboard/${air.id}`, {}, cookie))).json()).ok, true);
  assert.ok(calls.slice(before).some((c) => c.method === 'DELETE' && c.path.endsWith('/custom_rewards') && c.query.id === air.rewardId), 'Reward in Twitch gelöscht');
  assert.equal(await db.get(`soundboard/${air.id}`), null);
  assert.equal((await board(new Request(BASE + `/api/soundboard?id=${air.id}`))).status, 404);
});

await test('Backup: Download ohne Tokens, Restore stellt Stand wieder her und lehnt Fremddateien ab', async () => {
  const res = await admin(adminReq('GET', 'backup', null, cookie));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /stadtwache-backup-\d{4}-\d{2}-\d{2}\.json/);
  const file = await res.json();
  const keys = Object.keys(file.entries);
  assert.ok(keys.some((k) => k.startsWith('user/')) && keys.includes('config/settings'), 'Besucher und Einstellungen enthalten');
  assert.ok(!keys.includes('config/tokens') && !keys.some((k) => k.startsWith('event/') || k.startsWith('seen/')), 'keine Tokens und kein Kurzlebiges');
  assert.ok(!keys.some((k) => k.startsWith('sound/') || k.startsWith('image/') || k.startsWith('soundboard/')), 'ohne ?media=1 keine Medien');

  const userKey = keys.find((k) => k.startsWith('user/'));
  const before = await db.get(userKey);
  await db.delete(userKey);
  await db.set('user/fremd', { name: 'Neu', count: 1, days: ['2020-01-01'] });
  const tokens = await db.get('config/tokens');

  assert.equal((await admin(adminReq('POST', 'backup', { backup: { format: 'anderes' }, confirm: true }, cookie))).status, 400, 'Fremddatei');
  assert.equal((await admin(adminReq('POST', 'backup', { backup: file }, cookie))).status, 400, 'ohne Bestätigung');
  const r = await (await admin(adminReq('POST', 'backup', { backup: file, confirm: true }, cookie))).json();
  assert.equal(r.ok, true);
  assert.deepEqual(await db.get(userKey), before, 'gelöschter Nutzer ist zurück');
  assert.equal(await db.get('user/fremd'), null, 'Neueres wird durch den gesicherten Stand ersetzt');
  assert.deepEqual(await db.get('config/tokens'), tokens, 'Twitch-Verbindung bleibt unberührt');

  await db.set('sound/raid', { type: 'audio/wav', data: 'UklGRg==' });
  const withMedia = await (await admin(adminReq('GET', 'backup?media=1', null, cookie))).json();
  assert.equal(withMedia.media, true);
  assert.ok(withMedia.entries['sound/raid'], 'Medien enthalten');
  // Verweise auf fehlende Dateien werden beim Einspielen entfernt (hier: Ton-Hinweis ohne Datei)
  await db.set('config/settings', { ...(await db.get('config/settings')), sounds: { follow: { name: 'weg.wav', version: 1 } } });
  const plain = await (await admin(adminReq('GET', 'backup', null, cookie))).json();
  await admin(adminReq('POST', 'backup', { backup: plain, confirm: true }, cookie));
  assert.equal((await db.get('config/settings')).sounds?.follow, undefined, 'Verweis ohne Datei bereinigt');
});

fs.rmSync(process.env.LOCAL_STORE_DIR, { recursive: true, force: true });
console.log(`\n${n} Tests bestanden`);
