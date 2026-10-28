// Verbindet den Broadcaster-Account per OAuth (nur mit Admin-Login möglich).
import crypto from 'node:crypto';
import { db } from '../lib/store.mjs';
import { cookie, hasSession, parseCookies, safeEqual, text } from '../lib/http.mjs';
import { SCOPES, siteUrl, toStored, tokenRequest } from '../lib/twitch.mjs';

export const config = { path: ['/api/auth/login', '/api/auth/callback'] };

export default async (req) => {
  const url = new URL(req.url);
  if (!hasSession(req)) return text('Bitte zuerst im Admin-Bereich anmelden: /admin/', 401);
  const redirectUri = `${siteUrl(req)}/api/auth/callback`;

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
