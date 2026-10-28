// Twitch Kanalpunkte Check-in
// EventSub (WebSocket) -> Check-in speichern -> Chatnachricht + OBS-Overlay (Ton/Animation)
// Keine externen Abhängigkeiten, benötigt Node 22+.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const CONFIG = {
  clientId: env.TWITCH_CLIENT_ID,
  clientSecret: env.TWITCH_CLIENT_SECRET,
  port: Number(env.PORT || 3000),
  rewardTitle: env.REWARD_TITLE || 'Check-in',
  rewardCost: Number(env.REWARD_COST || 1),
  timezone: env.TIMEZONE || 'Europe/Berlin',
  // Der "Stream-Tag" wechselt erst um diese Uhrzeit, damit Streams nach Mitternacht
  // noch zum selben Tag zählen.
  dayRolloverHour: Number(env.DAY_ROLLOVER_HOUR ?? 5),
  chatTemplate: env.CHAT_TEMPLATE || '✅ {user} ist eingecheckt – du warst jetzt schon {count}x dabei! 🎉',
  duplicateTemplate: env.DUPLICATE_TEMPLATE || '{user}, du bist heute schon eingecheckt (Besuch #{count}) ✅ Deine Punkte bekommst du zurück.',
  dataDir: path.resolve(__dirname, env.DATA_DIR || 'data'),
};

const REDIRECT_URI = `http://localhost:${CONFIG.port}/auth/callback`;
const SCOPES = ['channel:read:redemptions', 'channel:manage:redemptions', 'user:write:chat'];

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------- Speicher

fs.mkdirSync(CONFIG.dataDir, { recursive: true });
const CHECKINS_FILE = path.join(CONFIG.dataDir, 'checkins.json');
const TOKENS_FILE = path.join(CONFIG.dataDir, 'tokens.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomar, damit bei einem Absturz nichts kaputtgeht
}

// { users: { [userId]: { name, count, first, last, days: ['2026-10-28', ...] } }, log: [...] }
const db = readJson(CHECKINS_FILE, { users: {}, log: [] });
let tokens = readJson(TOKENS_FILE, null);

// Stream-Tag als YYYY-MM-DD in der eingestellten Zeitzone
function streamDay(date = new Date()) {
  const shifted = new Date(date.getTime() - CONFIG.dayRolloverHour * 3600_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timezone }).format(shifted);
}

/** Zählt den Besuch hoch. Gibt { isNew, count, user } zurück; pro Stream-Tag zählt nur ein Check-in. */
function recordCheckIn(userId, userName) {
  const day = streamDay();
  const u = db.users[userId] ?? (db.users[userId] = { name: userName, count: 0, first: null, last: null, days: [] });
  u.name = userName; // Anzeigename kann sich ändern
  if (u.days.includes(day)) return { isNew: false, count: u.count, day };
  u.days.push(day);
  u.count = u.days.length;
  const now = new Date().toISOString();
  u.first ??= now;
  u.last = now;
  db.log.push({ ts: now, day, userId, name: userName, count: u.count });
  writeJson(CHECKINS_FILE, db);
  return { isNew: true, count: u.count, day };
}

// ---------------------------------------------------------------- Twitch API

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tokenRequest(params) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CONFIG.clientId, client_secret: CONFIG.clientSecret, ...params }),
  });
  if (!res.ok) throw new Error(`Token-Anfrage fehlgeschlagen: ${res.status} ${await res.text()}`);
  return res.json();
}

function storeTokens(t, extra = {}) {
  tokens = {
    ...tokens,
    ...extra,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
  };
  writeJson(TOKENS_FILE, tokens);
}

async function getAccessToken() {
  if (!tokens) throw new Error(`Nicht angemeldet. Öffne http://localhost:${CONFIG.port}/auth/login`);
  if (Date.now() >= tokens.expires_at) {
    storeTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }));
    log('Token erneuert');
  }
  return tokens.access_token;
}

async function helix(method, endpoint, { query, body } = {}) {
  const url = new URL('https://api.twitch.tv/helix/' + endpoint);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      'Client-Id': CONFIG.clientId,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function sendChat(message) {
  await helix('POST', 'chat/messages', {
    body: { broadcaster_id: tokens.user_id, sender_id: tokens.user_id, message },
  });
}

async function setRedemptionStatus(redemption, status) {
  try {
    await helix('PATCH', 'channel_points/custom_rewards/redemptions', {
      query: { id: redemption.id, broadcaster_id: tokens.user_id, reward_id: redemption.reward.id },
      body: { status },
    });
  } catch (e) {
    // Klappt nur bei Rewards, die von dieser App erstellt wurden (siehe README)
    log(`Einlösung konnte nicht auf ${status} gesetzt werden:`, e.message);
  }
}

async function ensureReward() {
  const { data } = await helix('GET', 'channel_points/custom_rewards', {
    query: { broadcaster_id: tokens.user_id, only_manageable_rewards: 'true' },
  });
  const existing = data.find((r) => r.title === CONFIG.rewardTitle);
  if (existing) return existing;
  const created = await helix('POST', 'channel_points/custom_rewards', {
    query: { broadcaster_id: tokens.user_id },
    body: {
      title: CONFIG.rewardTitle,
      cost: CONFIG.rewardCost,
      prompt: 'Check-in für diesen Stream – dein Besuch wird mitgezählt!',
      is_enabled: true,
      background_color: '#9146FF',
    },
  });
  log(`Reward "${CONFIG.rewardTitle}" angelegt`);
  return created.data[0];
}

// ---------------------------------------------------------------- Check-in-Ablauf

const overlayClients = new Set();
function pushOverlay(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of overlayClients) res.write(line);
}

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

// Serialisiert Check-ins, damit schnelle Einlösungen sich nicht überholen
let queue = Promise.resolve();
function handleRedemption(redemption, { dry = false } = {}) {
  queue = queue.then(() => processRedemption(redemption, dry)).catch((e) => log('Fehler:', e.message));
  return queue;
}

async function processRedemption(redemption, dry) {
  const userId = redemption.user_id;
  const userName = redemption.user_name;
  const result = recordCheckIn(userId, userName);
  const vars = { user: userName, count: result.count };

  if (result.isNew) {
    log(`Check-in: ${userName} (#${result.count})`);
    pushOverlay({ type: 'checkin', user: userName, count: result.count });
    if (!dry) {
      await sendChat(fill(CONFIG.chatTemplate, vars)).catch((e) => log('Chat fehlgeschlagen:', e.message));
      await setRedemptionStatus(redemption, 'FULFILLED');
    }
  } else {
    log(`${userName} hat heute schon eingecheckt`);
    if (!dry) {
      await sendChat(fill(CONFIG.duplicateTemplate, vars)).catch((e) => log('Chat fehlgeschlagen:', e.message));
      await setRedemptionStatus(redemption, 'CANCELED'); // Punkte zurückerstatten
    }
  }
  return result;
}

// ---------------------------------------------------------------- EventSub (WebSocket)

const seenMessages = new Set();
let rewardId = null;
let ws = null;

function connectEventSub(url = 'wss://eventsub.wss.twitch.tv/ws', isReconnect = false) {
  const socket = new WebSocket(url);
  let keepaliveTimeout = 30_000;
  let watchdog;
  const arm = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => { log('EventSub: Keepalive verpasst, verbinde neu'); socket.close(); }, keepaliveTimeout + 5_000);
  };

  socket.onopen = () => { arm(); };
  socket.onmessage = async (ev) => {
    arm();
    const msg = JSON.parse(ev.data);
    const type = msg.metadata.message_type;
    if (seenMessages.has(msg.metadata.message_id)) return;
    seenMessages.add(msg.metadata.message_id);
    if (seenMessages.size > 500) seenMessages.delete(seenMessages.values().next().value);

    if (type === 'session_welcome') {
      keepaliveTimeout = (msg.payload.session.keepalive_timeout_seconds || 10) * 1000;
      arm();
      // Bei einem von Twitch angeforderten Reconnect bleiben die Subscriptions bestehen
      if (!isReconnect) {
        try { await subscribe(msg.payload.session.id); } catch (e) { log('Subscription fehlgeschlagen:', e.message); }
      }
    } else if (type === 'session_reconnect') {
      ws = connectEventSub(msg.payload.session.reconnect_url, true);
    } else if (type === 'notification') {
      const e = msg.payload.event;
      if (e.reward.id === rewardId || (!rewardId && e.reward.title === CONFIG.rewardTitle)) {
        handleRedemption({ id: e.id, user_id: e.user_id, user_name: e.user_name, reward: e.reward });
      }
    } else if (type === 'revocation') {
      log('EventSub-Subscription widerrufen:', msg.payload.subscription.status);
    }
  };
  socket.onclose = () => {
    clearTimeout(watchdog);
    if (socket === ws) {
      log('EventSub getrennt, neuer Versuch in 5s');
      setTimeout(() => { if (socket === ws) ws = connectEventSub(); }, 5_000);
    }
  };
  socket.onerror = (e) => log('EventSub-Fehler:', e.message || 'unbekannt');
  return socket;
}

async function subscribe(sessionId) {
  await helix('POST', 'eventsub/subscriptions', {
    body: {
      type: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      condition: { broadcaster_user_id: tokens.user_id, ...(rewardId ? { reward_id: rewardId } : {}) },
      transport: { method: 'websocket', session_id: sessionId },
    },
  });
  log('EventSub aktiv – warte auf Check-ins');
}

async function startTwitch() {
  if (!CONFIG.clientId || !CONFIG.clientSecret) {
    log('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET fehlen – nur Overlay/Test-Modus aktiv.');
    return;
  }
  if (!tokens) {
    log(`Noch nicht angemeldet. Öffne http://localhost:${CONFIG.port}/auth/login im Browser.`);
    return;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      rewardId = (await ensureReward()).id;
      break;
    } catch (e) {
      log(`Reward-Prüfung fehlgeschlagen (${e.message}), neuer Versuch…`);
      await sleep(Math.min(30_000, attempt * 3_000));
    }
  }
  ws = connectEventSub();
}

// ---------------------------------------------------------------- HTTP-Server

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.css': 'text/css', '.png': 'image/png' };
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
let oauthState = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${CONFIG.port}`);

  // Alles außer dem Overlay ist nur vom eigenen Rechner aus erreichbar
  if (!isLocal(req)) { res.writeHead(403).end('Forbidden'); return; }

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': verbunden\n\n');
    overlayClients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => { clearInterval(ping); overlayClients.delete(res); });
    return;
  }

  if (url.pathname === '/auth/login') {
    if (!CONFIG.clientId) { res.writeHead(500).end('TWITCH_CLIENT_ID fehlt in .env'); return; }
    oauthState = crypto.randomUUID();
    const auth = new URL('https://id.twitch.tv/oauth2/authorize');
    auth.search = new URLSearchParams({
      client_id: CONFIG.clientId, redirect_uri: REDIRECT_URI, response_type: 'code',
      scope: SCOPES.join(' '), state: oauthState, force_verify: 'true',
    });
    res.writeHead(302, { Location: auth.toString() }).end();
    return;
  }

  if (url.pathname === '/auth/callback') {
    try {
      if (!oauthState || url.searchParams.get('state') !== oauthState) throw new Error('Ungültiger state');
      oauthState = null;
      const t = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: REDIRECT_URI });
      const who = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${t.access_token}` } }).then((r) => r.json());
      storeTokens(t, { user_id: who.user_id, login: who.login });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<h2>Angemeldet als ${who.login} ✅</h2><p>Du kannst dieses Fenster schließen.</p>`);
      log(`Angemeldet als ${who.login}`);
      if (!ws) startTwitch();
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Login fehlgeschlagen: ' + e.message);
    }
    return;
  }

  // Lokaler Test ohne Twitch: http://localhost:3000/test?user=Max[&id=123]
  if (url.pathname === '/test') {
    const name = url.searchParams.get('user') || 'TestUser';
    const result = await handleRedemption({ id: 'test', user_id: url.searchParams.get('id') || 'test-' + name.toLowerCase(), user_name: name, reward: { id: 'test' } }, { dry: true });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/api/users') {
    const list = Object.entries(db.users)
      .map(([id, u]) => ({ id, name: u.name, count: u.count, first: u.first, last: u.last, days: u.days }))
      .sort((a, b) => b.count - a.count);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(list, null, 2));
    return;
  }

  if (url.pathname === '/api/export.csv') {
    const rows = ['datum,zeitstempel,user,besuch_nr', ...db.log.map((l) => `${l.day},${l.ts},${l.name},${l.count}`)];
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' }).end(rows.join('\n'));
    return;
  }

  // Statische Dateien (Overlay)
  let file = url.pathname === '/' || url.pathname === '/overlay' ? '/overlay.html' : url.pathname;
  const full = path.join(__dirname, 'public', path.normalize(file));
  if (!full.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

// Nur an localhost binden: OBS läuft auf demselben Rechner
server.listen(CONFIG.port, '127.0.0.1', () => {
  log(`Server läuft: http://localhost:${CONFIG.port}`);
  log(`OBS Browser-Quelle: http://localhost:${CONFIG.port}/overlay`);
  startTwitch();
});
