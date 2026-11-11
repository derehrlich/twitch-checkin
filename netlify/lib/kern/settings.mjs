// Einstellungen des Bots: Standardwerte, Grenzen und Prüfung kommen aus EINER Stelle, dem Schema der Admin-Oberfläche
// (public/admin/js/schema.js). Dort steht je Einstellung eine Zeile mit Name, Standardwert, Beschriftung und Grenzen.
// Eine neue Einstellung braucht also nur diese eine Zeile, hier ist nichts mehr einzutragen.
import { db } from './store.mjs';
import { parseLevels } from '../zuschauer/streak.mjs';
import { SCHEMA } from '../../../public/admin/js/schema.js';

const ITEMS = Object.values(SCHEMA).flat().flatMap((g) => g.items);
const RULES = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// Werte, die nicht über die Formulare kommen: eigene Töne und Bilder (werden über /api/admin/sound und /image gesetzt)
const HIDDEN = {
  images: {}, // Bilder und GIFs je Platz: { follow: { name, version }, ... }
  soundName: null, // Check-in-Ton
  soundVersion: null,
  sounds: {}, // weitere Töne je Platz: { follow: { name, version }, ... }
};

export const DEFAULTS = { ...Object.fromEntries(ITEMS.map((i) => [i.id, i.def])), ...HIDDEN };

// Braucht der Bot den Chat-Webhook? Für Befehle, Abspann und Chat-Zähler.
export const needsChat = (s) => Boolean(s.chatCommands || s.creditsEnabled || s.chatStats || s.communityEnabled || s.alpacaEnabled || s.chatOverlayEnabled || s.modEnabled);

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Prüft eine Eingabe gegen die Regel der Einstellung (liefert den bereinigten Wert, oder undefined = ignorieren)
function clean(rule, v) {
  const { type, attrs = {} } = rule;
  if (type === 'check') return typeof v === 'boolean' ? v : undefined;
  if (type === 'number') {
    const n = Number(v);
    if (v === '' || v == null || !Number.isFinite(n)) return undefined;
    const whole = Number.isInteger(Number(attrs.step ?? 1)); // Schritt 0,1 (z. B. Lautstärke): Kommazahlen erlaubt
    return clamp(whole ? Math.round(n) : n, attrs.min ?? -Infinity, attrs.max ?? Infinity);
  }
  if (typeof v !== 'string') return undefined;
  if (attrs.kind === 'command') { // Chat-Befehl: !wort ohne Leerzeichen
    const w = v.trim().toLowerCase().replace(/\s+/g, '');
    return /^!\w{1,25}$/.test(w) ? w : undefined;
  }
  if (attrs.kind === 'timezone') {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: v }); return v; } catch { return undefined; }
  }
  if (attrs.kind === 'levels') { // Meilensteine: Zahlen mit Komma, höchstens 20
    const levels = parseLevels(v).filter((n) => n <= 100_000).slice(0, 20);
    return levels.length ? levels.join(',') : undefined;
  }
  const text = v.trim();
  return text || attrs.empty ? text.slice(0, attrs.maxlength ?? 400) : undefined; // leer nur, wo es erlaubt ist
}

// Bereinigt Eingaben aus dem Admin-Bereich. Unbekannte Felder fliegen raus.
export function sanitize(input) {
  const out = {};
  for (const [key, rule] of Object.entries(RULES)) {
    if (!(key in input)) continue;
    const v = clean(rule, input[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export async function getSettings() {
  return { ...DEFAULTS, ...((await db.get('config/settings')) ?? {}) };
}

export async function saveSettings(input) {
  const next = { ...(await getSettings()), ...sanitize(input) };
  await db.set('config/settings', next);
  return next;
}

// Ton-Metadaten setzen, ohne die Eingabe-Bereinigung der normalen Einstellungen.
// Der Check-in-Ton behält seine alten Felder, alle anderen Plätze liegen unter sounds.
export async function setImage(meta, slot) {
  const cur = await getSettings();
  const images = { ...(cur.images ?? {}) };
  if (meta) images[slot] = { name: meta.name, version: meta.version }; else delete images[slot];
  const next = { ...cur, images };
  await db.set('config/settings', next);
  return next;
}

export async function setSound(meta, slot = 'checkin') {
  const cur = await getSettings();
  let next;
  if (slot === 'checkin') next = { ...cur, soundName: meta?.name ?? null, soundVersion: meta?.version ?? null };
  else {
    const sounds = { ...(cur.sounds ?? {}) };
    if (meta) sounds[slot] = { name: meta.name, version: meta.version }; else delete sounds[slot];
    next = { ...cur, sounds };
  }
  await db.set('config/settings', next);
  return next;
}
