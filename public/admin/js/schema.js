// Alle Einstellungen an EINER Stelle. Daraus entstehen die Formulare, die Standardwerte und die Prüfung auf dem Server
// (netlify/lib/kern/settings.mjs liest diese Datei). Eine neue Einstellung braucht nur eine Zeile:
//   t('name', 'Standardwert', 'Beschriftung', { maxlength: 60 })     Text (maxlength = längste Eingabe)
//   a('name', 'Standardwert', 'Beschriftung', { Beispielwerte })    Textvorlage mit Vorschau (höchstens 400 Zeichen)
//   n('name', 5, 'Beschriftung', { min: 0, max: 10 })               Zahl (immer min und max angeben)
//   c('name', true, 'Beschriftung')                                  Haken
// Besondere Regeln in den Eigenschaften: kind: 'command' (Chat-Befehl wie !so), 'timezone', 'levels' (Meilensteine);
// empty: true erlaubt ein leeres Feld. Ändert eine Einstellung Rewards oder Webhooks, kommt sie zusätzlich in SYNC_KEYS.
const t = (id, def, label, attrs = {}) => ({ id, type: 'text', def, label, attrs });
const n = (id, def, label, attrs = {}) => ({ id, type: 'number', def, label, attrs });
const a = (id, def, label, preview) => ({ id, type: 'area', def, label, preview, attrs: { maxlength: 400 } });
const c = (id, def, label) => ({ id, type: 'check', def, label });
const code = (...names) => names.map((x) => `<code>{${x}}</code>`).join(' ');

const SIGN = (kind, label, title, message) => [t(`${kind}Title`, title, `${label}: Titel`, { maxlength: 60 }), t(`${kind}Message`, message, `${label}: Nachricht unter dem Namen`, { maxlength: 120, empty: true })];
const SIGN_HELP = `Platzhalter: ${code('user', 'tier', 'months', 'total', 'bits', 'viewers', 'raids', 'game', 'streak', 'days')}. Die Nachricht darf leer sein. Das Bild oder GIF über dem Schild lädst du unter „Medien“ hoch.`;

export const SCHEMA = {
  checkin: [
    { title: 'Check-in', hint: `Platzhalter: ${code('user')} Name, ${code('count')} Besuche, ${code('streak')} aktuelle Streak, ${code('record')} Rekord. Nach Änderungen an Name oder Preis die Rewards abgleichen.`, items: [
      t('rewardTitle', 'Check-in', 'Reward-Name', { maxlength: 45 }), n('rewardCost', 1, 'Preis (Kanalpunkte)', { min: 1, max: 1000000 }),
      a('chatTemplate', '✅ {user} ist eingecheckt – du warst jetzt schon {count}x dabei! 🎉', 'Chatnachricht beim Check-in', { user: 'Max', count: 7, streak: 5, record: 9 }),
      a('duplicateTemplate', '{user}, du bist heute schon eingecheckt (Besuch #{count}) ✅ Deine Punkte bekommst du zurück.', 'Nachricht, wenn schon eingecheckt (Punkte werden erstattet)'),
    ] },
    { title: 'Check-out', hint: `Zusätzlicher Platzhalter: ${code('duration')}, z. B. „2 Std 14 Min“. Wer nicht auscheckt, bekommt den Besuch gezählt, aber keine Dauer.`, items: [
      c('checkoutEnabled', true, 'Check-out aktivieren (zweiter Reward, speichert die Zeit im Stream)'),
      t('checkoutRewardTitle', 'Check-out', 'Reward-Name', { maxlength: 45 }), n('checkoutRewardCost', 1, 'Preis (Kanalpunkte)', { min: 1, max: 1000000 }),
      a('checkoutTemplate', '👋 {user} geht – {duration} dabei gewesen. Bis zum nächsten Mal!', 'Chatnachricht beim Check-out', { user: 'Max', count: 7, duration: '2 Std 14 Min' }),
      a('checkoutDuplicateTemplate', '{user}, du bist heute schon ausgecheckt ✅ Deine Punkte bekommst du zurück.', 'Nachricht, wenn schon ausgecheckt (Punkte werden erstattet)'),
      a('noCheckinTemplate', '{user}, du bist gerade nicht eingecheckt – zum Auschecken musst du zuerst einchecken. Deine Punkte bekommst du zurück.', 'Nachricht, wenn gar nicht eingecheckt (Punkte werden erstattet)'),
    ] },
    { title: 'Meilensteine', hint: 'Meilensteine zählen die <b>Gesamtbesuche</b> und gehen nie verloren.', items: [
      c('milestoneEnabled', true, 'Meilensteine feiern (Sonder-Feuerwerk, eigene Karte und Chattext)'),
      t('milestoneLevels', '10,25,50,100,250,500,1000', 'Bei diesen Gesamtbesuchen (mit Komma getrennt)', { kind: 'levels', placeholder: '10,25,50,100,250,500,1000' }),
      a('milestoneTemplate', '🏆 {user} ist zum {count}. Mal dabei – Meilenstein! Danke für deine Treue ❤️', 'Chatnachricht beim Meilenstein', { user: 'Max', count: 100, streak: 12, record: 15 }),
    ] },
    { title: 'Streak und Streak-Retter', hint: `Die <b>Streak</b> zählt Stream-Tage in Folge (ein Stream-Tag ist ein Tag mit mindestens einem Check-in), der Rekord bleibt erhalten. Der Retter schließt nur die jüngste Lücke der letzten 7 Stream-Tage. Platzhalter: ${code('user')} ${code('streak')} ${code('days')} überbrückte Streams.`, items: [
      n('streakGrace', 1, 'Schonfrist: so viele Streams darf man verpassen', { min: 0, max: 5 }),
      c('streakRescueEnabled', true, 'Streak-Retter aktivieren (dritter Kanalpunkte-Reward)'),
      t('streakRewardTitle', 'Streak-Retter', 'Reward-Name', { maxlength: 45 }), n('streakRewardCost', 500, 'Preis (Kanalpunkte)', { min: 1, max: 1000000 }),
      n('rescueMaxDays', 3, 'Rettet höchstens so viele verpasste Streams', { min: 1, max: 14 }),
      a('rescueTemplate', '🛟 {user} rettet die Streak! {days} verpasste(r) Stream(s) überbrückt – Streak: {streak} 🔥', 'Chatnachricht bei erfolgreicher Rettung'),
      a('rescueNotNeededTemplate', '{user}, deine Streak ist nicht in Gefahr ✅ Deine Punkte bekommst du zurück.', 'Nachricht, wenn die Streak nicht in Gefahr ist (Punkte werden erstattet)'),
      a('rescueTooLongTemplate', '{user}, die Lücke ist zu lang oder zu lange her, da kann ich nichts mehr retten. Deine Punkte bekommst du zurück.', 'Nachricht, wenn die Lücke zu lang oder zu alt ist (Punkte werden erstattet)'),
      ...SIGN('rescue', 'Streak-Rettung (Schild im Overlay)', 'Streak gerettet!', '{days} verpasste(r) Stream(s) überbrückt – Streak: {streak}'),
    ] },
  ],

  alerts: [
    { title: 'Alerts', hint: 'Prime-Subs meldet Twitch als Stufe 1. Nach dem Ein- oder Ausschalten die Webhooks abgleichen (Start → „Rewards &amp; Webhooks abgleichen“).', items: [
      c('alertsEnabled', false, 'Alerts aktiv – erst einschalten, wenn das alte Alert-Tool aus ist, sonst kommt alles doppelt'),
      c('alertFollow', true, 'Follow'), c('alertSub', true, 'Sub, Resub und Prime'), c('alertGift', true, 'Gift-Subs (ein Alert pro Paket)'), c('alertCheer', true, 'Bits'),
      n('alertCheerMin', 1, 'Bits-Alert ab (Bits)', { min: 1, max: 1000000 }),
      c('alertChat', false, 'Zusätzlich eine Dankes-Nachricht im Chat'),
    ] },
    { title: 'Chat-Dank', hint: `Platzhalter: ${code('user')} ${code('tier')} ${code('months')} ${code('total')} ${code('bits')}`, items: [
      a('followTemplate', '💜 Danke für den Follow, {user}! Schön, dass du da bist.', 'Follow'), a('subTemplate', '⭐ {user} hat abonniert ({tier}, {months} Monate) – vielen Dank!', 'Sub und Resub'), a('giftTemplate', '🎁 {user} verschenkt {total} Sub(s) – du bist großartig!', 'Gift-Subs'), a('cheerTemplate', '💎 {user} schickt {bits} Bits – danke!', 'Bits'),
    ] },
    { title: 'Schilder im Overlay', hint: `Ist ein hochgeladener Ton länger als die Anzeigedauer, bleibt das Schild bis zum Ende des Tons stehen (höchstens 30 Sekunden). Warten mehrere Ereignisse, gilt die Reihenfolge: Raid, Sub, Cheer, Follow, danach Meilenstein, Check-in und Check-out. ${SIGN_HELP}`, items: [
      ...SIGN('follow', 'Follow', 'Neuer Follower!', ''), ...SIGN('sub', 'Sub / Prime', 'Neues Abo!', 'Tier {tier} ({months} Monate)'), ...SIGN('resub', 'Resub', 'Abo-Treue!', 'Tier {tier} ({months} Monate)'), ...SIGN('gift', 'Gift-Subs', 'Sub-Geschenk!', 'verschenkt {total} Sub(s)!'), ...SIGN('cheer', 'Bits', 'Neuer Cheer!', '{bits} Bits'),
      n('alertDuration', 8000, 'Anzeigedauer der Alert-Schilder (ms)', { min: 2000, max: 30000, step: 500 }),
    ] },
  ],

  raids: [
    { title: 'Raid-Reaktion', hint: 'Twitch erlaubt höchstens einen Shoutout alle 2 Minuten; bei Raids kurz hintereinander bleiben dann nur Chattext und Overlay-Karte. Nach dem Aktivieren oder Ausschalten die Webhooks abgleichen.', items: [
      c('raidEnabled', true, 'Auf eingehende Raids reagieren'), c('raidShoutout', true, 'Offiziellen Twitch-Shoutout auslösen'), c('raidClip', true, 'Zufälligen Clip des Raiders im Overlay abspielen'),
      n('raidMinViewers', 1, 'Ab wie vielen Raidern reagieren', { min: 0, max: 100000 }), n('raidClipMaxSeconds', 30, 'Clip höchstens (Sekunden)', { min: 5, max: 60 }),
    ] },
    { title: 'Chat und Schild', hint: `Platzhalter: ${code('raider')} Name, ${code('viewers')} Zuschauer, ${code('game')} zuletzt gespieltes Spiel, ${code('url')} Kanallink, ${code('raids')} Anzahl der Raids dieses Kanals bei dir, ${code('visit')} fertiger Satzteil („zum ersten Mal bei uns“ / „schon zum 3. Mal bei uns“). Für das Schild gilt ${code('user')} für den Raider.`, items: [
      a('raidTemplate', '💜 RAID! {raider} ist mit {viewers} Leuten da – {visit}, danke dir! Zuletzt gespielt: {game}. Schaut bei {url} vorbei!', 'Chatnachricht beim Raid', { raider: 'Akinasuka', viewers: 42, game: 'Just Chatting', url: 'twitch.tv/akinasuka', raids: 3, visit: 'schon zum 3. Mal bei uns' }),
      ...SIGN('raid', 'Raid', 'Raid-Alarm!', 'Bringt {viewers} Leute mit!'), n('raidDuration', 11_000, 'Anzeigedauer des Raid-Schilds (ms)', { min: 2000, max: 30000, step: 500 }),
    ] },
  ],

  soundboard: [
    { title: 'Chat beim Soundboard', hint: `Platzhalter: ${code('user')} Name, ${code('title')} Name des Eintrags.`, items: [
      c('soundboardChat', false, 'Bei einer Einlösung eine Nachricht im Chat schreiben'),
      t('soundboardTemplate', '🔊 {user} spielt „{title}“', 'Chatnachricht', { maxlength: 200 }),
    ] },
  ],

  einlaufsound: [
    { title: 'Einlaufsound: Preise und Laufzeit', hint: 'Der <b>Kauf</b> gilt die eingestellten Monate. <b>Verlängern</b> bringt anteilig Monate (Verlängern-Preis ÷ Kaufpreis × Kauf-Monate). Die genaue Monatszahl setzt die Stadtwache selbst in Reward-Name und Beschreibung. Nach Änderungen die Rewards abgleichen.', items: [
      c('entrySoundEnabled', false, 'Einlaufsound aktivieren (zwei Rewards: Kauf und Verlängern)'),
      t('entrySoundBuyTitle', 'Eigener Einlaufsound', 'Kauf: Reward-Name (die Monate kommen automatisch dahinter)', { maxlength: 30 }), n('entrySoundBuyCost', 75_000, 'Kauf: Preis (Kanalpunkte)', { min: 1, max: 1000000 }),
      n('entrySoundBuyMonths', 6, 'Kauf: gilt so viele Monate', { min: 1, max: 36 }),
      t('entrySoundExtendTitle', 'Einlaufsound verlängern', 'Verlängern: Reward-Name (die Monate kommen automatisch dahinter)', { maxlength: 30 }), n('entrySoundExtendCost', 25_000, 'Verlängern: Preis (Kanalpunkte)', { min: 1, max: 1000000 }),
      n('entrySoundMaxMonths', 12, 'Höchste Restlaufzeit in Monaten (darüber hinaus wird nicht verlängert)', { min: 1, max: 60 }),
      n('entrySoundKeepMonths', 3, 'Abgelaufene Sounds so viele Monate aufbewahren (in der Zeit verlängerbar)', { min: 0, max: 24 }),
      n('entrySoundMaxSeconds', 5, 'Längster Sound in Sekunden (das Overlay schneidet längere ab)', { min: 1, max: 30 }),
      n('entrySoundUploadDays', 14, 'Frist für den Upload nach dem Kauf in Tagen (danach Punkte zurück)', { min: 1, max: 90 }),
    ] },
    { title: 'Top des Monats: Sound aus dem Katalog', hint: `Die Besten des Vormonats (Monatsrangliste, nur Verknüpfte) suchen sich einen Sound aus dem Katalog aus (unten pflegen). Gleichstand auf dem letzten Platz: alle mit derselben Punktzahl. Wer nicht wählt, behält den normalen Ton, ein gekaufter Sound hat Vorrang. Der Monat wird ab dem 2. des Folgemonats von selbst abgeschlossen. Platzhalter: ${code('user')} ${code('n')} ${code('month')} ${code('list')} ${code('url')} ${code('until')} ${code('sound')}.`, items: [
      c('awardEnabled', false, 'Auswahl der Top des Monats aktivieren (braucht die aktive Community-Rangliste)'),
      n('awardSize', 3, 'Wie viele Plätze (bei Gleichstand mehr)', { min: 1, max: 10 }), n('awardDays', 7, 'Frist zum Wählen in Tagen', { min: 1, max: 30 }),
      n('awardMonths', 1, 'Der Sound gilt so viele Monate ab der ersten Auswahl', { min: 1, max: 12 }),
      a('awardAnnounceTemplate', '🏆 Die Top {n} im {month}: {list}! Ihr dürft euch einen Einlaufsound aussuchen: {url} (bis {until})', 'Chat-Nachricht beim Monatsabschluss', { n: 3, month: 'Oktober 2026', list: '1. Anna · 2. Ben · 3. Cleo', url: 'https://…/einlaufsound', until: '07.11.2026' }),
      a('awardTipTemplate', '🏆 {user}, du warst im {month} unter den Top {n}! Such dir deinen Einlaufsound aus: {url} (noch bis {until})', 'Erinnerung beim Check-in, solange nicht gewählt', { user: 'Max', n: 3, month: 'Oktober 2026', url: 'https://…/einlaufsound', until: '07.11.2026' }),
      a('awardRerollTemplate', '🎲 Neu gezogen: @{user} rückt für {old} in die Top {n} im {month} nach! Such dir deinen Einlaufsound aus: {url} (bis {until})', 'Nachricht, wenn für einen Gewinner neu gezogen wurde', { user: 'Max', old: 'Moritz', n: 3, month: 'Oktober 2026', url: 'https://…/einlaufsound', until: '07.11.2026' }),
      a('awardChosenTemplate', '🔊 {user} hat sich den Einlaufsound „{sound}“ ausgesucht, gültig bis {until}!', 'Nachricht, wenn gewählt wurde', { user: 'Max', sound: 'Fanfare', until: '07.12.2026' }),
    ] },
    { title: 'Einlaufsound: Chat-Texte', hint: `Platzhalter: ${code('user')} Name, ${code('months')} Monate, ${code('until')} gültig bis, ${code('url')} Upload-Seite, ${code('days')} Frist, ${code('rest')} Restlaufzeit, ${code('max')} Obergrenze, ${code('reason')} Ablehnungsgrund. Nachrichten mit „Punkte zurück“ erstatten die Einlösung.`, items: [
      a('entrySoundBuyTemplate', '🔊 {user}, danke! Lade deinen Einlaufsound hier hoch: {url} (innerhalb von {days} Tagen). Nach der Prüfung gilt er {months}. Gefällt er nicht, bekommst du deine Punkte zurück.', 'Nach dem Kauf', { user: 'Max', months: '6 Monate', url: 'https://…/einlaufsound', days: 14 }),
      a('entrySoundHasTemplate', '{user}, du hast schon einen Einlaufsound (gültig bis {until}) – zum Verlängern nimm bitte „Einlaufsound verlängern“. Deine Punkte bekommst du zurück.', 'Kauf, obwohl schon ein Sound gilt', { user: 'Max', until: '14.04.2027' }),
      a('entrySoundOpenTemplate', '{user}, dein Kauf wartet noch auf deinen Upload oder auf die Prüfung: {url} Deine Punkte bekommst du zurück.', 'Kauf oder Verlängern, obwohl ein Kauf noch offen ist', { user: 'Max', url: 'https://…/einlaufsound' }),
      a('entrySoundNoneTemplate', '{user}, du hast noch keinen Einlaufsound gekauft – nimm zuerst „Eigener Einlaufsound“. Deine Punkte bekommst du zurück.', 'Verlängern ohne gekauften Sound', { user: 'Max' }),
      a('entrySoundExtendTemplate', '🔊 {user} verlängert den Einlaufsound um {months} – gültig bis {until}. Einen neuen Sound kannst du hier hochladen: {url}', 'Nach dem Verlängern', { user: 'Max', months: '2 Monate', until: '14.04.2027', url: 'https://…/einlaufsound' }),
      a('entrySoundTooMuchTemplate', '{user}, mehr als {max} Restlaufzeit geht nicht (aktuell noch {rest}). Deine Punkte bekommst du zurück.', 'Verlängern über der Obergrenze', { user: 'Max', max: '12 Monate', rest: '11,5 Monate' }),
      a('entrySoundBusyTemplate', '{user}, gerade läuft schon eine Einlösung für dich – bitte gleich noch einmal versuchen. Deine Punkte bekommst du zurück.', 'Gleichzeitige Einlösung'),
      a('entrySoundApprovedTemplate', '🔊 {user}, dein Einlaufsound ist freigegeben und gilt bis {until}!', 'Sound freigegeben', { user: 'Max', until: '14.04.2027' }),
      a('entrySoundRejectedTemplate', '{user}, dein Einlaufsound wurde leider abgelehnt ({reason}). Lade hier einen anderen hoch: {url}', 'Sound abgelehnt, neuer Upload möglich', { user: 'Max', reason: 'zu laut', url: 'https://…/einlaufsound' }),
      a('entrySoundRefundTemplate', '{user}, dein Einlaufsound wurde abgelehnt ({reason}). Deine Punkte bekommst du zurück.', 'Sound abgelehnt, Punkte zurück', { user: 'Max', reason: 'enthält Musik' }),
      a('entrySoundExpiredTemplate', '{user}, du hast deinen Einlaufsound nicht rechtzeitig hochgeladen. Deine Punkte bekommst du zurück.', 'Upload-Frist abgelaufen, Punkte zurück', { user: 'Max' }),
    ] },
  ],

  community: [
    { title: 'Community-Rangliste des Monats', hint: 'Twitch-Chat, Check-ins und Discord (vom VerwirrBot gemeldet) zählen zusammen. <b>Öffentlich erscheinen nur Konten, die sich selbst verknüpft haben.</b> Voraussetzung ist das Geheimwort <code>LINK_SECRET</code> in der Stadtwache-App (und beim Bot). Nach dem Ein- oder Ausschalten die Webhooks abgleichen.', items: [
      c('communityEnabled', false, 'Community-Rangliste aktivieren (Zählen, Verknüpfen, Monatsrangliste)'),
      n('communityWeightMsg', 1, 'Punkte je Nachricht', { min: 0, max: 1000 }), n('communityWeightDay', 10, 'Punkte je aktivem Tag (Twitch und Discord getrennt gezählt)', { min: 0, max: 1000 }),
      n('communityWeightCheckin', 20, 'Punkte je Check-in-Tag', { min: 0, max: 1000 }),
      n('communityMsgCap', 30, 'Gezählte Nachrichten pro Tag und Plattform (höchstens)', { min: 1, max: 500 }),
      n('communityMsgGap', 60, 'Mindestabstand zwischen zwei gezählten Nachrichten (Sekunden)', { min: 0, max: 3600 }),
      t('communityCommand', '!verknuepfen', 'Chat-Befehl, der die Verknüpfung erklärt', { maxlength: 26, kind: 'command', placeholder: '!verknuepfen' }),
      t('communityRankCommand', '!rangliste', 'Chat-Befehl für die Monatsrangliste', { maxlength: 26, kind: 'command', placeholder: '!rangliste' }), n('communityRankSize', 5, 'Wie viele Plätze im Chat zeigen', { min: 1, max: 10 }),
      t('communityHint', 'Nur verknüpfte Konten erscheinen hier. So geht’s: im Discord /verknuepfen tippen oder im Chat !verknuepfen.', 'Hinweis unter der Rangliste und im Twitch-Panel', { maxlength: 400 }),
      t('communityBonusNote', 'Bonuspunkte gibt es für besondere Taten, zum Beispiel +40 Punkte für den Clip der Woche im Discord.', 'Zeile zu Bonuspunkten in der Legende der Rangliste', { maxlength: 400 }),
    ] },
    { title: 'Hinweise im Chat', hint: `Platzhalter: ${code('user')} Name, ${code('url')} Adresse der Seite, ${code('month')} Monat, ${code('list')} Plätze, ${code('me')} eigener Platz. Der Tipp erscheint nach dem Check-in, höchstens einmal im Monat und nur bei Unverknüpften.`, items: [
      c('communityTip', true, 'Beim Check-in einmal im Monat einen Tipp zur Verknüpfung schreiben'),
      c('clipHintEnabled', true, 'Unter geteilten Clips einen Hinweis schreiben (nur wenn der Ersteller noch nicht verknüpft ist)'),
      t('discordInvite', 'https://discord.gg/qxPqqhYwtJ', 'Discord-Einladungslink für den Clip-Hinweis', { maxlength: 200, placeholder: 'https://discord.gg/…' }),
      a('clipHintTemplate', '🎬 Starker Clip, {creator}! Komm ins Dorf ({discord}) und tippe hier !verknuepfen: Dann kannst du im Discord ClipMaster werden und bekommst Bonuspunkte für die Rangliste. 🏆', 'Hinweis unter einem Clip', { creator: 'Fan', user: 'Max', discord: 'https://discord.gg/…' }),
      a('communityTipTemplate', '💡 {user}, du bist noch nicht in der Monatsrangliste: verknüpfe dein Discord mit /verknuepfen oder tippe !verknuepfen. Dein Name wird nur gezeigt, wenn du das selbst tust.', 'Tipp nach dem Check-in', { user: 'Max', url: 'https://…/verknuepfen' }),
      a('communityLinkTemplate', '🔗 {user}, verknüpfe dein Twitch- und Discord-Konto, dann erscheinst du in der Monatsrangliste: tippe im Discord /verknuepfen und folge dem Link. Mehr dazu: {url}', 'Antwort auf den Befehl', { user: 'Max', url: 'https://…/verknuepfen' }),
      a('communityRankTemplate', '🏆 Dorf-Rangliste {month}: {list}{me} · Alle Plätze: {url}', 'Antwort auf den Rangliste-Befehl', { month: 'Oktober 2026', list: '1. Anna (120) · 2. Ben (80)', me: ' · Du: Platz 7 (45)', url: 'https://…/rangliste' }),
      a('communityRankEmpty', '🏆 In der Dorf-Rangliste {month} stehen noch keine Punkte. Verknüpfe dich mit !verknuepfen und leg los! {url}', 'Antwort, wenn noch niemand Punkte hat', { month: 'Oktober 2026', url: 'https://…/rangliste' }),
    ] },
  ],

  chatleiste: [
    { title: 'Chat-Leiste', hint: 'Zeigt die Chatnachrichten in einer Zeile am Bildrand, neueste links. Bots aus der Liste „Bots, die weder im Abspann noch in der Chatter-Rangliste auftauchen“ (Reiter Overlays, Abschnitt Abspann) erscheinen nicht. Im Chat gilt: <b>!farbe #ff8800</b> (oder ein Farbname wie rot, türkis) setzt die eigene Farbe, jede Person darf das. <b>!glitter</b> und <b>!verlauf</b> schalten Extras ein und aus, das dürfen Abos, VIPs, Mods und die Namen unten. Mit einer Farbe dahinter stellt man sie ein: <b>!glitter gold</b> (Glitzerfarbe, <b>!glitter auto</b> nimmt wieder die Namensfarbe) und <b>!verlauf rot blau</b>. Glitzer und Verlauf können sich Zuschauer auch mit Kanalpunkten kaufen (nächste Abschnitte). <b>!reset</b> setzt alles zurück.', items: [
      c('chatOverlayEnabled', false, 'Chat-Leiste aktivieren (braucht den Chat-Webhook)'),
      n('chatOverlayMax', 10, 'Höchstens so viele Nachrichten gleichzeitig', { min: 1, max: 30 }),
      n('chatOverlaySeconds', 0, 'Eine Nachricht verschwindet nach so vielen Sekunden (0 = sie bleibt, bis neue sie wegschieben)', { min: 0, max: 3600 }),
      t('chatOverlayVip', 'ehrlichverwirrt, novelsbyeverly, pyronema, artemis_podowy', 'Namen, die Glitzer und Verlauf auch ohne Abo nutzen dürfen (mit Komma getrennt)', { maxlength: 400 }),
      c('chatOverlayHideCommands', true, 'Befehle (Nachrichten mit !) nicht zeigen'),
    ] },
    { title: 'Glitzer als Kanalpunkte-Belohnung', hint: `Zuschauer, die kein Abo haben, können sich den Glitzer in der Chat-Leiste mit Kanalpunkten kaufen: Name und Nachrichten glitzern dann, und mit <b>!glitter</b> schalten sie ihn an und aus (mit <b>!glitter gold</b> stellen sie die Glitzerfarbe ein). Abos, VIPs und Mods haben den Glitzer ohnehin. Braucht die eingeschaltete Chat-Leiste (oben). Nach dem Einschalten oder Ändern von Name und Preis die Rewards abgleichen. Platzhalter: ${code('user', 'until')} (bis wann er gilt, oder „unbegrenzt“).`, items: [
      c('glitterEnabled', false, 'Reward „Glitzer“ anbieten'),
      t('glitterRewardTitle', 'Glitzer-Chat', 'Reward-Name', { maxlength: 45 }), n('glitterRewardCost', 5000, 'Preis (Kanalpunkte)', { min: 1, max: 1000000 }),
      n('glitterDays', 30, 'Der Glitzer gilt so viele Tage (0 = für immer). Erneutes Einlösen verlängert', { min: 0, max: 3650 }),
      a('glitterTemplate', '✨ {user} glitzert jetzt bis {until}! Mit !glitter geht der Glitzer an und aus.', 'Chat-Nachricht nach dem Kauf', { user: 'Max', until: '10.12.2026' }),
    ] },
    { title: 'Verlauf als Kanalpunkte-Belohnung', hint: `Wie beim Glitzer, nur mit einem <b>Farbverlauf</b> durch mehrere Farben in Name und Nachrichten. Beim Einlösen schreiben die Käufer <b>2 oder 3 Farben</b> dazu (z. B. „rot blau“, „türkis rosa gelb“, Hex-Codes wie #ff8800, „zufall“) oder „auto“ für den automatischen Verlauf. Später ändern sie ihn mit <b>!verlauf rot blau</b>; <b>!verlauf</b> allein schaltet ihn an und aus. Unbekannte Farben beim Einlösen: Hinweis im Chat und Punkte zurück. Wer beides kauft, hat einen Verlauf mit Glitzer. Braucht die eingeschaltete Chat-Leiste. Nach dem Einschalten oder Ändern von Name, Preis oder Tagen die Rewards abgleichen. Platzhalter: ${code('user', 'until')}.`, items: [
      c('gradientEnabled', false, 'Reward „Verlauf“ anbieten'),
      t('gradientRewardTitle', 'Verlauf-Chat', 'Reward-Name', { maxlength: 45 }), n('gradientRewardCost', 5000, 'Preis (Kanalpunkte)', { min: 1, max: 1000000 }),
      n('gradientDays', 30, 'Der Verlauf gilt so viele Tage (0 = für immer). Erneutes Einlösen verlängert', { min: 0, max: 3650 }),
      a('gradientTemplate', '🌈 {user} hat jetzt einen Farbverlauf bis {until}! Mit !verlauf rot blau änderst du die Farben, mit !verlauf allein schaltest du ihn an und aus.', 'Chat-Nachricht nach dem Kauf', { user: 'Max', until: '10.12.2026' }),
      a('gradientBadTemplate', '{user}, diese Farben kenne ich nicht 🌈 Schreib beim Einlösen zum Beispiel „rot blau“, „türkis rosa gelb“, Hex-Codes wie #ff8800 oder „auto“. Deine Punkte bekommst du zurück.', 'Nachricht, wenn die Farben unbekannt sind (Punkte werden erstattet)', { user: 'Max' }),
    ] },
  ],

  alpakas: [
    { title: 'Alpakas im Overlay', hint: `Jede Person, die im Chat schreibt, läuft als Pixel-Alpaka durchs Bild, bis sie länger nichts mehr geschrieben hat. Ohne Reward haben alle einen natürlichen Fellton (weiß, beige, braun, grau). Mit dem Reward „Alpaka färben“ schreibt man die Farbe beim Einlösen dazu: einen Namen wie rot, türkis oder rosa, einen Hex-Code wie #ff8800 oder „zufall“. Die Farbe bleibt dauerhaft. Nach dem Ein- oder Ausschalten und nach Änderungen an Name oder Preis die Rewards abgleichen. Platzhalter der Texte: ${code('user')} ${code('color')}.`, items: [
      c('alpacaEnabled', false, 'Alpakas aktivieren (braucht den Chat-Webhook und legt den Reward „Alpaka färben“ an)'),
      n('alpacaMax', 30, 'Höchstens so viele Alpakas gleichzeitig (die zuletzt aktiven)', { min: 1, max: 60 }),
      n('alpacaMinutes', 90, 'Alpaka läuft so viele Minuten nach der letzten Nachricht weiter', { min: 5, max: 720 }),
      t('alpacaRewardTitle', 'Alpaka färben', 'Reward-Name', { maxlength: 45 }), n('alpacaRewardCost', 500, 'Preis (Kanalpunkte)', { min: 1, max: 1000000 }),
      a('alpacaTemplate', '🦙 {user} färbt sein Alpaka: {color}!', 'Chatnachricht nach dem Färben', { user: 'Max', color: 'türkis' }),
      a('alpacaBadTemplate', '{user}, diese Farbe kenne ich nicht 🦙 Schreib beim Einlösen zum Beispiel „rot“, „türkis“, „rosa“, einen Hex-Code wie #ff8800 oder „zufall“. Deine Punkte bekommst du zurück.', 'Nachricht, wenn die Farbe unbekannt ist (Punkte werden erstattet)', { user: 'Max' }),
    ] },
  ],

  chat: [
    { title: 'Chat-Befehle', hint: `Die Befehle laufen über den Chat-Webhook. Nach dem Ein- oder Ausschalten die Webhooks abgleichen. Platzhalter für <b>!streak</b>: ${code('user')} ${code('count')} Besuche, ${code('streak')} ${code('record')}, ${code('time')} Gesamtzeit, ${code('rank')} Platz, ${code('total')} Besucher gesamt. Für <b>!top</b>: ${code('n')} und ${code('list')}. Die Abklingzeit gilt je Befehl für den ganzen Chat.`, items: [
      c('chatCommands', true, 'Chat-Befehle aktivieren'),
      t('streakCommand', '!streak', 'Befehl für die eigenen Zahlen', { maxlength: 26, kind: 'command', placeholder: '!streak' }), t('topCommand', '!top', 'Befehl für die Bestenliste', { maxlength: 26, kind: 'command', placeholder: '!top' }),
      n('commandCooldown', 10, 'Abklingzeit (Sekunden)', { min: 0, max: 600 }), n('topSize', 5, 'Plätze in der Bestenliste', { min: 1, max: 10 }),
      a('streakCmdTemplate', '📊 {user}: {count} Besuche · 🔥 Streak {streak} (Rekord {record}) · {time} im Stream · Platz {rank} von {total}', 'Antwort auf !streak', { user: 'Max', count: 24, streak: 5, record: 9, time: '18 Std 40 Min', rank: 3, total: 120 }),
      a('streakCmdNone', '{user}, ich habe noch keinen Check-in von dir – löse den Check-in-Reward ein ✅', 'Antwort, wenn noch kein Check-in vorhanden ist', { user: 'Max' }),
      a('topTemplate', '🏆 Top {n} Stammgäste: {list}', 'Antwort auf !top', { n: 5, list: '1. Anna (42) · 2. Max (37) · 3. Kai (30)' }),
    ] },
    { title: 'Shoutout und Zitate', hint: `Beides ist standardmäßig aus. <b>!so name</b> dürfen Mods und du nutzen, der Bot macht den offiziellen Twitch-Shoutout und schreibt eine Nachricht (Platzhalter ${code('name')} ${code('game')} ${code('url')}). Twitch erlaubt Shoutouts nur, solange du live bist, und höchstens einen alle 2 Minuten. Der <b>Auto-Shoutout</b> gilt für die Namen in der Liste, einmal pro Stream-Tag beim ersten Chat-Beitrag. <b>Zitate:</b> jeder kann <b>!quote</b> (oder <b>!quote 3</b>) nutzen, Mods speichern mit <b>!addquote Text</b> und löschen mit <b>!delquote 3</b>. Platzhalter ${code('n')} ${code('text')} ${code('by')} ${code('date')}.`, items: [
      c('soEnabled', false, '!so (Shoutout per Befehl) aktivieren'), t('soCommand', '!so', 'Befehl für den Shoutout', { maxlength: 26, kind: 'command', placeholder: '!so' }),
      a('soTemplate', '📣 Schaut bei {name} vorbei: {url} – zuletzt gespielt: {game} 💜', 'Nachricht beim Shoutout', { name: 'RaiderIn', game: 'Hades', url: 'twitch.tv/raiderin' }),
      c('autoShoutoutEnabled', false, 'Auto-Shoutout für Stammgäste aktivieren'), t('autoShoutoutUsers', '', 'Namen für den Auto-Shoutout (mit Komma getrennt)', { maxlength: 400 }),
      c('quoteEnabled', false, 'Zitate aktivieren'),
      t('quoteCommand', '!quote', 'Befehl zum Anzeigen', { maxlength: 26, kind: 'command', placeholder: '!quote' }), t('quoteAddCommand', '!addquote', 'Befehl zum Speichern (Mods)', { maxlength: 26, kind: 'command', placeholder: '!addquote' }), t('quoteDelCommand', '!delquote', 'Befehl zum Löschen (Mods)', { maxlength: 26, kind: 'command', placeholder: '!delquote' }),
      a('quoteTemplate', '💬 Zitat #{n}: „{text}“ ({date})', 'Anzeige eines Zitats', { n: 3, text: 'Das war Absicht!', by: 'Max', date: '11.11.2026' }),
      a('quoteAddedTemplate', '✅ Zitat #{n} gespeichert.', 'Antwort nach dem Speichern', { n: 4, user: 'Max' }),
      a('quoteNoneTemplate', '{user}, ich kenne noch kein Zitat. Mods können mit !addquote eins anlegen.', 'Antwort, wenn es noch kein Zitat gibt', { user: 'Max' }),
    ] },
    { title: 'Moderation', hint: `Löscht Nachrichten, die gegen eine Regel verstoßen, und warnt kurz im Chat. <b>Nie betroffen:</b> du und deine Mods. VIPs, Abonnenten und Stammgäste (ab der eingestellten Zahl an Check-ins) dürfen Links, Großbuchstaben, Wiederholungen und Emotes, nur gesperrte Wörter gelten für sie auch. <b>Twitch-Clips</b> darf jeder teilen. Mit <b>!permit name</b> erlauben Mods jemandem 60 Sekunden lang einen Link. Fang mit dem <b>Testmodus</b> an: Dann schreibt der Bot nur ins Protokoll (Reiter Chat, unten), was er gelöscht <i>hätte</i>. Der Bot braucht dafür neue Rechte von Twitch: einmal auf Start → „Mit Twitch verbinden“ klicken. Platzhalter der Warnung: ${code('user', 'reason', 'n')}.`, items: [
      c('modEnabled', false, 'Moderation aktivieren'),
      c('modTestMode', true, 'Testmodus: nur ins Protokoll schreiben, nichts löschen'),
      c('modLinks', true, 'Links löschen'),
      c('modAllowClips', true, 'Twitch-Clips immer erlauben (clips.twitch.tv und twitch.tv/…/clip/…)'),
      t('modLinkAllow', 'youtube.com, youtu.be', 'Weitere erlaubte Adressen für Links (mit Komma getrennt)', { maxlength: 400, empty: true }),
      t('modWords', '', 'Gesperrte Wörter (mit Komma getrennt, gilt auch für VIPs, Abonnenten und Stammgäste)', { maxlength: 400, empty: true }),
      c('modCaps', true, 'Zu viele Großbuchstaben löschen'),
      n('modCapsMin', 15, 'Erst prüfen ab so vielen Buchstaben', { min: 5, max: 200 }), n('modCapsPercent', 70, 'Anteil Großbuchstaben ab (Prozent)', { min: 50, max: 100 }),
      c('modRepeat', true, 'Wiederholungen löschen'),
      n('modRepeatCount', 3, 'Dieselbe Nachricht so oft hintereinander, dann wird sie gelöscht', { min: 2, max: 10 }),
      c('modEmotes', true, 'Emote-Spam löschen'),
      n('modEmoteMax', 10, 'Mehr als so viele Emotes in einer Nachricht', { min: 3, max: 50 }),
      n('modTrustVisits', 5, 'Stammgast ab so vielen Check-ins (0 = niemand)', { min: 0, max: 1000 }),
      n('modTimeoutAfter', 0, 'Timeout ab dem so vielten Verstoß (0 = nie, nur löschen und warnen)', { min: 0, max: 10 }),
      n('modTimeoutSeconds', 30, 'Dauer des ersten Timeouts in Sekunden (verdoppelt sich, höchstens 600)', { min: 1, max: 600 }),
      n('modStrikeMinutes', 30, 'Verstöße zählen so viele Minuten lang zusammen', { min: 1, max: 1440 }),
      t('modPermitCommand', '!permit', 'Befehl für die Link-Erlaubnis (nur Mods)', { maxlength: 26, kind: 'command', placeholder: '!permit' }),
      a('modWarnTemplate', '⚠️ {user}, {reason}', 'Warnung im Chat', { user: 'Max', reason: 'bitte keine Links hier', n: 1 }),
    ] },
  ],

  abspann: [
    { title: 'Abspann', hint: 'Der Abspann sammelt pro Stream-Tag automatisch, wer geschrieben, gefolgt, abonniert, Bits geschickt oder geraidet hat – auch wenn die Alerts ausgeschaltet sind. Nach dem Einschalten die Webhooks abgleichen, sonst werden keine Ereignisse empfangen. Bots stehen nicht im Abspann.', items: [
      c('creditsEnabled', true, 'Abspann-Daten sammeln'),
      t('creditsTitle', 'Danke fürs Zuschauen!', 'Überschrift', { maxlength: 80 }), t('creditsOutro', 'Bis zum nächsten Mal! 💜', 'Schlusszeile', { maxlength: 80 }),
      n('creditsSpeed', 70, 'Lauftempo (Pixel pro Sekunde)', { min: 20, max: 300 }),
      c('creditsChatters', true, 'Chatter nennen'), c('creditsFollows', true, 'Neue Follower nennen'), c('creditsSubs', true, 'Abonnenten und Sub-Geschenke nennen'), c('creditsBits', true, 'Bits nennen'), c('creditsRaids', true, 'Raids nennen'),
      t('creditsIgnore', 'nightbot, streamelements, moobot, streamlabs, fossabot', 'Bots, die weder im Abspann noch in der Chatter-Rangliste auftauchen (mit Komma getrennt)', { maxlength: 400 }),
    ] },
    { title: 'Rangliste', hint: 'Die Rangliste (Seite und Twitch-Panel) zeigt nur Namen und Zahlen: Besuche, Chat-Nachrichten, Streaks und Zeit im Stream. Sie ist ohne Anmeldung erreichbar. Die Chat-Zählung beginnt beim Einschalten, Twitch liefert keinen Verlauf. Dein eigener Name und die Bots oben werden nicht gezählt.', items: [
      c('leaderboardPublic', true, 'Rangliste öffentlich anzeigen'), c('chatStats', true, 'Chat-Nachrichten zählen (für die Chatter-Rangliste, braucht den Chat-Webhook)'),
      n('leaderboardSize', 10, 'Plätze je Liste', { min: 3, max: 25 }),
    ] },
  ],

  gewinn: [
    { title: 'Geburtstags-Ziehung: Ticket und Texte', hint: `Zeiten, Preise, Lose-Rechnung und Gewinner pflegst du darüber in der Karte „Geburtstags-Ziehung“. Hier stehen Schalter, der Kanalpunkte-Reward und die Chat-Texte. Nach dem Einschalten oder Ändern von Name und Preis die Rewards abgleichen. Platzhalter: ${code('user')} ${code('prize')} ${code('place')} ${code('hours')} ${code('lots')} ${code('cost')} ${code('old')}.`, items: [
      c('gwEnabled', false, 'Geburtstags-Ziehung einschalten (legt den Reward an und zählt die Wochenpunkte, braucht den Chat-Webhook)'),
      t('gwRewardTitle', 'Geburtstags-Ticket', 'Reward-Name', { maxlength: 45 }), n('gwRewardCost', 500, 'Preis des Tickets (Kanalpunkte, günstig halten)', { min: 1, max: 1000000 }),
      c('gwBonusEnabled', true, 'Mitternachts-Los anbieten (Extra-Los für alle, die um 0:00 am Geburtstag dabei sind; das Fenster stellst du in der Karte „Geburtstags-Ziehung“ ein)'),
      t('gwBonusRewardTitle', 'Mitternachts-Los', 'Mitternachts-Los: Reward-Name', { maxlength: 45 }), n('gwBonusRewardCost', 15, 'Mitternachts-Los: Preis (Kanalpunkte)', { min: 1, max: 1000000 }),
      a('gwBonusTemplate', '🌙 {user}, dein Mitternachts-Los ist drin! Du hast {lots} Extra-Los obendrauf. Alles Gute zum Geburtstag!', 'Mitternachts-Los erhalten (mit Ticket)', { user: 'Max', lots: 1 }),
      a('gwBonusNoTicketTemplate', '🌙 {user}, dein Mitternachts-Los ist gemerkt! Damit es zählt, brauchst du noch das Geburtstags-Ticket (kommt am Danke-Stream).', 'Mitternachts-Los erhalten (noch ohne Ticket)', { user: 'Max', lots: 1 }),
      a('gwBonusDuplicateTemplate', '{user}, du hast dein Mitternachts-Los schon ✅ Pro Person gibt es eins. Deine Punkte bekommst du zurück.', 'Zweites Mitternachts-Los (Punkte werden erstattet)', { user: 'Max' }),
      a('gwBonusClosedTemplate', '{user}, das Mitternachts-Los gibt es gerade nicht mehr. Deine Punkte bekommst du zurück.', 'Mitternachts-Los: Fenster zu (Punkte werden erstattet)', { user: 'Max' }),
      n('gwRevealSeconds', 8, 'Sekunden je Platz bei der Aufdeckung (Overlay, Chat und Link im Takt, 0 = alles sofort)', { min: 0, max: 60 }),
      a('gwTicketTemplate', '🎟️ {user}, dein Geburtstags-Ticket ist drin! Du hast aktuell {lots} Los(e). Bonuslose gibt es für Aktivität bis zur Ziehung.', 'Ticket erhalten', { user: 'Max', lots: 3 }),
      a('gwDuplicateTemplate', '{user}, du hast dein Geburtstags-Ticket schon ✅ Pro Person gibt es eins. Deine Punkte bekommst du zurück.', 'Zweites Ticket (Punkte werden erstattet)', { user: 'Max' }),
      a('gwClosedTemplate', '{user}, das Geburtstags-Ticket gibt es gerade nicht. Deine Punkte bekommst du zurück.', 'Ticket-Fenster ist zu (Punkte werden erstattet)', { user: 'Max' }),
      a('gwBlockedTemplate', '{user}, du kannst beim Gewinnspiel leider nicht mitmachen. Deine Punkte bekommst du zurück.', 'Gesperrte Person (Punkte werden erstattet)', { user: 'Max' }),
      a('gwWinnerTemplate', '🎉 Platz {place}: {user} gewinnt {prize}! Du bekommst gleich eine Flüsternachricht mit deinem persönlichen Link, du hast {hours} Stunden Zeit.', 'Gewinner-Ansage im Chat', { user: 'Max', prize: 'Enshrouded', place: 1, hours: 24 }),
      a('gwRedrawTemplate', '🔁 Nachgezogen: {user} gewinnt {prize} (Platz {place}). {old} hat sich nicht gemeldet. Persönlicher Link per Flüstern, {hours} Stunden Zeit.', 'Nachgezogen', { user: 'Max', prize: 'Enshrouded', place: 1, hours: 24, old: 'Anna' }),
      a('gwWhisperTemplate', 'Glückwunsch {user}! Du hast {prize} gewonnen 🎉 Dein persönlicher Link (nur für dich, {hours} Stunden gültig, bitte nicht weitergeben): {url}', 'Flüsternachricht mit dem Link', { user: 'Max', prize: 'Enshrouded', hours: 24, url: 'https://…' }),
    ] },
  ],

  feier: [
    { title: 'Geburtstags-Befehl und Wochenplan-Seite', hint: `Der Befehl schreibt die Restzeit bis zur Zielzeit des Countdowns (Reiter „Geburtstagswoche“) und den Link zur Seite <code>/woche</code>. Dort steht der Wochenplan, ohne Anmeldung erreichbar. Die Seite ist nur sichtbar, solange der Befehl eingeschaltet ist. Im Plan steht ein Eintrag pro Zeile, am schönsten als „Mo 23.11. 19:00 Titel“ (Tag, Datum, Uhrzeit, Text). Platzhalter: ${code('countdown')} Restzeit, ${code('url')} Adresse der Seite, ${code('plan')} der Plan in einer Zeile (nur wenn du ihn doch im Chat willst).`, items: [
      c('bdayEnabled', false, 'Geburtstags-Befehl einschalten (braucht den Chat-Webhook)'),
      t('bdayCommand', '!geburtstag', 'Befehl', { maxlength: 26, kind: 'command', placeholder: '!geburtstag' }),
      a('bdayTemplate', '🎂 Noch {countdown} bis Marcels Geburtstag! Das ganze Programm der Woche: {url}', 'Antwort vor dem Geburtstag', { countdown: '3 Tage 4 Std 12 Min', url: 'https://…/woche' }),
      a('bdayDoneTemplate', '🎉 Marcel hat Geburtstag! Danke, dass ihr dabei seid ❤️ Das Programm: {url}', 'Antwort nach der Zielzeit', { url: 'https://…/woche' }),
      a('bdayPlan', 'Mo 23.11. 19:00 Geburtstagswoche startet: Rückblick auf die Kanalgeschichte\nDi 24.11. 20:30 Bauabend\nMi 25.11. 19:00 Community-Tag: Adventures & Community Votes\nDo 26.11. 20:30 1.0 Story-Abend\nFr 27.11. 19:00 Community-Tag: Adventures & Community Votes\nSa 28.11. ab 19:00 Mitternachtsstream, um 0:00 Extra-Los\nSo 29.11. Geburtstag, kein Stream\nMo 30.11. ab 19:30 Danke-Stream mit Ziehung', 'Wochenplan für die Seite /woche (eine Zeile pro Eintrag, zum Beispiel: Mo 23.11. 19:00 Titel)'),
    ] },
    { title: 'Glücksrad: Chat', hint: `Die Räder und ihre Felder pflegst du im Reiter „Geburtstagswoche“. Platzhalter: ${code('wheel')} Name des Rads, ${code('result')} Ergebnis.`, items: [
      c('radChatEnabled', true, 'Ergebnis nach dem Drehen in den Chat schreiben'),
      a('radTemplate', '🎡 {wheel}: {result}!', 'Chatnachricht mit dem Ergebnis', { wheel: 'Gebäudeart', result: 'Leuchtturm' }),
    ] },
  ],

  adventure: [
    { title: 'Adventure-Einreichung: Befehl und Texte', hint: `Zuschauer reichen im Chat mit dem Befehl ein, zum Beispiel <code>!adventure Name oder Link</code>. Im Discord geht es über den VerwirrBot in dieselbe Liste. Die Liste und die Übertragung aufs Glücksrad findest du oben in der Karte „Adventure-Einreichungen“. Platzhalter: ${code('user')} ${code('title')} ${code('count')} Einreichungen insgesamt, ${code('max')} Einreichungen je Person.`, items: [
      c('advEnabled', false, 'Adventure-Einreichung einschalten (Chat-Befehl und Discord, braucht den Chat-Webhook)'),
      c('advOpen', true, 'Einreichung ist offen (zum Schließen abhaken, die Liste bleibt)'),
      t('advCommand', '!adventure', 'Befehl', { maxlength: 26, kind: 'command', placeholder: '!adventure' }),
      n('advMaxPerPerson', 2, 'So viele Adventures darf jede Person einreichen (Twitch und Discord zusammen)', { min: 1, max: 20 }),
      a('advAddedTemplate', '🗺️ {user}, dein Adventure „{title}“ ist in der Liste (Nr. {count}). Danke!', 'Adventure angenommen', { user: 'Max', title: 'Lamas Rache', count: 4 }),
      a('advDuplicateTemplate', '{user}, „{title}“ ist schon in der Liste ✅', 'Adventure schon eingereicht', { user: 'Max', title: 'Lamas Rache' }),
      a('advLimitTemplate', '{user}, du hast schon {max} Adventures eingereicht. Mehr gehen leider nicht.', 'Zu viele Einreichungen', { user: 'Max', max: 2 }),
      a('advNoTextTemplate', '{user}, schreib den Namen oder den Link hinter den Befehl, zum Beispiel !adventure Lamas Rache', 'Nichts dahinter geschrieben', { user: 'Max' }),
      a('advClosedTemplate', '{user}, die Adventure-Einreichung ist gerade geschlossen.', 'Einreichung geschlossen', { user: 'Max' }),
    ] },
  ],

  tickets: [
    { title: 'Ticket-System', hint: `Die Events (Name, Datum, Plätze, Preis) legst du unten in der Eventliste an. Hier stehen nur Schalter, Chat-Befehle und Texte. Ausgeschaltet nimmt das Ticket-System keine Einlösungen an (die Punkte gehen zurück). Platzhalter in den Texten: ${code('user')} Name, ${code('event')} Eventname, ${code('seat')} Platznummer, ${code('max')} Plätze insgesamt, ${code('free')} freie Plätze, ${code('pos')} Wartelisten-Position, ${code('minutes')} Frist zum Melden.`, items: [
      c('ticketsEnabled', false, 'Ticket-System einschalten'),
      t('ticketsCommand', '!tickets', 'Befehl: freie Plätze und Warteliste', { maxlength: 26, kind: 'command', placeholder: '!tickets' }),
      t('ticketSeatCommand', '!platz', 'Befehl: mein Ticket oder meine Wartelisten-Position', { maxlength: 26, kind: 'command', placeholder: '!platz' }),
      t('ticketCancelCommand', '!absagen', 'Befehl: Ticket zurückgeben (der Erste auf der Warteliste rückt nach)', { maxlength: 26, kind: 'command', placeholder: '!absagen' }),
      t('ticketConfirmCommand', '!dabei', 'Befehl: Nachrücker meldet sich (nur bei Nachrück-Frist)', { maxlength: 26, kind: 'command', placeholder: '!dabei' }),
      t('ticketIngameCommand', '!steam', 'Befehl: Steam-Namen eintragen', { maxlength: 26, kind: 'command', placeholder: '!steam' }),
      t('ticketAddCommand', '!ticketadd', 'Mod-Befehl: Person von Hand eintragen', { maxlength: 26, kind: 'command', placeholder: '!ticketadd' }),
      t('ticketRemoveCommand', '!ticketremove', 'Mod-Befehl: Person von Hand entfernen', { maxlength: 26, kind: 'command', placeholder: '!ticketremove' }),
    ] },
    { title: 'Ticket-Texte im Chat', hint: `Kurz und freundlich halten. Platzhalter wie oben, zusätzlich ${code('when')} Datum und Uhrzeit (nur bei der Übersicht) und ${code('wait')} Länge der Warteliste, ${code('name')} Ingame-Name.`, items: [
      a('ticketGotTemplate', '🎟️ @{user}, du hast Platz {seat} von {max}! ({event})', 'Ticket bekommen', { user: 'Max', event: 'Community-Abend Mittwoch', seat: 3, max: 10 }),
      a('ticketWaitTemplate', '🕐 @{user}, alle {max} Plätze sind vergeben. Du stehst auf der Warteliste, Position {pos}. Rückt jemand nach vorn, sagen wir Bescheid! ({event})', 'Auf die Warteliste gekommen', { user: 'Max', event: 'Community-Abend Mittwoch', max: 10, pos: 2 }),
      a('ticketDupTemplate', '@{user}, du hast für {event} schon einen Platz oder stehst auf der Warteliste ✅ Deine Punkte bekommst du zurück.', 'Doppelte Einlösung (Punkte werden erstattet)', { user: 'Max', event: 'Community-Abend Mittwoch' }),
      a('ticketClosedTemplate', '@{user}, für {event} läuft gerade kein Ticketverkauf. Deine Punkte bekommst du zurück.', 'Verkauf nicht offen (Punkte werden erstattet)', { user: 'Max', event: 'Community-Abend Mittwoch' }),
      a('ticketFullTemplate', '@{user}, {event} ist leider komplett ausgebucht, auch die Warteliste ist voll. Deine Punkte bekommst du zurück.', 'Ausverkauft samt Warteliste (Punkte werden erstattet)', { user: 'Max', event: 'Community-Abend Mittwoch' }),
      a('ticketWeekTemplate', '@{user}, pro Woche gibt es nur ein Ticket, damit möglichst viele dabei sein können 💚 Deine Punkte bekommst du zurück.', 'Schon ein Ticket in dieser Woche (Punkte werden erstattet)', { user: 'Max' }),
      a('ticketMovedTemplate', '🎉 @{user} ist nachgerückt und hat jetzt einen Platz für {event}!', 'Nachgerückt (ohne Frist)', { user: 'Max', event: 'Community-Abend Mittwoch' }),
      a('ticketOfferTemplate', '🎉 @{user}, ein Platz für {event} ist frei geworden! Du hast {minutes} Minuten Zeit, dich mit !dabei zu melden, sonst rückt der Nächste nach.', 'Nachgerückt (mit Frist zum Melden)', { user: 'Max', event: 'Community-Abend Mittwoch', minutes: 30 }),
      a('ticketConfirmedTemplate', '✅ @{user}, dein Platz für {event} ist sicher. Bis dann!', 'Nachrücker hat sich gemeldet', { user: 'Max', event: 'Community-Abend Mittwoch' }),
      a('ticketExpiredTemplate', '⌛ @{user} hat sich nicht gemeldet, der Platz für {event} geht weiter.', 'Frist abgelaufen', { user: 'Max', event: 'Community-Abend Mittwoch' }),
      a('ticketCancelTemplate', '👋 @{user}, dein Platz für {event} ist zurückgegeben. Schade, bis zum nächsten Mal!', 'Ticket zurückgegeben', { user: 'Max', event: 'Community-Abend Mittwoch' }),
      a('ticketsLineTemplate', '{event} ({when}): {free} von {max} Plätzen frei, Warteliste: {wait}', 'Übersicht mit !tickets (eine Zeile je Event)', { event: 'Community-Abend Mittwoch', when: 'Mi 25.11. 19:00', free: 4, max: 10, wait: 0 }),
      a('ticketsNoneTemplate', 'Gerade gibt es keine Events mit Tickets 🎟️', 'Übersicht, wenn es kein Event gibt', {}),
      a('ticketSeatTemplate', '@{user}, du hast ein Ticket für {event} 🎟️', 'Mit !platz: Person hat ein Ticket', { user: 'Max', event: 'Community-Abend Mittwoch' }),
      a('ticketWaitPosTemplate', '@{user}, du stehst für {event} auf der Warteliste, Position {pos} 🕐', 'Mit !platz: Wartelisten-Position', { user: 'Max', event: 'Community-Abend Mittwoch', pos: 2 }),
      a('ticketSeatNoneTemplate', '@{user}, du hast gerade kein Ticket und stehst auf keiner Warteliste.', 'Mit !platz oder !absagen: nichts gefunden', { user: 'Max' }),
      a('ticketIngameTemplate', '✅ @{user}, ich habe „{name}“ für dich eingetragen.', 'Steam-Name gespeichert', { user: 'Max', name: 'MaxSteam' }),
    ] },
  ],

  allgemein: [
    { title: 'Allgemein', hint: 'Der Stream-Tag wechselt zur eingestellten Uhrzeit, damit Streams nach Mitternacht nicht doppelt zählen.', items: [
      n('volume', 0.6, 'Lautstärke im Overlay (0 bis 1)', { min: 0, max: 1, step: 0.1 }),
      n('duration', 5000, 'Anzeigedauer Check-in, Check-out und Meilenstein (ms)', { min: 2000, max: 30000, step: 500 }),
      t('timezone', 'Europe/Berlin', 'Zeitzone', { kind: 'timezone' }), n('dayRolloverHour', 5, 'Neuer Stream-Tag ab (Uhr)', { min: 0, max: 23 }),
      c('chatEnabled', true, 'Chatnachrichten senden (ausgeschaltet schreibt der Bot gar nichts)'),
    ] },
    { title: 'Automatische Sicherung', hint: 'Die Stadtwache sichert sich jede Nacht selbst in den Backup-Ordner auf dem Server (siehe Backup &amp; Wiederherstellen unten). Am besten liegt der Ordner auf einem anderen Gerät, zum Beispiel einer Freigabe deines NAS.', items: [
      c('backupAutoEnabled', true, 'Jede Nacht automatisch sichern'),
      n('backupHour', 3, 'Sichern um (Uhr)', { min: 0, max: 23 }),
      n('backupKeep', 7, 'So viele Sicherungen aufheben', { min: 1, max: 90 }),
      c('backupMedia', true, 'Mit Tönen und Bildern sichern'),
    ] },
    { title: 'Störungen an Discord melden', hint: `Die Stadtwache prüft alle paar Minuten, ob alles läuft, und schreibt dir bei Problemen in einen Discord-Kanal: Twitch hat Webhooks widerrufen, die Twitch-Verbindung ist ungültig, Webhooks fehlen oder die nächtliche Sicherung ist fehlgeschlagen. Eine Meldung kommt, wenn ein Problem bei zwei Prüfungen hintereinander da war, danach höchstens einmal am Tag erneut, und eine Nachricht, wenn alles wieder in Ordnung ist. <b>So bekommst du die Adresse:</b> In Discord auf den Kanal gehen → Kanal bearbeiten (Zahnrad) → Integrationen → Webhooks → Neuer Webhook → „Webhook-URL kopieren“ und hier einfügen. Die Adresse ist wie ein Passwort: Wer sie hat, kann in den Kanal schreiben. Nach dem Speichern mit dem Knopf unten testen.`, items: [
      c('healthEnabled', false, 'Störungen an Discord melden'),
      t('healthDiscordWebhook', '', 'Discord-Webhook-Adresse', { maxlength: 200, kind: 'discordhook', empty: true, placeholder: 'https://discord.com/api/webhooks/…' }),
    ] },
  ],
};

const all = Object.values(SCHEMA).flat().flatMap((g) => g.items);
export const CHECKS = all.filter((i) => i.type === 'check').map((i) => i.id);
export const FIELDS = all.filter((i) => i.type !== 'check').map((i) => i.id);

// Änderungen an diesen Feldern erfordern „Rewards & Webhooks abgleichen“
export const SYNC_KEYS = ['rewardTitle', 'rewardCost', 'checkoutEnabled', 'checkoutRewardTitle', 'checkoutRewardCost', 'streakRescueEnabled', 'streakRewardTitle', 'streakRewardCost', 'communityEnabled', 'entrySoundEnabled', 'entrySoundBuyTitle', 'entrySoundBuyCost', 'entrySoundBuyMonths', 'entrySoundExtendTitle', 'entrySoundExtendCost', 'entrySoundMaxSeconds', 'entrySoundMaxMonths', 'alpacaEnabled', 'alpacaRewardTitle', 'alpacaRewardCost', 'glitterEnabled', 'glitterRewardTitle', 'glitterRewardCost', 'glitterDays', 'gradientEnabled', 'gradientRewardTitle', 'gradientRewardCost', 'gradientDays', 'gwEnabled', 'gwRewardTitle', 'gwRewardCost', 'gwBonusEnabled', 'gwBonusRewardTitle', 'gwBonusRewardCost', 'raidEnabled', 'alertsEnabled', 'creditsEnabled', 'chatCommands', 'chatStats', 'modEnabled'];
