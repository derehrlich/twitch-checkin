import { db } from './store.mjs';
import { sendChat, setRedemptionStatus } from './twitch.mjs';

const pad = (n) => String(n).padStart(15, '0');

// Stream-Tag als YYYY-MM-DD in der eingestellten Zeitzone
export function streamDay(settings, date = new Date()) {
  const shifted = new Date(date.getTime() - settings.dayRolloverHour * 3_600_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(shifted);
}

export const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

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
  await db.set(`user/${userId}`, user);
  return { isNew: true, count: user.count, day };
}

/** Kompletter Ablauf für eine Einlösung: zählen, Overlay, Chat, Einlösung abschließen oder erstatten. */
export async function handleRedemption(redemption, settings) {
  const { id, user_id, user_name, reward } = redemption;
  const result = await recordCheckIn(user_id, user_name, settings);
  const vars = { user: user_name, count: result.count };

  if (result.isNew) {
    await pushOverlay({ type: 'checkin', user: user_name, count: result.count });
    if (settings.chatEnabled) await sendChat(fill(settings.chatTemplate, vars)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
    await setRedemptionStatus(id, reward.id, 'FULFILLED');
  } else {
    if (settings.chatEnabled) await sendChat(fill(settings.duplicateTemplate, vars)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
    await setRedemptionStatus(id, reward.id, 'CANCELED'); // Punkte zurück
  }
  return result;
}
