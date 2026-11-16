// Streamplan für den Chat (!plan). Der Plan kommt vom VerwirrBot (sein Kalender): Er schickt alle paar Minuten die nächsten Tage an
// POST /api/community/plan. Die Stadtwache ruft den Bot nie selbst an.
//   bot/plan   { at (ms), items: [{ date: 'JJJJ-MM-TT', time: 'HH:MM' oder '', text }] }
import { db } from '../kern/store.mjs';
import { fill } from '../zuschauer/checkin.mjs';

const KEY = 'bot/plan';
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const getPlan = () => db.get(KEY);

export async function savePlan(items, now = Date.now()) {
  const clean = (Array.isArray(items) ? items : []).slice(0, 60).map((i) => ({
    date: String(i?.date ?? ''), time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(i?.time ?? '')) ? i.time : '', text: String(i?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
  })).filter((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.date) && i.text);
  await db.set(KEY, { at: now, items: clean });
  return clean.length;
}

const dateIn = (tz, ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));
const timeIn = (tz, ms) => new Intl.DateTimeFormat('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

/** Text für !plan: die nächsten Einträge der kommenden 7 Tage (ein Eintrag von heute bleibt bis eine Stunde nach Beginn drin). */
export function planText(plan, settings, now = Date.now()) {
  const url = settings.discordInvite || 'unserem Discord';
  if (!plan || now - plan.at > 3 * 86_400_000) return fill(settings.planUnknownTemplate, { url });
  const tz = settings.timezone, today = dateIn(tz, now), last = dateIn(tz, now + 7 * 86_400_000), tomorrow = dateIn(tz, now + 86_400_000);
  const ago = now - 3_600_000, agoDate = dateIn(tz, ago), agoTime = timeIn(tz, ago);
  const rows = plan.items
    .filter((i) => i.date >= today && i.date <= last && !(i.date === agoDate && i.time && i.time < agoTime))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).slice(0, 5);
  if (!rows.length) return fill(settings.planNoneTemplate, { url });
  const name = (d) => (d === today ? 'heute' : d === tomorrow ? 'morgen' : `${WD[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.slice(8)}.${d.slice(5, 7)}.`);
  return fill(settings.planTemplate, { plan: rows.map((r) => `${name(r.date)}${r.time ? ' ' + r.time : ''} ${r.text}`).join(' · '), url });
}
