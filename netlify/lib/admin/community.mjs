// /api/admin/community: Verknüpfungen Discord <-> Twitch ansehen und löschen, Stand der Einrichtung.
import { getSettings } from '../settings.mjs';
import { allLinks, monthBoard, monthLabel, monthOf, removeLink, secretSet } from '../community.mjs';
import { json } from '../http.mjs';

export async function community({ route, method }) {
  const settings = await getSettings();
  if (route.length === 1 && method === 'GET') {
    const links = (await allLinks()).sort((a, b) => String(a.twitchName).localeCompare(String(b.twitchName), 'de'));
    const board = settings.communityEnabled && secretSet() ? await monthBoard(settings) : null;
    return json({
      secretSet: secretSet(), enabled: settings.communityEnabled, month: monthLabel(monthOf(settings)),
      links: links.map((l) => ({ twitchId: l.twitchId, twitchName: l.twitchName, discordName: l.discordName, at: l.at })),
      top: board ? board.rows.slice(0, 10).map((r) => ({ name: r.name, points: r.points, twitchMsgs: r.twitchMsgs, discordMsgs: r.discordMsgs, checkins: r.checkins })) : [],
    });
  }
  if (route.length === 2 && method === 'DELETE') {
    return json({ ok: await removeLink({ twitchId: route[1] }) });
  }
}
