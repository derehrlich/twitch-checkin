// Ende-zu-Ende-Test der Admin-Oberfläche: echter Browser, echte Netlify-Functions (lokal), simuliertes Twitch.
// Braucht Playwright (nicht Teil der Abhängigkeiten):  NODE_PATH=$(npm root -g) node test/e2e/admin.mjs
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
process.env.LOCAL_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
Object.assign(process.env, { TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: 'cs', EVENTSUB_SECRET: 'hooksecret1234', ADMIN_PASSWORD: 'geheim', SITE_URL: 'http://localhost:8092' });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-files-')); // Dateien für die Uploads

// ---- Twitch simulieren
const realFetch = globalThis.fetch; const rewards = []; let subs = []; let n = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); if (u.hostname === 'localhost') return realFetch(url, init);
  const ok = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  const body = init.body && !String(init.body).includes('=') ? JSON.parse(init.body) : null; const m = init.method || 'GET';
  if (u.host === 'id.twitch.tv') return ok({ access_token: 't', refresh_token: 'r', expires_in: 3600 });
  if (u.pathname.endsWith('/custom_rewards')) {
    if (m === 'GET') return ok({ data: rewards });
    if (m === 'POST') { const r = { id: 'rw' + ++n, title: body.title, cost: body.cost, is_enabled: body.is_enabled ?? true }; rewards.push(r); return ok({ data: [r] }); }
    if (m === 'PATCH') { const r = rewards.find((x) => x.id === u.searchParams.get('id')); Object.assign(r, body); return ok({ data: [r] }); }
    if (m === 'DELETE') { const i = rewards.findIndex((x) => x.id === u.searchParams.get('id')); if (i >= 0) rewards.splice(i, 1); return new Response(null, { status: 204 }); }
  }
  if (u.pathname.endsWith('/eventsub/subscriptions')) {
    if (m === 'GET') return ok({ data: subs });
    if (m === 'DELETE') { subs = subs.filter((x) => x.id !== u.searchParams.get('id')); return ok({}); }
    const s = { id: 's' + ++n, status: 'enabled', condition: body.condition, transport: body.transport }; subs.push(s); return ok({ data: [s] });
  }
  if (u.pathname.endsWith('/chat/messages')) return ok({ data: [{ is_sent: true }] });
  if (u.pathname.endsWith('/helix/users')) { const login = u.searchParams.get('login'); return ok({ data: login === 'zweite' ? [{ id: '202', login, display_name: 'Zweite' }] : login ? [{ id: '201', login, display_name: 'RaiderIn' }] : [] }); }
  return ok({ data: [] });
};

const { db } = await import(root + '/netlify/lib/store.mjs');
const fn = {
  admin: (await import(root + '/netlify/functions/admin.mjs')).default, overlay: (await import(root + '/netlify/functions/overlay.mjs')).default,
  sound: (await import(root + '/netlify/functions/sound.mjs')).default, image: (await import(root + '/netlify/functions/image.mjs')).default,
  soundboard: (await import(root + '/netlify/functions/soundboard.mjs')).default,
  credits: (await import(root + '/netlify/functions/credits.mjs')).default, leaderboard: (await import(root + '/netlify/functions/leaderboard.mjs')).default,
};
await db.set('config/tokens', { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3_600_000, user_id: '999', login: 'streamerin', scopes: ['channel:read:redemptions', 'channel:manage:redemptions', 'user:write:chat', 'moderator:manage:shoutouts', 'moderator:read:followers', 'channel:read:subscriptions', 'bits:read', 'user:read:chat', 'user:bot', 'channel:bot'] });
await db.set('user/1', { name: 'Stammgast', count: 2, first: '2030-01-01T10:00:00Z', last: '2030-01-02T10:00:00Z', days: ['2030-01-01', '2030-01-02'], sessions: { '2030-01-01': { in: 'x', out: 'y', minutes: 90 } } });

const types = { css: 'text/css', js: 'text/javascript', html: 'text/html', png: 'image/png', woff2: 'font/woff2' };
const srv = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://localhost:8092');
  const route = { '/api/overlay': fn.overlay, '/api/sound': fn.sound, '/api/image': fn.image, '/api/soundboard': fn.soundboard, '/api/credits': fn.credits, '/api/leaderboard': fn.leaderboard };
  const handler = u.pathname.startsWith('/api/admin/') ? fn.admin : route[u.pathname];
  if (handler) {
    const chunks = []; for await (const c of q) chunks.push(c);
    const res = await handler(new Request(u, { method: q.method, headers: q.headers, body: ['GET', 'HEAD'].includes(q.method) ? undefined : Buffer.concat(chunks) }));
    r.writeHead(res.status, Object.fromEntries(res.headers)); return r.end(Buffer.from(await res.arrayBuffer()));
  }
  let p = u.pathname === '/' ? '/admin/' : ['/abspann', '/rangliste', '/overlay'].includes(u.pathname) ? u.pathname + '.html' : u.pathname; if (p.endsWith('/')) p += 'index.html'; // /abspann und Co. wie die Weiterleitungen in netlify.toml
  fs.readFile(path.join(root, 'public', p), (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[p.split('.').pop()] ?? 'application/octet-stream'); r.end(d); });
}).listen(8092);

const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errs.push('console: ' + m.text()); });
let step = 0; const ok = (m) => console.log(`✓ ${++step}. ${m}`);
const toastText = async () => (await page.locator('#toast').textContent()) ?? '';

// 1. Anmeldung
await page.goto('http://localhost:8092/admin/');
await page.waitForSelector('#loginForm:visible');
await page.fill('#pw', 'falsch'); await page.click('#loginForm button'); await page.waitForTimeout(1200);
assert.equal(await page.locator('#app').isHidden(), true); ok('falsches Passwort bleibt auf der Anmeldung');
await page.fill('#pw', 'geheim'); await page.click('#loginForm button');
await page.waitForSelector('#app:visible'); ok('Anmeldung klappt');

// 2. Reiter
assert.equal(await page.locator('.tabs button').count(), 10);
const visiblePanels = async () => page.locator('.tab-panel:visible').evaluateAll((els) => els.map((e) => e.dataset.panel));
assert.deepEqual(await visiblePanels(), ['start']);
await page.waitForFunction(() => document.querySelectorAll('#checks .check').length >= 5);
const checks = await page.locator('#checks').innerText(); assert.match(checks, /Mit Twitch verbunden als streamerin/);
assert.match(await page.inputValue('#overlayUrl'), /\/overlay$/); ok('Start: Status und OBS-Adresse');
for (const tab of ['checkin', 'alerts', 'raids', 'soundboard', 'medien', 'besucher', 'tests', 'allgemein']) {
  await page.click(`.tabs button[data-tab="${tab}"]`); assert.deepEqual(await visiblePanels(), [tab]); assert.equal(await page.evaluate(() => location.hash), '#' + tab);
}
ok('alle 9 Reiter schalten um und setzen die Adresse (#reiter)');
await page.goto('http://localhost:8092/admin/#alerts'); await page.waitForSelector('#app:visible');
assert.deepEqual(await visiblePanels(), ['alerts']); ok('Direktlink #alerts öffnet den Reiter');

// 3. Einstellungen: Formulare aus dem Schema, Änderung -> Speichern-Leiste, Reiter-Markierung, Speichern, Abgleich-Hinweis
const ids = await page.evaluate(() => [...document.querySelectorAll('[data-setting]')].map((e) => e.id));
assert.ok(ids.length > 60, 'Felder: ' + ids.length); assert.equal(new Set(ids).size, ids.length, 'doppelte Feld-IDs');
assert.equal(await page.locator('#savebar').isHidden(), true);
await page.check('#alertsEnabled'); await page.fill('#followTitle', 'Willkommen!');
assert.equal(await page.locator('#savebar').isVisible(), true);
assert.equal(await page.locator('.tabs button[data-tab="alerts"]').evaluate((e) => e.classList.contains('dirty')), true); ok('Änderung zeigt die Speichern-Leiste und markiert den Reiter');
await page.click('#discard'); assert.equal(await page.isChecked('#alertsEnabled'), false); assert.equal(await page.inputValue('#followTitle'), 'Neuer Follower!');
assert.equal(await page.locator('#savebar').isHidden(), true); ok('Verwerfen stellt den gespeicherten Stand wieder her');
await page.check('#alertsEnabled'); await page.fill('#followTitle', 'Willkommen!'); await page.click('#save');
await page.waitForSelector('#savebar.hidden', { state: 'attached' }); assert.match(await toastText(), /Gespeichert/); assert.match(await toastText(), /abgleichen/);
assert.equal(await page.locator('#syncHint').isVisible(), true); ok('Speichern klappt und weist auf den nötigen Abgleich hin');
await page.reload(); await page.waitForSelector('#app:visible');
assert.equal(await page.isChecked('#alertsEnabled'), true); assert.equal(await page.inputValue('#followTitle'), 'Willkommen!'); ok('Einstellungen sind nach dem Neuladen noch da');
// Vorschau
await page.click('.tabs button[data-tab="checkin"]'); await page.fill('#chatTemplate', 'Hi {user} #{count} 🔥{streak}');
assert.match(await page.locator('[data-preview="chatTemplate"]').textContent(), /Hi Max #7 🔥5/); ok('Vorschau der Chatnachricht aktualisiert sich');
await page.click('#discard');

// 4. Abgleichen
await page.click('.tabs button[data-tab="start"]'); await page.click('.js-sync >> nth=1');
await page.waitForFunction(() => document.getElementById('syncHint').classList.contains('hidden'));
assert.equal(rewards.length >= 3, true); assert.equal(subs.some((s) => s.condition.to_broadcaster_user_id === '999'), true); ok('Rewards und Webhooks werden bei Twitch abgeglichen');
await page.waitForFunction(() => document.getElementById('checks').innerText.includes('Webhooks aktiv')); ok('Status zeigt: Webhooks aktiv');

// 5. Soundboard
await page.click('.tabs button[data-tab="soundboard"]');
await page.fill('#newBoardTitle', 'Airhorn'); await page.fill('#newBoardCost', '300'); await page.click('#addBoard');
await page.waitForSelector('#boardRows [data-id]'); assert.equal(await page.locator('#boardRows [data-id]').count(), 1);
fs.writeFileSync(S + '/horn.wav', Buffer.concat([Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVE'), Buffer.alloc(60)]));
await page.setInputFiles('#boardRows [data-f=file]', S + '/horn.wav'); await page.click('#boardRows [data-act=upload]');
await page.waitForFunction(() => document.querySelector('#boardRows').innerText.includes('horn.wav')); ok('Soundboard: Eintrag anlegen und Ton hochladen');
await page.click('.js-sync >> nth=3'); await page.waitForFunction(() => document.querySelector('#boardRows').innerText.includes('Reward: angelegt'));
assert.equal(rewards.some((r) => r.title === 'Airhorn' && r.cost === 300 && r.is_enabled), true); ok('Soundboard: Reward in Twitch angelegt');
await page.click('#boardRows [data-act=test]'); await page.waitForTimeout(400);
let poll = await (await realFetch('http://localhost:8092/api/overlay')).json();
const since = poll.cursor;
// 6. Medien
await page.click('.tabs button[data-tab="medien"]');
assert.equal(await page.locator('#soundRows [data-slot]').count(), 10); assert.equal(await page.locator('#imageRows [data-slot]').count(), 7);
await page.setInputFiles('#soundRows [data-slot=follow] input[type=file]', S + '/horn.wav'); await page.click('#soundRows [data-slot=follow] [data-act=up]');
await page.waitForFunction(() => document.querySelector('#soundRows [data-slot=follow]').innerText.includes('horn.wav'));
fs.writeFileSync(S + '/bild.gif', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30)]));
await page.setInputFiles('#imageRows [data-slot=follow] input[type=file]', S + '/bild.gif'); await page.click('#imageRows [data-slot=follow] [data-act=up]');
await page.waitForFunction(() => document.querySelector('#imageRows [data-slot=follow]').innerText.includes('bild.gif'));
poll = await (await realFetch('http://localhost:8092/api/overlay')).json(); assert.ok(poll.sounds.follow && poll.images.follow); ok('Medien: Ton und GIF je Alert hochladen, Overlay kennt beides');
// Upload darf ungespeicherte Formularwerte nicht überschreiben
await page.click('.tabs button[data-tab="allgemein"]'); await page.fill('#timezone', 'Europe/Paris');
await page.click('.tabs button[data-tab="medien"]'); await page.setInputFiles('#soundRows [data-slot=raid] input[type=file]', S + '/horn.wav'); await page.click('#soundRows [data-slot=raid] [data-act=up]');
await page.waitForFunction(() => document.querySelector('#soundRows [data-slot=raid]').innerText.includes('horn.wav'));
assert.equal(await page.inputValue('#timezone'), 'Europe/Paris'); ok('Upload lässt ungespeicherte Änderungen in den Formularen stehen');
await page.click('#discard');

// 7. Tests
await page.click('.tabs button[data-tab="tests"]'); await page.fill('#testUser', 'Tester');
await page.click('[data-test=alert-follow]'); await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'));
await page.click('[data-test=alert-cheer]'); await page.click('[data-test=milestone]'); await page.waitForTimeout(500);
const events = (await (await realFetch('http://localhost:8092/api/overlay?since=' + encodeURIComponent(since))).json()).events;
const kinds = events.map((e) => e.type + (e.kind ? ':' + e.kind : '')); assert.ok(kinds.includes('alert:follow') && kinds.includes('alert:cheer') && kinds.includes('checkin'), kinds.join());
assert.equal(events.find((e) => e.kind === 'follow').title, 'Willkommen!'); ok('Tests: Follow, Bits und Meilenstein erreichen das Overlay (mit dem gespeicherten Titel)');

// 8. Besucher
await page.click('.tabs button[data-tab="besucher"]'); await page.waitForSelector('#users tr.user');
assert.match(await page.locator('#users').innerText(), /Stammgast/); await page.click('#users tr.user');
await page.waitForSelector('#detail:visible'); assert.match(await page.locator('#dName').innerText(), /Stammgast – 2 Besuche/); ok('Besucher: Liste und Detail');
await page.fill('#addDay', '2030-01-05'); await page.click('#addDayBtn'); await page.waitForFunction(() => document.getElementById('dName').innerText.includes('3 Besuche'));
await page.click('#dDays button[data-day="2030-01-05"]', { trial: true }).catch(() => {}); ok('Besucher: Besuch nachtragen');

// Raids: Übersicht und Mehrfach-Eintrag
await page.click('.tabs button[data-tab="raids"]'); await page.waitForSelector('#raidList');
await page.fill('#raidBulk', 'raiderin 4\nzweite 2'); await page.click('#raidBulkBtn');
await page.waitForFunction(() => document.getElementById('raidList').innerText.includes('Nachgetragen'));
assert.match(await page.locator('#raidList').innerText(), /4/); assert.match(await page.locator('#raidBulkInfo').innerText(), /eingetragen/);
await page.click('#raidList tr[data-name]'); assert.notEqual(await page.inputValue('#raidSeedLogin'), ''); ok('Raids: Übersicht und mehrere Kanäle auf einmal eintragen');

// Chat & Abspann: Einstellungen speichern, Seiten laden
await page.click('.tabs button[data-tab="abspann"]'); await page.waitForSelector('#streakCommand:visible');
assert.equal(await page.inputValue('#streakCommand'), '!streak'); assert.equal(await page.locator('#creditsEnabled').isChecked(), true);
await page.fill('#topCommand', '!bestenliste'); await page.fill('#creditsTitle', 'Bis bald!'); await page.click('#save');
await page.waitForFunction(() => document.getElementById('toast').innerText.includes('Gespeichert'));
assert.match(await page.locator('#boardUrl').innerText(), /\/rangliste$/);
const abs = await b.newPage({ viewport: { width: 1280, height: 900 } }); const absErrs = []; abs.on('pageerror', (e) => absErrs.push(e.message));
await abs.goto('http://localhost:8092/abspann?demo'); await abs.waitForSelector('#roll h1');
assert.equal(await abs.locator('#roll h1').innerText(), 'Danke fürs Zuschauen!');
await abs.goto('http://localhost:8092/abspann'); await abs.waitForSelector('#roll h1');
assert.equal(await abs.locator('#roll h1').innerText(), 'Bis bald!', 'Überschrift kommt aus den Einstellungen');
await abs.goto('http://localhost:8092/rangliste'); await abs.waitForSelector('#grid section');
assert.equal(await abs.locator('#grid section').count(), 5); assert.deepEqual(absErrs, []);
await abs.close(); ok('Chat & Abspann: Einstellungen, Abspann und Rangliste laden');

// 9. Abmelden
await page.click('#logout'); await page.waitForSelector('#login:visible'); ok('Abmelden zeigt wieder die Anmeldung');
console.log('Fehler im Browser:', JSON.stringify(errs));
assert.deepEqual(errs, []);

await b.close(); srv.close(); fs.rmSync(process.env.LOCAL_STORE_DIR, { recursive: true, force: true }); fs.rmSync(S, { recursive: true, force: true }); process.exit(0);
