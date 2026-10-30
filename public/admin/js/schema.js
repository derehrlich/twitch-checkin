// Alle Einstellungsfelder an einer Stelle. Daraus entstehen die Formulare, die Liste der Felder beim Speichern
// und die Vorschauen. Ein neues Feld braucht hier einen Eintrag, serverseitig steht es in netlify/lib/settings.mjs.
const t = (id, label, attrs = {}) => ({ id, type: 'text', label, attrs });
const n = (id, label, attrs = {}) => ({ id, type: 'number', label, attrs });
const a = (id, label, preview) => ({ id, type: 'area', label, preview, attrs: { maxlength: 400 } });
const c = (id, label) => ({ id, type: 'check', label });
const code = (...names) => names.map((x) => `<code>{${x}}</code>`).join(' ');

const SIGN = (kind, label) => [t(`${kind}Title`, `${label}: Titel`, { maxlength: 60 }), t(`${kind}Message`, `${label}: Nachricht unter dem Namen`, { maxlength: 120 })];
const SIGN_HELP = `Platzhalter: ${code('user', 'tier', 'months', 'total', 'bits', 'viewers', 'raids', 'game', 'streak', 'days')}. Die Nachricht darf leer sein. Das Bild oder GIF über dem Schild lädst du unter „Medien“ hoch.`;

export const SCHEMA = {
  checkin: [
    { title: 'Check-in', hint: `Platzhalter: ${code('user')} Name, ${code('count')} Besuche, ${code('streak')} aktuelle Streak, ${code('record')} Rekord. Nach Änderungen an Name oder Preis die Rewards abgleichen.`, items: [
      t('rewardTitle', 'Reward-Name', { maxlength: 45 }), n('rewardCost', 'Preis (Kanalpunkte)', { min: 1 }),
      a('chatTemplate', 'Chatnachricht beim Check-in', { user: 'Max', count: 7, streak: 5, record: 9 }),
      a('duplicateTemplate', 'Nachricht, wenn schon eingecheckt (Punkte werden erstattet)'),
    ] },
    { title: 'Check-out', hint: `Zusätzlicher Platzhalter: ${code('duration')}, z. B. „2 Std 14 Min“. Wer nicht auscheckt, bekommt den Besuch gezählt, aber keine Dauer.`, items: [
      c('checkoutEnabled', 'Check-out aktivieren (zweiter Reward, speichert die Zeit im Stream)'),
      t('checkoutRewardTitle', 'Reward-Name', { maxlength: 45 }), n('checkoutRewardCost', 'Preis (Kanalpunkte)', { min: 1 }),
      a('checkoutTemplate', 'Chatnachricht beim Check-out', { user: 'Max', count: 7, duration: '2 Std 14 Min' }),
      a('checkoutDuplicateTemplate', 'Nachricht, wenn schon ausgecheckt (Punkte werden erstattet)'),
      a('noCheckinTemplate', 'Nachricht, wenn gar nicht eingecheckt (Punkte werden erstattet)'),
    ] },
    { title: 'Meilensteine', hint: 'Meilensteine zählen die <b>Gesamtbesuche</b> und gehen nie verloren.', items: [
      c('milestoneEnabled', 'Meilensteine feiern (Sonder-Feuerwerk, eigene Karte und Chattext)'),
      t('milestoneLevels', 'Bei diesen Gesamtbesuchen (mit Komma getrennt)', { placeholder: '10,25,50,100,250,500,1000' }),
      a('milestoneTemplate', 'Chatnachricht beim Meilenstein', { user: 'Max', count: 100, streak: 12, record: 15 }),
    ] },
    { title: 'Streak und Streak-Retter', hint: `Die <b>Streak</b> zählt Stream-Tage in Folge (ein Stream-Tag ist ein Tag mit mindestens einem Check-in), der Rekord bleibt erhalten. Der Retter schließt nur die jüngste Lücke der letzten 7 Stream-Tage. Platzhalter: ${code('user')} ${code('streak')} ${code('days')} überbrückte Streams.`, items: [
      n('streakGrace', 'Schonfrist: so viele Streams darf man verpassen', { min: 0, max: 5 }),
      c('streakRescueEnabled', 'Streak-Retter aktivieren (dritter Kanalpunkte-Reward)'),
      t('streakRewardTitle', 'Reward-Name', { maxlength: 45 }), n('streakRewardCost', 'Preis (Kanalpunkte)', { min: 1 }),
      n('rescueMaxDays', 'Rettet höchstens so viele verpasste Streams', { min: 1, max: 14 }),
      a('rescueTemplate', 'Chatnachricht bei erfolgreicher Rettung'),
      a('rescueNotNeededTemplate', 'Nachricht, wenn die Streak nicht in Gefahr ist (Punkte werden erstattet)'),
      a('rescueTooLongTemplate', 'Nachricht, wenn die Lücke zu lang oder zu alt ist (Punkte werden erstattet)'),
      ...SIGN('rescue', 'Streak-Rettung (Schild im Overlay)'),
    ] },
  ],

  alerts: [
    { title: 'Alerts', hint: 'Prime-Subs meldet Twitch als Stufe 1. Nach dem Ein- oder Ausschalten die Webhooks abgleichen (Start → „Rewards &amp; Webhooks abgleichen“).', items: [
      c('alertsEnabled', 'Alerts aktiv – erst einschalten, wenn das alte Alert-Tool aus ist, sonst kommt alles doppelt'),
      c('alertFollow', 'Follow'), c('alertSub', 'Sub, Resub und Prime'), c('alertGift', 'Gift-Subs (ein Alert pro Paket)'), c('alertCheer', 'Bits'),
      n('alertCheerMin', 'Bits-Alert ab (Bits)', { min: 1 }),
      c('alertChat', 'Zusätzlich eine Dankes-Nachricht im Chat'),
    ] },
    { title: 'Chat-Dank', hint: `Platzhalter: ${code('user')} ${code('tier')} ${code('months')} ${code('total')} ${code('bits')}`, items: [
      a('followTemplate', 'Follow'), a('subTemplate', 'Sub und Resub'), a('giftTemplate', 'Gift-Subs'), a('cheerTemplate', 'Bits'),
    ] },
    { title: 'Schilder im Overlay', hint: `Ist ein hochgeladener Ton länger als die Anzeigedauer, bleibt das Schild bis zum Ende des Tons stehen (höchstens 30 Sekunden). Warten mehrere Ereignisse, gilt die Reihenfolge: Raid, Sub, Cheer, Follow, danach Meilenstein, Check-in und Check-out. ${SIGN_HELP}`, items: [
      ...SIGN('follow', 'Follow'), ...SIGN('sub', 'Sub / Prime'), ...SIGN('resub', 'Resub'), ...SIGN('gift', 'Gift-Subs'), ...SIGN('cheer', 'Bits'),
      n('alertDuration', 'Anzeigedauer der Alert-Schilder (ms)', { min: 2000, max: 30000, step: 500 }),
    ] },
  ],

  raids: [
    { title: 'Raid-Reaktion', hint: 'Twitch erlaubt höchstens einen Shoutout alle 2 Minuten; bei Raids kurz hintereinander bleiben dann nur Chattext und Overlay-Karte. Nach dem Aktivieren oder Ausschalten die Webhooks abgleichen.', items: [
      c('raidEnabled', 'Auf eingehende Raids reagieren'), c('raidShoutout', 'Offiziellen Twitch-Shoutout auslösen'), c('raidClip', 'Zufälligen Clip des Raiders im Overlay abspielen'),
      n('raidMinViewers', 'Ab wie vielen Raidern reagieren', { min: 0 }), n('raidClipMaxSeconds', 'Clip höchstens (Sekunden)', { min: 5, max: 60 }),
    ] },
    { title: 'Chat und Schild', hint: `Platzhalter: ${code('raider')} Name, ${code('viewers')} Zuschauer, ${code('game')} zuletzt gespieltes Spiel, ${code('url')} Kanallink, ${code('raids')} Anzahl der Raids dieses Kanals bei dir, ${code('visit')} fertiger Satzteil („zum ersten Mal bei uns“ / „schon zum 3. Mal bei uns“). Für das Schild gilt ${code('user')} für den Raider.`, items: [
      a('raidTemplate', 'Chatnachricht beim Raid', { raider: 'Akinasuka', viewers: 42, game: 'Just Chatting', url: 'twitch.tv/akinasuka', raids: 3, visit: 'schon zum 3. Mal bei uns' }),
      ...SIGN('raid', 'Raid'), n('raidDuration', 'Anzeigedauer des Raid-Schilds (ms)', { min: 2000, max: 30000, step: 500 }),
    ] },
  ],

  soundboard: [
    { title: 'Chat beim Soundboard', hint: `Platzhalter: ${code('user')} Name, ${code('title')} Name des Eintrags.`, items: [
      c('soundboardChat', 'Bei einer Einlösung eine Nachricht im Chat schreiben'),
      t('soundboardTemplate', 'Chatnachricht', { maxlength: 200 }),
    ] },
  ],

  einlaufsound: [
    { title: 'Einlaufsound: Preise und Laufzeit', hint: 'Der <b>Kauf</b> gilt die eingestellten Monate. <b>Verlängern</b> bringt anteilig Monate (Verlängern-Preis ÷ Kaufpreis × Kauf-Monate). Die genaue Monatszahl setzt die Stadtwache selbst in Reward-Name und Beschreibung. Nach Änderungen die Rewards abgleichen.', items: [
      c('entrySoundEnabled', 'Einlaufsound aktivieren (zwei Rewards: Kauf und Verlängern)'),
      t('entrySoundBuyTitle', 'Kauf: Reward-Name (die Monate kommen automatisch dahinter)', { maxlength: 30 }), n('entrySoundBuyCost', 'Kauf: Preis (Kanalpunkte)', { min: 1 }),
      n('entrySoundBuyMonths', 'Kauf: gilt so viele Monate', { min: 1, max: 36 }),
      t('entrySoundExtendTitle', 'Verlängern: Reward-Name (die Monate kommen automatisch dahinter)', { maxlength: 30 }), n('entrySoundExtendCost', 'Verlängern: Preis (Kanalpunkte)', { min: 1 }),
      n('entrySoundMaxMonths', 'Höchste Restlaufzeit in Monaten (darüber hinaus wird nicht verlängert)', { min: 1, max: 60 }),
      n('entrySoundKeepMonths', 'Abgelaufene Sounds so viele Monate aufbewahren (in der Zeit verlängerbar)', { min: 0, max: 24 }),
      n('entrySoundMaxSeconds', 'Längster Sound in Sekunden (das Overlay schneidet längere ab)', { min: 1, max: 30 }),
      n('entrySoundUploadDays', 'Frist für den Upload nach dem Kauf in Tagen (danach Punkte zurück)', { min: 1, max: 90 }),
    ] },
    { title: 'Einlaufsound: Chat-Texte', hint: `Platzhalter: ${code('user')} Name, ${code('months')} Monate, ${code('until')} gültig bis, ${code('url')} Upload-Seite, ${code('days')} Frist, ${code('rest')} Restlaufzeit, ${code('max')} Obergrenze, ${code('reason')} Ablehnungsgrund. Nachrichten mit „Punkte zurück“ erstatten die Einlösung.`, items: [
      a('entrySoundBuyTemplate', 'Nach dem Kauf', { user: 'Max', months: '6 Monate', url: 'https://…/einlaufsound', days: 14 }),
      a('entrySoundHasTemplate', 'Kauf, obwohl schon ein Sound gilt', { user: 'Max', until: '14.04.2027' }),
      a('entrySoundOpenTemplate', 'Kauf oder Verlängern, obwohl ein Kauf noch offen ist', { user: 'Max', url: 'https://…/einlaufsound' }),
      a('entrySoundNoneTemplate', 'Verlängern ohne gekauften Sound', { user: 'Max' }),
      a('entrySoundExtendTemplate', 'Nach dem Verlängern', { user: 'Max', months: '2 Monate', until: '14.04.2027', url: 'https://…/einlaufsound' }),
      a('entrySoundTooMuchTemplate', 'Verlängern über der Obergrenze', { user: 'Max', max: '12 Monate', rest: '11,5 Monate' }),
      a('entrySoundBusyTemplate', 'Gleichzeitige Einlösung'),
      a('entrySoundApprovedTemplate', 'Sound freigegeben', { user: 'Max', until: '14.04.2027' }),
      a('entrySoundRejectedTemplate', 'Sound abgelehnt, neuer Upload möglich', { user: 'Max', reason: 'zu laut', url: 'https://…/einlaufsound' }),
      a('entrySoundRefundTemplate', 'Sound abgelehnt, Punkte zurück', { user: 'Max', reason: 'enthält Musik' }),
      a('entrySoundExpiredTemplate', 'Upload-Frist abgelaufen, Punkte zurück', { user: 'Max' }),
    ] },
  ],

  abspann: [
    { title: 'Chat-Befehle', hint: `Die Befehle laufen über den Chat-Webhook. Nach dem Ein- oder Ausschalten die Webhooks abgleichen. Platzhalter für <b>!streak</b>: ${code('user')} ${code('count')} Besuche, ${code('streak')} ${code('record')}, ${code('time')} Gesamtzeit, ${code('rank')} Platz, ${code('total')} Besucher gesamt. Für <b>!top</b>: ${code('n')} und ${code('list')}. Die Abklingzeit gilt je Befehl für den ganzen Chat.`, items: [
      c('chatCommands', 'Chat-Befehle aktivieren'),
      t('streakCommand', 'Befehl für die eigenen Zahlen', { maxlength: 26, placeholder: '!streak' }), t('topCommand', 'Befehl für die Bestenliste', { maxlength: 26, placeholder: '!top' }),
      n('commandCooldown', 'Abklingzeit (Sekunden)', { min: 0, max: 600 }), n('topSize', 'Plätze in der Bestenliste', { min: 1, max: 10 }),
      a('streakCmdTemplate', 'Antwort auf !streak', { user: 'Max', count: 24, streak: 5, record: 9, time: '18 Std 40 Min', rank: 3, total: 120 }),
      a('streakCmdNone', 'Antwort, wenn noch kein Check-in vorhanden ist', { user: 'Max' }),
      a('topTemplate', 'Antwort auf !top', { n: 5, list: '1. Anna (42) · 2. Max (37) · 3. Kai (30)' }),
    ] },
    { title: 'Abspann', hint: 'Der Abspann sammelt pro Stream-Tag automatisch, wer geschrieben, gefolgt, abonniert, Bits geschickt oder geraidet hat – auch wenn die Alerts ausgeschaltet sind. Nach dem Einschalten die Webhooks abgleichen, sonst werden keine Ereignisse empfangen. Bots stehen nicht im Abspann.', items: [
      c('creditsEnabled', 'Abspann-Daten sammeln'),
      t('creditsTitle', 'Überschrift', { maxlength: 80 }), t('creditsOutro', 'Schlusszeile', { maxlength: 80 }),
      n('creditsSpeed', 'Lauftempo (Pixel pro Sekunde)', { min: 20, max: 300 }),
      c('creditsChatters', 'Chatter nennen'), c('creditsFollows', 'Neue Follower nennen'), c('creditsSubs', 'Abonnenten und Sub-Geschenke nennen'), c('creditsBits', 'Bits nennen'), c('creditsRaids', 'Raids nennen'),
      t('creditsIgnore', 'Bots, die weder im Abspann noch in der Chatter-Rangliste auftauchen (mit Komma getrennt)', { maxlength: 400 }),
    ] },
    { title: 'Rangliste', hint: 'Die Rangliste (Seite und Twitch-Panel) zeigt nur Namen und Zahlen: Besuche, Chat-Nachrichten, Streaks und Zeit im Stream. Sie ist ohne Anmeldung erreichbar. Die Chat-Zählung beginnt beim Einschalten, Twitch liefert keinen Verlauf. Dein eigener Name und die Bots oben werden nicht gezählt.', items: [
      c('leaderboardPublic', 'Rangliste öffentlich anzeigen'), c('chatStats', 'Chat-Nachrichten zählen (für die Chatter-Rangliste, braucht den Chat-Webhook)'),
      n('leaderboardSize', 'Plätze je Liste', { min: 3, max: 25 }),
    ] },
  ],

  allgemein: [
    { title: 'Allgemein', hint: 'Der Stream-Tag wechselt zur eingestellten Uhrzeit, damit Streams nach Mitternacht nicht doppelt zählen.', items: [
      n('volume', 'Lautstärke im Overlay (0 bis 1)', { min: 0, max: 1, step: 0.1 }),
      n('duration', 'Anzeigedauer Check-in, Check-out und Meilenstein (ms)', { min: 2000, max: 30000, step: 500 }),
      t('timezone', 'Zeitzone'), n('dayRolloverHour', 'Neuer Stream-Tag ab (Uhr)', { min: 0, max: 23 }),
      c('chatEnabled', 'Chatnachrichten senden (ausgeschaltet schreibt der Bot gar nichts)'),
    ] },
  ],
};

const all = Object.values(SCHEMA).flat().flatMap((g) => g.items);
export const CHECKS = all.filter((i) => i.type === 'check').map((i) => i.id);
export const FIELDS = all.filter((i) => i.type !== 'check').map((i) => i.id);

// Änderungen an diesen Feldern erfordern „Rewards & Webhooks abgleichen“
export const SYNC_KEYS = ['rewardTitle', 'rewardCost', 'checkoutEnabled', 'checkoutRewardTitle', 'checkoutRewardCost', 'streakRescueEnabled', 'streakRewardTitle', 'streakRewardCost', 'entrySoundEnabled', 'entrySoundBuyTitle', 'entrySoundBuyCost', 'entrySoundBuyMonths', 'entrySoundExtendTitle', 'entrySoundExtendCost', 'entrySoundMaxSeconds', 'entrySoundMaxMonths', 'raidEnabled', 'alertsEnabled', 'creditsEnabled', 'chatCommands', 'chatStats'];
