# Stadtwache auf dem eigenen CasaOS-Server (Vorbereitung)

Stand heute läuft die Stadtwache auf Netlify (Functions + Netlify Blobs). Dieses Dokument sammelt, was für den Betrieb auf einem CasaOS-Server zu klären ist und was du vorbereiten kannst. **Es ist noch kein fertiges CasaOS-Paket**, siehe „Offene Punkte“.

## Was sich ändert, wenn der Bot bei dir zu Hause läuft

| Thema | Netlify heute | CasaOS |
|---|---|---|
| Ausführung | Netlify Functions | eigener Node-Prozess im Docker-Container (noch zu bauen) |
| Daten | Netlify Blobs | Dateien in einem Ordner (`LOCAL_STORE_DIR`, wird bereits von den Tests genutzt) |
| Erreichbarkeit | automatisch öffentlich mit HTTPS | **musst du selbst öffentlich machen**, siehe unten |
| Overlay-Abfragen alle 3 s | zählen gegen das Function-Kontingent | kostenlos |
| Updates | automatisch bei jedem Push | Container neu bauen oder Image aktualisieren |

## Das Wichtigste: Twitch muss deinen Server erreichen

Twitch schickt Check-ins, Raids, Follows usw. als Webhook (EventSub) an deinen Bot. Dafür gilt:

- Die Adresse muss **öffentlich per HTTPS auf Port 443** erreichbar sein. Eine reine LAN-Adresse wie `http://192.168.x.x` reicht nicht.
- Dieselbe öffentliche Adresse brauchst du als **OAuth Redirect URL** in der Twitch-App (`https://DEINE-ADRESSE/api/auth/callback`). Twitch erlaubt `http` nur für `localhost`.
- Sie muss in der Umgebungsvariable `SITE_URL` stehen.

Drei übliche Wege:

1. **Cloudflare Tunnel** (empfohlen): kostenlos, kein Portfreigabe, eigene Domain nötig. `cloudflared` gibt es als CasaOS-App oder als Container. Der Tunnel zeigt auf den Port des Bots.
2. **Tailscale Funnel**: kostenlos, kein eigener Domainname nötig (`*.ts.net`), ebenfalls ohne Portfreigabe.
3. **Reverse Proxy + DynDNS + Portfreigabe 443** (z. B. Nginx Proxy Manager, bei CasaOS als App verfügbar): volle Kontrolle, aber du musst Router, DynDNS und Zertifikat selbst pflegen.

Das **OBS-Overlay** kann auch über die LAN-Adresse laufen (Browserquelle `http://CASAOS-IP:PORT/overlay`), die öffentliche Adresse ist aber die sichere Wahl, solange nicht getestet ist, ob der eingebettete Twitch-Clip-Player (Raid-Clips) mit einer reinen IP-Adresse funktioniert.

## Das kannst du schon jetzt vorbereiten

1. **Backup ziehen**: Admin → *Allgemein → Backup & Wiederherstellen* → „Backup herunterladen“ (bei Bedarf „mit Tönen & Bildern“). Das ist dein Umzugspaket: Besucher, Streaks, Einstellungen, Soundboard, Raid-Zähler.
2. **Zugang klären**: Domain bzw. Tunnel-Adresse festlegen (siehe oben). Daran hängen `SITE_URL` und die Twitch-Redirect-URL.
3. **Ordner auf dem Server anlegen**, z. B. `/DATA/AppData/stadtwache/data` für die Daten. Ihn solltest du in dein CasaOS-Backup aufnehmen.
4. **Umgebungsvariablen notieren** (dieselben wie bei Netlify):
   - `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
   - `EVENTSUB_SECRET` (10–100 Zeichen)
   - `ADMIN_PASSWORD` (lang wählen)
   - `SITE_URL` (die öffentliche Adresse, ohne Slash am Ende)
   - `LOCAL_STORE_DIR` (Pfad im Container, z. B. `/data`)
5. **Twitch-App ergänzen** (<https://dev.twitch.tv/console/apps>): die neue Redirect URL zusätzlich eintragen. Die alte von Netlify kann vorerst bleiben.

## Umzug in der Praxis (wenn der Server steht)

1. Auf dem Server starten, Admin öffnen, Backup einspielen (*Allgemein → Wiederherstellen*).
2. **Mit Twitch verbinden** (Tokens werden aus Sicherheitsgründen nicht mitgesichert) und **Rewards & Webhooks abgleichen**. Der Status oben muss grün sein.
3. OBS-Browserquelle auf die neue Overlay-Adresse umstellen.
4. Erst danach die Netlify-Seite abschalten, damit Twitch-Ereignisse nicht an zwei Stellen landen und kein Check-in doppelt gezählt wird.

## Offene Punkte

Damit der Bot wirklich auf CasaOS läuft, fehlt noch:

- **Ein kleiner Node-Server**, der die vorhandenen Functions (`netlify/functions/*.mjs`, alle im Format `Request → Response`) unter ihren Pfaden ausliefert und `public/` bereitstellt. Die Datenhaltung ist dank `LOCAL_STORE_DIR` schon vorbereitet.
- **Dockerfile und CasaOS-Compose-Datei** (Port, Volume, Umgebungsvariablen).
- Ein Test, dass Overlay (inkl. Clip-Player) und Webhooks über die gewählte Adresse laufen.

Alternative ohne eigenen Server-Code: `npx netlify dev` in einem Container. Das ist aber ein Entwicklungswerkzeug und für den Dauerbetrieb nicht ideal.

Wenn du dich für einen Weg zur Erreichbarkeit entschieden hast (Cloudflare Tunnel, Tailscale oder Reverse Proxy), kann der Server-Teil gebaut werden.
