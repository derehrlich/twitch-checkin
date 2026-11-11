// Eigener Server für den Betrieb zu Hause (CasaOS/Docker) statt auf Netlify.
// Er macht nichts Neues: Er lädt die vorhandenen Functions (netlify/functions/*.mjs, Format Request → Response),
// liefert public/ aus und setzt die Weiterleitungen aus netlify.toml um. Die Daten liegen in Dateien (LOCAL_STORE_DIR).
//
//   node server.mjs        (Port aus PORT, Standard 3000)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

// Muss vor dem Laden der Functions feststehen: store.mjs entscheidet beim Import, ob Dateien oder Netlify Blobs genutzt werden.
process.env.LOCAL_STORE_DIR ||= path.join(ROOT, 'data');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.zip': 'application/zip', '.map': 'application/json',
};

// Functions laden. Genaue Pfade gehen vor Sammelpfaden ("/api/admin/*"), längere Sammelpfade vor kürzeren.
export async function loadRoutes(dir = path.join(ROOT, 'netlify/functions')) {
  const routes = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    if (typeof mod.default !== 'function' || !mod.config?.path) continue;
    for (const pattern of [].concat(mod.config.path)) {
      const wild = pattern.endsWith('/*');
      routes.push({ pattern, wild, base: wild ? pattern.slice(0, -2) : pattern, handler: mod.default, file });
    }
  }
  return routes.sort((a, b) => Number(a.wild) - Number(b.wild) || b.base.length - a.base.length);
}

export const matchRoute = (routes, pathname) =>
  routes.find((r) => (r.wild ? pathname === r.base || pathname.startsWith(r.base + '/') : pathname === r.base));

// Die [[redirects]] aus netlify.toml (from, to, status). Status 200 heißt: Inhalt der Zielseite ausliefern, Adresse bleibt.
export function loadRedirects(file = path.join(ROOT, 'netlify.toml')) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const block of fs.readFileSync(file, 'utf8').split('[[redirects]]').slice(1)) {
    const from = /^\s*from\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const to = /^\s*to\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const status = Number(/^\s*status\s*=\s*(\d+)/m.exec(block)?.[1] ?? 301);
    if (from && to) out.push({ from, to, status });
  }
  return out;
}

// Pfad in public/ auflösen, ohne aus dem Ordner auszubrechen. Gibt { file } oder { redirect } oder null zurück.
export function resolveStatic(pathname, publicDir = PUBLIC_DIR) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  if (rel.includes('\0')) return null;
  const target = path.join(publicDir, path.normalize(rel));
  if (target !== publicDir && !target.startsWith(publicDir + path.sep)) return null;
  const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };
  const s = stat(target);
  if (s?.isDirectory()) {
    if (!pathname.endsWith('/')) return { redirect: pathname + '/' };
    const index = path.join(target, 'index.html');
    return stat(index)?.isFile() ? { file: index } : null;
  }
  if (s?.isFile()) return { file: target };
  const html = stat(target + '.html');
  return html?.isFile() ? { file: target + '.html' } : null;
}

async function serveFile(req, res, file) {
  const s = fs.statSync(file);
  const etag = `"${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}"`;
  const headers = {
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'public, max-age=0, must-revalidate',
    etag,
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, { ...headers, 'content-length': s.size });
  if (req.method === 'HEAD') return res.end();
  await pipeline(fs.createReadStream(file), res);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { chunks.length = 0; req.pause(); reject(Object.assign(new Error('zu groß'), { status: 413 })); return; }
      if (size <= limit) chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Die Adresse so bauen, wie der Besucher sie sieht. Hinter dem Cloudflare-Tunnel steht X-Forwarded-Proto: https.
// Ohne den Header (direkter Aufruf im Heimnetz) ist es http, sonst bekäme der Login-Cookie ein „Secure" und ginge dort nicht.
async function toRequest(req, limit) {
  const first = (v) => String(Array.isArray(v) ? v[0] : v ?? '').split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) === 'https' ? 'https' : 'http';
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host) || 'localhost';
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const init = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method)) init.body = await readBody(req, limit);
  return new Request(`${proto}://${host}${req.url}`, init);
}

async function sendResponse(res, response, method) {
  const headers = {};
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  if (method === 'HEAD' || !response.body) return res.end();
  await pipeline(Readable.fromWeb(response.body), res);
}

export async function createApp({ maxBodyMb = Number(process.env.MAX_BODY_MB) || 100 } = {}) {
  const routes = await loadRoutes();
  const redirects = loadRedirects();
  const limit = maxBodyMb * 1024 * 1024;

  const plain = (res, status, body, close = false) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...(close ? { connection: 'close' } : {}) });
    res.end(body);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://x').pathname;

      if (pathname === '/healthz') return plain(res, 200, 'ok');

      // Weiterleitungen aus netlify.toml
      const rule = redirects.find((r) => r.from === pathname);
      let servePath = pathname;
      if (rule) {
        if (rule.status === 200) servePath = rule.to;
        else { res.writeHead(rule.status, { location: rule.to, 'cache-control': 'no-store' }); return res.end(); }
      }

      const route = rule ? null : matchRoute(routes, pathname);
      if (route) {
        let request;
        try { request = await toRequest(req, limit); } catch (e) {
          if (e.status === 413) { res.once('finish', () => req.destroy()); return plain(res, 413, 'Anfrage zu groß', true); }
          return plain(res, 400, 'Ungültige Anfrage');
        }
        let response;
        try { response = await route.handler(request, {}); } catch (e) {
          console.error(`Fehler in ${route.file}:`, e);
          response = new Response(JSON.stringify({ error: 'Interner Fehler' }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
        }
        return await sendResponse(res, response, req.method);
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405, 'Method not allowed');
      const found = resolveStatic(servePath);
      if (found?.redirect) { res.writeHead(301, { location: found.redirect + new URL(req.url, 'http://x').search }); return res.end(); }
      if (found?.file) return await serveFile(req, res, found.file);
      return plain(res, 404, 'Nicht gefunden');
    } catch (e) {
      console.error('Serverfehler:', e);
      if (!res.headersSent) plain(res, 500, 'Interner Fehler'); else res.destroy();
    }
  });
  return server;
}

// Beim direkten Start: Hinweise zur Einrichtung ausgeben (nie die Werte selbst) und lauschen.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'EVENTSUB_SECRET', 'ADMIN_PASSWORD', 'SITE_URL'].filter((k) => !process.env[k]);
  if (missing.length) console.warn('Hinweis: Diese Einstellungen fehlen noch:', missing.join(', '));
  if (process.env.SITE_URL && !/^https?:\/\/[^/]+$/.test(process.env.SITE_URL)) console.warn('Hinweis: SITE_URL sollte so aussehen: https://wache.beispiel.de (ohne Schrägstrich am Ende).');
  fs.mkdirSync(process.env.LOCAL_STORE_DIR, { recursive: true });

  process.on('unhandledRejection', (e) => console.error('Unbehandelter Fehler:', e));
  const port = Number(process.env.PORT) || 3000;
  const server = await createApp();
  server.listen(port, () => console.log(`Stadtwache läuft auf Port ${port}, Daten in ${process.env.LOCAL_STORE_DIR}`));
  // Nächtliche Sicherung: alle 10 Minuten nachsehen, ob heute schon gesichert wurde
  const { backupTick } = await import('./netlify/lib/system/autobackup.mjs');
  const tick = () => backupTick().then((r) => { if (r) console.log(r.ok ? `Sicherung angelegt: ${r.name}` : r.error); }).catch((e) => console.error('Sicherung:', e.message));
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 10 * 60_000).unref();
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}
