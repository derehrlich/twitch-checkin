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

## Admin-Bereich

- **Status** zeigt, ob Variablen, Twitch-Verbindung, Reward und Webhook in Ordnung sind
- **Einstellungen**: Chattexte (`{user}`, `{count}`), Rewardname und -preis, Lautstärke, Anzeigedauer, Zeitzone, Tageswechsel
- **Tests**: Overlay und Chat testen, ohne Zähler zu verändern
- **Ton**: eigene Sounddatei hochladen, anhören, zurücksetzen
- **Besucher**: Suche, Sortierung (Besuche, Gesamtzeit, Ø Dauer), Besuchstage mit Dauer ansehen, Besuche nachtragen oder entfernen, Nutzer löschen, CSV-Export

## Look

Overlay und Admin teilen sich den Holz-Look aus `public/theme.css`: Holz mit Maserung, Pergamentkarten, Messing-Nieten und weiche Schatten. Die Farben stehen als Variablen oben im File. Schriften: Fredoka und Pixelify Sans (nur für den Schriftzug), beide frei lizenziert und in `public/fonts/` abgelegt.

- **Grafiken**: `public/img/lantern.png` (Laterne) und `public/img/lama.png` (Maskottchen) stammen aus deinen Streamplan-Assets. Einfach durch gleichnamige PNGs mit transparentem Hintergrund ersetzen.
- **Eigener Sound**: Im Admin unter *OBS-Overlay → Ton* hochladen (MP3, WAV oder OGG, höchstens 1,5 MB). Er gilt im Overlay nach wenigen Sekunden, ohne Neuladen. Mit „Eingebauten Ton verwenden“ kommt wieder das Glockenspiel. Reihenfolge: hochgeladener Ton, dann `public/checkin.mp3` (falls vorhanden), dann das Glockenspiel.
- **Look ansehen**: `/overlay?demo` zeigt alle paar Sekunden eine Beispielkarte, ohne dass ein Check-in nötig ist.

## Hinweise

- **Overlay-Abfragen**: Netlify hält keine Dauerverbindungen, das Overlay fragt deshalb alle 3 Sekunden nach (`?poll=5000` ändert das). Jeder Abruf ist ein Function-Aufruf. Bei sehr langen Streams im Free-Tier bitte das Kontingent im Blick behalten.
- **Twitch-Token** liegen in Netlify Blobs. Der Zugriff darauf ist nur über die Functions möglich.
- **Tests**: `npm test` spielt Webhook, Zählung, Duplikate, Overlay und Admin-Rechte mit simulierter Twitch-API durch.
- **Lokal** läuft das Ganze mit `npx netlify dev`. Dafür muss in der Twitch-App zusätzlich `http://localhost:8888/api/auth/callback` als Redirect URL stehen. Webhooks von Twitch erreichen deinen Rechner dabei nicht.
