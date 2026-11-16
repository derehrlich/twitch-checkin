// Mediakit: öffentliche Seite /mediakit mit Kennzahlen (aus der eigenen Messung oder einem Twitch-CSV-Export), Zeitplan,
// Zielgruppe und Partnerformaten. Übernommen aus dem VerwirrBot (dort Phase 7k), hier als echte Seite statt Datei zum Hochladen.
//
// Speicher:
//   mediakit/config   { published, source: 'stats'|'csv', intro, audience, prices, email, schedule, formats, criteria }
//   mediakit/csv      Kennzahlen aus der zuletzt eingelesenen CSV (die Datei selbst wird nie gespeichert, Einnahmen werden nicht gelesen)
import fs from 'node:fs';
import { db } from '../kern/store.mjs';
import { allDays, allSessions, dayOf, numbers30, weekConsistency } from './stats.mjs';

const TEMPLATE = new URL('./mediakit-vorlage.html', import.meta.url);
export const DEFAULTS = {
  published: false, source: 'stats',
  intro: 'Gaming-Stream aus dem Bau- und Aufbau-Bereich, mit Enshrouded, Survival und Simulation. Ruhig, humorvoll, mit einer Community, die mitbaut.',
  audience: '', prices: '', email: '',
  schedule: 'Fest: Montag und Freitag, Start zwischen 19:00 und 20:00 Uhr\nZusätzlich spontan: Dienstag oder Donnerstag, 20:00 bis 20:30 Uhr\nZeitzone: Deutschland (CET/CEST)',
  formats: 'Stream-Erwähnung | Nennung zu Beginn und einmal im Stream, mit Link in der Beschreibung\nOverlay / Banner | Dauerhafte Einblendung im Stream-Layout für einen festen Zeitraum\nCommunity-Aktion | Gemeinsame Aktion, z. B. Server-Aktion oder Gewinnspiel, mit Abstimmung\nClip-Paket | Kurzclips für TikTok, YouTube Shorts und Instagram Reels, Werbung klar gekennzeichnet',
  criteria: 'GPORTAL | 40 | 6 Monate konstanter Zeitplan',
};
const LIMITS = { intro: 300, audience: 300, prices: 300, email: 120, schedule: 800, formats: 1500, criteria: 800 };

export const getConfig = async () => ({ ...DEFAULTS, ...((await db.get('mediakit/config')) ?? {}) });
export async function saveConfig(input) {
  const cur = await getConfig();
  const next = { ...cur };
  for (const [k, max] of Object.entries(LIMITS)) if (k in (input ?? {})) next[k] = String(input[k] ?? '').replace(/\r/g, '').trim().slice(0, max);
  if (next.email && !/^[^\s@]{1,64}@[^\s@]{1,120}\.[^\s@]{2,}$/.test(next.email)) throw new Error('Die E-Mail-Adresse sieht nicht richtig aus');
  if ('source' in (input ?? {})) next.source = input.source === 'csv' && (await db.get('mediakit/csv')) ? 'csv' : 'stats';
  if ('published' in (input ?? {})) next.published = Boolean(input.published);
  await db.set('mediakit/config', next);
  return next;
}

// ---- Twitch-CSV („Analysen und Einnahmen nach Tag“). Deutsche und englische Spaltennamen, Einnahmen-Spalten werden nicht gelesen.
const COLS = {
  date: ['datum', 'date'], minutes: ['gestreamte minuten', 'minutes streamed'], avg: ['durchschnittliche anzahl zuschauer', 'average viewers'],
  max: ['max. zuschauer', 'max viewers'], watched: ['angesehene minuten', 'minutes watched'], follows: ['follower', 'follows'],
};
const num = (v) => {
  let s = String(v ?? '0').trim().replace('%', '');
  s = s.includes(',') && s.includes('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.');
  const n = Number(s); return Number.isFinite(n) ? n : 0;
};
const dateOf = (v) => {
  const s = String(v ?? '').trim().slice(0, 10); let m;
  if ((m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/))) return `${m[3]}-${m[2]}-${m[1]}`;
  if ((m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
};
function parseCsv(text) {
  const firstLine = text.split('\n')[0] ?? '';
  const sep = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Kennzahlen aus dem CSV-Export. Wirft einen Fehler mit deutscher Meldung, wenn die Datei nicht passt. */
export function csvNumbers(text) {
  const rows = parseCsv(String(text ?? '').replace(/^﻿/, ''));
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  const missing = Object.entries(idx).filter(([k, i]) => i < 0 && k !== 'date').map(([k]) => COLS[k][0]);
  if (missing.length) throw new Error(`In der Datei fehlen Spalten: ${missing.join(', ')}. Bitte den Export „Analysen und Einnahmen nach Tag“ nehmen.`);
  const body = rows.slice(1);
  const live = body.filter((r) => num(r[idx.minutes]) > 0);
  if (!live.length) throw new Error('In der Datei steht kein Streamtag.');
  const dates = idx.date >= 0 ? body.map((r) => dateOf(r[idx.date])).filter(Boolean).sort() : [];
  const sum = (list, i) => list.reduce((a, r) => a + num(r[i]), 0);
  return {
    source: 'csv', from: dates[0] ?? null, to: dates.at(-1) ?? null, streamDays: live.length,
    avgViewers: sum(live, idx.avg) / live.length, maxViewers: Math.round(Math.max(...body.map((r) => num(r[idx.max])))),
    hoursStreamed: sum(body, idx.minutes) / 60, hoursWatched: sum(body, idx.watched) / 60, newFollowers: Math.round(sum(body, idx.follows)),
  };
}
export async function importCsv(text, settings, now = Date.now()) {
  if (String(text ?? '').length > 2_000_000) throw new Error('Die Datei ist zu groß');
  const k = { ...csvNumbers(text), readAt: dayOf(settings, now) };
  await db.set('mediakit/csv', k);
  await db.set('mediakit/config', { ...(await getConfig()), source: 'csv' });
  return k;
}
export async function removeCsv() {
  await db.delete('mediakit/csv');
  await db.set('mediakit/config', { ...(await getConfig()), source: 'stats' });
}

// ---- Auswertung und Seite
const NAMES = { audience: 'Zielgruppe', prices: 'Preise', email: 'Geschäfts-E-Mail' };
export const missing = (cfg) => Object.entries(NAMES).filter(([k]) => !cfg[k]).map(([, n]) => n);
const pairs = (text) => String(text ?? '').split('\n').map((z) => z.split('|').map((t) => t.trim())).filter((p) => p.length >= 2 && p[0] && p[1]);

/** Zeilen „Anbieter | Mindest-Ø-Zuschauer | Hinweis“ gegen die aktuellen Zahlen halten (nur für Marcel, nie auf der Seite). */
export function criteria(text, k) {
  return pairs(text).map(([name, goal, hint = '']) => ({ name, goal: Number(goal.replace(',', '.')), hint }))
    .filter((c) => Number.isFinite(c.goal) && c.goal > 0)
    .map((c) => ({ ...c, now: k.avgViewers, percent: Math.min(100, Math.floor((k.avgViewers / c.goal) * 100)), ok: k.avgViewers >= c.goal }));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('de-DE');
const short = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : '');
const long = (iso) => (iso ? `${short(iso)}${iso.slice(0, 4)}` : '');

export function renderHtml(k, cfg, today, { noindex = false } = {}) {
  const ph = (t) => `<span class="placeholder">[${esc(t)}]</span>`;
  const tiles = [
    [`~${fmt(k.avgViewers)}`, 'Ø Zuschauer an Streamtagen'], [fmt(k.maxViewers), 'Höchstwert gleichzeitiger Zuschauer'],
    [`~${fmt(k.hoursWatched)}`, 'Stunden gesehen'], [`~${fmt(k.hoursStreamed)}`, 'Stunden gestreamt'], [fmt(k.streamDays), 'Streamtage'],
    ...(k.newFollowers != null ? [[`~${fmt(k.newFollowers)}`, 'neue Follower']] : []),
  ];
  const range = k.from && k.to ? `${k.source === 'csv' ? 'Twitch-Export' : 'letzte 30 Tage'}, ${short(k.from)} bis ${long(k.to)}` : 'letzte 30 Tage';
  const fill = {
    ROBOTS: noindex ? '<meta name="robots" content="noindex">\n' : '',
    INTRO: esc(cfg.intro), ZEITRAUM: esc(range), STAND: long(today),
    QUELLE: k.source === 'csv' ? 'Twitch-Analytics-Export' : 'eigene Messung während der Streams (Twitch-Zuschauerzahl, jede Minute)',
    TILES: tiles.map(([a, b]) => `      <div class="stat"><b>${a.startsWith('~') ? `<span class="ca">ca.</span>${esc(a.slice(1))}` : esc(a)}</b><span>${esc(b)}</span></div>`).join('\n'),
    ZEITPLAN: cfg.schedule.split('\n').filter((z) => z.trim()).map((z) => `      <li>${esc(z.trim())}</li>`).join('\n'),
    ZIELGRUPPE: cfg.audience ? esc(cfg.audience) : ph('Altersgruppe, Geschlecht und Land aus den Twitch-Analytics eintragen'),
    FORMATE: pairs(cfg.formats).map(([a, b]) => `        <tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('\n'),
    PREISE: cfg.prices ? esc(cfg.prices) : ph('nach Absprache, oder eintragen'),
    MAIL: cfg.email ? `<a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a>` : ph('Geschäfts-E-Mail hier eintragen'),
  };
  return fs.readFileSync(TEMPLATE, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, key) => fill[key] ?? m);
}

/** Zahlen beider Quellen und die gewählte. */
export async function numbers(settings, now = Date.now()) {
  const [sessions, days, csv, cfg] = await Promise.all([allSessions(), allDays(), db.get('mediakit/csv'), getConfig()]);
  const stats = numbers30(sessions, days, settings, now);
  return { cfg, stats, csv: csv ?? null, chosen: cfg.source === 'csv' && csv ? csv : stats, weeks: weekConsistency(sessions, settings, now) };
}

/** Öffentliche Seite: nur wenn veröffentlicht. Solange Angaben fehlen, bleibt sie für Suchmaschinen gesperrt. */
export async function publicPage(settings, now = Date.now()) {
  const { cfg, chosen } = await numbers(settings, now);
  return cfg.published ? renderHtml(chosen, cfg, dayOf(settings, now), { noindex: missing(cfg).length > 0 }) : null;
}
export async function previewPage(settings, now = Date.now()) {
  const { cfg, chosen } = await numbers(settings, now);
  return renderHtml(chosen, cfg, dayOf(settings, now), { noindex: true });
}

export async function adminView(settings, now = Date.now()) {
  const { cfg, stats, csv, chosen, weeks } = await numbers(settings, now);
  return { config: cfg, numbers: chosen, stats, csv, weeks, criteria: criteria(cfg.criteria, chosen), missing: missing(cfg), statsEnabled: Boolean(settings.statsEnabled) };
}
