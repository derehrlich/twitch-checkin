# Geburtstagswoche (23.–30.11.2026)

Admin-Reiter **Geburtstagswoche**. Alles läuft auf der Stadtwache, die OBS-Seiten bleiben unsichtbar, bis du sie im Admin einblendest.

## Countdown (`/countdown`)
- In OBS eine Browserquelle 1920×1080 auf `https://<deine Adresse>/countdown`. Platz und Größe stellst du über die Adresse ein: `?pos=top` (Standard), `bottom`, `center`, `top-left`, `top-right`, `bottom-left`, `bottom-right`, dazu `?size=0.7`. Beispiel: `/countdown?pos=top-right&size=0.7`.
- Im Admin: Überschrift, **Zielzeit** (Datum und Uhrzeit, in der Zeitzone des Kanals), Text bei 0, wie lange der Text stehen bleibt. Er kann die ganze Woche mitlaufen. Bei 0 erscheint der Text mit Konfetti und verschwindet nach der eingestellten Zeit.
- Vorschau mit 3 Minuten: `/countdown?demo`.
- Für die Mitternachtsparty: Zielzeit `29.11.2026 00:00`.

## Glücksrad (`/rad`)
- OBS-Browserquelle 1920×1080 auf `/rad`. `?pos=left` oder `right` schiebt es zur Seite, `?size=0.7` macht es kleiner. Vorschau: `/rad?demo`.
- Beliebig viele Räder. Pro Rad ein Feld pro Zeile: `Leuchtturm`, mit Gewicht `Leuchtturm ; 3` (größeres Feld, höhere Chance) und mit eigener Farbe `Leuchtturm ; 1 ; #ff8800`. Ohne Farbe nimmt das Rad die Stream-Farben. Max. 40 Felder.
- „Gedrehte Felder danach ausgrauen“: jedes Feld kommt nur einmal dran (gut für Community-Aktionen). „Alle Felder wieder frei“ setzt zurück.
- „Beispielräder anlegen“ erstellt Gebäudeart, Baustil und Community-Aktion zum Ändern.
- „Drehen“ würfelt auf der Stadtwache (nicht im Browser) und blendet das Rad ein. Das Ergebnis geht nach der Drehzeit (7 Sekunden) in den Chat (Text unter „Glücksrad: Chat“ änderbar).

## Befehl `!geburtstag`
Zeigt im Chat die Restzeit bis zur Zielzeit des Countdowns und den Wochenplan. Standardmäßig **aus**. Einschalten und den **Plan** eintragen: Reiter Geburtstagswoche, Karte „Geburtstags-Befehl“ (ein Eintrag pro Zeile, im Chat mit · verbunden). Vorbelegt ist dein Entwurf, bitte prüfen. Nach der Zielzeit kommt der zweite Text („Marcel hat Geburtstag!“).

## Adventure-Einreichung (Community-Tage)
- Admin → Geburtstagswoche → „Adventure-Einreichungen“. Einschalten und Texte: Karte darunter (standardmäßig **aus**).
- Zuschauer reichen im Twitch-Chat mit `!adventure Name oder Link` ein, im Discord über den VerwirrBot (Schnittstelle `POST /api/community/adventure`, im Discord mit `/adventure einreichen` und `/adventure liste` (VerwirrBot, Phase 7l)). Alles landet in einer Liste. Höchstens 2 je Person (Twitch und Discord zusammen, wenn das Konto verknüpft ist), gleiche Namen nur einmal.
- „Offene aufs Glücksrad übertragen“ macht daraus ein Rad (oder ersetzt die Felder eines vorhandenen). Jedes Feld kommt nur einmal dran, im Ergebnis steht „eingereicht von …“. Ein gedrehtes Adventure steht in der Liste als „vom Rad gewählt“.
- Von Hand ergänzen geht auch, falls jemand es woanders postet.

## Mitternachts-Los
Siehe `docs/gewinnspiel.md`, Punkt 3b.

## Vor dem Stream
1. Admin → Gewinnspiel: Ziehung einschalten, Speichern, **Rewards mit Twitch abgleichen**. Das legt „Mitternachts-Los“ (15 Punkte) an.
2. Countdown-Zielzeit eintragen, „Einblenden“, in OBS prüfen.
3. Räder anlegen, einmal drehen zum Test (Test-Dreh blendet das Rad ein, danach „Ausblenden“).
