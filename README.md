# Twitch Kanalpunkte Check-in (Netlify)

Zuschauer lösen einen Kanalpunkte-Reward ein und werden damit für den Stream eingecheckt. Der Bot läuft komplett auf Netlify und wird über den Browser verwaltet (`/admin/`).

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
5. **Mit Twitch verbinden** klicken und mit dem **Broadcaster-Account** bestätigen. Danach **Reward & Webhook einrichten** klicken. Der Status oben muss vier grüne Punkte zeigen.
6. **OBS**: Browser-Quelle mit `https://DEINE-SEITE.netlify.app/overlay` (1920×1080), „Audio über OBS steuern“ aktivieren.

Der Reward wird von der App angelegt. Gibt es schon einen Reward gleichen Namens, der nicht von dieser App stammt, bitte vorher umbenennen oder löschen. Twitch erlaubt der App nur bei eigenen Rewards, Einlösungen zu bestätigen oder zu erstatten.

## Check-out und Dauer

Neben dem Check-in-Reward gibt es einen zweiten Reward **„Check-out“** (Name, Preis und Texte im Admin einstellbar, abschaltbar). Wer geht, löst ihn ein. Aus Check-in und Check-out ergibt sich die Dauer, die pro Besuch gespeichert wird.

- Im Chat kommt z. B. `👋 Max geht – 2 Std 14 Min dabei gewesen. Bis zum nächsten Mal!` (Platzhalter `{duration}`), und das Overlay zeigt eine Check-out-Karte mit der Dauer auf der Münze.
- **Wer nicht auscheckt**, bekommt den Besuch gezählt, aber keine Dauer. Es gibt bewusst keinen automatischen Check-out, damit niemand Zeit geschenkt bekommt.
- Auschecken geht, solange der Check-in höchstens 24 Stunden her ist, auch über den Tageswechsel hinweg.
- Ohne Check-in oder bei doppeltem Check-out bekommt der Zuschauer einen Hinweis im Chat und seine Punkte zurück.
- Im Admin siehst du Gesamtzeit und Ø Dauer pro Besucher, kannst danach sortieren und im CSV-Export stehen Check-in, Check-out und Minuten.
- **Wichtig nach einem Update:** Einmal im Admin auf „Reward & Webhook einrichten“ klicken, damit der Check-out-Reward angelegt und abonniert wird. Besuche von vor dem Update haben keine Dauer.

## Meilensteine, Streak und Streak-Retter

- **Meilensteine** zählen die **Gesamtbesuche** und gehen nie verloren. Bei den eingestellten Zahlen (Standard 10, 25, 50, 100, 250, 500, 1000) gibt es statt der normalen Karte eine goldene Meilenstein-Karte mit drei großen Feuerwerks-Salven, längerer Anzeigedauer und eigenem Chattext (`{user}` `{count}` `{streak}` `{record}`).
- **Streak** = Stream-Tage in Folge, an denen die Person da war. Ein Stream-Tag ist ein Tag, an dem mindestens eine Person eingecheckt hat; Besuche von früher werden beim ersten Mal automatisch nachgetragen. Die **Schonfrist** (Standard 1) verzeiht so viele verpasste Streams, danach reißt die Streak. Der **Rekord** bleibt erhalten. Auf der Check-in-Karte steht ab 2 Streams „🔥 N Streams in Folge“, im Chat sind `{streak}` und `{record}` nutzbar, im Admin siehst du beides pro Person.
- **Streak-Retter**: ein dritter Kanalpunkte-Reward (Standard „Streak-Retter“, 500 Punkte). Er schließt die jüngste Lücke aus verpassten Streams, wenn sie länger als die Schonfrist, höchstens so lang wie eingestellt (Standard 3 Streams) und nicht älter als 7 Stream-Tage ist. Ist nichts zu retten oder die Lücke zu lang, gibt es einen Hinweis im Chat und die Punkte zurück. Dieselbe Lücke lässt sich nur einmal retten.
- **Nach dem Update:** Einmal auf **Reward & Webhook einrichten** klicken, damit der Streak-Retter-Reward angelegt und abonniert wird.

## Raids: Chat, Shoutout und Clip

Wenn jemand in deinen Kanal raidet, passiert automatisch:
- **Chatnachricht** mit Raider, Zuschauerzahl, zuletzt gespieltem Spiel und Kanallink (Platzhalter `{raider}` `{viewers}` `{game}` `{url}`)
- **Offizieller Twitch-Shoutout** (Karte im Chat). Twitch erlaubt höchstens einen alle 2 Minuten; klappt er nicht, läuft der Rest trotzdem
- **Overlay-Karte** mit Name und Zuschauerzahl, danach spielt ein **zufälliger Clip aus den beliebtesten Clips des Raiders** (einstellbare Höchstlänge, Standard 30 s)

**Raid-Zähler:** Der Bot merkt sich, wie oft ein Kanal schon bei dir geraidet hat, und sagt es im Chat und auf der Overlay-Karte („schon zum 3. Mal bei uns“, Platzhalter `{raids}` und `{visit}`). Twitch liefert keinen Raid-Verlauf, gezählt wird deshalb ab dem ersten empfangenen Raid. Frühere Raids trägst du im Admin unter *Raids → Frühere Raids nachtragen* ein. Der Zähler läuft auch bei ausgeschalteter Raid-Reaktion weiter. Wer den Raid-Text im Admin schon gespeichert hat, muss `{visit}` selbst einfügen, der neue Standardtext gilt nur für ungespeicherte Einstellungen.

Alles ist im Admin unter *Einstellungen → Raids* ein- und ausschaltbar, dazu eine Mindestzahl an Raidern. Unter *OBS-Overlay* gibt es Raid-Tests mit echten Kanaldaten (Shoutouts werden im Test nie ausgelöst).

**Wichtig nach dem Update:** Einmal auf **Mit Twitch verbinden** klicken (neue Berechtigung `moderator:manage:shoutouts`) und danach auf **Reward & Webhook einrichten**, damit der Raid-Webhook (`channel.raid`) angelegt wird. Der Status oben zeigt, falls die Berechtigung noch fehlt.

Hinweise: Der Clip läuft über den offiziellen Twitch-Embed-Player. Clips sind Inhalte des Raiders und seiner Community; wer das nicht möchte, schaltet die Clip-Option aus.

## Alert-Schilder im Meld-Stil

Alerts (Follow, Sub, Resub, Gift-Subs, Bits, Streak-Rettung) und Raids erscheinen als Holz-Schild: oben ein großes **Bild oder GIF** (Admin → *OBS-Overlay → Bilder & GIFs*, je Alert eins; ohne Bild sitzt das Lama auf dem Schild), darunter **Titel, Name und Nachricht**. Titel und Nachricht stellst du unter *Einstellungen → Alert-Schilder im Overlay* ein, die Standardtexte entsprechen deinem früheren Meld-Alert („Neuer Follower!“, „Neues Abo! – Tier 1 (6 Monate)“, „Raid-Alarm! – Bringt 42 Leute mit!“, „Neuer Cheer! – 500 Bits“).

- **Anzeigedauer:** 8 s für Alerts, 11 s für Raids (einstellbar). Ist ein hochgeladener Ton länger, bleibt das Schild bis zum Ende des Tons stehen (höchstens 30 s), der Ton wird nie abgeschnitten.
- **Reihenfolge**, wenn mehrere warten: Raid, Sub (auch Resub und Gift), Cheer, Follow, danach Meilenstein, Check-in und Check-out. Zwischen zwei Ereignissen liegt eine kurze Pause von 0,8 s.
- **Look:** Die Schilder haben den Holz-Hintergrund aus deiner Ziel-Badge: Raster und Streifen, dunkler Rand, Schrauben in den Ecken, ein wanderndes Glanz-Lichtspiel und einen goldenen Glow, der aufleuchtet, wenn das Schild aufsetzt. Das steht in `public/overlay.html` unter `.sign .card.panel`.
- **Feuerwerk:** Beim Raid gibt es zusätzliche Salven nach 2,5 s und 5 s.
- **Bilder:** GIF, PNG, JPG oder WebP, höchstens 3 MB, am besten quadratisch (etwa 320 × 320) mit transparentem Hintergrund. Resub nimmt ohne eigenes Bild das Sub-Bild.

## Alerts: Follow, Sub, Gift-Sub, Bits

Im Holz-Look des Overlays, mit eigener Münze je Alert: **Follow**, **Sub/Resub** (mit Monaten und Nachricht), **Gift-Subs** (ein Alert pro Paket, die einzelnen geschenkten Subs werden unterdrückt) und **Bits** (mit Mindestwert und Nachricht). Optional kommt zusätzlich ein Dank im Chat, alle Texte sind anpassbar.

- Alerts sind **standardmäßig aus**. Erst einschalten, wenn ein altes Alert-Tool aus ist, sonst läuft alles doppelt.
- **Prime-Subs** meldet Twitch als normalen Stufe-1-Sub, sie lassen sich nicht getrennt darstellen.
- **Nach dem Update:** **Mit Twitch verbinden** (neue Berechtigungen `moderator:read:followers`, `channel:read:subscriptions`, `bits:read`), Alerts im Admin einschalten, dann **Reward & Webhook einrichten**.
- Tests: Unter *OBS-Overlay* gibt es je einen Test-Button pro Alert; sie ändern nichts und laufen auch bei ausgeschalteten Alerts.

## Admin-Bereich

- **Status** zeigt, ob Variablen, Twitch-Verbindung, Reward und Webhook in Ordnung sind
- **Einstellungen**: Chattexte (`{user}`, `{count}`), Rewardname und -preis, Lautstärke, Anzeigedauer, Zeitzone, Tageswechsel
- **Tests**: Overlay und Chat testen, ohne Zähler zu verändern
- **Ton**: eigene Sounddatei hochladen, anhören, zurücksetzen
- **Besucher**: Suche, Sortierung (Besuche, Gesamtzeit, Ø Dauer), Besuchstage mit Dauer ansehen, Besuche nachtragen oder entfernen, Nutzer löschen, CSV-Export

## Look

Overlay und Admin teilen sich den Holz-Look aus `public/theme.css`: Holz mit Maserung, Pergamentkarten, Messing-Nieten und weiche Schatten. Die Farben stehen als Variablen oben im File. Schriften: Fredoka und Pixelify Sans (nur für den Schriftzug), beide frei lizenziert und in `public/fonts/` abgelegt.

- **Grafiken**: `public/img/lantern.png` (Laterne) und `public/img/lama.png` (Maskottchen) stammen aus deinen Streamplan-Assets. Einfach durch gleichnamige PNGs mit transparentem Hintergrund ersetzen.
- **Töne pro Alert**: Im Admin unter *OBS-Overlay → Töne* hat jeder Alert (Check-in, Check-out, Meilenstein, Raid, Follow, Sub, Resub, Gift-Subs, Bits, Streak-Rettung) einen eigenen Platz für eine Sounddatei (MP3, WAV oder OGG, höchstens 1,5 MB). Sie gilt im Overlay nach wenigen Sekunden, ohne Neuladen. Fehlt eine eigene Datei, spielt das Overlay einen eingebauten Klang, der je Alert anders klingt (Horn beim Raid, Münze bei Bits, Glitzern bei Gift-Subs …). Check-out und Meilenstein nehmen ohne eigene Datei den Check-in-Ton, Resub den Sub-Ton. Beim Check-in gilt die Reihenfolge: hochgeladener Ton, `public/checkin.mp3` (falls vorhanden), eingebauter Klang. Bereits hochgeladene Check-in-Töne bleiben erhalten.
- **Look ansehen**: `/overlay?demo` zeigt alle paar Sekunden eine Beispielkarte, ohne dass ein Check-in nötig ist.

## Hinweise

- **Overlay-Abfragen**: Netlify hält keine Dauerverbindungen, das Overlay fragt deshalb alle 3 Sekunden nach (`?poll=5000` ändert das). Jeder Abruf ist ein Function-Aufruf. Bei sehr langen Streams im Free-Tier bitte das Kontingent im Blick behalten.
- **Twitch-Token** liegen in Netlify Blobs. Der Zugriff darauf ist nur über die Functions möglich.
- **Tests**: `npm test` spielt Webhook, Zählung, Duplikate, Overlay und Admin-Rechte mit simulierter Twitch-API durch.
- **Lokal** läuft das Ganze mit `npx netlify dev`. Dafür muss in der Twitch-App zusätzlich `http://localhost:8888/api/auth/callback` als Redirect URL stehen. Webhooks von Twitch erreichen deinen Rechner dabei nicht.
