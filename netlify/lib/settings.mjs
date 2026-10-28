import { db } from './store.mjs';
import { parseLevels } from './streak.mjs';

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
  // Meilensteine: bei diesen Gesamtbesuchen gibt es ein Sonder-Feuerwerk und einen eigenen Chattext
  milestoneEnabled: true,
  milestoneLevels: '10,25,50,100,250,500,1000',
  // Platzhalter: {user} {count} {streak} {record}
  milestoneTemplate: '🏆 {user} ist zum {count}. Mal dabei – Meilenstein! Danke für deine Treue ❤️',
  // Streak: Tage in Folge, an denen du gestreamt hast und die Person da war. Eine Schonfrist verzeiht verpasste Streams.
  streakGrace: 1,
  // Streak-Retter: dritter Reward, schließt eine gerissene Lücke (Platzhalter: {user} {streak} {days})
  streakRescueEnabled: true,
  streakRewardTitle: 'Streak-Retter',
  streakRewardCost: 500,
  rescueMaxDays: 3,
  rescueTemplate: '🛟 {user} rettet die Streak! {days} verpasste(r) Stream(s) überbrückt – Streak: {streak} 🔥',
  rescueNotNeededTemplate: '{user}, deine Streak ist nicht in Gefahr ✅ Deine Punkte bekommst du zurück.',
  rescueTooLongTemplate: '{user}, die Lücke ist zu lang oder zu lange her, da kann ich nichts mehr retten. Deine Punkte bekommst du zurück.',
  // Raids: Chatnachricht, Shoutout und Clip, wenn jemand rein raidet
  raidEnabled: true,
  raidMinViewers: 1,
  // Platzhalter: {raider} {viewers} {game} {url} {raids} {visit}
  raidTemplate: '💜 RAID! {raider} ist mit {viewers} Leuten da – {visit}, danke dir! Zuletzt gespielt: {game}. Schaut bei {url} vorbei!',
  raidShoutout: true,
  raidClip: true,
  raidClipMaxSeconds: 30,
  // Alerts: Follow, Sub/Resub/Prime, Gift-Subs, Bits. Standardmäßig aus, damit nichts doppelt läuft,
  // solange ein anderes Alert-Tool noch aktiv ist.
  alertsEnabled: false,
  alertFollow: true,
  alertSub: true,
  alertGift: true,
  alertCheer: true,
  alertCheerMin: 1,
  alertChat: false, // zusätzlich zur Overlay-Karte eine Dankes-Nachricht im Chat
  // Platzhalter: {user} {tier} {months} {total} {bits}
  followTemplate: '💜 Danke für den Follow, {user}! Schön, dass du da bist.',
  subTemplate: '⭐ {user} hat abonniert ({tier}, {months} Monate) – vielen Dank!',
  giftTemplate: '🎁 {user} verschenkt {total} Sub(s) – du bist großartig!',
  cheerTemplate: '💎 {user} schickt {bits} Bits – danke!',
  // Eigener Ton (wird über /api/admin/sound gesetzt, nicht über die Einstellungen)
  soundName: null,
  soundVersion: null,
  sounds: {}, // weitere Töne je Platz: { follow: { name, version }, ... }
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
  for (const k of ['milestoneTemplate', 'rescueTemplate', 'rescueNotNeededTemplate', 'rescueTooLongTemplate']) str(k, 400);
  str('streakRewardTitle', 45);
  num('streakRewardCost', 1, 1_000_000);
  num('streakGrace', 0, 5);
  num('rescueMaxDays', 1, 14);
  if (typeof input.milestoneLevels === 'string') {
    const levels = parseLevels(input.milestoneLevels).filter((n) => n <= 100_000).slice(0, 20);
    if (levels.length) out.milestoneLevels = levels.join(',');
  }
  num('raidMinViewers', 0, 100_000);
  num('raidClipMaxSeconds', 5, 60);
  for (const k of ['followTemplate', 'subTemplate', 'giftTemplate', 'cheerTemplate']) str(k, 400);
  num('alertCheerMin', 1, 1_000_000);
  num('rewardCost', 1, 1_000_000);
  num('checkoutRewardCost', 1, 1_000_000);
  num('dayRolloverHour', 0, 23);
  num('volume', 0, 1, false);
  num('duration', 2000, 30_000);
  if (typeof input.chatEnabled === 'boolean') out.chatEnabled = input.chatEnabled;
  for (const k of ['milestoneEnabled', 'streakRescueEnabled', 'raidEnabled', 'raidShoutout', 'raidClip', 'alertsEnabled', 'alertFollow', 'alertSub', 'alertGift', 'alertCheer', 'alertChat']) if (typeof input[k] === 'boolean') out[k] = input[k];
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

// Ton-Metadaten setzen, ohne die Eingabe-Bereinigung der normalen Einstellungen.
// Der Check-in-Ton behält seine alten Felder, alle anderen Plätze liegen unter sounds.
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
