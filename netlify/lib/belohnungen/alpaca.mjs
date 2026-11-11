// Alpakas im Overlay (/alpakas): jede Person, die im Chat schreibt, bekommt ein Pixel-Alpaka. Mit einem Kanalpunkte-Reward
// färbt man es ein (die Farbe schreibt man beim Einlösen dazu).
//
// Speicher:
//   alpaca-color/<twitchId>   { color: '#rrggbb', name }   gekaufte Farbe, bleibt für immer
//   alpaca-active             { <twitchId>: { n: Name, c: Farbe|null, t: letzte Nachricht } }   wer gerade im Overlay läuft
import { db } from '../kern/store.mjs';
import { sendChat, setRedemptionStatus } from '../kern/twitch.mjs';

export const ACTIVE_KEY = 'alpaca-active';
export const colorKey = (id) => `alpaca-color/${id}`;
const HARD_CAP = 100; // so viele Einträge hält die Liste höchstens (das Overlay zeigt davon alpacaMax)
const TOUCH_GAP = 60_000; // eine Person wird höchstens einmal pro Minute neu geschrieben

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

// ---- Farben

// Natürliche Alpaka-Töne für alle, die nichts gekauft haben (so fallen gefärbte auf)
export const NATURAL = ['#f1e6d0', '#d9c3a0', '#b89468', '#8a6a48', '#5e4632', '#efefef', '#a9a39a', '#3b3430'];

// Farbnamen (ohne Umlaute geschrieben: ä=ae, ö=oe, ü=ue, ß=ss)
export const COLOR_NAMES = {
  rot: '#e03a3a', dunkelrot: '#9c1c2c', rosa: '#ff8fc0', pink: '#ff4fa3', magenta: '#d62ecb',
  orange: '#ff8a1f', gelb: '#ffd93d', gold: '#f2b705', beige: '#e8d5b0', braun: '#8a5a33',
  gruen: '#3fbf5f', hellgruen: '#8be26a', dunkelgruen: '#1f7a3e', mint: '#7de8c0', tuerkis: '#27c9c0', cyan: '#2fd6f0',
  blau: '#3a7bff', hellblau: '#7fc4ff', dunkelblau: '#1f3f9c', lila: '#a14ee8', violett: '#7a3de0',
  weiss: '#f6f3ec', grau: '#9a9aa5', silber: '#c9ccd6', schwarz: '#2c2a33',
  // englisch
  red: '#e03a3a', blue: '#3a7bff', green: '#3fbf5f', yellow: '#ffd93d', purple: '#a14ee8', white: '#f6f3ec', black: '#2c2a33', gray: '#9a9aa5', grey: '#9a9aa5', brown: '#8a5a33', teal: '#27c9c0',
};

const plain = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return `#${hex2(f(0) * 255)}${hex2(f(8) * 255)}${hex2(f(4) * 255)}`;
}

/** Farbe aus dem Text der Einlösung: Name („türkis“), Hex („#ff8800“, „f80“ nur mit #) oder „zufall“. null = nicht erkannt. */
export function parseColor(input, rand = Math.random) {
  const text = plain(input ?? '').trim();
  if (!text) return null;
  const hex = /#([0-9a-f]{6}|[0-9a-f]{3})\b/.exec(text) ?? /(?:^|\s)([0-9a-f]{6})(?:\s|$)/.exec(text);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return `#${h}`;
  }
  for (const word of text.split(/[^a-z]+/).filter(Boolean)) {
    if (COLOR_NAMES[word]) return COLOR_NAMES[word];
    if (word === 'zufall' || word === 'zufaellig' || word === 'random') return hslToHex(Math.floor(rand() * 360), 0.7, 0.55);
  }
  return null;
}

/** Eigene Farbe oder, wenn es keine gibt, ein fester natürlicher Ton nach der Twitch-ID. */
export function colorFor(id, color) {
  if (color) return color;
  const n = Number(String(id).slice(-6)) || 0;
  return NATURAL[n % NATURAL.length];
}

// ---- Wer läuft gerade

const loadActive = async () => (await db.get(ACTIVE_KEY)) ?? {};
const lastTouch = new Map(); // spart Schreibzugriffe, solange die Function-Instanz läuft

function prune(active, now, minutes) {
  const cutoff = now - minutes * 60_000;
  for (const [id, a] of Object.entries(active)) if (!(a.t >= cutoff)) delete active[id];
  const ids = Object.keys(active);
  if (ids.length > HARD_CAP) for (const id of ids.sort((a, b) => active[b].t - active[a].t).slice(HARD_CAP)) delete active[id];
  return active;
}

/** Wird bei jeder Chat-Nachricht aufgerufen: hält die Person in der Liste und merkt sich, wann sie zuletzt geschrieben hat. */
export async function touchAlpaca(id, name, settings, now = Date.now()) {
  if (!id || now - (lastTouch.get(id) ?? 0) < TOUCH_GAP) return false;
  lastTouch.set(id, now);
  if (lastTouch.size > 5000) lastTouch.clear();
  const active = await loadActive();
  const color = active[id] ? active[id].c : ((await db.get(colorKey(id)))?.color ?? null);
  active[id] = { n: name, c: color, t: now };
  await db.set(ACTIVE_KEY, prune(active, now, settings.alpacaMinutes));
  return true;
}

/** Was das Overlay braucht (öffentlich): die zuletzt aktiven Chatter mit Name und Farbe. */
export async function publicView(settings, now = Date.now()) {
  if (!settings.alpacaEnabled) return { enabled: false, alpacas: [] };
  const cutoff = now - settings.alpacaMinutes * 60_000;
  const list = Object.entries(await loadActive())
    .filter(([, a]) => a.t >= cutoff)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, settings.alpacaMax)
    .map(([id, a]) => ({ id, name: a.n, color: colorFor(id, a.c) }));
  return { enabled: true, alpacas: list };
}

// ---- Einlösung

const say = async (settings, template, vars) => {
  if (settings.chatEnabled) await sendChat(fill(template, vars)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
};

/** Reward „Alpaka färben“: Farbe aus dem Text lesen und speichern. Nicht erkannt: Hinweis und Punkte zurück. */
export async function handleAlpaca(redemption, settings, now = Date.now()) {
  const { id: rid, user_id: id, user_name: name, user_input: input, reward } = redemption;
  const color = parseColor(input);
  if (!color) {
    await say(settings, settings.alpacaBadTemplate, { user: name });
    await setRedemptionStatus(rid, reward.id, 'CANCELED'); // Punkte zurück
    return { ok: false };
  }
  await db.set(colorKey(id), { color, name });
  const active = await loadActive();
  active[id] = { n: name, c: color, t: now }; // sofort sichtbar, auch wenn die Person gerade nicht geschrieben hat
  await db.set(ACTIVE_KEY, prune(active, now, settings.alpacaMinutes));
  lastTouch.set(id, now);
  await say(settings, settings.alpacaTemplate, { user: name, color: String(input).trim().slice(0, 30) });
  await setRedemptionStatus(rid, reward.id, 'FULFILLED');
  return { ok: true, color };
}
