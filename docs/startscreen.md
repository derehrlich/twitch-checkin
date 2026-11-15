# Startbildschirm („Gleich geht’s los“)

Admin → Reiter **Overlays** → Karte „Startbildschirm“. Die Seite bleibt in OBS unsichtbar, bis du sie dort startest.

## In OBS einbinden
- Browserquelle 1920×1080 auf `https://<deine Adresse>/startscreen`. Sie füllt das ganze Bild.
- **Eigene Szene „Startbildschirm“:** Quelle einfach als einzige Quelle einfügen. Zum Start im Admin „Startbildschirm starten“ drücken und in OBS auf die Szene wechseln.
- **Zusammen mit deinem Rahmen-Overlay (Gaming/Talking):** Adresse mit `?rahmen` benutzen, also `/startscreen?rahmen`. Dann entfallen die Warnstreifen, alles ist etwas kleiner und bleibt oberhalb der Holzleiste und links neben der Kamera. Lege die Quelle in deiner Szene **unter** Rahmen und Kamera.
- `?bg=0` macht den Hintergrund durchsichtig, dein Waldbild bleibt also stehen. Beides zusammen: `/startscreen?rahmen&bg=0`.
- Vorschau im Browser: `/startscreen?demo` (3 Minuten, immer sichtbar).

## Was du einstellst
- **Vorlauf** in Minuten (z. B. 10). „Starten“ beginnt den Countdown, „+5 Minuten“ verlängert, „Beenden“ blendet aus.
- **Animierter Hintergrund:** Du kannst auch eine **HTML-Datei** hochladen (eine einzelne Datei mit allem drin, bis 8 MB). Sie läuft abgeschottet hinter dem Startbildschirm und darf animiert sein. Bilder oder Skripte von anderen Webseiten lädt sie nach, dafür braucht der Rechner mit OBS Internet. Auf Admin oder Daten der Stadtwache hat sie keinen Zugriff. Dateien mit Bildern oder Schriften in Nachbarordnern funktionieren nicht, alles muss in der einen Datei stehen.
- **Hintergrundbild** hochladen (PNG, JPG, GIF oder WebP, bis 8 MB, am besten 1920×1080; größere Bilder werden im Browser automatisch verkleinert). Der Upload startet gleich nach der Auswahl.. Ohne Bild gibt es einen Bauplan-Hintergrund.
- **Überschrift, Zeile darunter, Text bei 0** (der Text steht, bis du „Beenden“ drückst).
- **Baufortschritt-Balken:** läuft mit dem Countdown durch die Phasen Baugrube, Fundament, Rohbau, Dach, Innenausbau und Richtfest.
- **Bauanekdoten:** eine pro Zeile, am schönsten als `Überschrift | Text`. Sie wechseln in zufälliger Reihenfolge alle X Sekunden. „Beispiel-Anekdoten laden“ füllt rund 30 witzige Sprüche ein, die du ändern kannst.
- Die Seite ist öffentlich wie die anderen Overlays: Cloudflare Access darf nicht davor liegen (`/startscreen`, `/api/startscreen`, `/api/startscreen-bg`).
