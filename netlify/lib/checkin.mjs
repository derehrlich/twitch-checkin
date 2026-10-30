import { db } from './store.mjs';
import { sendChat, setRedemptionStatus } from './twitch.mjs';
import { activeSoundFor } from './entrysound.mjs';
import { linkTip } from './community.mjs';
import { findRescue, getStreamDays, parseLevels, streakFor } from './streak.mjs';

const pad = (n) => String(n).padStart(15, '0');

// Stream-Tag als YYYY-MM-DD in der eingestellten Zeitzone
export function streamDay(settings, date = new Date()) {
  const shifted = new Date(date.getTime() - settings.dayRolloverHour * 3_600_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(shifted);
}

// 134 -> "2 Std 14 Min", 120 -> "2 Std", 45 -> "45 Min"
export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} Min`;
  return m % 60 ? `${Math.floor(m / 60)} Std ${m % 60} Min` : `${Math.floor(m / 60)} Std`;
}

export const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

// Titel und Nachricht eines Alert-Schilds aus den Einstellungen (kind: follow, sub, resub, gift, cheer, raid, rescue)
export const signText = (settings, kind, vars) => ({ title: fill(settings[`${kind}Title`] ?? '', vars), message: fill(settings[`${kind}Message`] ?? '', vars) });

// Overlay-Ereignis ablegen; das Overlay holt es beim nächsten Abruf. Alte Einträge werden gleich mit entsorgt.
export async function pushOverlay(event) {
  const now = Date.now();
  await db.set(`event/${pad(now)}-${Math.random().toString(36).slice(2, 7)}`, event);
  for (const key of await db.list('event/')) {
    if (now - Number(key.slice(6, 21)) > 3_600_000) await db.delete(key);
  }
}

/** Trägt den Besuch ein. Pro Stream-Tag zählt nur einer; die Sperre ist atomar. */
export async function recordCheckIn(userId, userName, settings) {
  const day = streamDay(settings);
  const fresh = await db.setIfNew(`checked/${day}/${userId}`, 1);
  if (fresh) await db.setIfNew(`streamday/${day}`, 1); // Stream-Tag für die Streak-Berechnung
  const user = (await db.get(`user/${userId}`)) ?? { name: userName, count: 0, first: null, last: null, days: [] };
  if (!fresh) {
    // Nicht schreiben: ein gleichzeitiger Gewinner würde sonst mit altem Stand überschrieben.
    // Steht der Tag noch nicht im gelesenen Eintrag, ist der Gewinner gerade dabei, ihn nachzutragen.
    return { isNew: false, count: user.days.includes(day) ? user.count : user.count + 1, day };
  }
  const now = new Date().toISOString();
  user.name = userName; // Anzeigename kann sich ändern
  user.days = user.days.includes(day) ? user.days : [...user.days, day].sort();
  user.count = user.days.length;
  user.first ??= now;
  user.last = now;
  user.sessions = { ...(user.sessions ?? {}), [day]: { in: now, out: null, minutes: null } };
  await db.set(`user/${userId}`, user);
  return { isNew: true, count: user.count, day };
}

/** Kompletter Ablauf für eine Einlösung: zählen, Overlay, Chat, Einlösung abschließen oder erstatten. */
export async function handleRedemption(redemption, settings) {
  const { id, user_id, user_name, reward } = redemption;
  const result = await recordCheckIn(user_id, user_name, settings);
  const streak = await streakFor(user_id, result.day, settings);
  const vars = { user: user_name, count: result.count, streak: streak.current, record: streak.record };

  if (result.isNew) {
    const milestone = settings.milestoneEnabled && parseLevels(settings.milestoneLevels).includes(result.count);
    const entrySound = await activeSoundFor(user_id, settings).catch((e) => { console.warn('Einlaufsound nicht geladen:', e.message); return null; });
    await pushOverlay({ type: 'checkin', user: user_name, count: result.count, streak: streak.current, milestone, ...(entrySound ? { entrySound } : {}) });
    if (settings.chatEnabled) await sendChat(fill(milestone ? settings.milestoneTemplate : settings.chatTemplate, vars)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
    await setRedemptionStatus(id, reward.id, 'FULFILLED');
    if (settings.chatEnabled) { // Tipp zur Verknüpfung, einmal im Monat und nur für Unverknüpfte
      const tip = await linkTip(user_id, user_name, settings).catch(() => null);
      if (tip) await sendChat(tip).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
    }
  } else {
    if (settings.chatEnabled) await sendChat(fill(settings.duplicateTemplate, vars)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
    await setRedemptionStatus(id, reward.id, 'CANCELED'); // Punkte zurück
  }
  return result;
}

/** Streak-Retter: schließt die jüngste Lücke aus verpassten Streams. Nicht nötig oder zu lang: Hinweis und Punkte zurück. */
export async function handleRescue(redemption, settings, now = new Date()) {
  const { id, user_id, user_name, reward } = redemption;
  const user = await db.get(`user/${user_id}`);
  const today = streamDay(settings, now);
  const streamDays = await getStreamDays();

  const refuse = async (template) => {
    if (settings.chatEnabled) await sendChat(fill(template, { user: user_name, streak: '', days: '' })).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
    await setRedemptionStatus(id, reward.id, 'CANCELED'); // Punkte zurück
    return { ok: false };
  };

  const rescue = user ? findRescue(user, streamDays, today, settings.streakGrace, settings.rescueMaxDays) : { status: 'none' };
  if (rescue.status === 'none') return refuse(settings.rescueNotNeededTemplate);
  if (rescue.status === 'toolong') return refuse(settings.rescueTooLongTemplate);
  // Atomare Sperre: dieselbe Lücke nur einmal retten, auch bei gleichzeitigen Einlösungen
  if (!(await db.setIfNew(`rescue/${user_id}/${rescue.days.at(-1)}`, 1))) return refuse(settings.rescueNotNeededTemplate);

  user.name = user_name;
  user.saved = [...new Set([...(user.saved ?? []), ...rescue.days])].sort();
  await db.set(`user/${user_id}`, user);
  const { current } = await streakFor(user_id, today, settings);

  await pushOverlay({ type: 'alert', kind: 'rescue', user: user_name, streak: current, days: rescue.days.length, ...signText(settings, 'rescue', { user: user_name, streak: current, days: rescue.days.length }) });
  if (settings.chatEnabled) await sendChat(fill(settings.rescueTemplate, { user: user_name, streak: current, days: rescue.days.length })).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
  await setRedemptionStatus(id, reward.id, 'FULFILLED');
  return { ok: true, saved: rescue.days.length, streak: current };
}

// Offene Sitzung (eingecheckt, nicht ausgecheckt) der letzten 24 Stunden; die jüngste gewinnt.
// So klappt das Auschecken auch, wenn der Stream über den Tageswechsel hinausgeht.
function findOpenSession(user, now) {
  let best = null;
  for (const [day, s] of Object.entries(user.sessions ?? {})) {
    const age = now - Date.parse(s.in);
    if (s.out == null && age >= 0 && age <= 24 * 3_600_000 && (!best || s.in > best.in)) best = { day, ...s };
  }
  return best;
}

// Check-ins aus der Zeit vor dem Check-out haben keine Sitzung, der Zeitpunkt steht aber in user.last.
// Daraus wird die offene Sitzung rekonstruiert, wenn der letzte Check-in höchstens 24 Stunden her ist.
function legacySession(user, settings, now) {
  if (!user.last) return null;
  const last = new Date(user.last);
  const age = now - last;
  const day = streamDay(settings, last);
  if (age < 0 || age > 24 * 3_600_000 || !user.days.includes(day) || user.sessions?.[day]) return null;
  return { day, in: user.last, out: null };
}

/** Check-out: Dauer = jetzt minus Check-in. Ohne offenen Check-in oder doppelt: Hinweis und Punkte zurück. */
export async function handleCheckout(redemption, settings, now = new Date()) {
  const { id, user_id, user_name, reward } = redemption;
  const user = await db.get(`user/${user_id}`);
  const open = user ? (findOpenSession(user, now) ?? legacySession(user, settings, now)) : null;

  const refuse = async (template) => {
    if (settings.chatEnabled) await sendChat(fill(template, { user: user_name, count: user?.count ?? 0, duration: '' })).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
    await setRedemptionStatus(id, reward.id, 'CANCELED'); // Punkte zurück
    return { ok: false };
  };

  if (!open) {
    const alreadyOut = Object.values(user?.sessions ?? {}).some((s) => s.out && now - Date.parse(s.out) <= 24 * 3_600_000);
    return refuse(alreadyOut ? settings.checkoutDuplicateTemplate : settings.noCheckinTemplate);
  }
  // Atomare Sperre gegen gleichzeitige Doppel-Einlösungen
  if (!(await db.setIfNew(`checkout/${open.day}/${user_id}`, 1))) return refuse(settings.checkoutDuplicateTemplate);

  const minutes = Math.max(0, Math.round((now - Date.parse(open.in)) / 60_000));
  user.name = user_name;
  user.sessions = { ...(user.sessions ?? {}), [open.day]: { in: open.in, out: now.toISOString(), minutes } };
  await db.set(`user/${user_id}`, user);

  await pushOverlay({ type: 'checkout', user: user_name, minutes, count: user.count });
  if (settings.chatEnabled) {
    await sendChat(fill(settings.checkoutTemplate, { user: user_name, count: user.count, duration: fmtDuration(minutes) })).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
  }
  await setRedemptionStatus(id, reward.id, 'FULFILLED');
  return { ok: true, minutes };
}
