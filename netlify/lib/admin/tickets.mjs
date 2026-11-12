// /api/admin/tickets: Events mit Plätzen anlegen, Teilnehmer und Warteliste verwalten, Anwesenheit abhaken, Liste exportieren.
import { getSettings } from '../kern/settings.mjs';
import { json, text } from '../kern/http.mjs';
import { deleteReward, lookupUser, siteUrl } from '../kern/twitch.mjs';
import {
  ACTIVE, ID, STATUS_LABEL, addEntry, cancelEntry, csvCell, deleteEvent, dropSubscription, entriesOf, fmtWhen, getEvent, getEvents,
  newEvent, promoteEntry, rebalance, refresh, sanitizeEvent, saveEvent, setAttendance, setEventStatus, setIngame, stats, withLock,
} from '../belohnungen/tickets.mjs';

const hook = (req) => `${siteUrl(req)}/api/twitch-webhook`;

const view = (ev, entries) => {
  const s = stats(ev, entries);
  return { ...ev, rewardSync: undefined, statusLabel: STATUS_LABEL[ev.status], taken: s.taken, free: s.free, waiting: s.wait.length, attended: entries.filter((e) => e.status === 'attended').length, noshow: entries.filter((e) => e.status === 'noshow').length, when: fmtWhen(ev.startsAt) };
};

export async function tickets({ req, route, method, body }) {
  const settings = await getSettings();
  if (route.length === 1 && method === 'GET') {
    const events = await getEvents();
    return json({ enabled: settings.ticketsEnabled, events: await Promise.all(events.map(async (ev) => view(ev, await entriesOf(ev.id)))) });
  }
  if (route.length === 1 && method === 'POST') {
    const f = sanitizeEvent(body);
    if (!f.name) return json({ error: 'Bitte einen Namen angeben' }, 400);
    if (!f.startsAt) return json({ error: 'Bitte Datum und Uhrzeit angeben' }, 400);
    const ev = newEvent(f);
    const clash = (await getEvents()).find((e) => e.status !== 'ended' && (e.rewardTitle || `Ticket: ${e.name}`) === (ev.rewardTitle || `Ticket: ${ev.name}`));
    if (clash) return json({ error: 'Es gibt schon ein Event mit diesem Reward-Namen' }, 400);
    await saveEvent(ev);
    const warning = await withLock(() => refresh(ev, hook(req)));
    return json({ event: view(ev, []), warning });
  }

  const ev = ID.test(route[1] ?? '') ? await getEvent(route[1]) : null;
  if (!ev) return json({ error: 'Event nicht gefunden' }, 404);
  const sub = route[2];

  if (!sub && method === 'GET') {
    const entries = await entriesOf(ev.id);
    const s = stats(ev, entries);
    return json({ event: view(ev, entries), entries: entries.map((e) => ({ ...e, position: e.status === 'waitlist' ? s.wait.findIndex((w) => w.userId === e.userId) + 1 : null })) });
  }
  if (!sub && method === 'PUT') {
    const f = sanitizeEvent(body);
    const before = ev.status;
    const { status, ...fields } = f;
    Object.assign(ev, fields);
    await saveEvent(ev);
    const r = status && status !== before ? await setEventStatus(ev, status, settings, Date.now(), hook(req)) : await rebalance(ev, settings, Date.now(), hook(req));
    return json({ event: view(await getEvent(ev.id), await entriesOf(ev.id)), warning: r.warning, moved: r.moved.map((m) => m.name) });
  }
  if (sub === 'sync' && method === 'POST') {
    ev.rewardSync = null; // erzwingt den Abgleich mit Twitch
    const warning = await withLock(() => refresh(ev, hook(req)));
    return json({ event: view(ev, await entriesOf(ev.id)), warning });
  }
  if (!sub && method === 'DELETE') {
    if (ev.rewardId) { await dropSubscription(ev.rewardId, hook(req)).catch((e) => console.warn('Abo nicht entfernt:', e.message)); await deleteReward(ev.rewardId); }
    await deleteEvent(ev);
    return json({ ok: true });
  }
  if (sub === 'csv' && method === 'GET') {
    const rows = ['platz,twitch_name,status,eingeloest_am,steam_name'];
    const entries = await entriesOf(ev.id);
    const s = stats(ev, entries);
    for (const e of entries.filter((x) => ACTIVE.includes(x.status))) {
      const pos = e.status === 'waitlist' ? `W${s.wait.findIndex((w) => w.userId === e.userId) + 1}` : '';
      rows.push([csvCell(pos), csvCell(e.name), csvCell(e.status), csvCell(new Date(e.redeemedAt).toISOString()), csvCell(e.ingame)].join(','));
    }
    return text('﻿' + rows.join('\n'), 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="tickets-${ev.id}.csv"` });
  }
  if (method !== 'POST' && method !== 'PUT') return;

  if (sub === 'add') {
    const login = String(body.name ?? '').trim().replace(/^@/, '').toLowerCase();
    if (!/^\w{2,25}$/.test(login)) return json({ error: 'Bitte einen Twitch-Namen angeben' }, 400);
    const user = await lookupUser(login);
    if (!user) return json({ error: `Den Twitch-Namen „${login}“ gibt es nicht` }, 400);
    const r = await addEntry(ev, user.id, user.name, settings, Date.now(), hook(req));
    return r.ok ? json({ ok: true, seat: r.seat, pos: r.pos }) : json({ error: `${user.name} hat schon ein Ticket oder steht auf der Warteliste` }, 400);
  }
  const userId = String(body.userId ?? '');
  if (sub === 'remove') {
    const r = await cancelEntry(ev, userId, settings, Date.now(), hook(req));
    return r.ok ? json({ ok: true, moved: r.moved.map((m) => m.name) }) : json({ error: 'Diese Person hat keinen aktiven Eintrag' }, 400);
  }
  if (sub === 'promote') {
    const r = await promoteEntry(ev, userId, settings);
    return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
  }
  if (sub === 'attendance') {
    const r = await setAttendance(ev, userId, body.status);
    return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
  }
  if (sub === 'ingame') {
    const r = await setIngame(userId, body.ingame);
    return r.ok ? json({ ok: true }) : json({ error: 'Bitte einen Namen angeben' }, 400);
  }
}
