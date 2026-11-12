// Öffentlicher Bereich des Gewinnspiels. Von außen ist ohne Login NUR dieser Pfad (/gewinn/...) erreichbar:
//   GET  /gewinn/<code>                Seite für den persönlichen Gewinner-Link
//   GET  /gewinn/api/<code>            Stand des Links (Preis, Frist, was zu tun ist)
//   POST /gewinn/api/<code>/confirm    Gewinn melden (Key-Preis: zeigt danach den Key)
//   POST /gewinn/api/<code>/address    Adresse senden (nur Sachpreise)
//   GET  /gewinn/overlay               OBS-Browserquelle für die Live-Ziehung (zeigt erst nach der Ziehung etwas, nur Gewinner)
//   GET  /gewinn/api/overlay           Daten dafür
//   GET  /gewinn/bedingungen           Teilnahmebedingungen (erst sichtbar, wenn im Dashboard veröffentlicht)
// Teilnehmerlisten, Protokolle und Adressen gibt es hier nicht, sie liegen hinter dem Admin-Login (/api/admin/gewinn).
import fs from 'node:fs';
import { getSettings } from '../lib/kern/settings.mjs';
import { json } from '../lib/kern/http.mjs';
import { byCode, confirmCode, currentDraw, overlayView, publicView, submitAddress } from '../lib/belohnungen/gewinn.mjs';

export const config = { path: ['/gewinn', '/gewinn/*'] };

// ---- Missbrauchsabwehr (im Speicher, reicht für einen einzelnen Server)
const hits = new Map(); // ip -> { reqs: [Zeiten], fails: [Zeiten] }
const WINDOW = 15 * 60_000, MAX_FAILS = 10, MAX_REQS = 120;
export const resetLimits = () => hits.clear();
const ipOf = (req) => (req.headers.get('cf-connecting-ip') || String(req.headers.get('x-forwarded-for') || '').split(',')[0] || 'unbekannt').trim();
function limited(ip, now = Date.now()) {
  const h = hits.get(ip) ?? { reqs: [], fails: [] };
  h.reqs = h.reqs.filter((t) => now - t < 60_000); h.fails = h.fails.filter((t) => now - t < WINDOW);
  h.reqs.push(now); hits.set(ip, h);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.reqs.length && !v.fails.length) hits.delete(k);
  return h.fails.length >= MAX_FAILS || h.reqs.length > MAX_REQS;
}
const fail = (ip, now = Date.now()) => { const h = hits.get(ip); if (h) h.fails.push(now); };

const SEC = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};
const page = (file) => new Response(fs.readFileSync(new URL(`../../public/${file}`, import.meta.url)), { headers: { 'content-type': 'text/html; charset=utf-8', ...SEC } });
const out = (data, status = 200) => json(data, status, SEC);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isPrivateHost = (h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(h) || /^[\d.]+(:\d+)?$/.test(h);

export default async (req) => {
  const url = new URL(req.url);
  // HTTPS erzwingen, wenn die Stadtwache über eine https-Adresse läuft (Cloudflare Tunnel liefert https). Im Heimnetz per IP bleibt http erlaubt.
  if (url.protocol === 'http:' && /^https:/.test(process.env.SITE_URL ?? '') && !isPrivateHost(url.host)) {
    return req.method === 'GET' ? new Response(null, { status: 308, headers: { location: `https://${url.host}${url.pathname}${url.search}` } }) : out({ error: 'Nur über https' }, 403);
  }
  const route = url.pathname.replace(/^\/gewinn\/?/, '').split('/').filter(Boolean);
  const method = req.method;

  if (route[0] === 'overlay' && !route[1] && method === 'GET') return page('gewinn-overlay.html');
  if (route[0] === 'api' && route[1] === 'overlay' && method === 'GET') return out(await overlayView(await getSettings()));

  if (route[0] === 'bedingungen' && method === 'GET') {
    const draw = await currentDraw();
    if (!draw?.termsPublished) return new Response('Die Teilnahmebedingungen sind noch nicht veröffentlicht.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...SEC } });
    return new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teilnahmebedingungen</title><body style="font:16px/1.55 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px"><h1>Teilnahmebedingungen: ${esc(draw.name)}</h1><div style="white-space:pre-wrap">${esc(draw.terms)}</div>`, { headers: { 'content-type': 'text/html; charset=utf-8', ...SEC } });
  }

  // Alles Weitere gehört zu einem persönlichen Link
  const apiCall = route[0] === 'api';
  const code = apiCall ? route[1] : route[0];
  if (!code || (!apiCall && route.length > 1)) return new Response('Nicht gefunden', { status: 404, headers: SEC });
  const ip = ipOf(req);
  if (limited(ip)) return out({ error: 'Zu viele Versuche. Bitte warte ein paar Minuten.' }, 429);

  if (!apiCall) {
    if (method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (!(await byCode(code))) { fail(ip); return new Response('Dieser Link ist ungültig.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...SEC } }); }
    return page('gewinn.html');
  }
  if (method === 'GET' && !route[2]) {
    const v = await publicView(code);
    if (!v) { fail(ip); return out({ error: 'Link ungültig' }, 404); }
    return out(v);
  }
  if (method === 'POST' && ['confirm', 'address'].includes(route[2])) {
    if (!req.headers.get('content-type')?.includes('application/json')) return out({ error: 'Content-Type muss application/json sein' }, 415);
    const body = await req.json().catch(() => ({}));
    const res = route[2] === 'confirm' ? await confirmCode(code, await getSettings()) : await submitAddress(code, body);
    if (res.error) { if (res.status === 404) fail(ip); return out({ error: res.error }, res.status); }
    return out(res);
  }
  return out({ error: 'Not found' }, 404);
};
