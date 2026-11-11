// Test des Heimservers (server.mjs): Weiterleitungen, statische Dateien, Functions, Cookies, Webhook-Signatur.  npm test
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LOCAL_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-server-'));
Object.assign(process.env, {
  TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: 'csecret', EVENTSUB_SECRET: 'hooksecret1234',
  ADMIN_PASSWORD: 'geheim', SITE_URL: 'https://wache.beispiel.de',
});

const { createApp, loadRedirects, matchRoute, loadRoutes, resolveStatic } = await import('../server.mjs');

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const server = await createApp();
const base = await listen(server);
const get = (p, init = {}) => fetch(base + p, { redirect: 'manual', ...init });

let n = 0;
const ok = (name) => { n++; console.log('  ok', name); };

// ---- Gesundheitsprüfung
{
  const r = await get('/healthz');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok');
  ok('healthz');
}

// ---- Weiterleitungen aus netlify.toml
{
  const root = await get('/');
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/admin/');
  const redirects = loadRedirects();
  assert.ok(redirects.length >= 8, 'Weiterleitungen gelesen');
  for (const r of redirects.filter((x) => x.status === 200)) {
    const res = await get(r.from);
    assert.equal(res.status, 200, `${r.from} → ${r.to}`);
    assert.match(res.headers.get('content-type'), /text\/html/);
  }
  ok('Weiterleitungen (302 und Umschreiben auf *.html)');
}

// ---- Statische Dateien
{
  const admin = await get('/admin/');
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /<html/i);
  const noSlash = await get('/admin');
  assert.equal(noSlash.status, 301);
  assert.equal(noSlash.headers.get('location'), '/admin/');

  const css = await get('/stadtwache.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const etag = css.headers.get('etag');
  assert.ok(etag);
  assert.equal((await get('/stadtwache.css', { headers: { 'if-none-match': etag } })).status, 304);
  assert.equal((await get('/stadtwache.css', { method: 'HEAD' })).status, 200);
  assert.equal((await get('/gibt-es-nicht')).status, 404);
  assert.equal((await get('/stadtwache.css', { method: 'POST' })).status, 405);
  ok('statische Dateien, Ordner-Weiterleitung, ETag, 404/405');
}

// ---- Pfade außerhalb von public/ bleiben tabu
{
  for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/..%2fserver.mjs', '/%00', '/%zz']) {
    const r = await get(p);
    assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`);
  }
  assert.equal(resolveStatic('/../package.json'), null);
  ok('kein Zugriff außerhalb von public/');
}

// ---- Routen: genaue Pfade vor Sammelpfaden
{
  const routes = await loadRoutes();
  assert.equal(matchRoute(routes, '/api/admin/state').file, 'admin.mjs');
  assert.equal(matchRoute(routes, '/api/admin').file, 'admin.mjs');
  assert.equal(matchRoute(routes, '/api/leaderboard').file, 'leaderboard.mjs');
  assert.equal(matchRoute(routes, '/api/auth/callback').file, 'auth.mjs');
  assert.equal(matchRoute(routes, '/api/administrator'), undefined);
  assert.equal(matchRoute(routes, '/nix'), undefined);
  ok('Routen-Zuordnung');
}

// ---- Functions
{
  const board = await get('/api/leaderboard');
  assert.ok([200, 404].includes(board.status));
  assert.match(board.headers.get('content-type'), /application\/json/);

  const unauth = await get('/api/admin/state');
  assert.equal(unauth.status, 401);
  ok('Functions antworten (JSON, Anmeldung nötig)');
}

// ---- Login: Cookie mit/ohne Secure je nach Weg ins Haus
{
  const login = (extra = {}) => get('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify({ password: 'geheim' }) });
  const lan = await login();
  assert.equal(lan.status, 200);
  const lanCookie = lan.headers.getSetCookie()[0];
  assert.match(lanCookie, /^session=/);
  assert.doesNotMatch(lanCookie, /Secure/, 'im Heimnetz (http) ohne Secure, sonst klappt der Login dort nicht');

  const tunnel = await login({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'wache.beispiel.de' });
  assert.match(tunnel.headers.getSetCookie()[0], /; Secure/, 'hinter dem Tunnel (https) mit Secure');

  const state = await get('/api/admin/state', { headers: { cookie: lanCookie.split(';')[0] } });
  assert.equal(state.status, 200);

  const wrong = await get('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'falsch' }) });
  assert.equal(wrong.status, 401);
  ok('Login-Cookie (Heimnetz ohne, Tunnel mit Secure), falsches Passwort');
}

// ---- Twitch-Webhook: Signatur
{
  const send = async (type, body, sign = true) => {
    const raw = JSON.stringify(body);
    const id = 'm1', ts = new Date().toISOString();
    const sig = 'sha256=' + crypto.createHmac('sha256', process.env.EVENTSUB_SECRET).update(id + ts + raw).digest('hex');
    return get('/api/twitch-webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': ts,
        'twitch-eventsub-message-type': type, 'twitch-eventsub-message-signature': sign ? sig : 'sha256=falsch',
      },
      body: raw,
    });
  };
  const bad = await send('webhook_callback_verification', { challenge: 'abc' }, false);
  assert.equal(bad.status, 403);
  const good = await send('webhook_callback_verification', { challenge: 'abc123' });
  assert.equal(good.status, 200);
  assert.equal(await good.text(), 'abc123');
  assert.equal((await get('/api/twitch-webhook')).status, 405);
  ok('Webhook: falsche Signatur 403, Verifizierung beantwortet');
}

// ---- Zu große Anfragen
{
  const small = await createApp({ maxBodyMb: 0.001 });
  const smallBase = await listen(small);
  const r = await fetch(smallBase + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(5000) });
  assert.equal(r.status, 413);
  small.close();
  ok('zu große Anfrage → 413');
}

// ---- Dateispeicher: Hilfsdateien tauchen nicht auf, Schreiben ist ersetzend
{
  const { db } = await import('../netlify/lib/kern/store.mjs');
  await db.set('test/a', { v: 1 });
  await db.set('test/a', { v: 2 });
  assert.deepEqual(await db.get('test/a'), { v: 2 });
  assert.equal(await db.setIfNew('test/a', { v: 3 }), false);
  assert.deepEqual(await db.list('test/'), ['test/a']);
  assert.ok(!fs.readdirSync(path.join(process.env.LOCAL_STORE_DIR, 'checkin')).some((f) => f.startsWith('.tmp-')), 'keine Hilfsdateien übrig');
  ok('Dateispeicher: ersetzen, setIfNew, list ohne Hilfsdateien');
}

server.close();
console.log(`\nServer-Test: ${n} Gruppen OK`);
process.exit(0);
