// Countdown-Overlay (/countdown): zählt bis zu einer festen Zeit herunter, zum Beispiel die ganze Geburtstagswoche bis Mitternacht.
//   countdown/config   { show, title, target (ISO-Zeit oder null), endText, holdMinutes }
// Die Seite holt Config und Serverzeit alle paar Sekunden und rechnet selbst weiter, ein falsch gehender Rechner-Takt stört also nicht.
import { db } from '../kern/store.mjs';
import { parseLocal, toLocal } from '../belohnungen/gewinn.mjs';
import { fill } from '../zuschauer/checkin.mjs';

export const CONFIG_KEY = 'countdown/config';
export const DEFAULT_CONFIG = { show: false, title: 'Noch bis Mitternacht', target: null, endText: 'Alles Gute zum Geburtstag! 🎂', holdMinutes: 15 };

export const getConfig = async () => ({ ...DEFAULT_CONFIG, ...((await db.get(CONFIG_KEY)) ?? {}) });

const str = (v, max) => String(v ?? '').trim().slice(0, max);

/** Nimmt Eingaben aus dem Dashboard an. `target` kommt als „2026-11-29T00:00“ in der Zeitzone des Kanals. */
export async function updateConfig(input, settings) {
  const cfg = await getConfig();
  const i = input ?? {};
  if (typeof i.show === 'boolean') cfg.show = i.show;
  if ('title' in i) cfg.title = str(i.title, 60) || DEFAULT_CONFIG.title;
  if ('endText' in i) cfg.endText = str(i.endText, 80) || DEFAULT_CONFIG.endText;
  if ('holdMinutes' in i) { const n = Math.round(Number(i.holdMinutes)); cfg.holdMinutes = Number.isFinite(n) ? Math.min(1440, Math.max(0, n)) : cfg.holdMinutes; }
  if ('target' in i) {
    if (i.target === '' || i.target == null) cfg.target = null;
    else {
      const t = parseLocal(i.target, settings.timezone);
      if (!t) throw new Error('Bitte Datum und Uhrzeit angeben');
      cfg.target = t;
    }
  }
  await db.set(CONFIG_KEY, cfg);
  return cfg;
}

/** Was die OBS-Seite braucht. `now` ist die Serverzeit in Millisekunden. */
export async function publicView(now = Date.now()) {
  const c = await getConfig();
  return { show: c.show && Boolean(c.target), title: c.title, target: c.target ? Date.parse(c.target) : null, endText: c.endText, holdMinutes: c.holdMinutes, now };
}

/** Restzeit für den Chat: „3 Tage 4 Std 12 Min“, unter einer Stunde „12 Min 5 Sek“. */
export function fmtRemaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} ${d === 1 ? 'Tag' : 'Tage'} ${h} Std ${m} Min`;
  if (h) return `${h} Std ${m} Min`;
  return `${m} Min ${s % 60} Sek`;
}

/** Antwort auf den Geburtstags-Befehl: Restzeit bis zum Countdown-Ziel plus Wochenplan (eine Zeile pro Eintrag).
 *  Der Twitch-Chat kennt keine Zeilenumbrüche. Mit `bdayEachLine` kommt deshalb erst der Satz mit der Restzeit (ohne {plan}),
 *  dann jeder Planeintrag als eigene Nachricht (höchstens 12). Ohne den Haken: eine Nachricht, Einträge mit · verbunden.
 *  Gibt eine Liste von Nachrichten zurück. */
export async function birthdayReply(settings, now = Date.now()) {
  const c = await getConfig();
  const lines = String(settings.bdayPlan ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const over = c.target && now >= Date.parse(c.target);
  const template = over ? settings.bdayDoneTemplate : settings.bdayTemplate;
  const countdown = c.target && !over ? fmtRemaining(Date.parse(c.target) - now) : 'ein bisschen';
  if (settings.bdayEachLine && lines.length) {
    const head = fill(template, { countdown, plan: '' }).replace(/\s+/g, ' ').trim();
    return [head, ...lines.slice(0, 12)];
  }
  return [fill(template, { countdown, plan: lines.join(' · ') || 'Der Plan kommt gleich.' })];
}

export async function adminView(settings, now = Date.now()) {
  const c = await getConfig();
  return { config: { ...c, target: toLocal(c.target, settings.timezone) }, view: await publicView(now), timezone: settings.timezone };
}
