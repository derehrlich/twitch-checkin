// Schnittstelle für den VerwirrBot (Anmeldung mit dem gemeinsamen Geheimwort LINK_SECRET als Bearer-Token):
//   GET  /api/community/board    Rangliste des Monats (verknüpfte Konten), Liste der verknüpften Discord-IDs und Regeln, damit der Bot dieselben Gewichte nutzt
//   GET  /api/community/link?discordId=...   ist dieses Discord-Konto verknüpft? { linked, twitchName }
//   POST /api/community/sync     Discord-Zahlen des Monats melden { month, rows: [{ discordId, msgs, days }] }
//   POST /api/community/unlink   Verknüpfung löschen { discordId }
// Öffentlich zugänglich ist nur die Rangliste in /api/leaderboard.
import { getSettings } from '../lib/settings.mjs';
import { json } from '../lib/http.mjs';
import { allLinks, botAuthorized, DISCORD_ID, linkByDiscord, monthBoard, removeLink, saveDiscordMonth, secretSet, weights } from '../lib/community.mjs';

export const config = { path: ['/api/community/*'] };

export default async (req) => {
  if (!secretSet()) return json({ error: 'LINK_SECRET ist nicht gesetzt' }, 503);
  if (!botAuthorized(req)) return json({ error: 'Nicht berechtigt' }, 401);
  const route = new URL(req.url).pathname.replace(/^\/api\/community\/?/, '').split('/').filter(Boolean);
  const settings = await getSettings();
  const writes = req.method === 'POST';
  const body = writes ? await req.json().catch(() => ({})) : {};

  if (route[0] === 'board' && req.method === 'GET') {
    const board = await monthBoard(settings);
    // linked: alle verknüpften Discord-IDs, damit der Bot nur für sie Zahlen meldet
    return json({ enabled: settings.communityEnabled, month: board.month, linked: (await allLinks()).map((l) => l.discordId), label: board.label, rules: { weights: weights(settings), msgCap: settings.communityMsgCap, msgGap: settings.communityMsgGap },
      rows: board.rows.slice(0, 200).map((r) => ({ discordId: r.discordId, name: r.name, points: r.points })) });
  }
  if (route[0] === 'link' && req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('discordId') ?? '';
    const link = DISCORD_ID.test(id) ? await linkByDiscord(id) : null;
    return json({ linked: Boolean(link), twitchName: link?.twitchName ?? null });
  }
  if (route[0] === 'sync' && writes) {
    if (!settings.communityEnabled) return json({ error: 'Die Community-Rangliste ist ausgeschaltet' }, 403);
    const res = await saveDiscordMonth(settings, body.month, body.rows);
    return res.error ? json(res, 400) : json(res);
  }
  if (route[0] === 'unlink' && writes) return json({ ok: await removeLink({ discordId: String(body.discordId ?? '') }) });
  return json({ error: 'Not found' }, 404);
};
