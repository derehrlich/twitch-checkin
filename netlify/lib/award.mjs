// Top des Monats: Die Besten der Monatsrangliste suchen sich einen Einlaufsound aus dem Katalog aus.
//
// Ablauf: Ab dem 2. des Folgemonats (die Discord-Zahlen des Vormonats sind dann abgeschlossen) wird der Vormonat beim ersten
// passenden Ereignis (Chat, Check-in, Admin, Seitenaufruf) einmalig abgeschlossen. Die Top n kommen in eine Gewinnerliste, bei
// Gleichstand auf dem letzten Platz alle mit derselben Punktzahl. Sie haben awardDays Tage Zeit zu wählen, wer nicht wählt,
// behält den normalen Ton. Der gewählte Sound gilt awardMonths Monate ab der ersten Auswahl. Ein gekaufter Sound hat Vorrang.
//
// Speicher:
//   config/catalog            Katalog: [{ id, name, soundName, soundVersion }], höchstens CATALOG_MAX Plätze
//   catalog/<id>              Sounddatei { type, data }
//   award/<YYYY-MM>           { month, label, closedAt, deadline, winners: [{ twitchId, name, place, points, choice, chosenAt }] }
//   awardsound/<twitchId>     gültiger Katalog-Sound { catalogId, validUntil, month }
import crypto from 'node:crypto';
import { db } from './store.mjs';
import { dayOf, monthBoard, monthOf, secretSet } from './community.mjs';
import { addMonths, fmtDate } from './entrysound.mjs';
import { sendChat, siteUrl } from './twitch.mjs';

export const CATALOG_MAX = 15;
export const CATALOG_ID = /^[a-f0-9]{8}$/;
export const catalogKey = (id) => `catalog/${id}`;
export const getCatalog = async () => (await db.get('config/catalog')) ?? [];
export const saveCatalog = (list) => db.set('config/catalog', list);
export const newCatalogId = () => crypto.randomBytes(4).toString('hex');

const DAY = 86_400_000;
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
export const awardUrl = () => `${siteUrl()}/einlaufsound`;

export function prevMonthKey(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Gewinner: die Top n, bei Gleichstand auf dem letzten Platz alle mit derselben Punktzahl. Platzvergabe wie im Sport (1, 1, 3). */
export function winnersOf(rows, n) {
  if (!rows.length) return [];
  const cut = rows[Math.min(n, rows.length) - 1].points;
  const out = [];
  let place = 0, last = null;
  rows.forEach((r, i) => {
    if (r.points !== last) { place = i + 1; last = r.points; }
    if (r.points >= cut) out.push({ twitchId: r.twitchId, name: r.name, place, points: r.points, choice: null, chosenAt: null });
  });
  return out;
}

const closed = new Set(); // Monate, die in dieser Function-Instanz schon als abgeschlossen bekannt sind (spart Lesezugriffe)
const say = async (settings, template, vars) => {
  if (settings.chatEnabled) await sendChat(fill(template, vars)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
};

/** Schließt den Vormonat ab, falls das noch nicht geschehen ist. Gibt den neuen Eintrag zurück, sonst null. force: auch vor dem 2. des Monats. */
export async function ensureAward(settings, now = new Date(), { force = false } = {}) {
  if (!settings.awardEnabled || !settings.communityEnabled || !secretSet()) return null;
  const month = prevMonthKey(monthOf(settings, now));
  if (!force) {
    if (Number(dayOf(settings, now).slice(8, 10)) < 2 || closed.has(month)) return null;
  }
  if (await db.get(`award/${month}`)) { closed.add(month); return null; }
  const board = await monthBoard(settings, month);
  const winners = winnersOf(board.rows, settings.awardSize);
  const record = { month, label: board.label, closedAt: now.toISOString(), deadline: new Date(now.getTime() + settings.awardDays * DAY).toISOString(), winners };
  if (!(await db.setIfNew(`award/${month}`, record))) { closed.add(month); return null; } // ein anderer Aufruf war schneller
  closed.add(month);
  if (winners.length) {
    await say(settings, settings.awardAnnounceTemplate, {
      n: winners.length, month: board.label, url: awardUrl(), until: fmtDate(record.deadline, settings),
      list: winners.map((w) => `${w.place}. ${w.name}`).join(' · '),
    });
  }
  return record;
}

/** Laufende Auswahl dieser Person (jüngster Monat, in dem sie Gewinner ist und die Frist läuft) oder null. */
export async function openAwardFor(twitchId, now = new Date()) {
  for (const key of (await db.list('award/')).slice(-2).reverse()) {
    const award = await db.get(key);
    const winner = award?.winners.find((w) => w.twitchId === twitchId);
    if (winner && Date.parse(award.deadline) > now) return { award, winner };
  }
  return null;
}

/** Wählt (oder ändert bis zum Fristende) den Katalog-Sound. Die Laufzeit startet mit der ersten Auswahl. */
export async function choose(twitchId, twitchName, catalogId, settings, now = new Date()) {
  if (!settings.awardEnabled) return { error: 'Die Auswahl ist gerade nicht aktiv.', status: 403 };
  const open = await openAwardFor(twitchId, now);
  if (!open) return { error: 'Du hast gerade keine Auswahl frei.', status: 403 };
  const cat = (await getCatalog()).find((c) => c.id === catalogId && c.soundVersion);
  if (!cat) return { error: 'Diesen Sound gibt es nicht (mehr).', status: 400 };
  const { award, winner } = open;
  const first = !winner.chosenAt;
  winner.choice = cat.id;
  winner.chosenAt ??= now.toISOString();
  await db.set(`award/${award.month}`, award);
  const prev = await db.get(`awardsound/${twitchId}`);
  const validUntil = first || !prev ? addMonths(now, settings.awardMonths).toISOString() : prev.validUntil;
  await db.set(`awardsound/${twitchId}`, { catalogId: cat.id, validUntil, month: award.month });
  if (first) await say(settings, settings.awardChosenTemplate, { user: twitchName, sound: cat.name, until: fmtDate(validUntil, settings) });
  return { ok: true, validUntil, sound: cat.name };
}

/** Hinweis beim Check-in für Gewinner, die noch nicht gewählt haben. Sonst null. */
export async function awardTip(twitchId, twitchName, settings, now = new Date()) {
  if (!settings.awardEnabled) return null;
  const open = await openAwardFor(twitchId, now);
  if (!open || open.winner.choice) return null;
  return fill(settings.awardTipTemplate, { user: twitchName, n: open.award.winners.length, month: open.award.label, url: awardUrl(), until: fmtDate(open.award.deadline, settings) });
}

/** Was die Person auf der Auswahl-Seite sieht: laufende Auswahl samt Katalog und der aktuell gültige Katalog-Sound. */
export async function awardView(twitchId, settings, now = new Date()) {
  const catalog = (await getCatalog()).filter((c) => c.soundVersion);
  const open = await openAwardFor(twitchId, now);
  const won = await db.get(`awardsound/${twitchId}`);
  const current = won && Date.parse(won.validUntil) > now ? catalog.find((c) => c.id === won.catalogId) : null;
  return {
    open: open ? { label: open.award.label, place: open.winner.place, deadline: open.award.deadline, choice: open.winner.choice } : null,
    catalog: open ? catalog.map((c) => ({ id: c.id, name: c.name, url: `/api/einlaufsound/catalog-audio?id=${c.id}&v=${c.soundVersion}` })) : [],
    current: current ? { name: current.name, validUntil: won.validUntil } : null,
  };
}

/** Übersicht für den Admin: die letzten Monate mit Gewinnern und ihrer Wahl. */
export async function recentAwards(settings) {
  const catalog = await getCatalog();
  const out = [];
  for (const key of (await db.list('award/')).slice(-3).reverse()) {
    const a = await db.get(key);
    if (!a) continue;
    out.push({ month: a.month, label: a.label, closedAt: a.closedAt, deadline: a.deadline, open: Date.parse(a.deadline) > Date.now(),
      winners: a.winners.map((w) => ({ name: w.name, place: w.place, points: w.points, choice: catalog.find((c) => c.id === w.choice)?.name ?? null })) });
  }
  return out;
}
