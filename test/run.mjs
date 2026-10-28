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
  if (u.pathname.endsWith('/chat/messages')) return ok({ data: [{ is_sent: true }] });
  if (u.pathname.endsWith('/custom_rewards') && entry.method === 'GET') return ok({ data: rewards });
  if (u.pathname.endsWith('/custom_rewards') && entry.method === 'POST') {
    const r = { id: 'reward' + (rewards.length + 1), title: entry.body.title, cost: entry.body.cost, is_enabled: true };
    rewards.push(r);
    return ok({ data: [r] });
  }
  if (u.pathname.endsWith('/custom_rewards') && entry.method === 'PATCH') {
    const r = rewards.find((x) => x.id === entry.query.id); Object.assign(r, entry.body); return ok({ data: [r] });
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
const { streamDay, handleCheckout, fmtDuration } = await import('../netlify/lib/checkin.mjs');
const { getSettings } = await import('../netlify/lib/settings.mjs');

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
  assert.deepEqual(await res.json(), { ok: true, reward: 'Check-in', checkout: 'Check-out' });
  const created = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/eventsub/subscriptions'));
  assert.deepEqual(created.map((c) => c.body.condition.reward_id).sort(), ['reward1', 'reward2']);
  assert.ok(created.every((c) => c.body.transport.method === 'webhook' && c.body.transport.callback === BASE + '/api/twitch-webhook'));
  const state = await db.get('config/state');
  assert.equal(state.rewardId, 'reward1');
  assert.equal(state.checkoutRewardId, 'reward2');
  // Zweites Einrichten legt nichts doppelt an und ersetzt die Subscriptions
  await admin(adminReq('POST', 'setup', {}, cookie));
  assert.equal(rewards.length, 2);
  assert.equal(subs.length, 2);
});

await test('Setup lehnt gleiche Namen für Check-in und Check-out ab', async () => {
  await admin(adminReq('PUT', 'settings', { checkoutRewardTitle: 'Check-in' }, cookie));
  assert.equal((await admin(adminReq('POST', 'setup', {}, cookie))).status, 400);
  await admin(adminReq('PUT', 'settings', { checkoutRewardTitle: 'Check-out' }, cookie));
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

fs.rmSync(process.env.LOCAL_STORE_DIR, { recursive: true, force: true });
console.log(`\n${n} Tests bestanden`);
