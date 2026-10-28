# Twitch Kanalpunkte Check-in

Zuschauer lösen einen Kanalpunkte-Reward ein und werden damit für den Stream "eingecheckt".

Pro Check-in passiert Folgendes:
- **Chatnachricht**, z. B. `✅ Max ist eingecheckt – du warst jetzt schon 7x dabei! 🎉`
- **Ton und Animation** im OBS-Overlay (Karte mit Konfetti)
- **Logging im Hintergrund**: Datum und Zeit werden pro User in `data/checkins.json` gespeichert

Ein Check-in zählt **einmal pro Stream-Tag**. Der Tag wechselt um 5 Uhr, damit Streams nach Mitternacht nicht doppelt zählen. Löst jemand den Reward am selben Tag ein zweites Mal ein, schreibt der Bot eine kurze Info in den Chat und erstattet die Punkte zurück. Weil gezählt wird, an wie vielen Tagen jemand da war, ist es egal, wenn die Streamserie mal abreißt.

## Einrichtung

1. **Twitch-App anlegen** unter <https://dev.twitch.tv/console/apps>:
   - OAuth Redirect URL: `http://localhost:3000/auth/callback`
   - Kategorie: Chat Bot oder Application Integration, Client Type: **Confidential**
   - Client ID und Client Secret notieren
2. **Konfiguration**: `cp .env.example .env` und Client ID und Secret eintragen.
3. **Starten** (Node 22 oder neuer):
   ```bash
   npm start
   ```
4. **Einmal anmelden**: <http://localhost:3000/auth/login> öffnen und mit dem **Broadcaster-Account** bestätigen. Die Tokens landen in `data/tokens.json` und werden automatisch erneuert.
   Beim Anmelden bekommt die App diese Rechte: Kanalpunkte lesen und verwalten sowie Chat schreiben.
5. Beim Start wird der Reward **"Check-in"** automatisch angelegt, falls er noch nicht existiert. Name und Preis stehen in `.env`.
   Der Reward muss von dieser App angelegt worden sein, sonst darf sie die Einlösung nicht auf "erfüllt" oder "erstattet" setzen. Einen bereits vorhandenen Reward gleichen Namens musst du deshalb vorher löschen oder umbenennen.
6. **OBS**: Quelle hinzufügen, Typ *Browser*, URL `http://localhost:3000/overlay`, Breite 1920, Höhe 1080.
   Für den Ton im Browser-Source "Audio über OBS steuern" aktivieren.

## Anpassen

| Was | Wie |
|---|---|
| Chattext | `CHAT_TEMPLATE` in `.env`, Platzhalter `{user}` und `{count}` |
| Eigener Sound | Datei als `public/checkin.mp3` ablegen (sonst gibt es einen eingebauten Ton) |
| Lautstärke und Dauer | Overlay-URL, z. B. `/overlay?volume=0.4&duration=6000` |
| Optik | `public/overlay.html` (CSS oben) |

## Testen ohne Twitch

Mit laufendem Server und geöffnetem Overlay löst das einen Check-in aus. Chat und Twitch werden dabei nicht angesprochen, aber der Zähler wird erhöht:

```bash
curl "http://localhost:3000/test?user=Max"
```

Testdaten kannst du danach aus `data/checkins.json` löschen.

## Daten

- `data/checkins.json` enthält alle User mit Anzahl, erstem und letztem Besuch und der Liste der Besuchstage.
- <http://localhost:3000/api/users> liefert die Rangliste als JSON.
- <http://localhost:3000/api/export.csv> liefert alle Check-ins als CSV.

## Hinweise

- Der Server lauscht nur auf `127.0.0.1` und muss auf dem Rechner laufen, auf dem auch OBS läuft.
- `.env` und `data/` enthalten Secrets und Nutzerdaten und gehören nicht in ein öffentliches Repo (sind in `.gitignore`).
- Die Verbindung zu Twitch läuft über EventSub per WebSocket. Dafür brauchst du weder eine öffentliche URL noch ein Port-Forwarding.
