// Persönlicher Einlaufsound: wird beim Check-in statt des normalen Tons gespielt.
//
// Ablauf Kauf: Einlösung -> Upload durch die Person (Twitch-Anmeldung auf /einlaufsound) -> Freigabe im Admin.
// Die Einlösung bleibt bis zur Freigabe offen (Punkte reserviert). Ablehnung mit Erstattung gibt die Punkte zurück.
// Verlängern: sofort gültig, Monate anteilig am Kaufpreis; erlaubt außerdem einen neuen Upload (wieder mit Freigabe).
//
// Speicher:
//   entrysound/<twitchId>          { id, name, soundName, soundVersion, validUntil, uploadsLeft, purchase, pending, rejected }
//   entrysound-file/<twitchId>     freigegebene Datei { type, data }
//   entrysound-pending/<twitchId>  Datei, die auf die Freigabe wartet
//   entrysound-lock/<twitchId>     kurze Sperre gegen gleichzeitige Einlösungen
import { db } from './store.mjs';
import { sendChat, setRedemptionStatus, siteUrl } from './twitch.mjs';

const DAY = 86_400_000;
const MONTH_DAYS = 30.4375;

export const USER_ID = /^\d{1,20}$/;
export const entryKey = (id) => `entrysound/${id}`;
export const fileKey = (id) => `entrysound-file/${id}`;
export const pendingKey = (id) => `entrysound-pending/${id}`;
export const getEntry = (id) => db.get(entryKey(id));

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

// ---- Monate und Preise

/** Monate, die eine Verlängerung bringt: anteilig am Kaufpreis (75.000 = 6 Monate, 25.000 = 2 Monate). */
export const extendMonths = (s) => (s.entrySoundBuyMonths * s.entrySoundExtendCost) / s.entrySoundBuyCost;

/** 2 -> "2 Monate", 1 -> "1 Monat", 1.5 -> "1,5 Monate" */
export function fmtMonths(m) {
  const r = Math.round(m * 10) / 10;
  return `${String(r).replace('.', ',')} ${r === 1 ? 'Monat' : 'Monate'}`;
}

/** Ganze Monate werden kalendarisch addiert, ein Rest als Tage. */
export function addMonths(date, months) {
  const d = new Date(date);
  const whole = Math.trunc(months);
  d.setUTCMonth(d.getUTCMonth() + whole);
  const rest = months - whole;
  if (rest) d.setTime(d.getTime() + Math.round(rest * MONTH_DAYS * DAY));
  return d;
}

export const fmtDate = (date, settings) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: settings.timezone }).format(new Date(date));

/** Reward-Titel mit der genauen Monatszahl; Twitch erlaubt höchstens 45 Zeichen. */
export function rewardTitles(s) {
  const fit = (base, suffix) => `${base.slice(0, 45 - suffix.length)}${suffix}`;
  return {
    buy: fit(s.entrySoundBuyTitle, ` (${fmtMonths(s.entrySoundBuyMonths)})`),
    extend: fit(s.entrySoundExtendTitle, ` (+${fmtMonths(extendMonths(s))})`),
  };
}

export function rewardPrompts(s) {
  const url = `${siteUrl()}/einlaufsound`;
  return {
    buy: `Dein eigener Einlaufsound beim Check-in für ${fmtMonths(s.entrySoundBuyMonths)}. Nach dem Einlösen lädst du auf ${url} deine Datei hoch (höchstens ${s.entrySoundMaxSeconds} Sekunden). Wird sie abgelehnt, bekommst du die Punkte zurück.`.slice(0, 200),
    extend: `Verlängert deinen Einlaufsound um ${fmtMonths(extendMonths(s))} (höchstens ${fmtMonths(s.entrySoundMaxMonths)} Restlaufzeit) und erlaubt einen neuen Upload. Ohne Einlaufsound bekommst du die Punkte zurück.`.slice(0, 200),
  };
}

// ---- Zustand

export const isActive = (rec, now = new Date()) => Boolean(rec?.soundVersion && rec.validUntil && Date.parse(rec.validUntil) > now);
const isKept = (rec, s, now) => Boolean(rec?.soundVersion && rec.validUntil && addMonths(rec.validUntil, s.entrySoundKeepMonths) > now);

/** Sound für den Check-in dieser Person: { url, max } oder null (dann gilt der normale Ton).
 *  Ein gekaufter Einlaufsound hat Vorrang vor dem Katalog-Sound der Top des Monats. */
export async function activeSoundFor(userId, settings, now = new Date()) {
  if (settings.entrySoundEnabled) {
    const rec = await getEntry(userId);
    if (isActive(rec, now)) return { url: `/api/einlaufsound/audio?id=${userId}&v=${rec.soundVersion}`, max: settings.entrySoundMaxSeconds };
  }
  if (settings.awardEnabled) {
    const won = await db.get(`awardsound/${userId}`);
    if (won && Date.parse(won.validUntil) > now) {
      const cat = ((await db.get('config/catalog')) ?? []).find((c) => c.id === won.catalogId);
      if (cat?.soundVersion) return { url: `/api/einlaufsound/catalog-audio?id=${cat.id}&v=${cat.soundVersion}`, max: settings.entrySoundMaxSeconds };
    }
  }
  return null;
}

const say = async (settings, template, vars) => {
  if (settings.chatEnabled) await sendChat(fill(template, vars)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
};
const baseVars = (settings, user) => ({ user, url: `${siteUrl()}/einlaufsound`, days: settings.entrySoundUploadDays, max: fmtMonths(settings.entrySoundMaxMonths), months: '' });

async function refuse(redemption, settings, template, vars) {
  await say(settings, template, vars);
  await setRedemptionStatus(redemption.id, redemption.reward.id, 'CANCELED'); // Punkte zurück
  return { ok: false };
}

// Eine Einlösung je Person gleichzeitig. Bei Streit gibt es die Punkte zurück, damit nichts verloren geht.
async function withLock(userId, fn) {
  const k = `entrysound-lock/${userId}`;
  if (!(await db.setIfNew(k, Date.now()))) {
    if (Date.now() - ((await db.get(k)) ?? 0) < 30_000) return { busy: true };
    await db.set(k, Date.now());
  }
  try { return await fn(); } finally { await db.delete(k); }
}

// ---- Einlösungen

/** Reward „Eigener Einlaufsound“: legt den Kauf an und wartet auf Upload und Freigabe. */
export async function handleEntryBuy(redemption, settings, now = new Date()) {
  const { user_id: id, user_name: name } = redemption;
  const vars = baseVars(settings, name);
  const outcome = await withLock(id, async () => {
    const rec = await getEntry(id);
    if (rec?.purchase) return refuse(redemption, settings, settings.entrySoundOpenTemplate, vars);
    if (isActive(rec, now)) return refuse(redemption, settings, settings.entrySoundHasTemplate, { ...vars, until: fmtDate(rec.validUntil, settings) });
    await db.set(entryKey(id), { ...(rec ?? {}), id, name, uploadsLeft: 1, rejected: null, pending: rec?.pending ?? null, purchase: { redemptionId: redemption.id, rewardId: redemption.reward.id, at: now.toISOString() } });
    await say(settings, settings.entrySoundBuyTemplate, { ...vars, months: fmtMonths(settings.entrySoundBuyMonths) });
    return { ok: true }; // Einlösung bleibt offen bis zur Freigabe
  });
  return outcome.busy ? refuse(redemption, settings, settings.entrySoundBusyTemplate, vars) : outcome;
}

/** Reward „Einlaufsound verlängern“: sofort gültig. Ohne Sound oder über der Obergrenze: Hinweis und Punkte zurück. */
export async function handleEntryExtend(redemption, settings, now = new Date()) {
  const { user_id: id, user_name: name } = redemption;
  const vars = baseVars(settings, name);
  const outcome = await withLock(id, async () => {
    const rec = await getEntry(id);
    if (!isKept(rec, settings, now)) return refuse(redemption, settings, rec?.purchase ? settings.entrySoundOpenTemplate : settings.entrySoundNoneTemplate, vars);
    const months = extendMonths(settings);
    const start = Math.max(now.getTime(), Date.parse(rec.validUntil));
    const end = addMonths(new Date(start), months);
    const cap = addMonths(now, settings.entrySoundMaxMonths);
    if (end - cap > DAY) { // einen Tag Spielraum für Rundungen
      const rest = Math.max(0, (Date.parse(rec.validUntil) - now) / DAY / MONTH_DAYS);
      return refuse(redemption, settings, settings.entrySoundTooMuchTemplate, { ...vars, rest: fmtMonths(rest) });
    }
    await db.set(entryKey(id), { ...rec, name, validUntil: end.toISOString(), uploadsLeft: 1 });
    await say(settings, settings.entrySoundExtendTemplate, { ...vars, months: fmtMonths(months), until: fmtDate(end, settings) });
    await setRedemptionStatus(redemption.id, redemption.reward.id, 'FULFILLED');
    return { ok: true, validUntil: end.toISOString() };
  });
  return outcome.busy ? refuse(redemption, settings, settings.entrySoundBusyTemplate, vars) : outcome;
}

// ---- Upload durch die Person

/** Legt die hochgeladene Datei zur Prüfung ab. Nur mit Upload-Recht (nach Kauf oder Verlängerung), eine Datei zur Zeit. */
export async function submitUpload(userId, { name, buf, type }) {
  const rec = await getEntry(userId);
  if (!rec || rec.uploadsLeft < 1) return { error: 'Du hast gerade keinen Upload frei. Löse dafür zuerst den Reward ein.', status: 403 };
  if (rec.pending) return { error: 'Dein Sound wird schon geprüft.', status: 409 };
  await db.set(pendingKey(userId), { type, data: buf.toString('base64') });
  await db.set(entryKey(userId), { ...rec, pending: { name, at: new Date().toISOString(), replace: !rec.purchase }, rejected: null });
  return { ok: true };
}

// ---- Admin: Freigabe, Ablehnung, Entfernen

export async function approve(userId, settings, now = new Date()) {
  const rec = await getEntry(userId);
  if (!rec?.pending) return { error: 'Nichts zu prüfen', status: 404 };
  const file = await db.get(pendingKey(userId));
  if (!file) return { error: 'Die Datei fehlt', status: 404 };
  const next = { ...rec, soundName: rec.pending.name, soundVersion: now.getTime(), uploadsLeft: 0, pending: null, rejected: null };
  if (rec.purchase) { // Kauf abschließen: ab jetzt gilt die Laufzeit
    next.validUntil = addMonths(now, settings.entrySoundBuyMonths).toISOString();
    next.purchase = null;
  }
  await db.set(fileKey(userId), file);
  await db.set(entryKey(userId), next);
  await db.delete(pendingKey(userId));
  if (rec.purchase) await setRedemptionStatus(rec.purchase.redemptionId, rec.purchase.rewardId, 'FULFILLED');
  await say(settings, settings.entrySoundApprovedTemplate, { ...baseVars(settings, rec.name), until: fmtDate(next.validUntil, settings) });
  return { ok: true };
}

/** Lehnt die Datei ab. refund: beim Kauf die Punkte zurück; sonst darf die Person eine andere Datei hochladen. */
export async function reject(userId, settings, { reason = '', refund = false } = {}) {
  const rec = await getEntry(userId);
  if (!rec?.pending) return { error: 'Nichts zu prüfen', status: 404 };
  const why = String(reason).trim().slice(0, 120) || 'passt leider nicht';
  await db.delete(pendingKey(userId));
  const vars = { ...baseVars(settings, rec.name), reason: why };
  if (refund && rec.purchase) {
    await setRedemptionStatus(rec.purchase.redemptionId, rec.purchase.rewardId, 'CANCELED');
    await dropOrKeep(userId, { ...rec, purchase: null, pending: null, uploadsLeft: 0 });
    await say(settings, settings.entrySoundRefundTemplate, vars);
    return { ok: true, refunded: true };
  }
  await db.set(entryKey(userId), { ...rec, pending: null, rejected: { reason: why, at: new Date().toISOString() } });
  await say(settings, settings.entrySoundRejectedTemplate, vars);
  return { ok: true, refunded: false };
}

/** Entfernt Sound und Eintrag. Ein offener Kauf wird erstattet. */
export async function remove(userId) {
  const rec = await getEntry(userId);
  if (!rec) return { error: 'Nicht gefunden', status: 404 };
  if (rec.purchase) await setRedemptionStatus(rec.purchase.redemptionId, rec.purchase.rewardId, 'CANCELED');
  await dropAll(userId);
  return { ok: true };
}

async function dropAll(userId) {
  await db.delete(entryKey(userId));
  await db.delete(fileKey(userId));
  await db.delete(pendingKey(userId));
}

// Ohne gültigen oder aufbewahrten Sound bleibt nichts übrig; sonst wird nur der Eintrag aktualisiert
async function dropOrKeep(userId, rec) {
  if (rec.soundVersion) await db.set(entryKey(userId), rec); else await dropAll(userId);
}

// ---- Aufräumen (beim Öffnen des Admin-Tabs)

/** Erstattet Käufe ohne Upload nach der Frist und löscht Sounds, die länger als die Aufbewahrungszeit abgelaufen sind. */
export async function cleanup(settings, now = new Date()) {
  for (const key of await db.list('entrysound/')) {
    const rec = await db.get(key);
    if (!rec) continue;
    const id = key.slice('entrysound/'.length);
    if (rec.purchase && !rec.pending && now - Date.parse(rec.purchase.at) > settings.entrySoundUploadDays * DAY) {
      await setRedemptionStatus(rec.purchase.redemptionId, rec.purchase.rewardId, 'CANCELED');
      await say(settings, settings.entrySoundExpiredTemplate, baseVars(settings, rec.name));
      await dropOrKeep(id, { ...rec, purchase: null, uploadsLeft: 0 });
      continue;
    }
    if (!rec.purchase && !rec.pending && (!rec.soundVersion || (rec.validUntil && !isKept(rec, settings, now)))) await dropAll(id);
  }
}

/** Übersicht für den Admin: offene Prüfungen zuerst. */
export async function listEntries(settings, now = new Date()) {
  const rows = [];
  for (const key of await db.list('entrysound/')) {
    const rec = await db.get(key);
    if (!rec) continue;
    const status = rec.pending ? 'pending' : rec.purchase ? 'awaiting' : isActive(rec, now) ? 'active' : 'expired';
    rows.push({ id: rec.id, name: rec.name, status, soundName: rec.soundName ?? null, soundVersion: rec.soundVersion ?? null, validUntil: rec.validUntil ?? null, pending: rec.pending ?? null, purchaseAt: rec.purchase?.at ?? null, rejected: rec.rejected ?? null, uploadsLeft: rec.uploadsLeft ?? 0 });
  }
  const order = { pending: 0, awaiting: 1, active: 2, expired: 3 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || String(a.name).localeCompare(String(b.name)));
}

/** Was die Person auf der Upload-Seite sieht. */
export async function viewFor(userId, settings, now = new Date()) {
  const rec = await getEntry(userId);
  const status = !rec ? 'none' : rec.pending ? 'pending' : rec.purchase ? 'awaiting' : isActive(rec, now) ? 'active' : rec.soundVersion ? 'expired' : 'none';
  return {
    status, validUntil: rec?.validUntil ?? null, soundName: rec?.soundName ?? null, uploadsLeft: rec?.uploadsLeft ?? 0,
    pending: rec?.pending ? { name: rec.pending.name, at: rec.pending.at } : null, rejected: rec?.rejected ?? null,
    soundVersion: rec?.soundVersion ?? null,
    limits: { seconds: settings.entrySoundMaxSeconds, bytes: UPLOAD_MAX },
    titles: rewardTitles(settings),
  };
}

export const UPLOAD_MAX = 1_200_000; // Bytes, reicht für 10 Sekunden WAV in Mono/CD-Qualität und deutlich mehr als 10 Sekunden MP3
