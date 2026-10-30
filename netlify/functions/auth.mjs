// Verbindet den Broadcaster-Account per OAuth (nur mit Admin-Login möglich).
import crypto from 'node:crypto';
import { db } from '../lib/store.mjs';
import { cookie, hasSession, makeViewerSession, parseCookies, safeEqual, text } from '../lib/http.mjs';
import { SCOPES, siteUrl, toStored, tokenRequest, userByLogin } from '../lib/twitch.mjs';

export const config = { path: ['/api/auth/login', '/api/auth/viewer', '/api/auth/callback'] };

export default async (req) => {
  const url = new URL(req.url);
  const redirectUri = `${siteUrl(req)}/api/auth/callback`;

  // Zuschauer melden sich ohne Berechtigungen an, damit Twitch bestätigt, wer sie sind (Upload-Seite für den Einlaufsound).
  // Der State beginnt mit „v:“, so landet die Rückkehr im Zuschauer-Zweig und berührt die Tokens des Broadcasters nie.
  if (url.pathname.endsWith('/viewer')) {
    if (!process.env.TWITCH_CLIENT_ID) return text('TWITCH_CLIENT_ID fehlt', 500);
    const state = `v:${crypto.randomUUID()}`;
    const auth = new URL('https://id.twitch.tv/oauth2/authorize');
    auth.search = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: '', state });
    return new Response(null, { status: 302, headers: { Location: auth.toString(), 'Set-Cookie': cookie(req, 'oauth_state', state, 600) } });
  }
  if (url.pathname.endsWith('/callback') && url.searchParams.get('state')?.startsWith('v:')) return viewerCallback(req, url, redirectUri);

  if (!hasSession(req)) return text('Bitte zuerst im Admin-Bereich anmelden: /admin/', 401);

  if (url.pathname.endsWith('/login')) {
    if (!process.env.TWITCH_CLIENT_ID) return text('TWITCH_CLIENT_ID fehlt', 500);
    const state = crypto.randomUUID();
    const auth = new URL('https://id.twitch.tv/oauth2/authorize');
    auth.search = new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
      scope: SCOPES.join(' '), state, force_verify: 'true',
    });
    return new Response(null, { status: 302, headers: { Location: auth.toString(), 'Set-Cookie': cookie(req, 'oauth_state', state, 600) } });
  }

  try {
    const expected = parseCookies(req).oauth_state;
    const state = url.searchParams.get('state');
    if (!expected || !state || !safeEqual(state, expected)) throw new Error('Ungültiger state');
    if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || url.searchParams.get('error'));

    const t = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirectUri });
    const who = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${t.access_token}` } }).then((r) => r.json());
    await db.set('config/tokens', toStored(t, { user_id: who.user_id, login: who.login, scopes: who.scopes ?? [] }));
    return new Response(null, { status: 302, headers: { Location: '/admin/?verbunden=1', 'Set-Cookie': cookie(req, 'oauth_state', '', 0) } });
  } catch (e) {
    return text('Login fehlgeschlagen: ' + e.message, 400);
  }
};

async function viewerCallback(req, url, redirectUri) {
  try {
    const expected = parseCookies(req).oauth_state;
    const state = url.searchParams.get('state');
    if (!expected || !safeEqual(state, expected)) throw new Error('Ungültiger state');
    if (url.searchParams.get('error')) return new Response(null, { status: 302, headers: { Location: '/einlaufsound?abgebrochen=1', 'Set-Cookie': cookie(req, 'oauth_state', '', 0) } });
    const t = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirectUri });
    const who = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${t.access_token}` } }).then((r) => r.json());
    if (!who.user_id) throw new Error('Twitch hat die Anmeldung nicht bestätigt');
    const profile = await userByLogin(who.login).catch(() => null); // Anzeigename mit Groß- und Kleinschreibung
    const headers = new Headers({ Location: '/einlaufsound' });
    headers.append('Set-Cookie', cookie(req, 'viewer', makeViewerSession({ id: who.user_id, name: profile?.display_name || who.login }), 30 * 86400));
    headers.append('Set-Cookie', cookie(req, 'oauth_state', '', 0));
    return new Response(null, { status: 302, headers });
  } catch (e) {
    return text('Anmeldung fehlgeschlagen: ' + e.message, 400);
  }
}
