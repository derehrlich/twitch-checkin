// Twitch-Statistik: misst jede Minute die Zuschauer, solange der Kanal live ist, dazu Follower und Abos.
// Nur im Admin sichtbar (und als Kennzahlen im Mediakit). Es wird nichts in den Chat oder nach Discord geschrieben.
//
// Speicher:
//   stat/live              { id, lastSeen }  laufender Stream (eine Lücke unter 10 Minuten zählt als derselbe Stream)
//   stat/session/<id>      { id, startedAt, lastSeen, endedAt, title, game, samples, sumViewers, peak, followersStart, followersEnd, subsEnd, curve: [[Minute, Zuschauer]] }
//   stat/day/<YYYY-MM-DD>  { followers, subs }  letzter Stand des Tages
//   stat/state             { checkedAt, followersAt, error, followers, subs }
import { db } from '../kern/store.mjs';
import { helix, userToken } from '../kern/twitch.mjs';

const GAP_MS = 10 * 60_000; // so lange darf die Messung aussetzen, ohne dass ein neuer Stream beginnt
const FOLLOW_LIVE_MS = 10 * 60_000, FOLLOW_IDLE_MS = 6 * 3_600_000;
const sKey = (id) => `stat/session/${id}`;
export const dayOf = (settings, ms) => new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(new Date(ms));

async function counts(userId) {
  const total = async (endpoint) => { try { return (await helix('GET', endpoint, { query: { broadcaster_id: userId, first: 1 } })).total ?? null; } catch { return null; } };
  return { followers: await total('channels/followers'), subs: await total('subscriptions') }; // Abos gibt es nur mit Affiliate/Partner, sonst null
}

/** Eine Messung. Läuft jede Minute (Timer in server.mjs), nur wenn die Statistik eingeschaltet ist. */
export async function statTick(settings, now = Date.now()) {
  if (!settings.statsEnabled) return { skipped: true };
  const state = (await db.get('stat/state')) ?? {};
  let stream = null, userId;
  try {
    userId = String((await userToken()).user_id);
    stream = (await helix('GET', 'streams', { query: { user_id: userId } })).data?.[0] ?? null;
  } catch (e) {
    await db.set('stat/state', { ...state, checkedAt: now, error: String(e.message).slice(0, 200) });
    return { error: e.message };
  }
  const live = await db.get('stat/live');
  const running = live && now - live.lastSeen < GAP_MS ? await db.get(sKey(live.id)) : null;
  const dueFollow = now - (state.followersAt ?? 0) >= (stream ? FOLLOW_LIVE_MS : FOLLOW_IDLE_MS);
  const starting = stream && !running, ending = !stream && live && now - live.lastSeen >= GAP_MS;
  let c = null;
  if (dueFollow || starting || ending) {
    c = await counts(userId);
    if (c.followers != null || c.subs != null) await db.set(`stat/day/${dayOf(settings, now)}`, { followers: c.followers, subs: c.subs });
  }
  if (stream) {
    const viewers = Number(stream.viewer_count) || 0;
    const s = running ?? { id: String(now).padStart(15, '0'), startedAt: new Date(now).toISOString(), endedAt: null, samples: 0, sumViewers: 0, peak: 0, followersStart: c?.followers ?? null, followersEnd: null, subsEnd: null, curve: [] };
    s.lastSeen = now; s.title = String(stream.title ?? '').slice(0, 140); s.game = String(stream.game_name ?? '').slice(0, 80);
    s.samples += 1; s.sumViewers += viewers; s.peak = Math.max(s.peak, viewers);
    if (s.curve.length < 1500) s.curve.push([Math.round((now - Date.parse(s.startedAt)) / 60_000), viewers]);
    if (c?.followers != null) s.followersEnd = c.followers;
    if (c?.subs != null) s.subsEnd = c.subs;
    await db.set(sKey(s.id), s);
    await db.set('stat/live', { id: s.id, lastSeen: now });
  } else if (ending) {
    const s = await db.get(sKey(live.id));
    if (s) { s.endedAt = new Date(s.lastSeen).toISOString(); if (c?.followers != null) s.followersEnd = c.followers; if (c?.subs != null) s.subsEnd = c.subs; await db.set(sKey(s.id), s); }
    await db.delete('stat/live');
  }
  await db.set('stat/state', { ...state, checkedAt: now, error: null, ...(c ? { followersAt: now, followers: c.followers ?? state.followers ?? null, subs: c.subs ?? state.subs ?? null } : {}) });
  return { live: Boolean(stream), viewers: stream ? Number(stream.viewer_count) || 0 : null };
}

export async function allSessions() {
  const out = [];
  const keys = await db.list('stat/session/');
  for (let i = 0; i < keys.length; i += 25) out.push(...(await Promise.all(keys.slice(i, i + 25).map((k) => db.get(k)))));
  return out.filter(Boolean).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
export async function allDays() {
  const out = [];
  for (const k of (await db.list('stat/day/')).sort()) { const d = await db.get(k); if (d) out.push({ date: k.split('/').pop(), ...d }); }
  return out;
}

const minutesOf = (s) => Math.max(0, Math.round(((s.endedAt ? Date.parse(s.endedAt) : s.lastSeen) - Date.parse(s.startedAt)) / 60_000));
const avgOf = (s) => (s.samples ? s.sumViewers / s.samples : 0);
/** Kurzfassung eines Streams für Liste und Diagramm (ohne die Verlaufskurve). */
export const sessionInfo = (s) => ({
  id: s.id, startedAt: s.startedAt, title: s.title, game: s.game, minutes: minutesOf(s), peak: s.peak, avg: Math.round(avgOf(s) * 10) / 10, open: !s.endedAt,
  followerPlus: s.followersStart != null && s.followersEnd != null ? s.followersEnd - s.followersStart : null,
});

/** Kennzahlen der letzten 30 Tage bis einschließlich heute (für die Statistik-Seite und das Mediakit). */
export function numbers30(sessions, days, settings, now = Date.now()) {
  const today = dayOf(settings, now), from = dayOf(settings, now - 29 * 86_400_000);
  const perDay = new Map();
  for (const s of sessions) {
    const day = dayOf(settings, Date.parse(s.startedAt)), minutes = minutesOf(s);
    if (!s.samples || minutes <= 0 || day < from || day > today) continue;
    const d = perDay.get(day) ?? { minutes: 0, sum: 0, samples: 0, peak: 0, watched: 0 };
    d.minutes += minutes; d.sum += s.sumViewers; d.samples += s.samples; d.peak = Math.max(d.peak, s.peak); d.watched += avgOf(s) * minutes;
    perDay.set(day, d);
  }
  const vals = [...perDay.values()];
  const dayAvgs = vals.map((d) => d.sum / d.samples);
  const fol = days.filter((d) => d.followers != null && d.date >= from && d.date <= today);
  return {
    source: 'stats', from, to: today, streamDays: vals.length,
    avgViewers: dayAvgs.length ? dayAvgs.reduce((a, b) => a + b, 0) / dayAvgs.length : 0,
    maxViewers: Math.max(0, ...vals.map((d) => d.peak)),
    hoursStreamed: vals.reduce((a, d) => a + d.minutes, 0) / 60, hoursWatched: vals.reduce((a, d) => a + d.watched, 0) / 60,
    newFollowers: fol.length > 1 ? fol.at(-1).followers - fol[0].followers : null,
  };
}

/** Wochen mit mindestens N Streamtagen seit Messbeginn (höchstens 26, die laufende Woche zählt noch nicht). */
export function weekConsistency(sessions, settings, now = Date.now(), minStreams = 2, weeks = 26) {
  const days = new Set(sessions.filter((s) => s.samples).map((s) => dayOf(settings, Date.parse(s.startedAt))));
  if (!days.size) return { ok: 0, counted: 0 };
  const monday = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d; };
  const thisWeek = monday(dayOf(settings, now));
  let w = monday([...days].sort()[0]);
  const earliest = new Date(thisWeek); earliest.setUTCDate(earliest.getUTCDate() - 7 * (weeks - 1));
  if (w < earliest) w = earliest;
  let ok = 0, counted = 0;
  for (; w < thisWeek; w = new Date(w.getTime() + 7 * 86_400_000)) {
    counted++;
    let n = 0;
    for (let i = 0; i < 7; i++) if (days.has(new Date(w.getTime() + i * 86_400_000).toISOString().slice(0, 10))) n++;
    if (n >= minStreams) ok++;
  }
  return { ok, counted };
}

export async function adminView(settings, now = Date.now()) {
  const [sessions, days, state, live] = await Promise.all([allSessions(), allDays(), db.get('stat/state'), db.get('stat/live')]);
  const done = sessions.filter((s) => minutesOf(s) > 0 && s.samples);
  const withFol = days.filter((d) => d.followers != null);
  return {
    enabled: Boolean(settings.statsEnabled), checkedAt: state?.checkedAt ?? null, error: state?.error ?? null, live: Boolean(live && now - live.lastSeen < GAP_MS),
    total: {
      streams: done.length, hours: Math.round(done.reduce((a, s) => a + minutesOf(s), 0) / 6) / 10, peak: Math.max(0, ...done.map((s) => s.peak)),
      avg: done.length ? Math.round(done.reduce((a, s) => a + avgOf(s), 0) / done.length * 10) / 10 : 0,
      followers: withFol.at(-1)?.followers ?? state?.followers ?? null, subs: days.filter((d) => d.subs != null).at(-1)?.subs ?? state?.subs ?? null,
    },
    last30: numbers30(sessions, days, settings, now),
    sessions: sessions.slice(0, 60).map(sessionInfo),
    followers: withFol.slice(-90).map((d) => ({ date: d.date, followers: d.followers })),
  };
}

export async function sessionCurve(id) {
  if (!/^\d{15}$/.test(String(id))) return null;
  const s = await db.get(sKey(id));
  return s ? { ...sessionInfo(s), curve: s.curve ?? [] } : null;
}
export async function deleteSession(id) {
  if (!/^\d{15}$/.test(String(id)) || !(await db.get(sKey(id)))) return false;
  await db.delete(sKey(id));
  if ((await db.get('stat/live'))?.id === id) await db.delete('stat/live');
  return true;
}
