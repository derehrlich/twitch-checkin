import crypto from 'node:crypto';

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export const text = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(req, name, value, maxAgeSeconds) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

// Session: signierter Cookie mit Ablaufzeit. Schlüssel ist SESSION_SECRET oder das Admin-Passwort.
const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

export const adminEnabled = () => Boolean(process.env.ADMIN_PASSWORD);
export const checkPassword = (pw) => adminEnabled() && safeEqual(pw ?? '', process.env.ADMIN_PASSWORD);

export function makeSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 7 * 86_400_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function hasSession(req) {
  if (!adminEnabled()) return false;
  const [payload, sig] = (parseCookies(req).session || '').split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

// Zuschauer-Anmeldung (Upload-Seite für den Einlaufsound): eigener Cookie, enthält nur Twitch-ID und Anzeigename.
// Ohne SESSION_SECRET oder ADMIN_PASSWORD gibt es keine Anmeldung, weil sich der Cookie nicht signieren ließe.
export function makeViewerSession({ id, name }) {
  const payload = Buffer.from(JSON.stringify({ id, name, exp: Date.now() + 30 * 86_400_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function viewerFrom(req) {
  if (!secret()) return null;
  const [payload, sig] = (parseCookies(req).viewer || '').split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return v.exp > Date.now() && /^\d{1,20}$/.test(String(v.id)) ? { id: String(v.id), name: String(v.name || '') } : null;
  } catch { return null; }
}

export { safeEqual };
