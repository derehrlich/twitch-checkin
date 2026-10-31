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
let clipDb = []; // Clips, die der simulierte Twitch einzeln (per id) herausgibt
let subs = []; // aktive Webhook-Subscriptions
const failSubTypes = new Set(); // Typen, deren Abo der simulierte Twitch mit 403 ablehnt
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
  if (u.pathname.endsWith('/helix/clips') && entry.query.id) return ok({ data: clipDb.filter((c) => c.id === entry.query.id) });
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
    if (failSubTypes.has(entry.body.type)) return ok({ error: 'Forbidden', status: 403, message: 'subscription missing proper authorization' }, 403);
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

// Abspann und Chat-Befehle haben eigene Tests weiter unten; die älteren Tests rechnen ohne ihre zusätzlichen Webhooks
await admin(adminReq('PUT', 'settings', { creditsEnabled: false, chatCommands: false, chatStats: false }, cookie));

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
  await db.set('config/tokens', { ...(await db.get('config/tokens')), scopes: ['channel:read:redemptions', 'channel:manage:redemptions', 'user:write:chat', 'moderator:manage:shoutouts', 'moderator:read:followers', 'channel:read:subscriptions', 'bits:read', 'user:read:chat', 'user:bot', 'channel:bot'] });
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

// ---- Blobs-Token
await test('Speicher: Blobs-Client entsteht bei jedem Zugriff neu, ein abgelaufenes Token einer alten Umgebung schadet nicht', async () => {
  const { createBlobStore } = await import('../netlify/lib/store.mjs');
  // Simuliert die Plattform: jeder neu angelegte Client bekommt das gerade gültige Token, ein früher angelegter läuft ab
  let currentToken = 'token-1'; let opened = 0; const data = new Map();
  const fakeOpen = () => {
    opened++; const token = currentToken;
    const check = () => { if (token !== currentToken) { const e = new Error('Netlify Blobs has generated an internal error (Failed to decode token: Token expired)'); e.status = 401; throw e; } };
    return {
      async get(k) { check(); return data.get(k) ?? null; },
      async setJSON(k, v, o = {}) { check(); if (o.onlyIfNew && data.has(k)) return { modified: false }; data.set(k, v); return { modified: true }; },
      async delete(k) { check(); data.delete(k); },
      list() { check(); const blobs = [...data.keys()].map((key) => ({ key })); return (async function* () { yield { blobs }; })(); },
    };
  };
  const store = createBlobStore('x', fakeOpen);
  await store.set('a/1', { n: 1 });
  currentToken = 'token-2'; // das Token der Umgebung läuft ab und wird erneuert
  assert.deepEqual(await store.get('a/1'), { n: 1 }, 'lesen mit neuem Token');
  assert.equal(await store.setIfNew('a/2', 1), true);
  currentToken = 'token-3';
  assert.deepEqual(await store.list('a/'), ['a/1', 'a/2']);
  await store.delete('a/1');
  assert.equal(await store.get('a/1'), null);
  assert.ok(opened >= 6, 'je Zugriff ein neuer Client: ' + opened);
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

// ---- Chat-Befehle, Abspann, Rangliste
const credits = (await import('../netlify/functions/credits.mjs')).default;
const leaderboard = (await import('../netlify/functions/leaderboard.mjs')).default;
const day0 = streamDay(await getSettings());
let chatN = 0;
const chatMsg = async (text, id = 'c1', name = 'Chatty') => {
  const before = chats().length;
  const ev = { subscription: { type: 'channel.chat.message' }, event: { broadcaster_user_id: '999', chatter_user_id: id, chatter_user_name: name, message_id: 'msg-' + chatN, message: { text } } };
  assert.equal((await webhook(signed('notification', ev, { id: 'chat-' + chatN++ }))).status, 204);
  return chats().slice(before);
};

await test('Setup abonniert Chat, Follows, Subs, Bits und Raids auch bei ausgeschalteten Alerts, sobald Abspann oder Befehle laufen', async () => {
  await admin(adminReq('PUT', 'settings', { creditsEnabled: true, chatCommands: true, alertsEnabled: false, raidEnabled: false }, cookie));
  assert.equal((await admin(adminReq('POST', 'setup', {}, cookie))).status, 200);
  const created = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/eventsub/subscriptions')).slice(-10);
  assert.deepEqual(created.find((c) => c.body.type === 'channel.chat.message').body.condition, { broadcaster_user_id: '999', user_id: '999' });
  for (const t of ['channel.follow', 'channel.subscribe', 'channel.subscription.gift', 'channel.cheer', 'channel.raid']) assert.ok(created.some((c) => c.body.type === t), t);
  assert.equal(subs.length, 10);
  await admin(adminReq('PUT', 'settings', { raidEnabled: true }, cookie));
});

await test('Setup: fehlt eine Berechtigung oder lehnt Twitch ein Zusatz-Abo ab, laufen die übrigen Webhooks trotzdem und die Meldung nennt den Grund', async () => {
  const tokens = await db.get('config/tokens');
  // 1) Token ohne Chat-Berechtigung (Verbindung stammt aus der Zeit vor dem Update)
  await db.set('config/tokens', { ...tokens, scopes: tokens.scopes.filter((sc) => sc !== 'user:read:chat') });
  let r = await (await admin(adminReq('POST', 'setup', {}, cookie))).json();
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Chat.*Berechtigung user:read:chat fehlt.*Mit Twitch verbinden/);
  // Auch user:bot und channel:bot sind für den Chat-Webhook nötig (Twitch verlangt sie bei App-Token)
  await db.set('config/tokens', { ...tokens, scopes: tokens.scopes.filter((sc) => !['user:bot', 'channel:bot'].includes(sc)) });
  const bot = await (await admin(adminReq('POST', 'setup', {}, cookie))).json();
  assert.match(bot.warnings[0], /user:bot, channel:bot fehlt/);
  await db.set('config/tokens', { ...tokens, scopes: tokens.scopes.filter((sc) => sc !== 'user:read:chat') });
  const created = () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/eventsub/subscriptions'));
  assert.ok(!created().slice(-9).some((c) => c.body.type === 'channel.chat.message'), 'kein Chat-Abo ohne Berechtigung');
  assert.ok(created().slice(-9).some((c) => c.body.type === 'channel.cheer'), 'Alerts-Abos wurden trotzdem angelegt');
  // 2) Twitch lehnt ein einzelnes Abo mit 403 ab
  await db.set('config/tokens', tokens);
  failSubTypes.add('channel.follow');
  r = await (await admin(adminReq('POST', 'setup', {}, cookie))).json();
  failSubTypes.clear();
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(' '), /Follows: Twitch hat das Abo abgelehnt \(403\) – vermutlich fehlt moderator:read:followers/);
  assert.ok(created().slice(-10).some((c) => c.body.type === 'channel.chat.message'), 'Chat-Abo trotzdem angelegt');
  // 3) alles in Ordnung: keine Meldungen
  r = await (await admin(adminReq('POST', 'setup', {}, cookie))).json();
  assert.equal(r.warnings, undefined);
  assert.equal(subs.length, 10);
});

await test('Chat: Chatter werden einmal pro Tag gemerkt, normale Nachrichten bleiben unbeantwortet', async () => {
  assert.deepEqual(await chatMsg('Hallo zusammen'), []);
  await chatMsg('noch eine');
  await chatMsg('hi', 'c2', 'Zweiter');
  assert.deepEqual((await db.list(`chatter/${day0}/`)).sort(), [`chatter/${day0}/c1`, `chatter/${day0}/c2`]);
});

await test('Chat: !streak antwortet mit Besuchen, Streak, Zeit und Platz; unbekannte Nutzer bekommen einen Hinweis', async () => {
  await admin(adminReq('PUT', 'settings', { commandCooldown: 0 }, cookie));
  assert.match((await chatMsg('!streak'))[0], /Chatty, ich habe noch keinen Check-in von dir|Chatty: /);
  await db.set('user/c1', { name: 'Chatty', count: 3, first: 'x', last: 'x', days: [day0], sessions: { [day0]: { in: 'a', out: 'b', minutes: 134 } } });
  const [reply] = await chatMsg('!STREAK');
  assert.match(reply, /^📊 Chatty: 3 Besuche · 🔥 Streak \d+ \(Rekord \d+\) · 2 Std 14 Min im Stream · Platz \d+ von \d+$/);
  assert.deepEqual(await chatMsg('!unbekannt'), []);
});

await test('Chat: !top listet die meisten Besuche, Abklingzeit und Doppelzustellung verhindern Spam', async () => {
  await db.set('user/c9', { name: 'Spitze', count: 999, first: 'x', last: 'x', days: [] });
  const [top] = await chatMsg('!top');
  assert.match(top, /^🏆 Top 5 Stammgäste: 1\. Spitze \(999\) · 2\./);
  await admin(adminReq('PUT', 'settings', { commandCooldown: 60 }, cookie));
  await db.delete('cooldown/!top');
  assert.equal((await chatMsg('!top')).length, 1);
  assert.equal((await chatMsg('!top')).length, 0, 'innerhalb der Abklingzeit keine zweite Antwort');
  const dup = { subscription: { type: 'channel.chat.message' }, event: { chatter_user_id: 'c1', chatter_user_name: 'Chatty', message_id: 'doppelt', message: { text: '!streak' } } };
  await webhook(signed('notification', dup, { id: 'dup-1' }));
  const before = chats().length;
  await webhook(signed('notification', dup, { id: 'dup-2' }));
  assert.equal(chats().length, before, 'dieselbe Nachricht wird nur einmal beantwortet');
  await admin(adminReq('PUT', 'settings', { commandCooldown: 0, chatEnabled: false }, cookie));
  assert.deepEqual(await chatMsg('!top'), [], 'bei ausgeschaltetem Chat schweigt der Bot');
  await admin(adminReq('PUT', 'settings', { chatEnabled: true, commandCooldown: 10 }, cookie));
});

await test('Abspann: sammelt Follows, Subs, Gifts, Bits und Raids auch ohne Alerts, ignoriert Bots und Anonyme', async () => {
  const cur = await cursor();
  const send = async (type, event) => assert.equal((await webhook(signed('notification', alertEvent(type, event), { id: 'cr-' + chatN++ }))).status, 204);
  await send('channel.follow', { user_name: 'Anna' });
  await send('channel.follow', { user_name: 'Bernd' });
  await send('channel.subscribe', { user_name: 'Cora', tier: '1000', is_gift: false });
  await send('channel.subscription.message', { user_name: 'Dirk', tier: '1000', cumulative_months: 12 });
  await send('channel.subscription.gift', { user_name: 'Emil', total: 5, tier: '1000' });
  await send('channel.subscription.gift', { user_name: null, is_anonymous: true, total: 10, tier: '1000' });
  await send('channel.cheer', { user_name: 'Fritz', bits: 100 });
  await send('channel.cheer', { user_name: 'Fritz', bits: 250 });
  await webhook(signed('notification', { subscription: { type: 'channel.raid' }, event: { from_broadcaster_user_id: '55', from_broadcaster_user_name: 'Gerda', viewers: 42 } }, { id: 'cr-raid' }));
  await chatMsg('moin', 'bot1', 'Nightbot');
  assert.deepEqual((await eventsSince(cur)).filter((e) => e.type === 'alert'), [], 'Alerts sind aus, es erscheint nichts im Overlay');

  const res = await credits(new Request(BASE + '/api/credits'));
  const data = await res.json();
  const sec = Object.fromEntries(data.sections.map((x) => [x.key, x.lines]));
  assert.equal(data.day, day0);
  assert.deepEqual(sec.chatters, ['Chatty', 'Zweiter'], 'Nightbot steht nicht im Abspann');
  assert.deepEqual(sec.follows, ['Anna', 'Bernd']);
  assert.deepEqual(sec.subs, ['Cora', 'Dirk (12 Monate)']);
  assert.deepEqual(sec.gifts, ['Emil (5)'], 'anonyme Geschenke werden nicht genannt');
  assert.deepEqual(sec.bits, ['Fritz (350)']);
  assert.deepEqual(sec.raids, ['Gerda (42)']);

  await admin(adminReq('PUT', 'settings', { creditsBits: false, creditsRaids: false }, cookie));
  const slim = Object.fromEntries((await (await credits(new Request(BASE + '/api/credits'))).json()).sections.map((x) => [x.key, 1]));
  assert.ok(!slim.bits && !slim.raids && slim.follows, 'abgeschaltete Abschnitte fehlen');
  assert.deepEqual((await (await credits(new Request(BASE + '/api/credits?day=2001-01-01'))).json()).sections, [], 'anderer Tag ist leer');
  await admin(adminReq('PUT', 'settings', { creditsBits: true, creditsRaids: true }, cookie));
});

await test('Abspann: ohne Einschalten wird nichts gesammelt', async () => {
  await admin(adminReq('PUT', 'settings', { creditsEnabled: false }, cookie)); // chatStats ist hier noch aus
  const before = (await db.list(`log/${day0}/`)).length;
  await webhook(signed('notification', alertEvent('channel.follow', { user_name: 'Heimlich' }), { id: 'cr-off' }));
  await chatMsg('hallo', 'c3', 'Nochjemand');
  assert.equal((await db.list(`log/${day0}/`)).length, before);
  assert.equal(await db.get(`chatter/${day0}/c3`), null);
  await admin(adminReq('PUT', 'settings', { creditsEnabled: true }, cookie));
});

await test('Chat-Zähler: Nachrichten und Chat-Tage je Person, ohne Bots und Kanalinhaber, nur wenn eingeschaltet', async () => {
  await chatMsg('vorher', 'c7', 'Vorher');
  assert.equal(await db.get('chatuser/c7'), null, 'ausgeschaltet zählt nichts');
  await admin(adminReq('PUT', 'settings', { chatStats: true }, cookie));
  await chatMsg('eins', 'c7', 'Vielschreiber'); await chatMsg('zwei', 'c7', 'Vielschreiber'); await chatMsg('drei', 'c7', 'Vielschreiber');
  await chatMsg('hi', 'c8', 'Wenigschreiber');
  await chatMsg('bot', 'bot1', 'Nightbot');
  await chatMsg('ich selbst', '999', 'Streamerin');
  assert.deepEqual(await db.get('chatuser/c7'), { name: 'Vielschreiber', messages: 3, days: 1, lastDay: day0 }, 'drei Nachrichten, aber nur ein Chat-Tag');
  assert.deepEqual(await db.get('chatuser/c8'), { name: 'Wenigschreiber', messages: 1, days: 1, lastDay: day0 });
  assert.equal(await db.get('chatuser/bot1'), null, 'Bots zählen nicht');
  assert.equal(await db.get('chatuser/999'), null, 'der Kanalinhaber zählt nicht');
  // Chat-Webhook wird auch dann abonniert, wenn nur die Zählung läuft
  await admin(adminReq('PUT', 'settings', { creditsEnabled: false, chatCommands: false }, cookie));
  await admin(adminReq('POST', 'setup', {}, cookie));
  assert.ok(subs.some((x) => x.condition.user_id === '999' && x.condition.broadcaster_user_id === '999'), 'channel.chat.message abonniert');
  await admin(adminReq('PUT', 'settings', { creditsEnabled: true, chatCommands: true }, cookie));
});

await test('Rangliste: öffentlich nur mit Namen und Zahlen, abschaltbar', async () => {
  const res = await leaderboard(new Request(BASE + '/api/leaderboard'));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.visits[0].name, 'Spitze'); assert.equal(data.visits[0].value, 999);
  assert.ok(data.visits.length <= 10 && data.streaks.every((x) => x.value > 0));
  assert.deepEqual(Object.keys(data.visits[0]).sort(), ['name', 'value'], 'keine IDs oder Tage nach außen');
  assert.deepEqual(data.chatters, [{ name: 'Vielschreiber', value: 3 }, { name: 'Wenigschreiber', value: 1 }], 'Chatter nach Nachrichten');
  assert.equal(res.headers.get('access-control-allow-origin'), '*', 'die Panel-Extension darf die Zahlen laden');
  await admin(adminReq('PUT', 'settings', { leaderboardPublic: false }, cookie));
  assert.equal((await leaderboard(new Request(BASE + '/api/leaderboard'))).status, 404);
  await admin(adminReq('PUT', 'settings', { leaderboardPublic: true }, cookie));
  await db.delete('user/c9'); await db.delete('user/c1');
});

await test('Panel-Extension: Zip enthält Seite, Skript mit eingesetzter Adresse und die Schrift', async () => {
  const { buildExtension } = await import('../scripts/build-extension.mjs');
  const zip = buildExtension('https://meine-seite.de/');
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'beginnt mit einem Zip-Header');
  for (const name of ['panel.html', 'panel.css', 'panel.js', 'fonts/Silkscreen-Bold.ttf']) assert.ok(zip.includes(Buffer.from(name)), name);
  assert.throws(() => buildExtension('http://unsicher.de'), /https/);
  assert.throws(() => buildExtension('https://seite.de/pfad'), /https/);
  const js = fs.readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');
  assert.ok(js.includes("'__SITE_URL__/api/leaderboard'"), 'Platzhalter im Quelltext');
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


// ---- Einlaufsound (Kauf, Upload, Freigabe, Verlängern, Ablauf)
{
  const entryFn = (await import('../netlify/functions/einlaufsound.mjs')).default;
  const { makeViewerSession } = await import('../netlify/lib/http.mjs');
  const es = await import('../netlify/lib/entrysound.mjs');
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(200)]);
  const viewer = (id, name) => `viewer=${encodeURIComponent(makeViewerSession({ id, name }))}`;
  const viewerReq = (method, p, body, ck) => new Request(BASE + '/api/einlaufsound/' + p, { method, headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const statusOf = (rid) => calls.filter((c) => c.path.endsWith('/redemptions') && c.query.id === rid).at(-1)?.body.status;
  let rid = 0;
  const redeem = async (which, userId, name) => {
    const state = await db.get('config/state');
    const id = `es-${++rid}`;
    await webhook(signed('notification', { subscription: { type: 'channel.channel_points_custom_reward_redemption.add' }, ...redemption(id, userId, name, which === 'buy' ? state.entryBuyRewardId : state.entryExtendRewardId) }));
    return id;
  };
  const MONTH = 30.4375 * 86_400_000;
  const monthsFromNow = (iso) => (Date.parse(iso) - Date.now()) / MONTH;

  await test('Einlaufsound: Rewards mit genauer Monatszahl in Titel und Beschreibung, Verlängern anteilig aus den Preisen', async () => {
    assert.equal((await admin(adminReq('PUT', 'settings', { entrySoundEnabled: true }, cookie))).status, 200);
    const res = await admin(adminReq('POST', 'setup', {}, cookie));
    const out = await res.json();
    assert.deepEqual(out.entrySound, ['Eigener Einlaufsound (6 Monate)', 'Einlaufsound verlängern (+2 Monate)']);
    const state = await db.get('config/state');
    const extend = rewards.find((r) => r.id === state.entryExtendRewardId);
    assert.equal(extend.cost, 25_000);
    assert.equal(rewards.find((r) => r.id === state.entryBuyRewardId).cost, 75_000);
    const s = await getSettings();
    assert.equal(es.extendMonths(s), 2);
    assert.equal(es.fmtMonths(1.5), '1,5 Monate'); assert.equal(es.fmtMonths(1), '1 Monat');
    assert.equal(es.rewardTitles({ ...s, entrySoundBuyCost: 100_000 }).extend, 'Einlaufsound verlängern (+1,5 Monate)');
    assert.ok(es.rewardPrompts(s).extend.includes('2 Monate'));
  });

  await test('Einlaufsound: Verlängern ohne gekauften Sound gibt Hinweis und Punkte zurück', async () => {
    const id = await redeem('extend', '5001', 'Anna');
    assert.equal(statusOf(id), 'CANCELED');
    assert.match(chats().at(-1), /noch keinen Einlaufsound gekauft/);
  });

  await test('Einlaufsound: Kauf bleibt offen, zweiter Kauf wird erstattet', async () => {
    const id = await redeem('buy', '5001', 'Anna');
    assert.equal(statusOf(id), undefined, 'Einlösung bleibt bis zur Freigabe offen');
    assert.match(chats().at(-1), /beispiel\.netlify\.app\/einlaufsound/);
    assert.equal((await db.get('entrysound/5001')).uploadsLeft, 1);
    const again = await redeem('buy', '5001', 'Anna');
    assert.equal(statusOf(again), 'CANCELED');
    assert.match(chats().at(-1), /wartet noch/);
  });

  await test('Zuschauer-Anmeldung: eigener Zweig, Tokens des Broadcasters bleiben unberührt', async () => {
    const login = await auth(new Request(BASE + '/api/auth/viewer'));
    assert.equal(login.status, 302);
    const loc = new URL(login.headers.get('location'));
    assert.equal(loc.searchParams.get('scope'), '');
    const state = loc.searchParams.get('state');
    assert.ok(state.startsWith('v:'));
    const stateCookie = login.headers.get('set-cookie').split(';')[0];
    await db.set('config/tokens', { ...(await db.get('config/tokens')), access_token: 'BLEIBT' });
    assert.equal((await auth(new Request(`${BASE}/api/auth/callback?code=c&state=${state}`, { headers: { cookie: 'oauth_state=falsch' } }))).status, 400);
    const back = await auth(new Request(`${BASE}/api/auth/callback?code=c&state=${state}`, { headers: { cookie: stateCookie } }));
    assert.equal(back.status, 302); assert.equal(back.headers.get('location'), '/einlaufsound');
    assert.match(back.headers.getSetCookie().join(';'), /viewer=/);
    assert.equal((await db.get('config/tokens')).access_token, 'BLEIBT');
  });

  await test('Einlaufsound-Seite: ohne Anmeldung kein Upload, Dateityp und Größe werden geprüft, nur eine Datei zur Zeit', async () => {
    const ck = viewer('5001', 'Anna');
    const anon = await (await entryFn(viewerReq('GET', 'me'))).json();
    assert.equal(anon.loggedIn, false);
    assert.equal((await entryFn(viewerReq('POST', 'upload', { name: 'a.wav', data: wav.toString('base64') }))).status, 401);
    const me = await (await entryFn(viewerReq('GET', 'me', null, ck))).json();
    assert.equal(me.status, 'awaiting'); assert.equal(me.uploadsLeft, 1); assert.equal(me.id, '5001');
    assert.equal((await entryFn(viewerReq('POST', 'upload', { name: 'a.txt', data: Buffer.from('kein Ton').toString('base64') }, ck))).status, 400);
    assert.equal((await entryFn(viewerReq('POST', 'upload', { name: 'gross.wav', data: Buffer.concat([wav, Buffer.alloc(700_000)]).toString('base64') }, ck))).status, 413);
    assert.equal((await entryFn(viewerReq('POST', 'upload', { name: 'ohne.wav', data: wav.toString('base64') }, viewer('6000', 'Fremd')))).status, 403, 'ohne Kauf kein Upload');
    assert.equal((await entryFn(viewerReq('POST', 'upload', { name: 'anna.wav', data: wav.toString('base64') }, ck))).status, 200);
    assert.equal((await entryFn(viewerReq('POST', 'upload', { name: 'zwei.wav', data: wav.toString('base64') }, ck))).status, 409);
    assert.equal((await entryFn(viewerReq('GET', 'audio?id=5001'))).status, 404, 'noch nicht freigegebene Dateien werden nicht ausgeliefert');
  });

  await test('Einlaufsound: Freigabe schließt den Kauf ab, Laufzeit 6 Monate, Check-in spielt den Sound', async () => {
    const list = await (await admin(adminReq('GET', 'entrysound', null, cookie))).json();
    assert.equal(list.entries[0].status, 'pending');
    assert.match(list.info.titles.extend, /\+2 Monate/);
    const file = await (await admin(adminReq('GET', 'entrysound/5001/pending', null, cookie))).json();
    assert.equal(file.type, 'audio/wav');
    assert.equal((await admin(adminReq('POST', 'entrysound/5001/approve', {}, cookie))).status, 200);
    const rec = await db.get('entrysound/5001');
    assert.ok(Math.abs(monthsFromNow(rec.validUntil) - 6) < 0.1, 'etwa 6 Monate');
    assert.equal(rec.purchase, null); assert.equal(rec.uploadsLeft, 0);
    assert.equal(statusOf('es-2'), 'FULFILLED');
    assert.match(chats().at(-1), /freigegeben/);
    assert.equal((await entryFn(viewerReq('GET', `audio?id=5001&v=${rec.soundVersion}`))).status, 200);
    await webhook(signed('notification', { subscription: { type: 'channel.channel_points_custom_reward_redemption.add' }, ...redemption('es-checkin-1', '5001', 'Anna', (await db.get('config/state')).rewardId) }));
    const ev = await db.get((await db.list('event/')).at(-1));
    assert.equal(ev.type, 'checkin');
    assert.equal(ev.entrySound.url, `/api/einlaufsound/audio?id=5001&v=${rec.soundVersion}`);
    assert.equal(ev.entrySound.max, 5);
  });

  await test('Einlaufsound: Kauf bei gültigem Sound wird erstattet', async () => {
    const id = await redeem('buy', '5001', 'Anna');
    assert.equal(statusOf(id), 'CANCELED');
    assert.match(chats().at(-1), /schon einen Einlaufsound/);
  });

  await test('Einlaufsound: Verlängern bringt 2 Monate und Upload-Recht, Obergrenze 12 Monate', async () => {
    const before = (await db.get('entrysound/5001')).validUntil;
    const id = await redeem('extend', '5001', 'Anna');
    assert.equal(statusOf(id), 'FULFILLED');
    const rec = await db.get('entrysound/5001');
    assert.ok(Math.abs((Date.parse(rec.validUntil) - Date.parse(before)) / MONTH - 2) < 0.1);
    assert.equal(rec.uploadsLeft, 1);
    assert.match(chats().at(-1), /um 2 Monate/);
    assert.equal(statusOf(await redeem('extend', '5001', 'Anna')), 'FULFILLED'); // 10 Monate
    assert.equal(statusOf(await redeem('extend', '5001', 'Anna')), 'FULFILLED'); // 12 Monate
    const over = await redeem('extend', '5001', 'Anna');
    assert.equal(statusOf(over), 'CANCELED', 'mehr als 12 Monate geht nicht');
    assert.match(chats().at(-1), /mehr als 12 Monate Restlaufzeit geht nicht/);
    assert.ok(monthsFromNow((await db.get('entrysound/5001')).validUntil) <= 12.05);
  });

  await test('Einlaufsound: neuer Sound nach Verlängern, Ablehnung lässt neuen Upload zu, Laufzeit bleibt', async () => {
    const ck = viewer('5001', 'Anna');
    const until = (await db.get('entrysound/5001')).validUntil;
    assert.equal((await entryFn(viewerReq('POST', 'upload', { name: 'neu.wav', data: wav.toString('base64') }, ck))).status, 200);
    assert.equal((await admin(adminReq('POST', 'entrysound/5001/reject', { reason: 'zu laut' }, cookie))).status, 200);
    assert.match(chats().at(-1), /abgelehnt \(zu laut\)/);
    const rec = await db.get('entrysound/5001');
    assert.equal(rec.uploadsLeft, 1); assert.equal(rec.rejected.reason, 'zu laut'); assert.equal(rec.validUntil, until);
    const oldVersion = rec.soundVersion;
    assert.equal((await entryFn(viewerReq('POST', 'upload', { name: 'neu2.wav', data: wav.toString('base64') }, ck))).status, 200);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal((await admin(adminReq('POST', 'entrysound/5001/approve', {}, cookie))).status, 200);
    const next = await db.get('entrysound/5001');
    assert.ok(next.soundVersion > oldVersion); assert.equal(next.validUntil, until); assert.equal(next.uploadsLeft, 0);
  });

  await test('Einlaufsound: Ablehnen und erstatten gibt beim Kauf die Punkte zurück und räumt auf', async () => {
    const id = await redeem('buy', '5002', 'Ben');
    await entryFn(viewerReq('POST', 'upload', { name: 'b.wav', data: wav.toString('base64') }, viewer('5002', 'Ben')));
    assert.equal((await admin(adminReq('POST', 'entrysound/5002/reject', { reason: 'Musik', refund: true }, cookie))).status, 200);
    assert.equal(statusOf(id), 'CANCELED');
    assert.match(chats().at(-1), /Deine Punkte bekommst du zurück/);
    assert.equal(await db.get('entrysound/5002'), null);
    assert.equal(await db.get('entrysound-pending/5002'), null);
  });

  await test('Einlaufsound: ohne Upload innerhalb der Frist gibt es die Punkte automatisch zurück', async () => {
    const id = await redeem('buy', '5003', 'Cleo');
    const rec = await db.get('entrysound/5003');
    await db.set('entrysound/5003', { ...rec, purchase: { ...rec.purchase, at: new Date(Date.now() - 20 * 86_400_000).toISOString() } });
    await admin(adminReq('GET', 'entrysound', null, cookie)); // Aufräumen beim Öffnen
    assert.equal(statusOf(id), 'CANCELED');
    assert.match(chats().at(-1), /nicht rechtzeitig/);
    assert.equal(await db.get('entrysound/5003'), null);
  });

  await test('Einlaufsound: Abgelaufen spielt der normale Ton, in der Aufbewahrungszeit verlängerbar ab heute, danach gelöscht', async () => {
    const s = await getSettings();
    const rec = await db.get('entrysound/5001');
    const past = new Date(Date.now() - 20 * 86_400_000).toISOString();
    await db.set('entrysound/5001', { ...rec, validUntil: past });
    assert.equal(await es.activeSoundFor('5001', s), null);
    const id = await redeem('extend', '5001', 'Anna');
    assert.equal(statusOf(id), 'FULFILLED');
    assert.ok(Math.abs(monthsFromNow((await db.get('entrysound/5001')).validUntil) - 2) < 0.1, 'zählt ab heute');
    assert.ok(await es.activeSoundFor('5001', s));
    // länger als 3 Monate abgelaufen: weg
    await db.set('entrysound/5001', { ...(await db.get('entrysound/5001')), validUntil: new Date(Date.now() - 120 * 86_400_000).toISOString(), uploadsLeft: 0 });
    await admin(adminReq('GET', 'entrysound', null, cookie));
    assert.equal(await db.get('entrysound/5001'), null);
    assert.equal(await db.get('entrysound-file/5001'), null);
    assert.equal(statusOf(await redeem('extend', '5001', 'Anna')), 'CANCELED');
  });

  await test('Einlaufsound: ausgeschaltet spielt kein persönlicher Sound', async () => {
    await db.set('entrysound/5004', { id: '5004', name: 'Dirk', soundVersion: 1, validUntil: new Date(Date.now() + 86_400_000).toISOString(), uploadsLeft: 0 });
    assert.ok(await es.activeSoundFor('5004', await getSettings()));
    await admin(adminReq('PUT', 'settings', { entrySoundEnabled: false }, cookie));
    assert.equal(await es.activeSoundFor('5004', await getSettings()), null);
  });
}


// ---- Community-Rangliste und Konto-Verknüpfung
{
  const verknuepfen = (await import('../netlify/functions/verknuepfen.mjs')).default;
  const community = (await import('../netlify/functions/community.mjs')).default;
  const leaderboard = (await import('../netlify/functions/leaderboard.mjs')).default;
  const com = await import('../netlify/lib/community.mjs');
  const { makeViewerSession } = await import('../netlify/lib/http.mjs');
  const viewer = (id, name) => `viewer=${encodeURIComponent(makeViewerSession({ id, name }))}`;
  const vReq = (method, p, body, ck) => new Request(BASE + '/api/verknuepfen/' + p, { method, headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const bot = (method, p, body, secret = 'geheimwort-12345') => community(new Request(BASE + '/api/community/' + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: body ? JSON.stringify(body) : undefined }));
  const token = (discordId, name = 'AnnaDC', exp = Date.now() + 600_000, secret = 'geheimwort-12345') => com.signLinkToken({ discordId, discordName: name, exp }, secret);
  const chatMsg = (id, name, text = 'hallo') => webhook(signed('notification', { subscription: { type: 'channel.chat.message' }, event: { broadcaster_user_id: '999', chatter_user_id: id, chatter_user_name: name, message_id: crypto.randomUUID(), message: { text } } }));

  await test('Community: ohne LINK_SECRET alles aus, Bot-Schnittstelle nur mit Geheimwort', async () => {
    assert.equal((await bot('GET', 'board')).status, 503);
    process.env.LINK_SECRET = 'geheimwort-12345';
    assert.equal((await bot('GET', 'board', null, 'falsch')).status, 401);
    assert.equal((await community(new Request(BASE + '/api/community/board'))).status, 401, 'ohne Anmeldung');
    await admin(adminReq('PUT', 'settings', { communityEnabled: true, chatEnabled: true, chatCommands: true }, cookie));
    assert.equal((await bot('GET', 'board')).status, 200);
  });

  await test('Verknüpfen: Link-Token wird geprüft, ohne Zustimmung und Anmeldung passiert nichts', async () => {
    assert.ok(com.verifyLinkToken(token('111111111')));
    assert.equal(com.verifyLinkToken(token('111111111', 'x', Date.now() - 1000)), null, 'abgelaufen');
    assert.equal(com.verifyLinkToken(token('111111111', 'x', Date.now() + 1000, 'anderes-geheimwort')), null, 'falsch signiert');
    const invite = token('111111111', 'AnnaDC');
    const anon = await (await verknuepfen(vReq('GET', `me?t=${encodeURIComponent(invite)}`))).json();
    assert.equal(anon.loggedIn, false); assert.equal(anon.invite.discordName, 'AnnaDC');
    assert.equal((await verknuepfen(vReq('POST', 'confirm', { consent: true, t: invite }))).status, 401, 'ohne Twitch-Anmeldung');
    const ck = viewer('5001', 'Anna');
    assert.equal((await verknuepfen(vReq('POST', 'confirm', { t: invite }, ck))).status, 400, 'ohne Zustimmung');
    assert.equal((await verknuepfen(vReq('POST', 'confirm', { consent: true, t: 'kaputt' }, ck))).status, 400, 'ungültiger Link');
    assert.equal(await com.linkByTwitch('5001'), null);
    assert.equal((await verknuepfen(vReq('POST', 'confirm', { consent: true, t: invite }, ck))).status, 200);
    const link = await com.linkByTwitch('5001');
    assert.equal(link.discordId, '111111111'); assert.equal(link.twitchName, 'Anna');
    assert.equal((await com.linkByDiscord('111111111')).twitchId, '5001');
  });

  await test('Verknüpfen: Anmeldung gibt den Link-Token weiter, nur eigene Seiten als Ziel', async () => {
    const login = await auth(new Request(BASE + '/api/auth/viewer?next=/verknuepfen&t=abc'));
    const cookies = login.headers.getSetCookie().join(';');
    assert.match(cookies, /viewer_next=%2Fverknuepfen/); assert.match(cookies, /link_token=abc/);
    const evil = await auth(new Request(BASE + '/api/auth/viewer?next=https://boese.example'));
    assert.match(evil.headers.getSetCookie().join(';'), /viewer_next=%2Feinlaufsound/, 'fremde Ziele werden ignoriert');
  });

  await test('Zählen: Mindestabstand und Tageslimit, Kanalinhaber zählt nicht', async () => {
    const s = await getSettings();
    const t0 = new Date('2030-05-10T12:00:00Z');
    assert.equal(await com.countCommunityChat('5001', 'Anna', s, t0), true);
    assert.equal(await com.countCommunityChat('5001', 'Anna', s, new Date(t0.getTime() + 30_000)), false, 'unter 60 Sekunden');
    assert.equal(await com.countCommunityChat('5001', 'Anna', s, new Date(t0.getTime() + 61_000)), true);
    for (let i = 2; i < 40; i++) await com.countCommunityChat('5001', 'Anna', s, new Date(t0.getTime() + i * 61_000));
    const rec = await db.get('cmonth/2030-05/5001');
    assert.equal(rec.msgs, 30, 'höchstens 30 pro Tag'); assert.equal(rec.days, 1);
    assert.equal(await com.countCommunityChat('5001', 'Anna', s, new Date('2030-05-11T12:00:00Z')), true, 'neuer Tag zählt wieder'); assert.equal((await db.get('cmonth/2030-05/5001')).days, 2);
    await chatMsg('999', 'Kanal'); // Kanalinhaber
    assert.equal(await db.get(`cmonth/${com.monthOf(s)}/999`), null);
    await chatMsg('5001', 'Anna');
    assert.equal((await db.get(`cmonth/${com.monthOf(s)}/5001`)).msgs, 1);
  });

  await test('Discord-Zahlen vom Bot: gültiger Monat, Werte begrenzt, Rangliste mit Gewichten und nur verknüpfte Konten', async () => {
    const s = await getSettings(); const month = com.monthOf(s);
    assert.equal((await bot('POST', 'sync', { month: '1999-01', rows: [] })).status, 400, 'alter Monat');
    const res = await bot('POST', 'sync', { month, rows: [{ discordId: '111111111', msgs: 10, days: 3 }, { discordId: '222222222', msgs: 99999, days: 99 }, { discordId: 'kaputt', msgs: 1, days: 1 }] });
    assert.deepEqual(await res.json(), { ok: true, saved: 1 }, 'Unverknüpfte und ungültige IDs werden nicht gespeichert');
    assert.equal(await db.get(`dmonth/${month}/222222222`), null, 'ohne Verknüpfung keine Daten');
    await com.saveLink({ discordId: '222222222', discordName: 'Gast', twitchId: '5009', twitchName: 'Gast' });
    await bot('POST', 'sync', { month, rows: [{ discordId: '222222222', msgs: 99999, days: 99 }] });
    assert.deepEqual(await db.get(`dmonth/${month}/222222222`), { msgs: 930, days: 31 }, 'Werte begrenzt (30 × 31 Nachrichten, 31 Tage)');
    await com.removeLink({ discordId: '222222222' });
    await db.set('user/5001', { name: 'Anna', count: 1, days: [`${month}-01`, `${month}-02`], sessions: {} });
    const board = await com.monthBoard(s);
    assert.equal(board.rows.length, 1, 'nur das verknüpfte Konto');
    const r = board.rows[0];
    assert.equal(r.points, (1 + 10) * 1 + (1 + 3) * 10 + 2 * 20, 'Twitch 1 + Discord 10 Nachrichten, 4 aktive Tage, 2 Check-ins');
    const who = await (await bot('GET', 'link?discordId=111111111')).json();
    assert.deepEqual(who, { linked: true, twitchName: 'Anna' });
    assert.deepEqual(await (await bot('GET', 'link?discordId=999999999')).json(), { linked: false, twitchName: null });
    const api = await (await bot('GET', 'board')).json();
    assert.deepEqual(api.linked, ['111111111']);
    assert.equal(api.rules.msgCap, 30); assert.equal(api.rows[0].discordId, '111111111'); assert.equal(api.rows[0].points, r.points);
  });

  await test('Öffentliche Rangliste zeigt die Monatswertung mit Hinweis, nur Namen und Punkte', async () => {
    const data = await (await leaderboard(new Request(BASE + '/api/leaderboard'))).json();
    assert.equal(data.month.rows.length, 1);
    assert.deepEqual(Object.keys(data.month.rows[0]).sort(), ['name', 'value']);
    assert.match(data.month.hint, /verknüpft/);
    assert.deepEqual(data.month.rules, { msg: 1, day: 10, checkin: 20, msgCap: 30, msgGap: 60, bonusNote: (await getSettings()).communityBonusNote }, 'Legende nennt die echten Werte');
    assert.match(data.month.rules.bonusNote, /Clip der Woche/);
    assert.ok(!JSON.stringify(data.month).includes('111111111'), 'keine Discord-ID öffentlich');
  });

  await test('Chat: !rangliste zeigt die Top-Plätze des Monats und den eigenen Platz, ohne Punkte eine Aufforderung', async () => {
    await admin(adminReq('PUT', 'settings', { commandCooldown: 0, communityRankSize: 1 }, cookie));
    const month = com.monthOf(await getSettings());
    await com.saveLink({ discordId: '444444444', discordName: 'DoraDC', twitchId: '5010', twitchName: 'Dora' });
    await db.set(`dmonth/${month}/444444444`, { msgs: 1, days: 1 });
    await chatMsg('5001', 'Anna', '!rangliste');
    assert.match(chats().at(-1), /Dorf-Rangliste .*: 1\. Anna \(\d+\)/);
    assert.ok(!/Du: Platz/.test(chats().at(-1)), 'wer oben steht, braucht keine Extrazeile');
    assert.match(chats().at(-1), /beispiel\.netlify\.app\/rangliste/);
    await chatMsg('5010', 'Dora', '!rangliste');
    assert.match(chats().at(-1), /1\. Anna .* · Du: Platz 2 \(\d+\)/);
    await chatMsg('5555', 'Fremd', '!rangliste');
    assert.ok(!/Du: Platz/.test(chats().at(-1)), 'Unverknüpfte bekommen keine Platzangabe');
    await com.removeLink({ discordId: '444444444' });
    const zero = { communityWeightMsg: 0, communityWeightDay: 0, communityWeightCheckin: 0 };
    await admin(adminReq('PUT', 'settings', { communityRankSize: 5, ...zero }, cookie)); // ohne Gewichte hat niemand Punkte
    await chatMsg('5555', 'Fremd', '!rangliste');
    assert.match(chats().at(-1), /noch keine Punkte/, 'leere Rangliste');
    await admin(adminReq('PUT', 'settings', { communityWeightMsg: 1, communityWeightDay: 10, communityWeightCheckin: 20 }, cookie));
  });

  await test('Chat: !verknuepfen erklärt es, Check-in-Tipp nur einmal im Monat und nur für Unverknüpfte', async () => {
    await chatMsg('5002', 'Ben', '!verknuepfen');
    assert.match(chats().at(-1), /verknüpfe dein Twitch- und Discord-Konto/);
    const s = await getSettings();
    assert.match(await com.linkTip('5002', 'Ben', s), /noch nicht in der Monatsrangliste/);
    assert.equal(await com.linkTip('5002', 'Ben', s), null, 'nur einmal im Monat');
    assert.equal(await com.linkTip('5001', 'Anna', s), null, 'Verknüpfte bekommen keinen Tipp');
  });

  await test('Verknüpfung löschen: durch die Person, durch den Bot und im Admin, danach nicht mehr in der Rangliste', async () => {
    const ck = viewer('5001', 'Anna');
    const place = await (await verknuepfen(vReq('GET', 'place', null, ck))).json();
    assert.equal(place.rank, 1);
    assert.equal((await verknuepfen(vReq('POST', 'unlink', {}, ck))).status, 200);
    assert.equal(await com.linkByTwitch('5001'), null); assert.equal(await com.linkByDiscord('111111111'), null);
    assert.equal((await com.monthBoard(await getSettings())).rows.length, 0);
    await com.saveLink({ discordId: '111111111', discordName: 'AnnaDC', twitchId: '5001', twitchName: 'Anna' });
    assert.deepEqual(await (await bot('POST', 'unlink', { discordId: '111111111' })).json(), { ok: true });
    await com.saveLink({ discordId: '333333333', discordName: 'BenDC', twitchId: '5002', twitchName: 'Ben' });
    const list = await (await admin(adminReq('GET', 'community', null, cookie))).json();
    assert.equal(list.links.length, 1); assert.equal(list.secretSet, true);
    assert.deepEqual(await (await admin(adminReq('DELETE', 'community/5002', null, cookie))).json(), { ok: true });
    // neue Verknüpfung desselben Discord-Kontos mit anderem Twitch-Konto ersetzt die alte
    await com.saveLink({ discordId: '333333333', discordName: 'BenDC', twitchId: '5002', twitchName: 'Ben' });
    await com.saveLink({ discordId: '333333333', discordName: 'BenDC', twitchId: '5003', twitchName: 'Cleo' });
    assert.equal(await com.linkByTwitch('5002'), null); assert.equal((await com.linkByDiscord('333333333')).twitchId, '5003');
  });

  await test('Bot-Schnittstelle: Discord-Konto zu einem Twitch-Namen nachschlagen', async () => {
    await com.saveLink({ discordId: '444444444', discordName: 'FanDC', twitchId: '7002', twitchName: 'FanLinks' });
    assert.deepEqual(await (await bot('GET', 'link?twitch=fanlinks')).json(), { linked: true, discordId: '444444444', twitchName: 'FanLinks' }, 'Groß-/Kleinschreibung egal');
    assert.deepEqual(await (await bot('GET', 'link?twitch=%40FANLINKS')).json(), { linked: true, discordId: '444444444', twitchName: 'FanLinks' }, 'mit @');
    assert.deepEqual(await (await bot('GET', 'link?twitch=Unbekannt')).json(), { linked: false, discordId: null, twitchName: null });
    assert.equal((await bot('GET', 'link?twitch=FanLinks', null, 'falsch')).status, 401);
  });

  await test('Bot-Schnittstelle: Bonuspunkte zählen einmal pro Schlüssel und erscheinen in der Rangliste', async () => {
    const s = await getSettings(); const m = com.monthOf(s);
    const before = (await com.monthBoard(s)).rows.find((r) => r.twitchId === '7002')?.points ?? 0;
    const unlinked = await (await bot('POST', 'bonus', { key: 'clip-x', twitch: 'NiemandVerknuepft', points: 100 })).json();
    assert.deepEqual(unlinked, { ok: false, linked: false });
    assert.equal(await db.get('bonuskey/clip-x'), null, 'ohne Verknüpfung wird nichts gebucht');
    const ok1 = await (await bot('POST', 'bonus', { key: 'clipwoche-1', discordId: '444444444', points: 100, reason: 'Clip der Woche' })).json();
    assert.equal(ok1.ok, true); assert.equal(ok1.points, 100); assert.equal(ok1.total, 100); assert.equal(ok1.month, m);
    const dup = await (await bot('POST', 'bonus', { key: 'clipwoche-1', discordId: '444444444', points: 100 })).json();
    assert.deepEqual(dup, { ok: true, duplicate: true });
    const ok2 = await (await bot('POST', 'bonus', { key: 'clipwoche-2', twitch: 'fanlinks', points: 50 })).json();
    assert.equal(ok2.total, 150, 'zweiter Schlüssel zählt dazu, Suche über den Twitch-Namen');
    const row = (await com.monthBoard(s)).rows.find((r) => r.twitchId === '7002');
    assert.equal(row.points, before + 150); assert.equal(row.bonus, 150);
    const api = await (await bot('GET', 'board')).json();
    assert.equal(api.rows.find((r) => r.discordId === '444444444').points, before + 150, 'der Bot sieht die Bonuspunkte in der Rangliste');
    for (const bad of [{ key: '', points: 10, twitch: 'fanlinks' }, { key: 'k', points: 0, twitch: 'fanlinks' }, { key: 'k', points: 5000, twitch: 'fanlinks' }, { key: 'k', points: 'viel', twitch: 'fanlinks' }])
      assert.equal((await bot('POST', 'bonus', bad)).status, 400, JSON.stringify(bad));
    assert.equal((await bot('POST', 'bonus', { key: 'k9', twitch: 'fanlinks', points: 5 }, 'falsch')).status, 401);
  });

  await test('Chat: unter einem geteilten Clip steht der Hinweis, nur einmal pro Clip und nur wenn der Ersteller nicht verknüpft ist', async () => {
    await admin(adminReq('PUT', 'settings', { communityEnabled: true, chatEnabled: true, clipHintEnabled: true }, cookie));
    clipDb = [
      { id: 'GrossartigerClip-abc', title: 'Krass', creator_id: '7001', creator_name: 'FanOhne', broadcaster_id: '999' },
      { id: 'VerknuepfterClip-def', title: 'Auch krass', creator_id: '7002', creator_name: 'FanLinks', broadcaster_id: '999' },
      { id: 'FremderKanalClip-ghi', title: 'Woanders', creator_id: '7003', creator_name: 'Fremd', broadcaster_id: '12345' },
    ];
    const frei = () => db.delete('cooldown/cliphint');
    const n0 = chats().length;
    await frei(); await chatMsg('5050', 'Max', 'schaut mal https://clips.twitch.tv/GrossartigerClip-abc');
    assert.equal(chats().length, n0 + 1);
    const hint = chats().at(-1);
    assert.match(hint, /FanOhne/); assert.match(hint, /https:\/\/discord\.gg\/qxPqqhYwtJ/); assert.match(hint, /!verknuepfen/); assert.match(hint, /ClipMaster/);
    await frei(); await chatMsg('5051', 'Eva', 'https://clips.twitch.tv/GrossartigerClip-abc');
    assert.equal(chats().length, n0 + 1, 'derselbe Clip noch einmal: kein zweiter Hinweis');
    await frei(); await chatMsg('5050', 'Max', 'https://www.twitch.tv/streamerin/clip/VerknuepfterClip-def');
    assert.equal(chats().length, n0 + 1, 'Ersteller ist verknüpft: kein Hinweis');
    await frei(); await chatMsg('5050', 'Max', 'https://clips.twitch.tv/FremderKanalClip-ghi');
    assert.equal(chats().length, n0 + 1, 'Clip eines anderen Kanals: kein Hinweis');
    await frei(); await chatMsg('5050', 'Max', 'https://clips.twitch.tv/GibtEsNichtClip-xyz');
    assert.equal(chats().length, n0 + 1, 'unbekannter Clip: kein Hinweis');
    clipDb.push({ id: 'ZweiterFreierClip-jkl', title: 'Noch einer', creator_id: '7004', creator_name: 'NochEiner', broadcaster_id: '999' });
    await chatMsg('5050', 'Max', 'https://www.twitch.tv/streamerin/clip/ZweiterFreierClip-jkl');
    assert.equal(chats().length, n0 + 1, 'Abklingzeit: zwei Clips direkt hintereinander füllen nicht den Chat');
    await frei();
    await admin(adminReq('PUT', 'settings', { clipHintEnabled: false }, cookie));
    await chatMsg('5050', 'Max', 'https://www.twitch.tv/streamerin/clip/ZweiterFreierClip-jkl');
    assert.equal(chats().length, n0 + 1, 'ausgeschaltet');
    await admin(adminReq('PUT', 'settings', { clipHintEnabled: true }, cookie));
    const msg = (await (await admin(adminReq('GET', 'settings', null, cookie))).json());
    assert.ok(JSON.stringify(msg).includes('discord.gg/qxPqqhYwtJ'), 'Einladungslink steht in den Einstellungen');
    await com.removeLink({ discordId: '444444444' });
    await db.delete(`bonus/${com.monthOf(await getSettings())}/7002`);
  });

  await test('Backup enthält Einlaufsounds, Verknüpfungen und Monatszahlen', async () => {
    const b = await (await admin(adminReq('GET', 'backup', null, cookie))).json();
    assert.ok(Object.keys(b.entries).some((k) => k.startsWith('link/')));
    assert.ok(Object.keys(b.entries).some((k) => k.startsWith('cmonth/')));
    assert.ok(Object.keys(b.entries).some((k) => k.startsWith('dmonth/')));
  });
  delete process.env.LINK_SECRET;
}


// ---- Top des Monats: Katalog, Monatsabschluss, Auswahl
{
  const aw = await import('../netlify/lib/award.mjs');
  const es = await import('../netlify/lib/entrysound.mjs');
  const com = await import('../netlify/lib/community.mjs');
  const entryFn = (await import('../netlify/functions/einlaufsound.mjs')).default;
  const { makeViewerSession } = await import('../netlify/lib/http.mjs');
  process.env.LINK_SECRET = 'geheimwort-12345';
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(200)]).toString('base64');
  const viewer = (id, name) => `viewer=${encodeURIComponent(makeViewerSession({ id, name }))}`;
  const vReq = (method, p, body, ck) => new Request(BASE + '/api/einlaufsound/' + p, { method, headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const api = (method, p, body) => admin(adminReq(method, p, body, cookie));
  const JUNE = new Date(Date.UTC(2030, 5, 3, 12)); // 3. Juni 2030: Vormonat ist 2030-05
  let fanfare, gong;

  await test('Top des Monats: Gewinner mit Gleichstand auf dem letzten Platz, alle mit derselben Punktzahl', async () => {
    const row = (name, points) => ({ twitchId: name, name, points });
    assert.deepEqual(aw.winnersOf([row('a', 100), row('b', 80), row('c', 60), row('d', 60), row('e', 10)], 3).map((w) => [w.name, w.place]), [['a', 1], ['b', 2], ['c', 3], ['d', 3]]);
    assert.deepEqual(aw.winnersOf([row('a', 100), row('b', 50), row('c', 50), row('d', 50), row('e', 1)], 3).map((w) => [w.name, w.place]), [['a', 1], ['b', 2], ['c', 2], ['d', 2]]);
    assert.equal(aw.winnersOf([row('a', 5), row('b', 5), row('c', 5), row('d', 5)], 3).length, 4, 'alle gleich');
    assert.equal(aw.winnersOf([row('a', 5), row('b', 4)], 3).length, 2, 'weniger Leute als Plätze');
    assert.deepEqual(aw.winnersOf([], 3), []);
    assert.equal(aw.prevMonthKey('2030-01'), '2029-12'); assert.equal(aw.prevMonthKey('2030-06'), '2030-05');
  });

  await test('Katalog: höchstens 15 Plätze, Namen eindeutig, Sound hochladen, nur Sounds mit Datei werden ausgeliefert', async () => {
    fanfare = await (await api('POST', 'catalog', { name: 'Fanfare' })).json();
    gong = await (await api('POST', 'catalog', { name: 'Gong' })).json();
    assert.equal((await api('POST', 'catalog', { name: 'Fanfare' })).status, 400, 'doppelter Name');
    assert.equal((await api('POST', 'catalog', { name: '  ' })).status, 400);
    assert.equal((await api('PUT', `catalog/${gong.id}`, { name: 'Fanfare' })).status, 400, 'Umbenennen auf vergebenen Namen');
    for (let i = 0; i < 13; i++) assert.equal((await api('POST', 'catalog', { name: 'Platz ' + i })).status, 200);
    assert.equal((await api('POST', 'catalog', { name: 'zu viel' })).status, 400, 'höchstens 15');
    const list = await (await api('GET', 'catalog')).json();
    assert.equal(list.entries.length, 15); assert.equal(list.max, 15);
    for (const e of list.entries.filter((x) => x.name.startsWith('Platz'))) await api('DELETE', `catalog/${e.id}`);
    assert.equal((await api('POST', `catalog/${fanfare.id}/sound`, { name: 'fanfare.wav', data: Buffer.from('kein Ton').toString('base64') })).status, 400, 'nur Audio');
    const up = await (await api('POST', `catalog/${fanfare.id}/sound`, { name: 'fanfare.wav', data: wav })).json();
    fanfare = up; assert.ok(up.soundVersion);
    assert.equal((await entryFn(vReq('GET', `catalog-audio?id=${fanfare.id}&v=1`))).status, 200);
    assert.equal((await entryFn(vReq('GET', `catalog-audio?id=${gong.id}&v=1`))).status, 404, 'ohne Datei nichts zum Ausliefern');
    assert.equal((await entryFn(vReq('GET', 'catalog-audio?id=../../x'))).status, 404);
  });

  await test('Monatsabschluss: erst ab dem 2., einmalig, Top 3 mit Gleichstand, Ankündigung im Chat', async () => {
    await api('PUT', 'settings', { awardEnabled: true, communityEnabled: true, chatEnabled: true, awardSize: 3 });
    const s = await getSettings();
    // vier Verknüpfte im Mai 2030: Uli 100, Vera 80, Wim und Xaver je 60 Punkte (nur Twitch-Nachrichten, Gewichte × 1)
    const people = [['6001', 'Uli', 100], ['6002', 'Vera', 80], ['6003', 'Wim', 60], ['6004', 'Xaver', 60], ['6005', 'Yara', 10]];
    for (const [id, name, pts] of people) {
      await com.saveLink({ discordId: `70000000${id}`, discordName: name + 'DC', twitchId: id, twitchName: name });
      await db.set(`cmonth/2030-05/${id}`, { name, msgs: pts, days: 0, lastDay: null, dayMsgs: 0, lastAt: 0 });
    }
    assert.equal(await aw.ensureAward(s, new Date(Date.UTC(2030, 5, 1, 12))), null, 'am 1. noch nicht (Discord-Zahlen sind noch nicht abgeschlossen)');
    assert.equal(await db.get('award/2030-05'), null);
    const rec = await aw.ensureAward(s, JUNE);
    assert.equal(rec.month, '2030-05'); assert.deepEqual(rec.winners.map((w) => [w.name, w.place]), [['Uli', 1], ['Vera', 2], ['Wim', 3], ['Xaver', 3]]);
    assert.ok(Math.abs((Date.parse(rec.deadline) - JUNE) / 86_400_000 - 7) < 0.01, '7 Tage Zeit');
    assert.match(chats().at(-1), /Top 4 im .*2030: 1\. Uli · 2\. Vera · 3\. Wim · 3\. Xaver.*07\.06\.2030|Top 4 im .*2030: 1\. Uli · 2\. Vera · 3\. Wim · 3\. Xaver/);
    const before = chats().length;
    assert.equal(await aw.ensureAward(s, JUNE), null, 'nur einmal'); assert.equal(chats().length, before);
  });

  await test('Auswahl: nur Gewinner, nur Sounds mit Datei, Laufzeit 1 Monat ab der ersten Wahl, Ändern behält die Laufzeit', async () => {
    const s = await getSettings();
    const me = await (await entryFn(vReq('GET', 'me', null, viewer('6001', 'Uli')))).json();
    assert.equal(me.awardEnabled, true); assert.equal(me.award.open.place, 1);
    assert.deepEqual(me.award.catalog.map((c) => c.name), ['Fanfare'], 'Sounds ohne Datei erscheinen nicht');
    const stranger = await (await entryFn(vReq('GET', 'me', null, viewer('6999', 'Fremd')))).json();
    assert.equal(stranger.award.open, null);
    assert.equal((await entryFn(vReq('POST', 'choose', { catalogId: fanfare.id }, viewer('6999', 'Fremd')))).status, 403, 'kein Gewinner');
    assert.equal((await entryFn(vReq('POST', 'choose', { catalogId: fanfare.id }))).status, 401, 'nicht angemeldet');
    assert.equal((await entryFn(vReq('POST', 'choose', { catalogId: gong.id }, viewer('6001', 'Uli')))).status, 400, 'Sound ohne Datei');
    assert.equal((await entryFn(vReq('POST', 'choose', { catalogId: 'unbekannt' }, viewer('6001', 'Uli')))).status, 400);
    const ok = await (await entryFn(vReq('POST', 'choose', { catalogId: fanfare.id }, viewer('6001', 'Uli')))).json();
    assert.equal(ok.ok, true); assert.match(chats().at(-1), /Uli hat sich den Einlaufsound „Fanfare“ ausgesucht/);
    const won = await db.get('awardsound/6001');
    assert.ok(Math.abs((Date.parse(won.validUntil) - Date.now()) / (30.4375 * 86_400_000) - 1) < 0.1, '1 Monat ab jetzt');
    // zweiten Sound hochladen, ändern: Laufzeit bleibt, keine zweite Chat-Nachricht
    gong = await (await api('POST', `catalog/${gong.id}/sound`, { name: 'gong.wav', data: wav })).json();
    const count = chats().length;
    assert.equal((await entryFn(vReq('POST', 'choose', { catalogId: gong.id }, viewer('6001', 'Uli')))).status, 200);
    const changed = await db.get('awardsound/6001');
    assert.equal(changed.catalogId, gong.id); assert.equal(changed.validUntil, won.validUntil); assert.equal(chats().length, count);
    assert.equal((await aw.awardView('6001', s)).current.name, 'Gong');
  });

  await test('Check-in: Katalog-Sound der Gewinner, gekaufter Sound hat Vorrang, abgelaufen und nicht gewählt gilt der normale Ton', async () => {
    const s = await getSettings();
    const a = await es.activeSoundFor('6001', s);
    assert.match(a.url, new RegExp(`^/api/einlaufsound/catalog-audio\\?id=${gong.id}&v=\\d+$`)); assert.equal(a.max, 5);
    assert.equal(await es.activeSoundFor('6003', s), null, 'Wim hat nicht gewählt: normaler Ton');
    assert.equal(await es.activeSoundFor('6001', s, new Date(Date.now() + 40 * 86_400_000)), null, 'nach einem Monat vorbei');
    await db.set('entrysound/6001', { id: '6001', name: 'Uli', soundVersion: 9, validUntil: new Date(Date.now() + 86_400_000).toISOString(), uploadsLeft: 0 });
    await api('PUT', 'settings', { entrySoundEnabled: true });
    assert.match((await es.activeSoundFor('6001', await getSettings())).url, /^\/api\/einlaufsound\/audio\?id=6001/, 'gekaufter Sound zuerst');
    await api('PUT', 'settings', { entrySoundEnabled: false }); await db.delete('entrysound/6001');
    await api('PUT', 'settings', { awardEnabled: false });
    assert.equal(await es.activeSoundFor('6001', await getSettings()), null, 'ausgeschaltet');
    await api('PUT', 'settings', { awardEnabled: true });
  });

  await test('Frist: nach 7 Tagen keine Wahl mehr, Erinnerung beim Check-in nur für Gewinner ohne Wahl', async () => {
    const s = await getSettings();
    assert.equal((await aw.choose('6003', 'Wim', fanfare.id, s, new Date(Date.UTC(2030, 5, 11)))).status, 403, 'Frist vorbei');
    assert.match(await aw.awardTip('6003', 'Wim', s, new Date(Date.UTC(2030, 5, 4))), /Wim, du warst im .* unter den Top 4.*noch bis 10\.06\.2030/);
    assert.equal(await aw.awardTip('6001', 'Uli', s, new Date(Date.UTC(2030, 5, 4))), null, 'hat schon gewählt');
    assert.equal(await aw.awardTip('6999', 'Fremd', s, new Date(Date.UTC(2030, 5, 4))), null, 'kein Gewinner');
    assert.equal(await aw.awardTip('6003', 'Wim', s, new Date(Date.UTC(2030, 5, 11))), null, 'Frist vorbei');
    // beim echten Check-in (die Frist läuft laut Datenstand bis 2030) erscheint die Erinnerung im Chat
    const state = await db.get('config/state');
    await webhook(signed('notification', { subscription: { type: 'channel.channel_points_custom_reward_redemption.add' }, ...redemption('aw-ci-1', '6003', 'Wim', state.rewardId) }));
    assert.match(chats().at(-1), /Wim, du warst im .* unter den Top 4/);
  });

  await test('Bot-Schnittstelle /api/community/award: Gewinner mit Discord-ID und Stand der Wahl, nur mit Geheimwort', async () => {
    const community = (await import('../netlify/functions/community.mjs')).default;
    const get = (secret) => community(new Request(BASE + '/api/community/award', { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));
    assert.equal((await get()).status, 401); assert.equal((await get('falsch')).status, 401);
    const res = await (await get('geheimwort-12345')).json();
    assert.equal(res.enabled, true); assert.equal(res.award.month, '2030-05'); assert.equal(res.award.open, true);
    assert.match(res.award.url, /\/einlaufsound$/);
    assert.deepEqual(res.award.winners.map((w) => [w.name, w.discordId, w.chosen, w.sound]), [
      ['Uli', '700000006001', true, 'Gong'], ['Vera', '700000006002', false, null], ['Wim', '700000006003', false, null], ['Xaver', '700000006004', false, null]]);
    await com.removeLink({ twitchId: '6002' });
    assert.equal((await (await get('geheimwort-12345')).json()).award.winners[1].discordId, null, 'ohne Verknüpfung keine Discord-ID');
    await api('PUT', 'settings', { awardEnabled: false });
    assert.deepEqual(await (await get('geheimwort-12345')).json(), { enabled: false, award: null });
    await api('PUT', 'settings', { awardEnabled: true });
  });

  await test('Admin: Gewinner mit Wahl in der Übersicht, Vormonat ist schon abgeschlossen, Backup enthält Katalog und Gewinner', async () => {
    const list = await (await api('GET', 'catalog')).json();
    const may = list.awards.find((x) => x.month === '2030-05');
    assert.deepEqual(may.winners.map((w) => [w.name, w.choice]), [['Uli', 'Gong'], ['Vera', null], ['Wim', null], ['Xaver', null]]);
    const closed = await (await api('POST', 'catalog/close', {})).json();
    assert.equal(closed.ok, true);
    await api('DELETE', `catalog/${gong.id}`);
    assert.equal(await es.activeSoundFor('6001', await getSettings()), null, 'gelöschter Katalog-Sound: normaler Ton');
    const b = await (await admin(adminReq('GET', 'backup?media=1', null, cookie))).json();
    for (const prefix of ['award/', 'awardsound/', 'catalog/', 'config/catalog']) assert.ok(Object.keys(b.entries).some((k) => k.startsWith(prefix)), prefix);
    await api('PUT', 'settings', { awardEnabled: false });
    assert.equal((await api('POST', 'catalog/close', {})).status, 400, 'ausgeschaltet');
  });
  delete process.env.LINK_SECRET;
}

await test('Abspiel-Reihenfolge: nacheinander in der Reihenfolge des Eintreffens, Freigabe, abgelaufene Wartende', async () => {
  const { claim, release } = await import('../netlify/lib/playlock.mjs');
  await db.delete('config/playlock');
  const T = 1_000_000;
  assert.deepEqual(await claim({ id: 'alert', at: T, ms: 5000 }, T), { wait: 0 });
  // Soundboard meldet sich als Zweites, Einlaufsound als Drittes: beide müssen warten
  assert.ok((await claim({ id: 'sound', at: T + 10, ms: 3000 }, T + 100)).wait > 0);
  assert.ok((await claim({ id: 'entry', at: T + 20, ms: 3000 }, T + 150)).wait > 0);
  // Alert ist früh fertig: der Einlaufsound darf nicht vor dem Soundboard dran sein
  await release({ id: 'alert' }, T + 1000);
  assert.ok((await claim({ id: 'entry', at: T + 20, ms: 3000 }, T + 1100)).wait > 0, 'Soundboard war zuerst');
  assert.deepEqual(await claim({ id: 'sound', at: T + 10, ms: 3000 }, T + 1200), { wait: 0 });
  assert.ok((await claim({ id: 'entry', at: T + 20, ms: 3000 }, T + 1300)).wait > 0);
  // Ohne Freigabe endet die Sperre nach der angegebenen Länge
  assert.deepEqual(await claim({ id: 'entry', at: T + 20, ms: 3000 }, T + 1200 + 3001), { wait: 0 });
  // Ein Wartender, der verschwindet (Seite neu geladen), blockiert nicht ewig
  await release({ id: 'entry' }, T + 5000);
  assert.ok((await claim({ id: 'weg', at: T + 6000, ms: 1000 }, T + 6000)).wait === 0);
  assert.ok((await claim({ id: 'gone', at: T + 6001, ms: 1000 }, T + 6100)).wait > 0);
  assert.deepEqual(await claim({ id: 'spaet', at: T + 20000, ms: 1000 }, T + 20000), { wait: 0 }, 'Wartender nach Ablauf entfernt');
  await db.delete('config/playlock');
  const fn = (await import('../netlify/functions/playlock.mjs')).default;
  assert.equal((await fn(new Request(BASE + '/api/playlock', { method: 'GET' }))).status, 405);
  assert.equal((await fn(new Request(BASE + '/api/playlock', { method: 'POST', body: '{}' }))).status, 400);
  assert.deepEqual(await (await fn(new Request(BASE + '/api/playlock', { method: 'POST', body: JSON.stringify({ id: 'x', ms: 100 }) }))).json(), { wait: 0 });
});

await test('Commands: anlegen, Befehl mit Rolle und Abklingzeit, Stichwort, mehrere Aktionen nacheinander', async () => {
  await db.delete('config/commands');
  await admin(adminReq('PUT', 'settings', { chatEnabled: true, chatCommands: true, commandCooldown: 0 }, cookie));
  const api = (m, p, b) => admin(adminReq(m, p, b, cookie));
  const cmdMsg = async (text, { id = 'c7', name = 'Chatty', badges = [], mid } = {}) => {
    const before = chats().length;
    const ev = { subscription: { type: 'channel.chat.message' }, event: { broadcaster_user_id: '999', chatter_user_id: id, chatter_user_name: name, badges, message_id: mid ?? 'cm-' + chatN, message: { text } } };
    assert.equal((await webhook(signed('notification', ev, { id: 'cm-' + chatN++ }))).status, 204);
    return chats().slice(before);
  };
  assert.equal((await api('POST', 'commands', { trigger: { type: 'command', word: '' }, actions: [{ type: 'chat', text: 'x' }] })).status, 400, 'Befehl fehlt');
  assert.equal((await api('POST', 'commands', { trigger: { type: 'command', word: 'ant' }, actions: [{ type: 'chat', text: '' }] })).status, 400, 'Aktion ohne Inhalt');
  const made = await (await api('POST', 'commands', {
    name: 'Ant', trigger: { type: 'command', word: 'Ant' }, role: 'all', cooldown: 30,
    actions: [{ type: 'chat', text: 'Hallo {user}, du sagst: {args}' }, { type: 'alert', title: 'Ant!', message: '{user} fragt {args}' }],
  })).json();
  assert.equal(made.trigger.word, '!ant', 'Ausrufezeichen und Kleinschreibung ergänzt');
  assert.equal((await api('POST', 'commands', { trigger: { type: 'command', word: '!ANT' }, actions: [{ type: 'chat', text: 'y' }] })).status, 400, 'Befehl doppelt');

  const cur = await cursor();
  assert.deepEqual(await cmdMsg('!ant ob das klappt'), ['Hallo Chatty, du sagst: ob das klappt']);
  const ev = await eventsSince(cur);
  assert.deepEqual(ev, [{ type: 'alert', kind: 'command', user: 'Chatty', title: 'Ant!', message: 'Chatty fragt ob das klappt' }]);
  assert.deepEqual(await cmdMsg('!ant nochmal', { id: 'c8', name: 'Zweiter' }), [], 'Abklingzeit gilt für alle');
  await db.delete(`cooldown/cmd-${made.id}`);

  // Rolle: nur Mods (Abzeichen), der Kanalinhaber zählt immer
  await api('PUT', `commands/${made.id}`, { role: 'mod', cooldown: 0 });
  assert.deepEqual(await cmdMsg('!ant x'), [], 'ohne Abzeichen');
  assert.equal((await cmdMsg('!ant x', { badges: [{ set_id: 'moderator', id: '1' }] })).length, 1);
  assert.equal((await cmdMsg('!ant x', { id: '999', name: 'Boss' })).length, 1, 'Kanalinhaber');
  assert.deepEqual(await cmdMsg('!ant x', { id: 'c9', name: 'Sub', badges: [{ set_id: 'subscriber', id: '0' }] }), [], 'Sub ist kein Mod');

  // Stichwort: ganzes Wort, nie auf den Kanalinhaber (der Bot schreibt als Kanalinhaber)
  await api('PUT', `commands/${made.id}`, { enabled: false });
  const kw = await (await api('POST', 'commands', { trigger: { type: 'keyword', word: 'Lurk' }, cooldown: 0, actions: [{ type: 'chat', text: 'Viel Spaß, {user}!' }] })).json();
  assert.deepEqual(await cmdMsg('ich lurke nur'), [], 'nur ganze Wörter');
  assert.deepEqual(await cmdMsg('Ich gehe lurk, bis später!'), ['Viel Spaß, Chatty!']);
  assert.deepEqual(await cmdMsg('lurk', { id: '999', name: 'Boss' }), [], 'Kanalinhaber löst kein Stichwort aus');
  await admin(adminReq('PUT', 'settings', { creditsIgnore: 'chatty' }, cookie));
  assert.deepEqual(await cmdMsg('lurk'), [], 'ignorierte Namen (Bots) lösen nichts aus');
  await admin(adminReq('PUT', 'settings', { creditsIgnore: 'nightbot' }, cookie));
  const dupMsg = await cmdMsg('lurk', { mid: 'gleich' }); const again = await cmdMsg('lurk', { mid: 'gleich' });
  assert.equal(dupMsg.length, 1); assert.deepEqual(again, [], 'doppelt zugestellt, nur einmal');

  // Chat-Befehle aus: alles schweigt; Chat aus: nur der Alert
  await api('PUT', `commands/${kw.id}`, { cooldown: 0 });
  await admin(adminReq('PUT', 'settings', { chatCommands: false }, cookie));
  assert.deepEqual(await cmdMsg('lurk'), []);
  await admin(adminReq('PUT', 'settings', { chatCommands: true }, cookie));

  // Test-Knopf, Liste, Löschen
  const cur2 = await cursor();
  await api('PUT', `commands/${made.id}`, { enabled: true });
  assert.equal((await api('POST', `commands/${made.id}/test`, { user: 'Probe' })).status, 200);
  assert.equal((await eventsSince(cur2))[0].message, 'Probe fragt Beispiel');
  const all = await (await api('GET', 'commands')).json();
  assert.equal(all.commands.length, 2);
  assert.equal((await api('DELETE', `commands/${kw.id}`)).status, 200);
  assert.equal((await api('PUT', 'commands/zzzzzzzz', {})).status, 404);
  assert.equal((await admin(adminReq('GET', 'commands'))).status, 401, 'ohne Login');
});

await test('Commands: Timer läuft nur bei Chat-Aktivität, nie doppelt ohne neue Nachrichten, Sound-Aktion nur mit Ton', async () => {
  const { tickTimers, recordPulse } = await import('../netlify/lib/commands.mjs');
  await db.delete('config/commands'); await db.delete('state/chatpulse');
  const settings = await getSettings();
  const api = (m, p, b) => admin(adminReq(m, p, b, cookie));
  const timer = await (await api('POST', 'commands', { trigger: { type: 'timer', minutes: 10, minMessages: 2 }, actions: [{ type: 'alert', title: 'Ping', message: 'Schön, dass ihr da seid' }] })).json();
  assert.deepEqual(timer.trigger, { type: 'timer', minutes: 10, minMessages: 2 });
  const T = Date.now();
  const alerts = async (cur) => (await eventsSince(cur)).filter((e) => e.kind === 'command');
  let cur = await cursor();
  assert.equal(await tickTimers(settings, T), 0, 'ohne Chat nichts');
  await recordPulse(T - 1000);
  assert.equal(await tickTimers(settings, T), 0, 'eine Nachricht reicht nicht');
  await recordPulse(T - 500);
  assert.equal(await tickTimers(settings, T), 1);
  assert.equal((await alerts(cur)).length, 1);
  cur = await cursor();
  assert.equal(await tickTimers(settings, T + 11 * 60_000), 0, 'Zeit vorbei, aber seit dem letzten Mal niemand geschrieben');
  await recordPulse(T + 11 * 60_000 - 200); await recordPulse(T + 11 * 60_000 - 100);
  assert.equal(await tickTimers(settings, T + 5 * 60_000), 0, 'Intervall noch nicht vorbei');
  assert.equal(await tickTimers(settings, T + 11 * 60_000), 1);
  assert.equal((await alerts(cur)).length, 1);
  await api('PUT', `commands/${timer.id}`, { enabled: false });
  await recordPulse(T + 30 * 60_000); await recordPulse(T + 30 * 60_000);
  assert.equal(await tickTimers(settings, T + 31 * 60_000), 0, 'ausgeschaltet');

  // Sound-Aktion: nur Einträge mit Ton
  const snd = await (await api('POST', 'commands', { trigger: { type: 'command', word: '!horn' }, actions: [{ type: 'sound', soundId: 'deadbeef' }] })).json();
  const cur3 = await cursor();
  await api('POST', `commands/${snd.id}/test`, {});
  assert.deepEqual(await eventsSince(cur3), [], 'unbekannter oder tonloser Sound wird übersprungen');
  await db.delete('config/commands'); await db.delete('state/chatpulse');
});

fs.rmSync(process.env.LOCAL_STORE_DIR, { recursive: true, force: true });
console.log(`\n${n} Tests bestanden`);
