// Zuschauer- und Follower-Statistik für die Gewinnspiel-Auswertung. Ein geplanter Job ruft pollStats alle 5 Minuten auf.
// Twitch liefert keinen Verlauf nachträglich, deshalb zählt die Statistik erst ab dem Einschalten.
import { db } from './store.mjs';
import { fill, streamDay } from './checkin.mjs';
import { getSettings } from './settings.mjs';
import { helix, sendChat, userToken } from './twitch.mjs';
import { activeGiveaway, fmtDate, loadGiveaway } from './giveaway.mjs';

const HOUR = 3_600_000;

async function followerTotal(userId) {
  const res = await helix('GET', 'channels/followers', { query: { broadcaster_id: userId, first: '1' } });
  return Number.isFinite(res.total) ? res.total : null;
}

/** Eine Abfrage: Zuschauer (nur wenn live) und Follower-Stand für den heutigen Stream-Tag speichern. Gibt zurück, ob der Kanal live ist. */
export async function pollStats(now = new Date()) {
  const settings = await getSettings();
  if (!settings.giveawayEnabled || !(await db.get('config/tokens'))) return { skipped: true };
  const { user_id } = await userToken();
  const day = streamDay(settings, now);
  const { data } = await helix('GET', 'streams', { as: 'app', query: { user_id } });
  const live = data?.[0]?.type === 'live' ? data[0] : null;
  const rec = (await db.get(`gwstats/${day}`)) ?? { samples: 0, sum: 0, peak: 0, followers: null, followersAt: null, lastLive: null };
  let changed = false;
  if (live) {
    const v = Number(live.viewer_count) || 0;
    rec.samples++; rec.sum += v; rec.peak = Math.max(rec.peak, v); rec.lastLive = now.toISOString(); changed = true;
  }
  // Follower: einmal am Tag, im Stream stündlich (so lässt sich der Zuwachs auch tagesgenau sehen)
  const stale = rec.followers == null || (live && now.getTime() - Date.parse(rec.followersAt ?? 0) > HOUR);
  if (stale) {
    try { const total = await followerTotal(user_id); if (total != null) { rec.followers = total; rec.followersAt = now.toISOString(); changed = true; } }
    catch (e) { console.warn('Follower-Stand nicht abrufbar:', e.message); }
  }
  if (changed) await db.set(`gwstats/${day}`, rec);
  if (live) await remind(settings, now).catch((e) => console.warn('Gewinnspiel-Erinnerung fehlgeschlagen:', e.message));
  return { live: Boolean(live), viewers: live?.viewer_count ?? null };
}

/** Erinnerung im Chat in einstellbarem Abstand, nur während des Streams und nur bei laufendem Gewinnspiel. */
export async function remind(settings, now = new Date()) {
  const minutes = settings.giveawayRemindMinutes;
  if (!minutes || !settings.chatEnabled) return false;
  const g = await activeGiveaway(settings, now);
  if (!g) return false;
  const last = await db.get(`gwremind/${g.id}`);
  if (last && now.getTime() - last < minutes * 60_000) return false;
  await db.set(`gwremind/${g.id}`, now.getTime());
  await sendChat(rulesText(settings, g));
  return true;
}

export const rulesText = (settings, g) => fill(settings.giveawayRulesTemplate, {
  name: g.name, start: fmtDate(g.start), end: fmtDate(g.end), minStreams: g.minStreams, minWeeks: g.minWeeks, prize: g.prizes[0]?.title ?? '',
});

/** Antwort auf den Punkte-Befehl für eine Person. */
export async function pointsReply(settings, userId, userName, now = new Date()) {
  const g = await activeGiveaway(settings, now);
  if (!g) return fill(settings.giveawayNoneTemplate, { user: userName });
  const { rows } = await loadGiveaway(g, settings);
  const me = rows.find((r) => r.id === userId);
  const tpl = !me ? settings.giveawayPointsNoneTemplate : me.qualified ? settings.giveawayPointsTemplate : settings.giveawayPointsOpenTemplate;
  const needStreams = me?.missingStreams ?? g.minStreams, needWeeks = me?.missingWeeks ?? g.minWeeks;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const missing = [needStreams && plural(needStreams, 'Stream', 'Streams'), needWeeks && plural(needWeeks, 'Woche', 'Wochen')].filter(Boolean).join(' und ');
  return fill(tpl, {
    missing, user: userName, name: g.name, points: me?.points ?? 0, checkins: me?.checkins ?? 0, weeks: me?.weeks ?? 0,
    missingStreams: needStreams, missingWeeks: needWeeks, minStreams: g.minStreams, minWeeks: g.minWeeks,
  });
}
