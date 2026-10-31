# Stadtwache – Twitch-Bot für Check-in, Streaks und Raids (Netlify)

Die Stadtwache ist der Chatbot für deinen Kanal. Zuschauer lösen einen Kanalpunkte-Reward ein und werden damit für den Stream eingecheckt. Der Bot läuft komplett auf Netlify und wird über den Browser verwaltet (`/admin/`).

Pro Check-in passiert Folgendes:
- **Chatnachricht**, z. B. `✅ Max ist eingecheckt – du warst jetzt schon 7x dabei! 🎉`
- **Ton und Animation** im OBS-Overlay (Karte mit Konfetti)
- **Logging im Hintergrund**: Jeder Besuchstag wird pro User gespeichert (Netlify Blobs)

Ein Check-in zählt **einmal pro Stream-Tag**. Der Tag wechselt um 5 Uhr (einstellbar), damit Streams nach Mitternacht nicht doppelt zählen. Löst jemand den Reward am selben Tag erneut ein, schreibt der Bot einen Hinweis in den Chat und erstattet die Punkte. Gezählt werden die Tage, an denen jemand da war, ein Abreißen der Streamserie spielt also keine Rolle.

## Einrichtung

1. **Netlify**: Repo mit Netlify verbinden (*Add new site → Import from Git*). Build-Einstellungen kommen aus `netlify.toml`, es gibt keinen Build-Befehl.
2. **Twitch-App** unter <https://dev.twitch.tv/console/apps> anlegen:
   - OAuth Redirect URL: `https://DEINE-SEITE.netlify.app/api/auth/callback`
   - Client Type: **Confidential**
   - Client ID und Client Secret notieren
3. **Umgebungsvariablen** in Netlify (*Site configuration → Environment variables*):

   | Variable | Inhalt |
   |---|---|
   | `TWITCH_CLIENT_ID` | aus der Twitch-App |
   | `TWITCH_CLIENT_SECRET` | aus der Twitch-App |
   | `EVENTSUB_SECRET` | beliebiger Zufallstext, 10 bis 100 Zeichen (signiert die Twitch-Webhooks) |
   | `ADMIN_PASSWORD` | Passwort für den Admin-Bereich, lang wählen |
   | `SITE_URL` | optional, nur bei eigener Domain (z. B. `https://checkin.example.de`) |

   Danach einmal neu deployen (*Deploys → Trigger deploy*), damit die Variablen greifen.
4. **Admin-Bereich** öffnen: `https://DEINE-SEITE.netlify.app/admin/`, mit `ADMIN_PASSWORD` anmelden.
5. **Mit Twitch verbinden** klicken und mit dem **Broadcaster-Account** bestätigen. Danach **Rewards & Webhooks abgleichen** klicken. Der Status oben muss vier grüne Punkte zeigen.
6. **OBS**: Browser-Quelle mit `https://DEINE-SEITE.netlify.app/overlay` (1920×1080), „Audio über OBS steuern“ aktivieren.

Der Reward wird von der App angelegt. Gibt es schon einen Reward gleichen Namens, der nicht von dieser App stammt, bitte vorher umbenennen oder löschen. Twitch erlaubt der App nur bei eigenen Rewards, Einlösungen zu bestätigen oder zu erstatten.

## Check-out und Dauer

Neben dem Check-in-Reward gibt es einen zweiten Reward **„Check-out“** (Name, Preis und Texte im Admin einstellbar, abschaltbar). Wer geht, löst ihn ein. Aus Check-in und Check-out ergibt sich die Dauer, die pro Besuch gespeichert wird.

- Im Chat kommt z. B. `👋 Max geht – 2 Std 14 Min dabei gewesen. Bis zum nächsten Mal!` (Platzhalter `{duration}`), und das Overlay zeigt eine Check-out-Karte mit der Dauer auf der Münze.
- **Wer nicht auscheckt**, bekommt den Besuch gezählt, aber keine Dauer. Es gibt bewusst keinen automatischen Check-out, damit niemand Zeit geschenkt bekommt.
- Auschecken geht, solange der Check-in höchstens 24 Stunden her ist, auch über den Tageswechsel hinweg.
- Ohne Check-in oder bei doppeltem Check-out bekommt der Zuschauer einen Hinweis im Chat und seine Punkte zurück.
- Im Admin siehst du Gesamtzeit und Ø Dauer pro Besucher, kannst danach sortieren und im CSV-Export stehen Check-in, Check-out und Minuten.
- **Wichtig nach einem Update:** Einmal im Admin auf „Rewards & Webhooks abgleichen“ klicken, damit der Check-out-Reward angelegt und abonniert wird. Besuche von vor dem Update haben keine Dauer.

## Meilensteine, Streak und Streak-Retter

- **Meilensteine** zählen die **Gesamtbesuche** und gehen nie verloren. Bei den eingestellten Zahlen (Standard 10, 25, 50, 100, 250, 500, 1000) gibt es statt der normalen Karte eine goldene Meilenstein-Karte mit drei großen Feuerwerks-Salven, längerer Anzeigedauer und eigenem Chattext (`{user}` `{count}` `{streak}` `{record}`).
- **Streak** = Stream-Tage in Folge, an denen die Person da war. Ein Stream-Tag ist ein Tag, an dem mindestens eine Person eingecheckt hat; Besuche von früher werden beim ersten Mal automatisch nachgetragen. Die **Schonfrist** (Standard 1) verzeiht so viele verpasste Streams, danach reißt die Streak. Der **Rekord** bleibt erhalten. Auf der Check-in-Karte steht ab 2 Streams „🔥 N Streams in Folge“, im Chat sind `{streak}` und `{record}` nutzbar, im Admin siehst du beides pro Person.
- **Streak-Retter**: ein dritter Kanalpunkte-Reward (Standard „Streak-Retter“, 500 Punkte). Er schließt die jüngste Lücke aus verpassten Streams, wenn sie länger als die Schonfrist, höchstens so lang wie eingestellt (Standard 3 Streams) und nicht älter als 7 Stream-Tage ist. Ist nichts zu retten oder die Lücke zu lang, gibt es einen Hinweis im Chat und die Punkte zurück. Dieselbe Lücke lässt sich nur einmal retten.
- **Nach dem Update:** Einmal auf **Rewards & Webhooks abgleichen** klicken, damit der Streak-Retter-Reward angelegt und abonniert wird.

## Raids: Chat, Shoutout und Clip

Wenn jemand in deinen Kanal raidet, passiert automatisch:
- **Chatnachricht** mit Raider, Zuschauerzahl, zuletzt gespieltem Spiel und Kanallink (Platzhalter `{raider}` `{viewers}` `{game}` `{url}`)
- **Offizieller Twitch-Shoutout** (Karte im Chat). Twitch erlaubt höchstens einen alle 2 Minuten; klappt er nicht, läuft der Rest trotzdem
- **Overlay-Karte** mit Name und Zuschauerzahl, danach spielt ein **zufälliger Clip aus den beliebtesten Clips des Raiders** (einstellbare Höchstlänge, Standard 30 s)

**Raid-Zähler:** Der Bot merkt sich, wie oft ein Kanal schon bei dir geraidet hat, und sagt es im Chat und auf der Overlay-Karte („schon zum 3. Mal bei uns“, Platzhalter `{raids}` und `{visit}`). Twitch liefert keinen Raid-Verlauf, gezählt wird deshalb ab dem ersten empfangenen Raid. Frühere Raids trägst du im Admin unter *Raids → Frühere Raids nachtragen* ein, einzeln oder mehrere auf einmal (eine Zeile pro Kanal, z. B. `kanalname 3`). Die Tabelle *Erfasste Raids* darüber zeigt alle bekannten Kanäle mit Raid-Anzahl, Zuschauern und Quelle (live oder nachgetragen); ein Klick auf eine Zeile übernimmt den Kanal zum Ändern. Der Zähler läuft auch bei ausgeschalteter Raid-Reaktion weiter. Wer den Raid-Text im Admin schon gespeichert hat, muss `{visit}` selbst einfügen, der neue Standardtext gilt nur für ungespeicherte Einstellungen.

Alles ist im Admin unter *Raids* ein- und ausschaltbar, dazu eine Mindestzahl an Raidern. Unter *Tests* gibt es Raid-Tests mit echten Kanaldaten (Shoutouts werden im Test nie ausgelöst).

**Wichtig nach dem Update:** Einmal auf **Mit Twitch verbinden** klicken (neue Berechtigung `moderator:manage:shoutouts`) und danach auf **Rewards & Webhooks abgleichen**, damit der Raid-Webhook (`channel.raid`) angelegt wird. Der Status oben zeigt, falls die Berechtigung noch fehlt.

Hinweise: Der Clip läuft über den offiziellen Twitch-Embed-Player. Clips sind Inhalte des Raiders und seiner Community; wer das nicht möchte, schaltet die Clip-Option aus.

## Kanalpunkte-Soundboard

Im Admin unter *Kanalpunkte-Soundboard* legst du Einträge an. Jeder Eintrag ist ein eigener Kanalpunkte-Reward mit Name, Preis, Abklingzeit, Lautstärke und einer Sounddatei (MP3, WAV oder OGG, höchstens 1,5 MB). Löst ein Zuschauer ihn ein, spielt das Overlay den Sound sofort ab (unabhängig von der Warteschlange der Alerts) und zeigt unten links kurz ein kleines Holz-Schild mit Name und Sound. Optional schreibt der Bot eine Nachricht in den Chat (Platzhalter `{user}` `{title}`).

- **Abklingzeit:** Sie wird von Twitch selbst erzwungen (globale Abklingzeit des Rewards).
- **Einrichten:** Nach dem Anlegen oder Ändern von Name, Preis, Abklingzeit oder „Aktiv“ auf *Rewards mit Twitch abgleichen* klicken (entspricht *Rewards & Webhooks abgleichen*). Einträge ohne Ton oder ohne Haken bei „Aktiv“ werden in Twitch ausgeschaltet. Beim Löschen eines Eintrags wird auch sein Reward in Twitch gelöscht.
- **Namen** müssen auf deinem Kanal eindeutig sein. Gibt es schon einen Reward gleichen Namens, der nicht von dieser App stammt, meldet der Abgleich das.
- **Grenzen:** höchstens 20 Einträge, ein Ton endet nach spätestens 20 Sekunden. Die Töne werden im Overlay vorab geladen, damit sie ohne Verzögerung spielen.
- Ein Soundboard-Reward zählt **nicht** als Check-in.

## Einlaufsound (Kanalpunkte)

Zwei Stufen, beide ohne zweite Währung (nur Kanalpunkte). Einschalten im Admin unter *Einlaufsound*, danach die Rewards abgleichen.

- **Kauf** („Eigener Einlaufsound (6 Monate)“, Standard 75.000 Punkte): Die Einlösung bleibt offen. Die Person meldet sich auf `/einlaufsound` mit Twitch an (ohne Berechtigungen) und lädt ihre Datei hoch. Du hörst sie im Admin an und gibst sie frei, erst dann ist der Kauf abgeschlossen und die Laufzeit beginnt. „Ablehnen und erstatten“ gibt die Punkte zurück, „Ablehnen“ lässt die Person eine andere Datei hochladen. Ohne Upload innerhalb der Frist (14 Tage) gibt es die Punkte automatisch zurück.
- **Verlängern** („Einlaufsound verlängern (+2 Monate)“, Standard 25.000 Punkte): sofort gültig. Die Monate sind anteilig: Verlängern-Preis ÷ Kaufpreis × Kauf-Monate, die genaue Zahl steht automatisch im Reward-Namen. Dabei darf die Person einmal einen neuen Sound hochladen (wieder mit Freigabe). Höchstens 12 Monate Restlaufzeit; ohne Sound oder darüber gibt es einen Chat-Hinweis und die Punkte zurück.
- **Nach Ablauf** spielt wieder der normale Ton. Der Sound bleibt 3 Monate gespeichert und lässt sich in der Zeit verlängern (zählt ab heute), danach wird er gelöscht.
- Das **Overlay** spielt den Sound beim Check-in und schneidet ihn nach 5 Sekunden ab (einstellbar). Die Länge wird auf dem Server nicht ausgelesen, deshalb prüfst du beim Anhören.
- Die Anmeldung der Zuschauer nutzt dieselbe Redirect-URL wie der Admin (`/api/auth/callback`), in der Twitch-App ist nichts Neues einzutragen. Sie braucht `ADMIN_PASSWORD` oder `SESSION_SECRET`, um den Cookie zu signieren.

## Top des Monats: Katalog-Sound (Einlaufsound)

Die Besten der Monatsrangliste suchen sich einen Sound aus deinem Katalog aus. Einschalten im Admin unter *Einlaufsound → Top des Monats* (braucht die aktive Community-Rangliste).

- **Katalog:** Im Admin (*Einlaufsound → Katalog*) legst du höchstens 15 Sounds an (Name und Datei). Sounds ohne Datei erscheinen nicht in der Auswahl.
- **Monatsabschluss:** Ab dem 2. des Folgemonats wird der Vormonat einmalig abgeschlossen, sobald im Chat etwas los ist, jemand eincheckt oder die Seite öffnet (der Admin-Knopf „Vormonat jetzt abschließen“ macht es sofort). Die Top 3 kommen in die Gewinnerliste, **bei Gleichstand auf dem letzten Platz alle mit derselben Punktzahl**. Es erscheinen nur verknüpfte Konten.
- **Auswahl:** Die Gewinner bekommen eine Chat-Nachricht und beim Check-in eine Erinnerung, solange sie nicht gewählt haben. Auf `/einlaufsound` (Twitch-Anmeldung) hören sie die Sounds an und wählen. **7 Tage** Zeit, bis dahin ist Ändern möglich.
- **Hall of Fame im Discord:** `GET /api/community/award` (Bearer `LINK_SECRET`) liefert dem VerwirrBot die jüngste Auswahl: `{ enabled, award: { month, label, deadline, open, url, winners: [{ discordId, name, place, points, chosen, sound }] } }`. `discordId` ist `null`, wenn die Person nicht verknüpft ist. Der Bot kann damit die Gewinner mit `@` erwähnen und vor Fristende an alle mit `chosen: false` erinnern. Die Abfrage schließt den Vormonat bei Bedarf ab (ab dem 2.).
- **Laufzeit:** **1 Monat ab der ersten Auswahl**, Ändern verlängert nichts. Wer nicht wählt, behält den normalen Ton (kein Nachrücken).
- **Vorrang:** Ein gekaufter Einlaufsound geht vor dem Katalog-Sound. Das Overlay schneidet auch Katalog-Sounds nach 5 Sekunden ab.

## Community-Rangliste des Monats und Verknüpfung

Twitch-Chat, Check-ins und Discord (vom VerwirrBot gemeldet) zählen zusammen. **Öffentlich erscheinen nur Konten, die sich selbst verknüpft haben.** Einschalten im Admin unter *Community*, danach die Webhooks abgleichen.

- **Geheimwort:** `LINK_SECRET` in Netlify setzen (langer Zufallstext) und denselben Wert beim VerwirrBot in `data/verwirrbot.env` eintragen. Damit signiert der Bot die Verknüpfungs-Links und meldet sich bei `/api/community/*` an. Ohne das Geheimwort ist alles ausgeschaltet.
- **Verknüpfen:** im Discord `/verknuepfen`, privater Link zu `/verknuepfen`, Anmeldung mit Twitch (ohne Berechtigungen), **ausdrückliche Zustimmung** per Haken. Löschen geht jederzeit auf der Seite, im Discord mit `/verknuepfung_loeschen` oder im Admin.
- **Punkte:** Nachrichten × 1 + aktive Tage × 10 + Check-in-Tage × 20 (alles im Admin einstellbar). Eine Nachricht zählt höchstens alle 60 Sekunden, pro Tag und Plattform höchstens 30. Gezählt wird nur wie viele, nie was geschrieben wird. Der Kanalinhaber und Bots zählen nicht.
- **Anzeige:** `/rangliste` und der Panel-Reiter „Monat“ zeigen die Top-Plätze mit Hinweis, wie man mitmacht. Der Chat-Befehl `!rangliste` zeigt die Top 5 des Monats (und den eigenen Platz, wenn man verknüpft ist), `!verknuepfen` erklärt die Verknüpfung, und wer eincheckt und noch nicht verknüpft ist, bekommt einmal im Monat einen kurzen Tipp.
- **Bot-Schnittstelle:** `GET /api/community/board`, `GET /api/community/link?discordId=…` oder `?twitch=Name` (Discord-Konto zu einem Twitch-Namen), `POST /api/community/sync`, `POST /api/community/bonus`, `POST /api/community/unlink`, `GET /api/community/award` (Bearer `LINK_SECRET`).
- **Bonuspunkte:** Der VerwirrBot schreibt zum Beispiel dem Gewinner des Clips der Woche 40 Punkte für den Monat gut (`{ key, points, reason, discordId | twitch }`). Jeder `key` zählt nur einmal, auch wenn der Bot die Anfrage wiederholt. Die Punkte erscheinen in der Monatsrangliste und zählen für „Top des Monats“. Nicht verknüpfte Konten bekommen nichts (Antwort `{ ok: false, linked: false }`).
- **Clip-Hinweis im Chat:** Teilt jemand einen Clip dieses Kanals im Chat (`clips.twitch.tv/…` oder `twitch.tv/<Kanal>/clip/…`) und der Ersteller ist noch nicht verknüpft, schreibt der Bot **einmal pro Clip** den Hinweis, dass man im Discord ClipMaster werden kann (Einladungslink und `!verknuepfen`). Admin → *Community*: ein/aus, Discord-Einladungslink, Text (`{creator}`, `{user}`, `{discord}`). Zwischen zwei Hinweisen liegen mindestens 20 Sekunden.

## Getrennte Overlays (eigene Lautstärke in OBS)

Neben `/overlay` (alles in einer Quelle) gibt es drei getrennte Browserquellen, damit du Alerts, Soundboard und Einlaufsounds im OBS-Mixer einzeln regeln kannst:

- `/overlay-alerts`: Check-in/-out, Meilenstein, Raid, Follow, Sub, Bits … samt Eigenton; ein Check-in mit Einlaufsound zeigt die Karte, bleibt aber stumm
- `/overlay-sounds`: nur die Kanalpunkte-Sounds des Soundboards (mit kleinem Schild)
- `/overlay-entry`: nur die Einlaufsounds (gekauft oder aus dem Katalog), nacheinander und nach der eingestellten Länge abgeschnitten, ohne Anzeige. Ohne diese Quelle hört man den Einlaufsound nicht.

Alle je als Browserquelle 1920×1080 mit „Audio über OBS steuern“ anlegen, die Adresse `/overlay` dann entfernen (sonst läuft alles doppelt). Die Pegel stellst du im OBS-Audiomixer ein. Alternativ geht `?mode=alerts`, `?mode=sounds` bzw. `?mode=entry` an `/overlay`.

**Nacheinander statt übereinander:** Die Quellen wissen nichts voneinander, deshalb fragen sie vor jedem Ton beim Server an (`/api/playlock`). Es spielt immer nur eine Quelle, die anderen warten in der Reihenfolge, in der ihr Ereignis eingetroffen ist. Kommt also ein Follow-Alert und kurz danach ein Kanalpunkte-Sound, startet der Sound erst, wenn der Alert fertig ist. Sobald ein Ton zu Ende ist, wird die Sperre sofort freigegeben. Ist der Server nicht erreichbar, spielt das Overlay nach spätestens 60 Sekunden trotzdem. Die stumme Karte in `/overlay-alerts` (Check-in mit Einlaufsound) braucht keine Sperre, der Einlaufsound reiht sich dafür selbst ein. Das gilt auch für die Sammel-Adresse `/overlay`.

## Commands und Regeln

Im Admin unter *Commands* legst du eigene Commands an. Jeder hat einen **Auslöser**, eine **Rolle**, eine **Abklingzeit** (für alle zusammen) und **bis zu 6 Aktionen**, die nacheinander laufen:

- **Chat-Text** (Platzhalter `{user}`, `{args}` = Text nach dem Befehl, `{channel}`)
- **Overlay-Alert** (Titel und Text, als Holz-Schild mit dem Alert-Ton der Standardwerte)
- **Sound** aus dem Kanalpunkte-Soundboard (nur Einträge mit Ton)

Auslöser: **Chat-Befehl** (z. B. `!ant`, Rolle: alle, Abonnenten, VIPs, Mods oder nur du; höhere Rollen dürfen auch), **Stichwort** (ganzes Wort irgendwo im Chat; reagiert nie auf deine eigenen Nachrichten, weil der Bot als du schreibt, und nicht auf die Namen aus der Bot-Liste unter *Chat & Abspann*) und **zeitgesteuert**: alle X Minuten, aber nur, wenn seit dem letzten Mal mindestens N Chat-Nachrichten kamen (Bots und du zählen nicht). Ohne neue Nachrichten wird derselbe Alert nicht wiederholt.

Voraussetzungen: *Chat-Befehle* an (sie halten den Chat-Webhook offen), für Chat-Antworten *Chat-Nachrichten* unter *Allgemein*. Der Takt der Timer wird vom Overlay angestoßen (es fragt ohnehin alle 3 Sekunden nach), sie laufen also nur, solange eine Overlay-Quelle in OBS offen ist, und kosten keine zusätzlichen Function-Aufrufe. Mit dem Knopf *Testen* läuft ein Command sofort, ohne Rolle, Abklingzeit und Aktivität. Die Commands stehen auch in der Sicherung.

## Overlay aktualisiert sich selbst

OBS lädt eine Browserquelle nach einem Deploy nicht von selbst neu und zeigt sonst weiter die alte Version. Deshalb vergleicht das Overlay alle 2 Minuten die ausgelieferte Seite mit der geladenen und lädt sich neu, sobald gerade kein Alert läuft. Ein laufender Alert wird nie unterbrochen. Bei der allerersten Version mit dieser Funktion muss die Quelle in OBS einmal von Hand aktualisiert werden (Eigenschaften → „Cache der aktuellen Seite aktualisieren“). Der Abstand lässt sich über `?updatecheck=<ms>` ändern (mindestens 5000).

## Alert-Schilder im Meld-Stil

Alerts (Follow, Sub, Resub, Gift-Subs, Bits, Streak-Rettung) und Raids erscheinen als Holz-Schild: oben ein großes **Bild oder GIF** (Admin → *Medien → Bilder und GIFs*, je Alert eins; ohne Bild sitzt das Lama auf dem Schild), darunter **Titel, Name und Nachricht**. Titel und Nachricht stellst du unter *Alerts → Schilder im Overlay* ein, die Standardtexte entsprechen deinem früheren Meld-Alert („Neuer Follower!“, „Neues Abo! – Tier 1 (6 Monate)“, „Raid-Alarm! – Bringt 42 Leute mit!“, „Neuer Cheer! – 500 Bits“).

- **Anzeigedauer:** 8 s für Alerts, 11 s für Raids (einstellbar). Ist ein hochgeladener Ton länger, bleibt das Schild bis zum Ende des Tons stehen (höchstens 30 s), der Ton wird nie abgeschnitten.
- **Reihenfolge**, wenn mehrere warten: Raid, Sub (auch Resub und Gift), Cheer, Follow, danach Meilenstein, Check-in und Check-out. Zwischen zwei Ereignissen liegt eine kurze Pause von 0,8 s.
- **Look:** Die Schilder haben den Holz-Hintergrund aus deiner Ziel-Badge: Raster und Streifen, dunkler Rand, Schrauben in den Ecken, ein wanderndes Glanz-Lichtspiel und einen goldenen Glow, der aufleuchtet, wenn das Schild aufsetzt. Das steht in `public/overlay.html` unter `.sign .card.panel`.
- **Feuerwerk:** Beim Raid gibt es zusätzliche Salven nach 2,5 s und 5 s.
- **Bilder:** GIF, PNG, JPG oder WebP, höchstens 3 MB, am besten quadratisch (etwa 320 × 320) mit transparentem Hintergrund. Resub nimmt ohne eigenes Bild das Sub-Bild.

## Alerts: Follow, Sub, Gift-Sub, Bits

Im Holz-Look des Overlays, mit eigener Münze je Alert: **Follow**, **Sub/Resub** (mit Monaten und Nachricht), **Gift-Subs** (ein Alert pro Paket, die einzelnen geschenkten Subs werden unterdrückt) und **Bits** (mit Mindestwert und Nachricht). Optional kommt zusätzlich ein Dank im Chat, alle Texte sind anpassbar.

- Alerts sind **standardmäßig aus**. Erst einschalten, wenn ein altes Alert-Tool aus ist, sonst läuft alles doppelt.
- **Prime-Subs** meldet Twitch als normalen Stufe-1-Sub, sie lassen sich nicht getrennt darstellen.
- **Nach dem Update:** **Mit Twitch verbinden** (neue Berechtigungen `moderator:read:followers`, `channel:read:subscriptions`, `bits:read`), Alerts im Admin einschalten, dann **Rewards & Webhooks abgleichen**.
- Tests: Unter *OBS-Overlay* gibt es je einen Test-Button pro Alert; sie ändern nichts und laufen auch bei ausgeschalteten Alerts.

## Admin-Bereich

Der Admin unter `/admin/` ist in Reiter gegliedert. Änderungen an Einstellungen werden gesammelt und mit **einem** Speichern-Knopf unten übernommen (der betroffene Reiter bekommt einen roten Punkt, „Verwerfen“ setzt zurück). Betreffen die Änderungen Rewards oder Webhooks, erscheint ein Hinweis mit dem Knopf „Jetzt abgleichen“.

| Reiter | Inhalt |
|---|---|
| **Start** | Status (Variablen, Twitch-Verbindung, Rewards, Webhooks), „Mit Twitch verbinden“, „Rewards & Webhooks abgleichen“, Überblick, OBS-Adresse |
| **Check-in & Streak** | Check-in, Check-out, Meilensteine, Streak und Streak-Retter mit Namen, Preisen und Chattexten |
| **Alerts** | Follow, Sub, Gift-Subs, Bits: Schalter, Chat-Dank, Schilder (Titel, Nachricht, Dauer) |
| **Raids** | Raid-Reaktion, Shoutout, Clip, Chattext, Schild, Übersicht erfasster Raids, früher erhaltene Raids nachtragen (auch mehrere auf einmal) |
| **Chat & Abspann** | Chat-Befehle `!streak` und `!top`, Abspann-Einstellungen, Rangliste, Links zu Abspann und Rangliste |
| **Soundboard** | Einträge mit Reward, Abklingzeit, Lautstärke und Ton; Chat-Nachricht |
| **Medien** | Töne und Bilder/GIFs je Alert |
| **Besucher** | Suche, Sortierung, Besuchstage mit Dauer, Besuche nachtragen oder entfernen, Nutzer löschen, CSV-Export |
| **Tests** | Beispiel-Ereignisse ans Overlay oder in den Chat, ohne Zähler zu verändern |
| **Allgemein** | Lautstärke, Anzeigedauer, Zeitzone, Tageswechsel, Chat an/aus, Backup & Wiederherstellen |

## Backup & Wiederherstellen

Im Admin unter *Allgemein → Backup & Wiederherstellen* lädst du eine Sicherung als JSON herunter und spielst sie bei Bedarf wieder ein. Sie enthält Besucher (mit Streaks und Dauer), Einstellungen, Soundboard, Raid-Zähler und Reward-IDs. Töne und Bilder sind nur mit „Backup mit Tönen & Bildern“ dabei (bei Netlify begrenzt auf ca. 6 MB je Anfrage). **Die Twitch-Verbindung ist nicht enthalten:** Nach dem Wiederherstellen einmal *Mit Twitch verbinden* und *Rewards & Webhooks abgleichen* klicken. Beim Einspielen wird der aktuelle Stand ersetzt.

## Betrieb auf dem eigenen Server

Vorbereitende Infos für CasaOS (Erreichbarkeit für Twitch, Umzug, offene Punkte) stehen in [`docs/casaos.md`](docs/casaos.md).

## Chat-Befehle, Abspann und Rangliste

Alles im Admin unter *Chat & Abspann*. **Nach dem Update:** einmal **Mit Twitch verbinden** (neue Berechtigungen `user:read:chat`, `user:bot` und `channel:bot`, die Twitch für Chat-Webhooks verlangt) und danach **Rewards & Webhooks abgleichen**, damit der Chat-Webhook (`channel.chat.message`) angelegt wird.

- **`!streak`** antwortet dem Zuschauer mit Besuchen, Streak (Rekord), Gesamtzeit im Stream und Platz in der Rangliste. **`!top`** nennt die Besten nach Besuchen. Befehle, Texte, Anzahl der Plätze und die Abklingzeit (gilt je Befehl für den ganzen Chat, Standard 10 s) sind einstellbar. Bei ausgeschaltetem Chat (*Allgemein*) schweigt der Bot.
- **Abspann** (`/abspann`): Der Bot merkt sich pro Stream-Tag, wer geschrieben (**Chatter**), gefolgt, abonniert (inkl. Resub-Monate), Subs verschenkt, Bits geschickt oder geraidet hat – **auch bei ausgeschalteten Alerts**. Die Namen laufen als Scrolltext durch, am Ende bleibt die Schlusszeile stehen. In OBS legst du dafür eine eigene Szene „Stream-Ende“ an (Browserquelle 1920×1080 auf `https://DEINE-SEITE.netlify.app/abspann`, „Browser aktualisieren, wenn Szene aktiv wird“ einschalten). Bots (Nightbot & Co.) und dein eigener Name werden ausgelassen, die Liste lässt sich ändern. Ohne Hintergrund: `?transparent`, anderes Tempo: `?speed=100`, früherer Stream-Tag: `?day=2026-10-28`, Vorschau mit Beispieldaten: `?demo`.
  Der Abspann läuft bewusst als Szene und nicht als Alert: Twitch meldet „Stream beendet“ erst, wenn dein Encoder schon aus ist, die Zuschauer sähen die Karte dann nicht mehr.
- **Rangliste** (`/rangliste`): öffentliche Seite mit **Anwesenden** (Besuche), **Chattern** (Nachrichten), aktueller Streak, Streak-Rekord und Zeit im Stream (nur Namen und Zahlen, einmal pro Minute zwischengespeichert, abschaltbar). Die Chat-Zählung beginnt beim Einschalten von *Chat-Nachrichten zählen*, dein Name und Bots zählen nicht. Als OBS-Browserquelle geht `/rangliste?overlay` (transparent, ohne Kopf).
- **Twitch-Panel:** Normale Panels zeigen nur ein festes Bild mit Link. Sofort geht ein Panel mit **Link** auf `/rangliste`. Live im Panel zeigt die **Panel-Extension** (`extension/`, fertiges Zip unter `/stadtwache-panel.zip`) die Plätze in vier Reitern (Besuche, Chat, Streaks, Monat). Im Teststatus sehen nur du und Testkonten sie, für alle Zuschauer braucht sie die Twitch-Prüfung. Anleitung: [`docs/twitch-panel.md`](docs/twitch-panel.md). Bei eigener Adresse: `npm run build:extension -- https://deine-adresse.de`.
- **Kosten:** Jede Chatnachricht ist ein Function-Aufruf auf Netlify. Bei sehr aktivem Chat steigt der Verbrauch deutlich. Wer das nicht möchte, schaltet *Chat-Befehle*, *Abspann* und *Chat-Nachrichten zählen* aus und gleicht die Webhooks ab, dann wird der Chat-Webhook wieder entfernt.

## Projektaufbau

```
netlify/functions/   Eingänge (je Datei eine URL): admin, auth, overlay, sound, image, soundboard, einlaufsound, verknuepfen, community, credits, leaderboard, twitch-webhook
netlify/lib/         Logik: checkin, streak, raid, alerts, chat, credits, soundboard, entrysound, award, community, settings, twitch, store, http …
netlify/lib/admin/   Bereiche der Admin-API: status, config, setup, tests, raids, media, soundboard, entrysound, users, backup
public/overlay.html  OBS-Overlay (Karten, Schilder, Soundboard, Selbst-Update)
public/abspann.html  Abspann-Szene, public/rangliste.html öffentliche Rangliste, public/einlaufsound.html Upload-Seite, public/verknuepfen.html Verknüpfung
extension/           Twitch-Panel-Extension (Quelltext), scripts/build-extension.mjs baut daraus public/stadtwache-panel.zip
public/admin/        Admin-Oberfläche: index.html (Gerüst), admin.css, js/ (ein Skript je Bereich)
test/run.mjs         Tests der Functions mit simuliertem Twitch (npm test)
test/e2e/admin.mjs   Ende-zu-Ende-Test der Admin-Oberfläche im Browser (optional, braucht Playwright)
```

- **Neues Einstellungsfeld:** Standardwert und Prüfung in `netlify/lib/settings.mjs`, Formularfeld in `public/admin/js/schema.js`. Mehr nicht, Formular, Speichern und Vorschau entstehen daraus.
- **Neue Admin-Route:** Datei in `netlify/lib/admin/` anlegen und in `netlify/functions/admin.mjs` in die Tabelle `ROUTES` eintragen.
- **Ende-zu-Ende-Test:** `NODE_PATH=$(npm root -g) node test/e2e/admin.mjs` (Playwright muss installiert sein). Er startet die echten Functions lokal mit simuliertem Twitch und klickt die Oberfläche durch.

## Look

Zwei Stile: **Overlay und Abspann** (Stream-Grafiken) nutzen den Holz-Look aus `public/theme.css`. **Admin, Rangliste, Einlaufsound-Seite und Twitch-Panel** haben das Design des VerwirrBot-Dashboards (Marineblau mit gelbem Akzent, Silkscreen-Überschriften, Karten, Seitenleiste am PC, Hell/Dunkel-Schalter 🌓): gemeinsame Basis `public/stadtwache.css`, Schalter in `public/thema.js`, Admin-Besonderheiten in `public/admin/admin.css`, Panel in `extension/panel.css`.

- **Grafiken**: `public/img/lantern.png` (Laterne) und `public/img/lama.png` (Maskottchen) stammen aus deinen Streamplan-Assets. Einfach durch gleichnamige PNGs mit transparentem Hintergrund ersetzen.
- **Töne pro Alert**: Im Admin unter *Medien → Töne* hat jeder Alert (Check-in, Check-out, Meilenstein, Raid, Follow, Sub, Resub, Gift-Subs, Bits, Streak-Rettung) einen eigenen Platz für eine Sounddatei (MP3, WAV oder OGG, höchstens 1,5 MB). Sie gilt im Overlay nach wenigen Sekunden, ohne Neuladen. Fehlt eine eigene Datei, spielt das Overlay einen eingebauten Klang, der je Alert anders klingt (Horn beim Raid, Münze bei Bits, Glitzern bei Gift-Subs …). Check-out und Meilenstein nehmen ohne eigene Datei den Check-in-Ton, Resub den Sub-Ton. Beim Check-in gilt die Reihenfolge: hochgeladener Ton, `public/checkin.mp3` (falls vorhanden), eingebauter Klang. Bereits hochgeladene Check-in-Töne bleiben erhalten.
- **Look ansehen**: `/overlay?demo` zeigt alle paar Sekunden eine Beispielkarte, ohne dass ein Check-in nötig ist.

## Hinweise

- **Overlay-Abfragen**: Netlify hält keine Dauerverbindungen, das Overlay fragt deshalb alle 3 Sekunden nach (`?poll=5000` ändert das). Jeder Abruf ist ein Function-Aufruf. Bei sehr langen Streams im Free-Tier bitte das Kontingent im Blick behalten.
- **Twitch-Token** liegen in Netlify Blobs. Der Zugriff darauf ist nur über die Functions möglich.
- **Tests**: `npm test` spielt Webhook, Zählung, Duplikate, Overlay und Admin-Rechte mit simulierter Twitch-API durch.
- **Lokal** läuft das Ganze mit `npx netlify dev`. Dafür muss in der Twitch-App zusätzlich `http://localhost:8888/api/auth/callback` als Redirect URL stehen. Webhooks von Twitch erreichen deinen Rechner dabei nicht.
