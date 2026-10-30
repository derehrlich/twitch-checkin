// Verknüpfungsseite (/verknuepfen): Die Person kommt mit einem Link vom VerwirrBot (/verknuepfen im Discord), meldet sich mit
// Twitch an und stimmt ausdrücklich zu. Erst dann wird verknüpft. Löschen ist hier jederzeit möglich.
import { getSettings } from '../lib/settings.mjs';
import { cookie, json, parseCookies, viewerFrom } from '../lib/http.mjs';
import { linkByTwitch, monthBoard, removeLink, saveLink, secretSet, verifyLinkToken } from '../lib/community.mjs';

export const config = { path: ['/api/verknuepfen', '/api/verknuepfen/*'] };

const tokenFrom = (req, body) => verifyLinkToken(body?.t ?? new URL(req.url).searchParams.get('t') ?? parseCookies(req).link_token);

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/verknuepfen\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  const settings = await getSettings();
  const enabled = settings.communityEnabled && secretSet();
  const viewer = viewerFrom(req);
  const writes = method === 'POST';
  if (writes && !req.headers.get('content-type')?.includes('application/json')) return json({ error: 'Content-Type muss application/json sein' }, 415);
  const body = writes ? await req.json().catch(() => ({})) : {};

  if (route[0] === 'me' && method === 'GET') {
    const invite = tokenFrom(req);
    const link = viewer ? await linkByTwitch(viewer.id) : null;
    return json({ enabled, loggedIn: Boolean(viewer), name: viewer?.name ?? null, invite: invite ? { discordName: invite.discordName } : null, linked: link ? { discordName: link.discordName, at: link.at } : null, hint: settings.communityHint });
  }

  if (!enabled) return json({ error: 'Die Verknüpfung ist gerade nicht aktiv' }, 403);
  if (!viewer) return json({ error: 'Bitte zuerst mit Twitch anmelden' }, 401);

  if (route[0] === 'confirm' && writes) {
    if (body.consent !== true) return json({ error: 'Bitte stimme zu, damit wir verknüpfen dürfen' }, 400);
    const invite = tokenFrom(req, body);
    if (!invite) return json({ error: 'Der Link ist abgelaufen oder ungültig. Tippe im Discord noch einmal /verknuepfen.' }, 400);
    const rec = await saveLink({ discordId: invite.discordId, discordName: invite.discordName, twitchId: viewer.id, twitchName: viewer.name });
    return json({ ok: true, linked: { discordName: rec.discordName, at: rec.at } }, 200, { 'set-cookie': cookie(req, 'link_token', '', 0) });
  }

  if (route[0] === 'unlink' && writes) {
    await removeLink({ twitchId: viewer.id });
    return json({ ok: true });
  }

  if (route[0] === 'place' && method === 'GET') { // eigener Platz in der Monatsrangliste
    const board = await monthBoard(settings);
    const i = board.rows.findIndex((r) => r.twitchId === viewer.id);
    return json({ label: board.label, rank: i < 0 ? null : i + 1, points: i < 0 ? 0 : board.rows[i].points, total: board.rows.length });
  }

  return json({ error: 'Not found' }, 404);
};
