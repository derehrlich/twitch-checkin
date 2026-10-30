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
  // Schild-Texte der Alerts (Titel oben, Nachricht unter dem Namen). Platzhalter je nach Alert:
  // {user} {tier} {months} {total} {bits} {viewers} {raids} {game} {streak} {days}
  followTitle: 'Neuer Follower!', followMessage: '',
  subTitle: 'Neues Abo!', subMessage: 'Tier {tier} ({months} Monate)',
  resubTitle: 'Abo-Treue!', resubMessage: 'Tier {tier} ({months} Monate)',
  giftTitle: 'Sub-Geschenk!', giftMessage: 'verschenkt {total} Sub(s)!',
  cheerTitle: 'Neuer Cheer!', cheerMessage: '{bits} Bits',
  raidTitle: 'Raid-Alarm!', raidMessage: 'Bringt {viewers} Leute mit!',
  rescueTitle: 'Streak gerettet!', rescueMessage: '{days} verpasste(r) Stream(s) überbrückt – Streak: {streak}',
  alertDuration: 8000, // Anzeigedauer der Alert-Schilder in ms (ist ein Ton länger, bleibt das Schild bis zu seinem Ende)
  raidDuration: 11000,
  // Eigene Bilder je Alert (wie die Sounds): { follow: { name, version }, ... }
  images: {},
  // Soundboard: optionale Chatnachricht bei einer Einlösung (Platzhalter: {user} {title})
  soundboardChat: false,
  soundboardTemplate: '🔊 {user} spielt „{title}“',
  // Chat-Befehle (brauchen den Chat-Webhook). Platzhalter !streak: {user} {count} {streak} {record} {time} {rank} {total}
  chatCommands: true,
  commandCooldown: 10, // Sekunden, gilt je Befehl für alle gemeinsam
  streakCommand: '!streak',
  streakCmdTemplate: '📊 {user}: {count} Besuche · 🔥 Streak {streak} (Rekord {record}) · {time} im Stream · Platz {rank} von {total}',
  streakCmdNone: '{user}, ich habe noch keinen Check-in von dir – löse den Check-in-Reward ein ✅',
  topCommand: '!top',
  topSize: 5,
  topTemplate: '🏆 Top {n} Stammgäste: {list}', // {list} = "1. Max (42) · 2. Anna (37) ..."
  // Abspann (/abspann): sammelt pro Stream-Tag Chatter, Follows, Subs, Bits und Raids und lässt sie als Scrolltext laufen
  creditsEnabled: true,
  creditsTitle: 'Danke fürs Zuschauen!',
  creditsOutro: 'Bis zum nächsten Mal! 💜',
  creditsSpeed: 70, // Pixel pro Sekunde
  creditsChatters: true, creditsFollows: true, creditsSubs: true, creditsBits: true, creditsRaids: true,
  creditsIgnore: 'nightbot, streamelements, moobot, streamlabs, fossabot', // Namen, die nicht im Abspann stehen (Bots)
  // Chat-Aktivität zählen (Nachrichten und Chat-Tage je Person) für die Chatter-Rangliste. Zählt ab dem Einschalten, Twitch liefert keinen Verlauf.
  chatStats: true,
  // Öffentliche Rangliste (/rangliste und Twitch-Panel-Extension)
  leaderboardPublic: true,
  leaderboardSize: 10,
  // Persönlicher Einlaufsound (Kanalpunkte): Kauf gilt buyMonths Monate, Verlängern ist anteilig am Kaufpreis
  // (Monate = buyMonths * extendCost / buyCost), die Restlaufzeit ist auf maxMonths begrenzt. Abgelaufene Sounds
  // bleiben keepMonths Monate gespeichert und lassen sich in der Zeit verlängern.
  entrySoundEnabled: false,
  entrySoundBuyTitle: 'Eigener Einlaufsound',
  entrySoundBuyCost: 75_000,
  entrySoundBuyMonths: 6,
  entrySoundExtendTitle: 'Einlaufsound verlängern',
  entrySoundExtendCost: 25_000,
  entrySoundMaxMonths: 12,
  entrySoundKeepMonths: 3,
  entrySoundMaxSeconds: 5, // das Overlay schneidet längere Sounds nach so vielen Sekunden ab
  entrySoundUploadDays: 14, // so lange hat man nach dem Kauf Zeit für den Upload, danach gibt es die Punkte zurück
  // Platzhalter: {user} {months} {until} {url} {days} {rest} {max} {reason}
  entrySoundBuyTemplate: '🔊 {user}, danke! Lade deinen Einlaufsound hier hoch: {url} (innerhalb von {days} Tagen). Nach der Prüfung gilt er {months}. Gefällt er nicht, bekommst du deine Punkte zurück.',
  entrySoundHasTemplate: '{user}, du hast schon einen Einlaufsound (gültig bis {until}) – zum Verlängern nimm bitte „Einlaufsound verlängern“. Deine Punkte bekommst du zurück.',
  entrySoundOpenTemplate: '{user}, dein Kauf wartet noch auf deinen Upload oder auf die Prüfung: {url} Deine Punkte bekommst du zurück.',
  entrySoundNoneTemplate: '{user}, du hast noch keinen Einlaufsound gekauft – nimm zuerst „Eigener Einlaufsound“. Deine Punkte bekommst du zurück.',
  entrySoundExtendTemplate: '🔊 {user} verlängert den Einlaufsound um {months} – gültig bis {until}. Einen neuen Sound kannst du hier hochladen: {url}',
  entrySoundTooMuchTemplate: '{user}, mehr als {max} Restlaufzeit geht nicht (aktuell noch {rest}). Deine Punkte bekommst du zurück.',
  entrySoundBusyTemplate: '{user}, gerade läuft schon eine Einlösung für dich – bitte gleich noch einmal versuchen. Deine Punkte bekommst du zurück.',
  entrySoundApprovedTemplate: '🔊 {user}, dein Einlaufsound ist freigegeben und gilt bis {until}!',
  entrySoundRejectedTemplate: '{user}, dein Einlaufsound wurde leider abgelehnt ({reason}). Lade hier einen anderen hoch: {url}',
  entrySoundRefundTemplate: '{user}, dein Einlaufsound wurde abgelehnt ({reason}). Deine Punkte bekommst du zurück.',
  entrySoundExpiredTemplate: '{user}, du hast deinen Einlaufsound nicht rechtzeitig hochgeladen. Deine Punkte bekommst du zurück.',
  // Community-Rangliste des Monats: Twitch-Chat, Check-ins und Discord (vom VerwirrBot) zählen zusammen.
  // Öffentlich erscheinen nur Konten, die sich selbst verknüpft haben (/verknuepfen im Discord, LINK_SECRET nötig).
  // Punkte = Nachrichten × wMsg + aktive Tage × wDay + Check-in-Tage × wCheckin
  communityEnabled: false,
  communityWeightMsg: 1,
  communityWeightDay: 10,
  communityWeightCheckin: 20,
  communityMsgCap: 30, // gezählte Nachrichten pro Tag und Plattform
  communityMsgGap: 60, // Sekunden Mindestabstand zwischen zwei gezählten Nachrichten
  communityCommand: '!verknuepfen',
  communityTip: true, // Beim Check-in einmal im Monat einen Tipp an Unverknüpfte
  // Platzhalter: {user} {url}
  communityLinkTemplate: '🔗 {user}, verknüpfe dein Twitch- und Discord-Konto, dann erscheinst du in der Monatsrangliste: tippe im Discord /verknuepfen und folge dem Link. Mehr dazu: {url}',
  communityTipTemplate: '💡 {user}, du bist noch nicht in der Monatsrangliste: verknüpfe dein Discord mit /verknuepfen oder tippe !verknuepfen. Dein Name wird nur gezeigt, wenn du das selbst tust.',
  communityRankCommand: '!rangliste', // zeigt die Top-Plätze des Monats im Chat
  communityRankSize: 5,
  // Platzhalter: {month} Monat, {list} "1. Anna (120) · 2. Ben (80)", {me} eigener Platz (nur wenn verknüpft und nicht in der Liste), {url} Rangliste-Seite
  communityRankTemplate: '🏆 Dorf-Rangliste {month}: {list}{me} · Alle Plätze: {url}',
  communityRankEmpty: '🏆 In der Dorf-Rangliste {month} stehen noch keine Punkte. Verknüpfe dich mit !verknuepfen und leg los! {url}',
  communityHint: 'Nur verknüpfte Konten erscheinen hier. So geht’s: im Discord /verknuepfen tippen oder im Chat !verknuepfen.',
  // Top des Monats: Die Besten des Vormonats suchen sich einen Sound aus dem Katalog (Admin, 15 Plätze) aus.
  // Gleichstand auf dem letzten Platz: alle mit derselben Punktzahl dürfen. Wer nicht wählt, behält den normalen Ton.
  awardEnabled: false,
  awardSize: 3,
  awardDays: 7, // so lange kann man wählen
  awardMonths: 1, // so lange gilt der gewählte Sound, ab der ersten Auswahl
  // Platzhalter: {user} {n} {month} {list} {url} {until} {sound}
  awardAnnounceTemplate: '🏆 Die Top {n} im {month}: {list}! Ihr dürft euch einen Einlaufsound aussuchen: {url} (bis {until})',
  awardTipTemplate: '🏆 {user}, du warst im {month} unter den Top {n}! Such dir deinen Einlaufsound aus: {url} (noch bis {until})',
  awardChosenTemplate: '🔊 {user} hat sich den Einlaufsound „{sound}“ ausgesucht, gültig bis {until}!',
  // Eigener Ton (wird über /api/admin/sound gesetzt, nicht über die Einstellungen)
  soundName: null,
  soundVersion: null,
  sounds: {}, // weitere Töne je Platz: { follow: { name, version }, ... }
};

// Braucht der Bot den Chat-Webhook? Für Befehle, Abspann und Chat-Zähler.
export const needsChat = (s) => Boolean(s.chatCommands || s.creditsEnabled || s.chatStats || s.communityEnabled);

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
  str('soundboardTemplate', 200);
  for (const k of ['follow', 'sub', 'resub', 'gift', 'cheer', 'raid', 'rescue']) {
    str(k + 'Title', 60);
    if (typeof input[k + 'Message'] === 'string') out[k + 'Message'] = input[k + 'Message'].trim().slice(0, 120); // darf leer sein
  }
  for (const k of ['streakCommand', 'topCommand']) {
    if (typeof input[k] === 'string') { const v = input[k].trim().toLowerCase().replace(/\s+/g, ''); if (/^!\w{1,25}$/.test(v)) out[k] = v; }
  }
  for (const k of ['streakCmdTemplate', 'streakCmdNone', 'topTemplate']) str(k, 400);
  str('creditsTitle', 80); str('creditsOutro', 80); str('creditsIgnore', 400);
  for (const k of ['entrySoundBuyTemplate', 'entrySoundHasTemplate', 'entrySoundOpenTemplate', 'entrySoundNoneTemplate', 'entrySoundExtendTemplate', 'entrySoundTooMuchTemplate', 'entrySoundBusyTemplate', 'entrySoundApprovedTemplate', 'entrySoundRejectedTemplate', 'entrySoundRefundTemplate', 'entrySoundExpiredTemplate']) str(k, 400);
  str('entrySoundBuyTitle', 30); str('entrySoundExtendTitle', 30); // Platz für die Monate hinter dem Namen (Twitch erlaubt 45 Zeichen)
  num('entrySoundBuyCost', 1, 1_000_000); num('entrySoundExtendCost', 1, 1_000_000);
  num('entrySoundBuyMonths', 1, 36); num('entrySoundMaxMonths', 1, 60); num('entrySoundKeepMonths', 0, 24);
  num('entrySoundMaxSeconds', 1, 30); num('entrySoundUploadDays', 1, 90);
  for (const k of ['communityLinkTemplate', 'communityTipTemplate', 'communityHint']) str(k, 400);
  for (const k of ['communityRankTemplate', 'communityRankEmpty']) str(k, 400);
  num('communityRankSize', 1, 10);
  if (typeof input.communityRankCommand === 'string') { const v = input.communityRankCommand.trim().toLowerCase().replace(/\s+/g, ''); if (/^!\w{1,25}$/.test(v)) out.communityRankCommand = v; }
  for (const k of ['awardAnnounceTemplate', 'awardTipTemplate', 'awardChosenTemplate']) str(k, 400);
  num('awardSize', 1, 10); num('awardDays', 1, 30); num('awardMonths', 1, 12);
  num('communityWeightMsg', 0, 1000); num('communityWeightDay', 0, 1000); num('communityWeightCheckin', 0, 1000);
  num('communityMsgCap', 1, 500); num('communityMsgGap', 0, 3600);
  if (typeof input.communityCommand === 'string') { const v = input.communityCommand.trim().toLowerCase().replace(/\s+/g, ''); if (/^!\w{1,25}$/.test(v)) out.communityCommand = v; }
  num('commandCooldown', 0, 600); num('topSize', 1, 10); num('creditsSpeed', 20, 300); num('leaderboardSize', 3, 25);
  num('alertDuration', 2000, 30_000);
  num('raidDuration', 2000, 30_000);
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
  for (const k of ['awardEnabled', 'communityEnabled', 'communityTip', 'entrySoundEnabled', 'soundboardChat', 'milestoneEnabled', 'streakRescueEnabled', 'raidEnabled', 'raidShoutout', 'raidClip', 'alertsEnabled', 'alertFollow', 'alertSub', 'alertGift', 'alertCheer', 'alertChat', 'chatCommands', 'creditsEnabled', 'creditsChatters', 'creditsFollows', 'creditsSubs', 'creditsBits', 'creditsRaids', 'leaderboardPublic', 'chatStats']) if (typeof input[k] === 'boolean') out[k] = input[k];
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
