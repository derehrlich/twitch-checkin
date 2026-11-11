# Stadtwache auf dem eigenen CasaOS-Server

Die Stadtwache läuft zu Hause auf dem NAS (früher auch auf Netlify). Der Code ist derselbe: `server.mjs` lädt die vorhandenen Functions, liefert `public/` aus und speichert die Daten in einem Ordner (`/data`). Gebaut wird ein Docker-Image (`Dockerfile`), das die GitHub Action `docker-image.yml` nach `ghcr.io/derehrlich/twitch-checkin` legt.

Warum zu Hause: Das Overlay fragt alle 3 Sekunden nach. Auf Netlify zählt jede Abfrage gegen das Kontingent, zu Hause kostet sie nichts.

## Wie alles zusammenhängt

```
Twitch / OBS / Zuschauer ──https──> Cloudflare ──Tunnel──> cloudflared (NAS) ──> Stadtwache (Port 3000)
```

Es wird nichts im Router freigegeben. Der Tunnel baut die Verbindung von innen nach außen auf.

## Was du vorher brauchst

- Domain bei Cloudflare mit Status „Aktiv" (z. B. `ehrlichverwirrt.de`), darunter die Adresse `wache.ehrlichverwirrt.de`.
- Cloudflare Tunnel (`cloudflared`) auf dem NAS.
- Backup der Netlify-Version: Admin → *System → Backup & Wiederherstellen* → „Backup herunterladen" (am besten **mit Tönen & Bildern**). **Das zuerst machen, solange Netlify noch läuft.**
- Deine Werte: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `EVENTSUB_SECRET`, `ADMIN_PASSWORD`, `LINK_SECRET`. Netlify zeigt als „secret" gespeicherte Werte nicht mehr an, du holst sie so:
  - `TWITCH_CLIENT_ID`: Twitch-Entwicklerkonsole (nicht geheim). `TWITCH_CLIENT_SECRET`: dort „Neues Geheimnis" erzeugen (das alte wird dann ungültig, also das neue auch in Netlify eintragen, solange Netlify noch läuft).
  - `EVENTSUB_SECRET`: frei ausdenken (10 bis 100 Zeichen, nur Buchstaben und Zahlen). Er muss nicht gleich bleiben, denn die Webhooks werden für die neue Adresse ohnehin neu angelegt (Admin → *Rewards & Webhooks abgleichen*).
  - `ADMIN_PASSWORD`: neues langes Passwort.
  - `LINK_SECRET`: aus `data/verwirrbot.env` des VerwirrBot auf dem NAS übernehmen, dann ändert sich am VerwirrBot nichts.

## Schritt 1: Image bereitstellen (einmalig)

1. Den Branch in `main` mergen (oder in GitHub unter *Actions → Docker-Image → Run workflow* den Branch von Hand bauen lassen).
2. Nach dem ersten Lauf: GitHub → dein Profil → *Packages* → `twitch-checkin` → *Package settings* → **Change visibility → Public**. Sonst kann CasaOS das Image nicht laden.

## Schritt 2: In CasaOS installieren

1. CasaOS → App-Store → **Benutzerdefinierte App installieren** (oben rechts) → Compose-Datei einfügen (Inhalt von `docker-compose.yml`).
2. Die Werte `HIER_…` ersetzen und `SITE_URL` auf deine Adresse stellen (mit `https://`, ohne Schrägstrich am Ende).
3. Installieren. Die Daten liegen danach in `/DATA/AppData/stadtwache/data`. Diesen Ordner **nie überschreiben** und in dein NAS-Backup aufnehmen.
4. Test im Heimnetz: `http://192.168.178.144:3000/admin/` öffnen und mit dem Admin-Passwort anmelden.

## Schritt 3: Daten übernehmen

1. Im neuen Admin: *System → Backup & Wiederherstellen → Wiederherstellen* (die Datei von Netlify).
2. **Mit Twitch verbinden.** Tokens sind nie im Backup. Das geht erst, wenn die Redirect-URL aus Schritt 4 in der Twitch-App steht.

## Schritt 4: Tunnel und Twitch

1. Cloudflare → Zero Trust → Netzwerke → Tunnels → dein Tunnel → *Public Hostname* hinzufügen:
   - Subdomain `wache`, Domain `ehrlichverwirrt.de`
   - Typ `HTTP`, URL `192.168.178.144:3000`
2. Twitch-Entwicklerkonsole (<https://dev.twitch.tv/console/apps>) → deine App → **OAuth Redirect URL** ergänzen: `https://wache.ehrlichverwirrt.de/api/auth/callback`. Die alte Netlify-Adresse kann vorerst stehen bleiben.
3. Admin (jetzt unter der neuen Adresse) → mit Twitch verbinden → **Rewards & Webhooks abgleichen**. Der Status oben muss grün sein.
4. OBS: Browserquellen auf die neue Adresse umstellen (`https://wache.ehrlichverwirrt.de/overlay` usw.). Das Twitch-Panel (Erweiterung) ebenfalls, falls es die Adresse enthält.
5. **VerwirrBot-Dashboard:** Die Adresse der Stadtwache auf die neue ändern.

## Schritt 5: Netlify abschalten

Erst wenn alles läuft und ein Test-Check-in angekommen ist: Netlify-Seite pausieren oder löschen. Läuft beides gleichzeitig, wird ein Ereignis an zwei Orte geliefert und ein Check-in könnte doppelt gezählt werden.

## Admin-Bereich zusätzlich schützen (Cloudflare Access)

Cloudflare → Zero Trust → Access → Anwendungen → *Selbst gehostet*: Anwendung für `wache.ehrlichverwirrt.de` mit den Pfaden **`/admin`** und **`/api/admin`**, Regel „Erlauben, wenn E-Mail = deine Adresse". Alles andere **nicht** in die Regel aufnehmen, sonst brechen Twitch-Webhooks (`/api/twitch-webhook`), Anmeldung (`/api/auth/*`), Overlay, Rangliste und der VerwirrBot (`/api/community/*`).

## Betrieb

- **Update per Knopf:** Im Admin unter *System → Updates* steht die laufende Version und der Knopf **„Auf Updates prüfen“**. Er bittet Watchtower, nachzusehen, ob nach einem Merge in `main` ein neues Image da ist. Wenn ja, lädt Watchtower es und startet die Stadtwache neu (die Seite ist etwa eine halbe Minute weg, die Daten bleiben). Wenn nein, steht dort „Bereits aktuell“.
  - **Einmalig einrichten:** 1. Ein langes Geheimwort ausdenken (Buchstaben und Zahlen). 2. In CasaOS die App aus `docker-compose.watchtower.yml` installieren, `HIER_UPDATE_SCHLUESSEL` durch das Geheimwort ersetzen. 3. In der Stadtwache-App `WATCHTOWER_TOKEN` auf dasselbe Geheimwort setzen und `WATCHTOWER_URL` auf `http://<NAS-Adresse>:8081`. 4. Watchtower findet die Stadtwache über ihren Namen (`stadtwache`, siehe `command` in `docker-compose.watchtower.yml`). Heißt deine App anders, den Namen dort anpassen. Steht im Protokoll (`docker logs watchtower`) `scanned=0`, hat es keinen Container gefunden.
  - Die Version kommt aus dem Bau des Images (`BUILD_SHA`, gesetzt von der GitHub Action). Nach einem Merge dauert der Bau etwa eine Minute, erst danach findet der Knopf etwas Neues.
- **Update von Hand** (falls der Knopf nicht geht): per SSH `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/nicholas-fedor/watchtower:latest --run-once --cleanup stadtwache`.
- **Server war aus:** Nach einem längeren Ausfall kann Twitch die Webhooks abgeschaltet haben. Admin → **Rewards & Webhooks abgleichen**.
- **Gesundheit:** `/healthz` antwortet mit `ok`; Docker prüft das selbst.
- **Automatische Sicherung:** Jede Nacht ab 3 Uhr (einstellbar im Admin unter *System → Automatische Sicherung*) legt die Stadtwache eine Datei `stadtwache-JJJJ-MM-TT.json` im Backup-Ordner ab, mit Tönen und Bildern, und hebt die letzten 7 auf. Im Admin unter *System → Backup & Wiederherstellen* siehst du die letzte Sicherung und kannst mit „Jetzt sichern“ eine auslösen. **Der Ordner sollte auf einem anderen Gerät liegen**, zum Beispiel einer Freigabe deines NAS: In CasaOS unter *Dateien → Netzwerk → Freigabe hinzufügen* verbinden (sie erscheint dann unter `/media/<Name>`), dann in der Stadtwache-App beim Speicher `/DATA/AppData/stadtwache/backups` durch den Ordner auf der Freigabe ersetzen (rechts steht weiter `:/backups`). Zurückspielen: Datei im Admin bei *Wiederherstellen* auswählen.
- **Sicherung:** Der Ordner `/DATA/AppData/stadtwache/data` enthält auch die Twitch-Tokens (Dateirechte nur für den Besitzer). Nicht öffentlich teilen. Das Admin-Backup enthält sie nicht.

## Lokal ausprobieren (Entwickler)

```
npm ci
ADMIN_PASSWORD=test SITE_URL=http://localhost:3000 npm start   # Daten in ./data
npm test
```
