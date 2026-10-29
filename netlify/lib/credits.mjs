// Abspann: sammelt pro Stream-Tag, wer geschrieben, gefollowt, abonniert, Bits geschickt oder geraidet hat.
//   chatter/<tag>/<twitchId>   Anzeigename (einmal pro Person und Tag)
//   log/<tag>/<nachrichtenId>  { t, type, user, ... } je Follow, Sub, Resub, Gift, Cheer und Raid
import { db } from './store.mjs';
import { streamDay } from './checkin.mjs';

const seenChatters = new Set(); // spart Schreibzugriffe, solange die Function-Instanz läuft

export async function recordChatter(day, userId, name) {
  const k = `${day}/${userId}`;
  if (seenChatters.has(k)) return;
  await db.setIfNew(`chatter/${k}`, name);
  seenChatters.add(k);
  if (seenChatters.size > 5000) seenChatters.clear();
}

// EventSub-Ereignis -> Eintrag für den Abspann (null = nichts zu merken)
export function logEntry(type, e) {
  const anon = e.is_anonymous || !(e.user_name || e.from_broadcaster_user_name);
  switch (type) {
    case 'channel.follow': return { type: 'follow', user: e.user_name };
    case 'channel.subscribe': return { type: 'sub', user: e.user_name, gift: Boolean(e.is_gift) };
    case 'channel.subscription.message': return { type: 'resub', user: e.user_name, months: Number(e.cumulative_months) || 1 };
    case 'channel.subscription.gift': return { type: 'gift', user: anon ? null : e.user_name, total: Number(e.total) || 1 };
    case 'channel.cheer': return { type: 'cheer', user: anon ? null : e.user_name, bits: Number(e.bits) || 0 };
    case 'channel.raid': return { type: 'raid', user: e.from_broadcaster_user_name, viewers: Number(e.viewers) || 0 };
    default: return null;
  }
}

export async function logEvent(type, e, msgId, settings) {
  const entry = logEntry(type, e);
  if (!entry) return;
  await db.set(`log/${streamDay(settings)}/${msgId}`, { t: Date.now(), ...entry });
}

async function loadAll(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 25) out.push(...(await Promise.all(keys.slice(i, i + 25).map(async (k) => [k, await db.get(k)]))));
  return out.filter(([, v]) => v != null);
}

const byName = (a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' });

/** Die Abschnitte des Abspanns für einen Stream-Tag. */
export async function creditsFor(day, settings) {
  const ignore = new Set(String(settings.creditsIgnore ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean));
  const tokens = await db.get('config/tokens');
  if (tokens?.login) ignore.add(String(tokens.login).toLowerCase());
  const shown = (name) => name && !ignore.has(String(name).toLowerCase());

  const chatters = (await loadAll(await db.list(`chatter/${day}/`))).map(([, v]) => v).filter(shown);
  const log = (await loadAll(await db.list(`log/${day}/`))).map(([, v]) => v).sort((a, b) => a.t - b.t);

  const unique = (list) => [...new Set(list)].sort(byName);
  const sections = [];
  const add = (key, title, lines) => { if (lines.length) sections.push({ key, title, lines }); };

  if (settings.creditsChatters) add('chatters', 'Chatter', unique(chatters));
  if (settings.creditsFollows) add('follows', 'Neue Follower', unique(log.filter((x) => x.type === 'follow' && shown(x.user)).map((x) => x.user)));
  if (settings.creditsSubs) {
    const subs = new Map(); // Name -> Monate (0 = neu / geschenkt)
    for (const x of log) if ((x.type === 'sub' || x.type === 'resub') && shown(x.user)) subs.set(x.user, Math.max(subs.get(x.user) ?? 0, x.months ?? 0));
    add('subs', 'Abonnenten', [...subs.entries()].sort((a, b) => byName(a[0], b[0])).map(([n, m]) => (m > 1 ? `${n} (${m} Monate)` : n)));
    const gifts = new Map();
    for (const x of log) if (x.type === 'gift' && shown(x.user)) gifts.set(x.user, (gifts.get(x.user) ?? 0) + x.total);
    add('gifts', 'Sub-Geschenke', [...gifts.entries()].sort((a, b) => b[1] - a[1] || byName(a[0], b[0])).map(([n, t]) => `${n} (${t})`));
  }
  if (settings.creditsBits) {
    const bits = new Map();
    for (const x of log) if (x.type === 'cheer' && shown(x.user)) bits.set(x.user, (bits.get(x.user) ?? 0) + x.bits);
    add('bits', 'Bits', [...bits.entries()].sort((a, b) => b[1] - a[1] || byName(a[0], b[0])).map(([n, b]) => `${n} (${b})`));
  }
  if (settings.creditsRaids) {
    const raids = new Map();
    for (const x of log) if (x.type === 'raid' && shown(x.user)) raids.set(x.user, (raids.get(x.user) ?? 0) + x.viewers);
    add('raids', 'Raids', [...raids.entries()].map(([n, v]) => `${n} (${v})`));
  }

  return { day, title: settings.creditsTitle, outro: settings.creditsOutro, speed: settings.creditsSpeed, sections };
}
