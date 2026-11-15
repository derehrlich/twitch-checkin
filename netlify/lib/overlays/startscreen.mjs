// Startbildschirm-Overlay (/startscreen): „Gleich geht’s los“ mit Countdown, Baustellen-Fortschritt und wechselnden Bauanekdoten.
//   startscreen/config   { title, subtitle, endText, minutes (Vorlauf), rotateSeconds, showProgress, anecdotes (Text, eine je Zeile),
//                          bgName, bgVersion }
//   startscreen/state    { active, startedAt (ms), until (ms) }
//   startbg/image        { type, data }  das Hintergrundbild (Base64, wie bei den Alert-Bildern)
// Die Seite holt alles alle paar Sekunden samt Serverzeit und rechnet selbst weiter.
import { db } from '../kern/store.mjs';

export const CONFIG_KEY = 'startscreen/config';
export const STATE_KEY = 'startscreen/state';
export const BG_KEY = 'startbg/image';

// Eine Zeile: „Überschrift | Text“ oder nur „Text“.
export const DEFAULT_ANECDOTES = [
  'Fundament wird gegossen | Der Beton muss jetzt erst mal trocknen. Das Warten ist der schwerste Teil der Arbeit.',
  'Baustellen-Weisheit | Ein Meter Abstand zur Wand ist ein Plan. Zwei Zentimeter daneben ist ein Anbau.',
  'Kaffeepause läuft | Auf jeder Baustelle gilt: Ohne Kaffee wird kein Stein bewegt.',
  'Maßband gesucht | Es steckt bestimmt hinter dem Ohr. Oder in der Hosentasche. Oder es ist nie angekommen.',
  'Zweimal messen | Einmal schneiden. Und dann trotzdem zu kurz. Das ist Handwerk.',
  'Bauleiter-Wissen | „Das haben wir gleich“ heißt auf Deutsch: frühestens nach der Mittagspause.',
  'Kran wird aufgebaut | Der Kran steht höher als alle Ausreden, weshalb der Zeitplan trotzdem wackelt.',
  'Schubkarre repariert | Das Rad hat jetzt Luft. Die Ladung wiegt trotzdem dreimal so viel wie gedacht.',
  'Wasserwaage im Einsatz | Die Blase sagt „gerade“. Das Haus sagt „kommt drauf an“.',
  'Bauhelm Pflicht | Wer ohne Helm kommt, trägt dafür einen Eimer. Auch das ist Arbeitsschutz.',
  'Richtfest in Sicht | Erst die Bretter, dann das Bier. So war es schon immer.',
  'Gerüst steht | Es wackelt nur ein bisschen. Das nennt man dann „flexibel gebaut“.',
  'Beton rührt sich | Eine Mischung aus Zement, Sand, Wasser und viel Hoffnung.',
  'Bauzaun aufgestellt | Er hält niemanden draußen, dafür sieht alles viel professioneller aus.',
  'Der Nagel | Beim ersten Schlag verbogen, beim zweiten gerade, beim dritten im Daumen.',
  'Statik-Check | Die Statikerin sagt, das hält. Der Bauherr sagt, das hat immer gehalten.',
  'Ziegel gezählt | Bestellt waren 1.000. Angekommen sind 987. Gebraucht werden 1.200.',
  'Bagger startklar | Er buddelt tiefer als jede Rechnung vorher geplant hat.',
  'Tipp vom Polier | Wer „Pfusch“ ruft, hat meistens die Anleitung nicht gelesen.',
  'Arbeitsschuhe | Stahlkappen schützen die Zehen. Den Stolz schützt leider nichts.',
  'Zeitplan der Baustelle | Mittwoch fertig. Welcher Mittwoch, bleibt ein Geheimnis.',
  'Bauschutt sortiert | Zehn Eimer Kleinkram, ein Eimer Stolz und eine Tüte „Das brauchen wir noch“.',
  'Dachlatten gestapelt | Von unten sieht alles ordentlich aus. Von oben ist es ein Haufen.',
  'Der Zollstock | Hat zwölf Gelenke und genau eines davon geht nie auf.',
  'Mittagspause | Zählt zur Arbeitszeit, wenn man dabei auf die Baustelle schaut.',
  'Putz trocknet | Nicht anfassen! Ein Fingerabdruck bleibt ein Leben lang.',
  'Handwerker-Regel | Was nicht passt, wird passend gemacht. Wer passend macht, braucht einen Hammer.',
  'Neue Schaufel | Sie glänzt noch. Das ändert sich spätestens nach dem ersten Loch.',
  'Fundament-Wissen | Wer es tief genug gräbt, findet entweder Steine oder eine alte Münze.',
  'Zement im Haar | Gehört zum Bauen dazu, wie das Salz zur Suppe. Nur schwerer rauszubekommen.',
].join('\n');

export const DEFAULT_CONFIG = {
  title: 'Gleich geht’s los!',
  subtitle: 'Die Baustelle öffnet in Kürze',
  endText: 'Die Baustelle ist eröffnet! 🏗️',
  minutes: 10, rotateSeconds: 9, showProgress: true,
  anecdotes: DEFAULT_ANECDOTES, bgName: null, bgVersion: null,
};
const IDLE = { active: false, startedAt: 0, until: 0 };

export const getConfig = async () => ({ ...DEFAULT_CONFIG, ...((await db.get(CONFIG_KEY)) ?? {}) });
export const getState = async () => ({ ...IDLE, ...((await db.get(STATE_KEY)) ?? {}) });

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const num = (v, min, max, fallback) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

/** Aus dem Textfeld wird eine Liste (leere Zeilen weg, höchstens 100 Zeilen mit je 200 Zeichen). */
export const parseAnecdotes = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.trim().slice(0, 200)).filter(Boolean).slice(0, 100)
  .map((l) => { const i = l.indexOf('|'); return i > 0 ? { head: l.slice(0, i).trim(), text: l.slice(i + 1).trim() } : { head: '', text: l }; });

export async function updateConfig(input) {
  const cfg = await getConfig();
  const i = input ?? {};
  if ('title' in i) cfg.title = str(i.title, 60) || DEFAULT_CONFIG.title;
  if ('subtitle' in i) cfg.subtitle = str(i.subtitle, 80);
  if ('endText' in i) cfg.endText = str(i.endText, 80) || DEFAULT_CONFIG.endText;
  if ('minutes' in i) cfg.minutes = num(i.minutes, 1, 240, cfg.minutes);
  if ('rotateSeconds' in i) cfg.rotateSeconds = num(i.rotateSeconds, 4, 60, cfg.rotateSeconds);
  if (typeof i.showProgress === 'boolean') cfg.showProgress = i.showProgress;
  if ('anecdotes' in i) cfg.anecdotes = parseAnecdotes(i.anecdotes).map((a) => (a.head ? `${a.head} | ${a.text}` : a.text)).join('\n');
  if ('bgName' in i) { cfg.bgName = i.bgName ? str(i.bgName, 80) : null; cfg.bgVersion = i.bgName ? (i.bgVersion ?? Date.now()) : null; }
  await db.set(CONFIG_KEY, cfg);
  return cfg;
}

/** Vorlauf starten (Minuten aus den Einstellungen, oder die angegebenen). */
export async function start(minutes, now = Date.now()) {
  const cfg = await getConfig();
  const min = num(minutes, 1, 240, cfg.minutes);
  const state = { active: true, startedAt: now, until: now + min * 60_000 };
  await db.set(STATE_KEY, state);
  return state;
}

/** Zeit dazugeben (oder, falls nichts läuft, neu starten). */
export async function extend(minutes, now = Date.now()) {
  const s = await getState();
  if (!s.active) return start(minutes, now);
  const next = { ...s, until: Math.max(s.until, now) + num(minutes, 1, 240, 5) * 60_000 };
  await db.set(STATE_KEY, next);
  return next;
}

export async function stop() { await db.set(STATE_KEY, { ...IDLE }); }

/** Was die OBS-Seite braucht. `now` ist die Serverzeit in Millisekunden. */
export async function publicView(now = Date.now()) {
  const [c, s] = await Promise.all([getConfig(), getState()]);
  return {
    show: s.active, title: c.title, subtitle: c.subtitle, endText: c.endText, showProgress: c.showProgress, rotateSeconds: c.rotateSeconds,
    startedAt: s.startedAt, until: s.until, anecdotes: parseAnecdotes(c.anecdotes), bg: c.bgVersion ? `/api/startscreen-bg?v=${c.bgVersion}` : null, now,
  };
}

export async function adminView() {
  const [c, s] = await Promise.all([getConfig(), getState()]);
  return { config: c, state: s, defaultAnecdotes: DEFAULT_ANECDOTES };
}
