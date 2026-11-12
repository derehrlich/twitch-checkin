// Glücksrad-Overlay (/rad): beliebig viele Räder mit eigenen Feldern (Gebäudeart, Baustil, Spiel, Community-Aktion …).
//   rad/wheel/<id>   { id, name, removeWon, segments: [{ id, label, weight, color, used }], createdAt }
//   rad/state        { show, wheelId, spin: { id, wheelId, startedAt, durationMs, index, segmentId, label, turns } | null, history: [{ at, wheel, label }] }
// Das Ergebnis würfelt der Server (crypto, nach Gewicht). Das Overlay dreht nur, bis das Rad auf dem Ergebnis steht.
import crypto from 'node:crypto';
import { db } from '../kern/store.mjs';
import { sendChat } from '../kern/twitch.mjs';
import { fill } from '../zuschauer/checkin.mjs';

export const MAX_WHEELS = 40;
export const MAX_SEGMENTS = 40;
export const PALETTE = ['#f6b82e', '#4fb8c4', '#e5533d', '#58a84a', '#9146ff', '#f08a24', '#ff8fc0', '#2a7fbf'];
export const SPIN_MS = 7000;
const WHEEL_ID = /^[a-f0-9]{8}$/;
export const isWheelId = (v) => WHEEL_ID.test(String(v ?? ''));
const nid = () => crypto.randomBytes(4).toString('hex');
const wheelKey = (id) => `rad/wheel/${id}`;
const STATE_KEY = 'rad/state';

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Aus einem Textfeld machen: pro Zeile `Name` oder `Name ; Gewicht ; #Farbe`. Leere Zeilen fallen weg. */
export function parseSegments(text, old = []) {
  const known = new Map(old.map((s) => [s.label.toLowerCase(), s]));
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const [label, w, c] = line.split(';').map((x) => x.trim());
    if (!label) continue;
    const weight = Math.min(100, Math.max(1, Math.round(Number(String(w ?? '').replace(',', '.'))) || 1));
    const prev = known.get(label.slice(0, 40).toLowerCase());
    out.push({ id: prev?.id ?? nid(), label: label.slice(0, 40), weight, color: HEX.test(c ?? '') ? c.toLowerCase() : '', used: prev?.used ?? false });
  }
  if (out.length > MAX_SEGMENTS) throw new Error(`Höchstens ${MAX_SEGMENTS} Felder pro Rad`);
  return out;
}
export const segmentsText = (w) => w.segments.map((s) => [s.label, ...(s.weight !== 1 || s.color ? [s.weight] : []), ...(s.color ? [s.color] : [])].join(' ; ')).join('\n');
const colored = (segs) => segs.map((s, i) => ({ ...s, color: s.color || PALETTE[i % PALETTE.length] }));

export const getWheel = (id) => (isWheelId(id) ? db.get(wheelKey(id)) : null);
export const saveWheel = (w) => db.set(wheelKey(w.id), w);
export async function listWheels() {
  const out = [];
  for (const k of await db.list('rad/wheel/')) { const w = await db.get(k); if (w) out.push(w); }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
export async function getState() {
  return { show: false, wheelId: null, spin: null, history: [], ...((await db.get(STATE_KEY)) ?? {}) };
}
const saveState = (s) => db.set(STATE_KEY, s);

export async function createWheel({ name, segmentsText: text } = {}, now = Date.now()) {
  if ((await db.list('rad/wheel/')).length >= MAX_WHEELS) throw new Error(`Höchstens ${MAX_WHEELS} Räder`);
  const w = { id: nid(), name: str(name, 40) || 'Neues Rad', removeWon: false, segments: parseSegments(text ?? 'Feld 1\nFeld 2\nFeld 3'), createdAt: new Date(now).toISOString() };
  if (w.segments.length < 2) throw new Error('Ein Rad braucht mindestens 2 Felder');
  await saveWheel(w);
  const st = await getState();
  if (!st.wheelId) { st.wheelId = w.id; await saveState(st); }
  return w;
}

export async function updateWheel(id, input) {
  const w = await getWheel(id);
  if (!w) return null;
  const i = input ?? {};
  if ('name' in i) w.name = str(i.name, 40) || w.name;
  if (typeof i.removeWon === 'boolean') w.removeWon = i.removeWon;
  if ('segments' in i) {
    const segs = parseSegments(i.segments, w.segments);
    if (segs.length < 2) throw new Error('Ein Rad braucht mindestens 2 Felder');
    w.segments = segs;
  }
  await saveWheel(w);
  return w;
}

export async function deleteWheel(id) {
  if (!(await getWheel(id))) return false;
  await db.delete(wheelKey(id));
  const st = await getState();
  if (st.wheelId === id) { st.wheelId = (await listWheels())[0]?.id ?? null; st.spin = null; await saveState(st); }
  return true;
}

export async function updateState(input) {
  const st = await getState();
  if (typeof input.show === 'boolean') st.show = input.show;
  if ('wheelId' in input) {
    if (!(await getWheel(input.wheelId))) throw new Error('Rad nicht gefunden');
    if (st.wheelId !== input.wheelId) { st.wheelId = input.wheelId; st.spin = null; }
  }
  await saveState(st);
  return st;
}

/** Zufall nach Gewicht, kryptografisch. Nur Felder, die noch nicht „verbraucht“ sind (bei removeWon). */
export function pick(segments, rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32) {
  const live = segments.filter((s) => !s.used);
  const total = live.reduce((a, s) => a + s.weight, 0);
  let t = rnd() * total;
  for (const s of live) { if (t < s.weight) return s; t -= s.weight; }
  return live.at(-1) ?? null;
}

/** Dreht das gewählte Rad. Das Ergebnis steht sofort fest, das Overlay zeigt es nach der Drehzeit. Der Chat-Text kommt erst nach der Drehzeit. */
export async function spin(settings, { now = Date.now(), announce = true } = {}) {
  const st = await getState();
  const w = await getWheel(st.wheelId);
  if (!w) return { error: 'Es ist kein Rad gewählt', status: 404 };
  if (st.spin && now < st.spin.startedAt + st.spin.durationMs + 1500) return { error: 'Das Rad dreht sich noch', status: 409 };
  const seg = pick(w.segments);
  if (!seg) return { error: 'Alle Felder sind schon dran. Setze das Rad zurück.', status: 409 };
  const index = w.segments.findIndex((s) => s.id === seg.id);
  st.spin = { id: nid(), wheelId: w.id, startedAt: now, durationMs: SPIN_MS, index, segmentId: seg.id, label: seg.label, turns: 5 + crypto.randomInt(0, 3), land: crypto.randomInt(10, 91) / 100 };
  st.history = [{ at: new Date(now).toISOString(), wheel: w.name, label: seg.label }, ...st.history].slice(0, 50);
  st.show = true; // ein Dreh macht das Rad sichtbar
  await saveState(st);
  if (w.removeWon) { seg.used = true; await saveWheel(w); }
  if (announce && settings.radChatEnabled && settings.chatEnabled) {
    setTimeout(() => sendChat(fill(settings.radTemplate, { wheel: w.name, result: seg.label })).catch((e) => console.warn('Chat fehlgeschlagen:', e.message)), SPIN_MS + 500).unref?.();
  }
  return { ok: true, spin: st.spin };
}

export async function resetUsed(id) {
  const w = await getWheel(id);
  if (!w) return null;
  for (const s of w.segments) s.used = false;
  await saveWheel(w);
  return w;
}

export async function clearHistory() { const st = await getState(); st.history = []; await saveState(st); return st; }

/** Beispiel-Räder für den Anfang (Dienstag-Bauabend). Nur zum Ändern gedacht. */
export const EXAMPLES = [
  { name: 'Gebäudeart', segmentsText: 'Wohnhaus\nTaverne\nLeuchtturm\nBurg\nMarkthalle\nGeburtstagstorte\nWerkstatt\nBrücke' },
  { name: 'Baustil', segmentsText: 'Gemütlich\nMittelalter\nMärchenhaft\nModern\nSteampunk\nBunt und chaotisch' },
  { name: 'Community-Aktion', segmentsText: 'Chat wählt das Material\nZuschauer-Umfrage zur Farbe\n5 Minuten Zeitlimit\nOhne Hilfsmittel bauen\nBlind bauen\nFreie Wahl' },
];

/** Was die OBS-Seite braucht: gewähltes Rad mit Farben, aktueller Dreh, Serverzeit. */
export async function publicView(now = Date.now()) {
  const st = await getState();
  const w = await getWheel(st.wheelId);
  if (!w) return { show: false, now };
  return {
    show: st.show, now, wheel: { id: w.id, name: w.name, removeWon: w.removeWon, segments: colored(w.segments).map((s) => ({ id: s.id, label: s.label, weight: s.weight, color: s.color, used: s.used })) },
    spin: st.spin && st.spin.wheelId === w.id ? st.spin : null,
  };
}

export async function adminView(now = Date.now()) {
  const st = await getState();
  const wheels = (await listWheels()).map((w) => ({ ...w, segmentsText: segmentsText(w) }));
  return { state: st, wheels, view: await publicView(now), spinMs: SPIN_MS };
}
