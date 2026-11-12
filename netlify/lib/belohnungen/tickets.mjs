// Ticket-System für Community-Abende: begrenzte Plätze über Kanalpunkte, Warteliste, Nachrücken, Anwesenheit.
//
// Speicher:
//   ticket/event/<id>                { id, name, startsAt: '2026-11-25T19:00', seats, cost, status, rewardId, rewardTitle, rewardSync,
//                                      waitlistMax, oneWeek, refundNoShow, promoteMinutes, createdAt }
//   ticket/entry/<eventId>/<userId>  { eventId, userId, name, status, redeemedAt, redemptionId, rewardId, pending, ingame, offerUntil, note }
//   ticket/ingame/<userId>           { ingame }   zuletzt gemerkter Ingame-/Discord-Name (gilt für neue Tickets)
//
// Status eines Platzes: ticket · offered (nachgerückt, muss sich noch melden) · waitlist · cancelled · attended · noshow
// `pending` heißt: die Einlösung liegt noch „unerfüllt“ in der Twitch-Queue (Warteliste, Nachrücker, oder Event mit Erstattung bei Nichterscheinen).
// Alles, was Plätze verändert, läuft durch `withLock`: der Server ist ein einziger Prozess, so wird das Limit auch bei vielen
// gleichzeitigen Einlösungen nie überschritten.
import crypto from 'node:crypto';
import { db } from '../kern/store.mjs';
import { EVENT_TYPE, helix, listSubscriptions, lookupUser, sendChat, setRedemptionStatus, userToken } from '../kern/twitch.mjs';
import { fill } from '../zuschauer/checkin.mjs';

export const EVENT_STATUS = ['planned', 'open', 'closed', 'ended'];
export const STATUS_LABEL = { planned: 'geplant', open: 'Verkauf offen', closed: 'Verkauf geschlossen', ended: 'beendet' };
export const SEAT = ['ticket', 'offered', 'attended', 'noshow']; // diese Einträge belegen einen Platz
export const ACTIVE = [...SEAT, 'waitlist'];
export const ID = /^[a-f0-9]{8}$/;

const evKey = (id) => `ticket/event/${id}`;
const entKey = (eid, uid) => `ticket/entry/${eid}/${uid}`;

// ---- Sperre: eine Änderung nach der anderen

let tail = Promise.resolve();
export function withLock(fn) {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
}

// ---- Lesen und Schreiben

export async function getEvents() {
  const evs = await Promise.all((await db.list('ticket/event/')).map((k) => db.get(k)));
  return evs.filter(Boolean).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.createdAt - b.createdAt);
}
export const getEvent = (id) => db.get(evKey(id));
export const saveEvent = (ev) => db.set(evKey(ev.id), ev);
export const activeEvents = async () => (await getEvents()).filter((e) => e.status !== 'ended');
export const eventByReward = async (rewardId) => (await getEvents()).find((e) => e.rewardId && e.rewardId === rewardId) ?? null;

const byTime = (a, b) => a.redeemedAt - b.redeemedAt || a.name.localeCompare(b.name, 'de');
export async function entriesOf(eid) {
  const list = await Promise.all((await db.list(`ticket/entry/${eid}/`)).map((k) => db.get(k)));
  return list.filter(Boolean).sort(byTime);
}

/** Zahlen zu einem Event: belegte und freie Plätze, Warteliste in Reihenfolge der Einlösung. */
export function stats(ev, entries) {
  const taken = entries.filter((e) => SEAT.includes(e.status)).length;
  const wait = entries.filter((e) => e.status === 'waitlist').sort(byTime);
  return { taken, free: Math.max(0, ev.seats - taken), wait };
}

// ---- Eingaben aus dem Admin

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const defaultTitle = (name) => `Ticket: ${name}`.slice(0, 45);

/** Bereinigt Eingaben. Gibt nur die gültigen Felder zurück. */
export function sanitizeEvent(input) {
  const out = {};
  if (typeof input.name === 'string' && input.name.trim()) out.name = input.name.replace(/[<>"]/g, '').trim().slice(0, 60);
  if (typeof input.startsAt === 'string' && WHEN.test(input.startsAt) && !Number.isNaN(Date.parse(input.startsAt + ':00Z'))) out.startsAt = input.startsAt;
  if (typeof input.rewardTitle === 'string') out.rewardTitle = input.rewardTitle.replace(/[<>"]/g, '').trim().slice(0, 45);
  if (EVENT_STATUS.includes(input.status)) out.status = input.status;
  const num = (k, min, max) => { const n = Number(input[k]); if (input[k] !== '' && input[k] != null && Number.isFinite(n)) out[k] = clamp(Math.round(n), min, max); };
  num('seats', 1, 500); num('cost', 1, 1_000_000); num('waitlistMax', 0, 200); num('promoteMinutes', 0, 240);
  for (const k of ['oneWeek', 'refundNoShow']) if (typeof input[k] === 'boolean') out[k] = input[k];
  return out;
}

export const newEvent = (fields) => ({
  id: crypto.randomBytes(4).toString('hex'), seats: 10, cost: 1000, status: 'planned', waitlistMax: 10, oneWeek: false, refundNoShow: false, promoteMinutes: 0,
  rewardId: null, rewardTitle: '', rewardSync: null, createdAt: Date.now(), ...fields,
});

// ---- Kleine Helfer

/** 'Mi 25.11. 19:00' aus '2026-11-25T19:00' */
export function fmtWhen(startsAt) {
  const d = new Date(startsAt + ':00Z');
  const day = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getUTCDay()];
  const p = (n) => String(n).padStart(2, '0');
  return `${day} ${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}. ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Montag der Woche (als Datum), in der das Event liegt
export function weekOf(startsAt) {
  const d = new Date(startsAt.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const say = async (settings, tpl, vars) => {
  const msg = fill(tpl, vars);
  if (settings.chatEnabled) await sendChat(msg).catch((e) => console.warn('Ticket-Chat fehlgeschlagen:', e.message));
  return msg;
};

const settle = async (entry, status) => { // Einlösung in Twitch erfüllen oder stornieren (Punkte zurück)
  if (!entry.pending || !entry.redemptionId) { entry.pending = false; return; }
  await setRedemptionStatus(entry.redemptionId, entry.rewardId, status);
  entry.pending = false;
};

// ---- Reward in Twitch

export function rewardPrompt(ev) {
  const base = `Platz für „${ev.name}“ (${fmtWhen(ev.startsAt)}), ${ev.seats} Plätze, ein Ticket pro Person.`;
  const rule = ev.refundNoShow ? ' Wer nicht kommt, bekommt die Punkte zurück.' : ' Wer nicht erscheint, bekommt keine Punkte zurück.';
  return (base + (ev.waitlistMax ? ' Ist alles voll, kommst du auf die Warteliste.' : '') + rule).slice(0, 200);
}

/** Legt den Reward des Events an oder gleicht ihn ab (Name, Preis, Beschreibung, an/aus, pausiert). Ändert `ev`, speichert nicht. */
export async function syncReward(ev, full) {
  const want = {
    title: ev.rewardTitle || defaultTitle(ev.name), cost: ev.cost, prompt: rewardPrompt(ev),
    is_enabled: ev.status === 'open', is_paused: ev.status === 'open' && full,
  };
  if (ev.rewardId && JSON.stringify(ev.rewardSync) === JSON.stringify(want)) return ev;
  const { user_id } = await userToken();
  const done = (r) => { ev.rewardId = r.id; ev.rewardSync = want; return ev; };
  if (ev.rewardId) {
    try { return done((await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: ev.rewardId }, body: want })).data[0]); } catch (e) {
      if (!/-> 404/.test(e.message)) throw e;
      ev.rewardId = null; // in Twitch gelöscht: neu anlegen
    }
  }
  try {
    return done((await helix('POST', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id }, body: { ...want, background_color: '#2E8B6E' } })).data[0]);
  } catch (e) {
    if (e.message.includes('DUPLICATE_REWARD')) throw new Error(`Auf deinem Kanal gibt es schon einen Reward „${want.title}“, der nicht von dieser App stammt. Gib dem Event einen anderen Reward-Namen.`);
    throw e;
  }
}

/** Webhook-Abo für genau diesen Reward (damit Einlösungen ankommen). */
export async function ensureSubscription(ev, webhookUrl) {
  if (!ev.rewardId) return;
  if ((await listSubscriptions(webhookUrl)).some((s) => s.type === EVENT_TYPE && s.condition?.reward_id === ev.rewardId)) return;
  const { user_id } = await userToken();
  await helix('POST', 'eventsub/subscriptions', {
    as: 'app',
    body: { type: EVENT_TYPE, version: '1', condition: { broadcaster_user_id: user_id, reward_id: ev.rewardId }, transport: { method: 'webhook', callback: webhookUrl, secret: process.env.EVENTSUB_SECRET } },
  });
}

export async function dropSubscription(rewardId, webhookUrl) {
  for (const s of await listSubscriptions(webhookUrl)) {
    if (s.type === EVENT_TYPE && s.condition?.reward_id === rewardId) await helix('DELETE', 'eventsub/subscriptions', { as: 'app', query: { id: s.id } });
  }
}

/** Reward an den aktuellen Stand anpassen und das Event speichern. Fehler kommen als Text zurück (Event bleibt trotzdem gespeichert). */
export async function refresh(ev, webhookUrl = null) {
  const s = stats(ev, await entriesOf(ev.id));
  let warning = null;
  try {
    await syncReward(ev, s.free === 0 && s.wait.length >= ev.waitlistMax);
    if (webhookUrl) await ensureSubscription(ev, webhookUrl);
  } catch (e) { warning = e.message; console.warn('Ticket-Reward:', e.message); }
  await saveEvent(ev);
  return warning;
}

// ---- Nachrücken (nur innerhalb der Sperre aufrufen)

const vars = (ev, entry, s, extra = {}) => ({ user: entry.name, event: ev.name, max: ev.seats, free: s.free, seat: s.taken, pos: s.wait.findIndex((w) => w.userId === entry.userId) + 1, minutes: ev.promoteMinutes, ...extra });

async function promoteNext(ev, settings, now) {
  const moved = [];
  for (;;) {
    const entries = await entriesOf(ev.id);
    const s = stats(ev, entries);
    if (ev.status === 'ended' || s.free <= 0 || !s.wait.length) return moved;
    const next = s.wait[0];
    if (ev.promoteMinutes > 0) { // erst melden, dann ist der Platz sicher
      next.status = 'offered'; next.offerUntil = now + ev.promoteMinutes * 60_000;
      await db.set(entKey(ev.id, next.userId), next);
      await say(settings, settings.ticketOfferTemplate, vars(ev, next, stats(ev, await entriesOf(ev.id))));
    } else {
      next.status = 'ticket';
      if (!ev.refundNoShow) await settle(next, 'FULFILLED');
      await db.set(entKey(ev.id, next.userId), next);
      await say(settings, settings.ticketMovedTemplate, vars(ev, next, stats(ev, await entriesOf(ev.id))));
    }
    moved.push(next);
  }
}

/** Nach jeder Änderung: nachrücken lassen und den Reward angleichen. */
async function settleEvent(ev, settings, now, webhookUrl = null) {
  const moved = await promoteNext(ev, settings, now);
  return { moved, warning: await refresh(ev, webhookUrl) };
}

// ---- Einlösung

export function handleTicket(redemption, ev0, settings, now = Date.now()) {
  return withLock(async () => {
    const { id: rid, user_id: uid, user_name: name, reward } = redemption;
    const ev = (await getEvent(ev0.id)) ?? ev0;
    const refund = (tpl, why) => say(settings, tpl, { user: name, event: ev.name, max: ev.seats }).then(() => setRedemptionStatus(rid, reward.id, 'CANCELED')).then(() => ({ ok: false, why }));
    if (!settings.ticketsEnabled) { await setRedemptionStatus(rid, reward.id, 'CANCELED'); return { ok: false, why: 'aus' }; }
    if (ev.status !== 'open') return refund(settings.ticketClosedTemplate, 'closed');

    const old = await db.get(entKey(ev.id, uid));
    if (old && ACTIVE.includes(old.status)) return refund(settings.ticketDupTemplate, 'duplicate');
    if (ev.oneWeek) {
      const week = weekOf(ev.startsAt);
      for (const other of await activeEvents()) {
        if (other.id === ev.id || weekOf(other.startsAt) !== week) continue;
        const theirs = await db.get(entKey(other.id, uid));
        if (theirs && ACTIVE.includes(theirs.status)) return refund(settings.ticketWeekTemplate, 'week');
      }
    }
    const entries = await entriesOf(ev.id);
    const s = stats(ev, entries);
    const seat = s.free > 0 && !s.wait.length;
    if (!seat && s.wait.length >= ev.waitlistMax) {
      const w = await refund(settings.ticketFullTemplate, 'full');
      await refresh(ev);
      return w;
    }
    const ingame = (await db.get(`ticket/ingame/${uid}`))?.ingame ?? '';
    const entry = { eventId: ev.id, userId: uid, name, status: seat ? 'ticket' : 'waitlist', redeemedAt: now, redemptionId: rid, rewardId: reward.id, pending: true, ingame, offerUntil: null, note: '' };
    if (seat && !ev.refundNoShow) await settle(entry, 'FULFILLED'); // Warteliste und „Erstattung bei Nichterscheinen“: bleibt unerfüllt in der Queue
    await db.set(entKey(ev.id, uid), entry);
    const after = stats(ev, await entriesOf(ev.id));
    const reply = await say(settings, seat ? settings.ticketGotTemplate : settings.ticketWaitTemplate, vars(ev, entry, after));
    await refresh(ev);
    return { ok: true, status: entry.status, reply };
  });
}

// ---- Absagen, Entfernen, Hinzufügen, Nachrücken von Hand

async function release(ev, entry, settings, now, status = 'cancelled', note = '') {
  const hadSeat = SEAT.includes(entry.status);
  await settle(entry, 'CANCELED'); // nur bei noch offener Einlösung gibt es die Punkte zurück
  entry.status = status; entry.offerUntil = null; entry.note = note;
  await db.set(entKey(ev.id, entry.userId), entry);
  return hadSeat;
}

/** Zuschauer sagt ab oder ein Mod/Admin entfernt jemanden. */
export function cancelEntry(ev0, userId, settings, now = Date.now(), webhookUrl = null) {
  return withLock(async () => {
    const ev = await getEvent(ev0.id);
    const entry = await db.get(entKey(ev.id, userId));
    if (!entry || !ACTIVE.includes(entry.status)) return { ok: false };
    await release(ev, entry, settings, now);
    const { moved, warning } = await settleEvent(ev, settings, now, webhookUrl);
    return { ok: true, entry, moved, warning };
  });
}

/** Mod/Admin trägt jemanden von Hand ein: Platz, wenn frei, sonst Warteliste. */
export function addEntry(ev0, userId, name, settings, now = Date.now(), webhookUrl = null) {
  return withLock(async () => {
    const ev = await getEvent(ev0.id);
    const old = await db.get(entKey(ev.id, userId));
    if (old && ACTIVE.includes(old.status)) return { ok: false, error: 'exists', entry: old };
    const s = stats(ev, await entriesOf(ev.id));
    const seat = s.free > 0 && !s.wait.length;
    const ingame = (await db.get(`ticket/ingame/${userId}`))?.ingame ?? '';
    const entry = { eventId: ev.id, userId, name, status: seat ? 'ticket' : 'waitlist', redeemedAt: now, redemptionId: null, rewardId: null, pending: false, ingame, offerUntil: null, note: 'von Hand' };
    await db.set(entKey(ev.id, userId), entry);
    const warning = await refresh(ev, webhookUrl);
    return { ok: true, entry, warning, seat, pos: stats(ev, await entriesOf(ev.id)).wait.findIndex((w) => w.userId === userId) + 1 };
  });
}

/** Eine bestimmte Person von der Warteliste auf einen freien Platz setzen (Admin). */
export function promoteEntry(ev0, userId, settings, now = Date.now()) {
  return withLock(async () => {
    const ev = await getEvent(ev0.id);
    const entry = await db.get(entKey(ev.id, userId));
    if (!entry || entry.status !== 'waitlist') return { ok: false, error: 'Diese Person steht nicht auf der Warteliste.' };
    if (stats(ev, await entriesOf(ev.id)).free <= 0) return { ok: false, error: 'Es ist kein Platz frei. Erhöhe die Plätze oder entferne zuerst jemanden.' };
    entry.status = 'ticket';
    if (!ev.refundNoShow) await settle(entry, 'FULFILLED');
    await db.set(entKey(ev.id, userId), entry);
    await say(settings, settings.ticketMovedTemplate, vars(ev, entry, stats(ev, await entriesOf(ev.id))));
    await refresh(ev);
    return { ok: true, entry };
  });
}

/** Nachrücker meldet sich (!dabei): der Platz gehört ihm. */
export function confirmEntry(ev0, userId, settings) {
  return withLock(async () => {
    const ev = await getEvent(ev0.id);
    const entry = await db.get(entKey(ev.id, userId));
    if (!entry || entry.status !== 'offered') return { ok: false };
    entry.status = 'ticket'; entry.offerUntil = null;
    if (!ev.refundNoShow) await settle(entry, 'FULFILLED');
    await db.set(entKey(ev.id, userId), entry);
    await say(settings, settings.ticketConfirmedTemplate, vars(ev, entry, stats(ev, await entriesOf(ev.id))));
    return { ok: true, entry };
  });
}

/** Anwesenheit am Event-Abend. Bei „Erstattung bei Nichterscheinen“ gibt es für „nicht erschienen“ die Punkte zurück, nie in der Standardeinstellung. */
export function setAttendance(ev0, userId, status) {
  return withLock(async () => {
    const ev = await getEvent(ev0.id);
    const entry = await db.get(entKey(ev.id, userId));
    if (!entry || !SEAT.includes(entry.status) || entry.status === 'offered') return { ok: false, error: 'Nur Ticket-Inhaber haben eine Anwesenheit.' };
    if (!['ticket', 'attended', 'noshow'].includes(status)) return { ok: false, error: 'Unbekannter Status' };
    if (status === 'attended') await settle(entry, 'FULFILLED');
    if (status === 'noshow') await settle(entry, ev.refundNoShow ? 'CANCELED' : 'FULFILLED');
    entry.status = status;
    await db.set(entKey(ev.id, userId), entry);
    return { ok: true, entry };
  });
}

/** Ingame-/Discord-Name eines Zuschauers: gilt für alle seine laufenden Tickets und wird für spätere gemerkt. */
export async function setIngame(userId, ingame) {
  const value = String(ingame).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  if (!value) return { ok: false };
  await db.set(`ticket/ingame/${userId}`, { ingame: value });
  let n = 0;
  for (const ev of await activeEvents()) {
    const entry = await db.get(entKey(ev.id, userId));
    if (entry && ACTIVE.includes(entry.status)) { entry.ingame = value; await db.set(entKey(ev.id, userId), entry); n++; }
  }
  return { ok: true, value, events: n };
}

/** Status des Events ändern (Verkauf öffnen, schließen, beenden). Beim Ende: Warteliste stornieren, offene Tickets erfüllen. */
export function setEventStatus(ev0, status, settings, now = Date.now(), webhookUrl = null) {
  return withLock(async () => {
    const ev = await getEvent(ev0.id);
    ev.status = status;
    if (status === 'ended') {
      for (const e of await entriesOf(ev.id)) {
        if (e.status === 'waitlist' || e.status === 'offered') await release(ev, e, settings, now, 'cancelled', 'Event beendet');
        else if (SEAT.includes(e.status) && e.pending) { await settle(e, 'FULFILLED'); await db.set(entKey(ev.id, e.userId), e); }
      }
    }
    return settleEvent(ev, settings, now, webhookUrl);
  });
}

/** Nach Änderungen an Plätzen o. Ä.: nachrücken und Reward angleichen. */
export const rebalance = (ev0, settings, now = Date.now(), webhookUrl = null) => withLock(async () => settleEvent((await getEvent(ev0.id)), settings, now, webhookUrl));

/** Abgelaufene Nachrück-Fristen: der Platz geht an den Nächsten. Gibt die Anzahl zurück. */
export function sweepOffers(settings, now = Date.now()) {
  return withLock(async () => {
    let n = 0;
    for (const ev of await activeEvents()) {
      const late = (await entriesOf(ev.id)).filter((e) => e.status === 'offered' && e.offerUntil && e.offerUntil <= now);
      if (!late.length) continue;
      for (const e of late) {
        await release(ev, e, settings, now, 'cancelled', 'Frist abgelaufen');
        await say(settings, settings.ticketExpiredTemplate, vars(ev, e, stats(ev, await entriesOf(ev.id))));
        n++;
      }
      await settleEvent(ev, settings, now);
    }
    return n;
  });
}

export async function deleteEvent(ev, webhookUrl) {
  return withLock(async () => {
    for (const e of await entriesOf(ev.id)) {
      if (e.pending) await settle(e, 'CANCELED');
      await db.delete(entKey(ev.id, e.userId));
    }
    await db.delete(evKey(ev.id));
  });
}

// ---- Chat-Befehle

const usable = (events) => events.filter((e) => e.status !== 'ended');
const names = (events) => events.map((e) => e.name).join(', ');
const pick = (events, filter) => { const f = filter.trim().toLowerCase(); return f ? events.filter((e) => e.name.toLowerCase().includes(f)) : events; };

/** !tickets */
export async function ticketsInfo(settings) {
  const events = usable(await getEvents());
  if (!events.length) return fill(settings.ticketsNoneTemplate, {});
  const parts = [];
  for (const ev of events) {
    const s = stats(ev, await entriesOf(ev.id));
    parts.push(ev.status === 'planned' ? `${ev.name}: Verkauf startet bald` : fill(settings.ticketsLineTemplate, { event: ev.name, free: s.free, max: ev.seats, wait: s.wait.length, when: fmtWhen(ev.startsAt) }) + (ev.status === 'closed' ? ' (Verkauf geschlossen)' : ''));
  }
  return parts.join(' · ');
}

// Events, in denen die Person einen Eintrag hat
async function mine(userId) {
  const out = [];
  for (const ev of usable(await getEvents())) {
    const entry = await db.get(entKey(ev.id, userId));
    if (entry && ACTIVE.includes(entry.status)) out.push({ ev, entry });
  }
  return out;
}

/** !platz */
export async function mySeat(userId, userName, settings, now = Date.now()) {
  const list = await mine(userId);
  if (!list.length) return fill(settings.ticketSeatNoneTemplate, { user: userName });
  const parts = [];
  for (const { ev, entry } of list) {
    const s = stats(ev, await entriesOf(ev.id));
    if (entry.status === 'waitlist') parts.push(fill(settings.ticketWaitPosTemplate, vars(ev, entry, s, { user: userName })));
    else if (entry.status === 'offered') parts.push(`Du bist für ${ev.name} nachgerückt! Melde dich in ${Math.max(1, Math.ceil((entry.offerUntil - now) / 60_000))} Min mit ${settings.ticketConfirmCommand}.`);
    else parts.push(fill(settings.ticketSeatTemplate, vars(ev, entry, s, { user: userName })));
  }
  return parts.join(' · ');
}

/** !absagen [Event] */
export async function cancelByUser(e, args, settings, now = Date.now()) {
  const user = e.chatter_user_name;
  const list = (await mine(e.chatter_user_id)).filter((x) => pick([x.ev], args).length);
  if (!list.length) return fill(settings.ticketSeatNoneTemplate, { user });
  if (list.length > 1) return `${user}, für welches Event? ${settings.ticketCancelCommand} ${names(list.map((x) => x.ev))}`.slice(0, 400);
  const { ev } = list[0];
  const r = await cancelEntry(ev, e.chatter_user_id, settings, now);
  return r.ok ? fill(settings.ticketCancelTemplate, { user, event: ev.name }) : fill(settings.ticketSeatNoneTemplate, { user });
}

/** !dabei */
export async function confirmByUser(e, settings) {
  const offered = (await mine(e.chatter_user_id)).find((x) => x.entry.status === 'offered');
  if (!offered) return fill(settings.ticketSeatNoneTemplate, { user: e.chatter_user_name });
  await confirmEntry(offered.ev, e.chatter_user_id, settings); // schreibt die Bestätigung selbst in den Chat
  return null;
}

/** !ingame Name */
export async function ingameByUser(e, args, settings) {
  const user = e.chatter_user_name;
  if (!args.trim()) return `${user}, schreib deinen Ingame- oder Discord-Namen dazu: ${settings.ticketIngameCommand} Name`;
  const r = await setIngame(e.chatter_user_id, args);
  return r.ok ? fill(settings.ticketIngameTemplate, { user, name: r.value }) : null;
}

/** !ticketadd Name [Event] und !ticketremove Name [Event] (Mods) */
export async function modCommand(kind, e, args, settings, now = Date.now()) {
  const [first = '', ...rest] = args.trim().split(/\s+/);
  const login = first.replace(/^@/, '').toLowerCase();
  const cmd = kind === 'add' ? settings.ticketAddCommand : settings.ticketRemoveCommand;
  if (!login) return `${e.chatter_user_name}, für wen? Zum Beispiel ${cmd} name`;
  const events = pick(usable(await getEvents()), rest.join(' '));
  if (!events.length) return `${e.chatter_user_name}, dieses Event gibt es nicht (oder es ist schon beendet).`;
  if (kind === 'add') {
    if (events.length > 1) return `${e.chatter_user_name}, für welches Event? ${cmd} ${login} ${names(events)}`.slice(0, 400);
    const user = await lookupUser(login);
    if (!user) return `${e.chatter_user_name}, den Twitch-Namen „${login}“ gibt es nicht.`;
    const r = await addEntry(events[0], user.id, user.name, settings, now);
    if (!r.ok) return `${user.name} hat für ${events[0].name} schon ein Ticket oder steht auf der Warteliste.`;
    return r.seat ? `🎟️ ${user.name} hat jetzt einen Platz für ${events[0].name}.` : `🎟️ ${user.name} steht auf der Warteliste für ${events[0].name} (Platz ${r.pos}), denn alle Plätze sind vergeben.`;
  }
  const found = [];
  for (const ev of events) {
    const entry = (await entriesOf(ev.id)).find((x) => ACTIVE.includes(x.status) && x.name.toLowerCase() === login);
    if (entry) found.push({ ev, entry });
  }
  if (!found.length) return `${e.chatter_user_name}, „${login}“ hat kein Ticket und steht auf keiner Warteliste.`;
  if (found.length > 1) return `${e.chatter_user_name}, bei welchem Event? ${cmd} ${login} ${names(found.map((x) => x.ev))}`.slice(0, 400);
  const { ev, entry } = found[0];
  await cancelEntry(ev, entry.userId, settings, now);
  return `🗑️ ${entry.name} ist bei ${ev.name} entfernt.`;
}

// ---- Teilnehmerliste für den Admin und die Kopierliste

export const csvCell = (v) => { const s = String(v ?? '').replace(/"/g, '""'); return `"${/^[=+\-@]/.test(s) ? "'" + s : s}"`; };
