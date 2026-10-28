import { db } from './store.mjs';

export const DEFAULTS = {
  rewardTitle: 'Check-in',
  rewardCost: 1,
  chatEnabled: true,
  // Platzhalter: {user} {count}
  chatTemplate: '✅ {user} ist eingecheckt – du warst jetzt schon {count}x dabei! 🎉',
  duplicateTemplate: '{user}, du bist heute schon eingecheckt (Besuch #{count}) ✅ Deine Punkte bekommst du zurück.',
  timezone: 'Europe/Berlin',
  // Der Stream-Tag wechselt zu dieser Uhrzeit (Streams nach Mitternacht zählen zum Vortag)
  dayRolloverHour: 5,
  volume: 0.6,
  duration: 5000,
  // Check-out: zweiter Reward, aus Check-in und Check-out ergibt sich die Dauer
  checkoutEnabled: true,
  checkoutRewardTitle: 'Check-out',
  checkoutRewardCost: 1,
  // Platzhalter: {user} {count} {duration}
  checkoutTemplate: '👋 {user} geht – {duration} dabei gewesen. Bis zum nächsten Mal!',
  checkoutDuplicateTemplate: '{user}, du bist heute schon ausgecheckt ✅ Deine Punkte bekommst du zurück.',
  noCheckinTemplate: '{user}, du bist gerade nicht eingecheckt – zum Auschecken musst du zuerst einchecken. Deine Punkte bekommst du zurück.',
  // Raids: Chatnachricht, Shoutout und Clip, wenn jemand rein raidet
  raidEnabled: true,
  raidMinViewers: 1,
  // Platzhalter: {raider} {viewers} {game} {url}
  raidTemplate: '💜 RAID! {raider} ist mit {viewers} Leuten da – willkommen! Zuletzt gespielt: {game}. Schaut bei {url} vorbei!',
  raidShoutout: true,
  raidClip: true,
  raidClipMaxSeconds: 30,
  // Eigener Ton (wird über /api/admin/sound gesetzt, nicht über die Einstellungen)
  soundName: null,
  soundVersion: null,
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Bereinigt Eingaben aus dem Admin-Bereich. Unbekannte Felder fliegen raus.
function sanitize(input) {
  const out = {};
  const str = (k, max) => { if (typeof input[k] === 'string' && input[k].trim()) out[k] = input[k].trim().slice(0, max); };
  const num = (k, min, max, int = true) => {
    const n = Number(input[k]);
    if (input[k] !== '' && input[k] != null && Number.isFinite(n)) out[k] = clamp(int ? Math.round(n) : n, min, max);
  };
  str('rewardTitle', 45);
  str('chatTemplate', 400);
  str('duplicateTemplate', 400);
  str('checkoutRewardTitle', 45);
  str('checkoutTemplate', 400);
  str('checkoutDuplicateTemplate', 400);
  str('noCheckinTemplate', 400);
  str('raidTemplate', 400);
  num('raidMinViewers', 0, 100_000);
  num('raidClipMaxSeconds', 5, 60);
  num('rewardCost', 1, 1_000_000);
  num('checkoutRewardCost', 1, 1_000_000);
  num('dayRolloverHour', 0, 23);
  num('volume', 0, 1, false);
  num('duration', 2000, 30_000);
  if (typeof input.chatEnabled === 'boolean') out.chatEnabled = input.chatEnabled;
  for (const k of ['raidEnabled', 'raidShoutout', 'raidClip']) if (typeof input[k] === 'boolean') out[k] = input[k];
  if (typeof input.checkoutEnabled === 'boolean') out.checkoutEnabled = input.checkoutEnabled;
  if (typeof input.timezone === 'string') {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone }); out.timezone = input.timezone; } catch { /* ungültig, ignorieren */ }
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

// Ton-Metadaten setzen, ohne die Eingabe-Bereinigung der normalen Einstellungen
export async function setSound(meta) {
  const next = { ...(await getSettings()), soundName: meta?.name ?? null, soundVersion: meta?.version ?? null };
  await db.set('config/settings', next);
  return next;
}
