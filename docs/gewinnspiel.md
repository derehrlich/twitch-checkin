# Gewinnspiele

Admin-Seite **Gewinnspiel** (Gruppe „Aktionen“). Alles läuft lokal auf der Stadtwache, es gibt keine externen Formulardienste.

## Mehrere Gewinnspiele verwalten
Oben steht die Liste aller Gewinnspiele, darunter legst du mit einer Vorlage ein neues an. Mehrere können gleichzeitig laufen.

| Vorlage | Mitmachen | Lose | Preis |
|---|---|---|---|
| Schnell im Stream | Chat-Befehl (z. B. `!gewinn`), nach dem Öffnen 5 Minuten offen | jeder ein Los | ohne Link, nur Ansage |
| Mit Zeitraum | Kanalpunkte-Ticket, Zeiten von/bis | Bonuslose aus den Monatspunkten der Rangliste | Key mit persönlichem Link |
| Einfache Verlosung | Kanalpunkte-Ticket | jeder ein Los | Key |
| Geburtstags-Ziehung | Kanalpunkte-Ticket | Wochenpunkte, Mitternachts-Los | drei Preise |

Die Vorlage füllt nur die Felder vor. Unter „Mitmachen, Zeiten und Lose“ stellst du alles um:
- **So macht man mit:** Chat-Befehl (kostenlos, eigener Befehl je Gewinnspiel) oder Kanalpunkte-Ticket.
- **Gewinnchance:** jeder ein Los, Bonuslose aus den Monatspunkten (Twitch-Chat, Check-ins, bei verknüpften Konten Discord; es zählt der Stand bei der Ziehung) oder Bonuslose aus der Aktivität während des Gewinnspiels. Dazu „Punkte pro Bonuslos“ und die Obergrenze.
- **Preise:** Key (Link zeigt den Key), Sachpreis (Link mit Adressformular) oder „Ohne Link“ (nur Ansage im Chat und im Overlay).

Ablauf einer schnellen Runde: anlegen, Preis eintragen, **Öffnen** (der Bot sagt es im Chat an), nach Ablauf der Minuten schließt es sich selbst, dann **Jetzt ziehen**.

Wichtig:
- Es gibt nur **einen** Kanalpunkte-Ticket-Reward. Er gehört immer zu genau einem Gewinnspiel (Knopf „Ticket-Reward hierher“ in der Liste). Chat-Gewinnspiele laufen unabhängig davon.
- Die Texte im Chat stehen ganz unten auf der Seite („Gewinnspiele im Chat: Texte“ und „Kanalpunkte-Ticket: Reward und Texte“). Dort ist auch der Hauptschalter „Gewinnspiele einschalten“.
- Ein gezogenes Gewinnspiel lässt sich nicht löschen, weil das Protokoll erhalten bleibt.
- Abos und Bits haben nie Einfluss auf die Gewinnchance.

# Geburtstags-Gewinnspiel (Danke-Stream, 30.11.2026)

## So läuft es ab
1. **Einrichten:** Auf der Seite ganz unten „Gewinnspiele einschalten“ anhaken und speichern, dann **Rewards mit Twitch abgleichen**. Danach einmal im Admin auf Start → **Mit Twitch verbinden** klicken (neue Berechtigung `user:manage:whispers` für Flüsternachrichten).
2. **Ziehung anlegen** (Vorlage „Geburtstags-Ziehung“). Vorbelegt: Wochenpunkte ab 23.11. 0:00, Tickets ab 30.11. 0:00, 3 Preise, 1 Bonuslos je 100 Wochenpunkte, höchstens 10 Lose.
3. **Wochenpunkte** zählen ab dem eingestellten Zeitpunkt automatisch: Check-in 50 Punkte je Tag, Streak-Bonus 10 Punkte je Streak-Tag (bis Streak 7), Chat 2 Punkte je Nachricht (Abstand 20 s, höchstens 20 pro Tag). Alle Werte im Reiter änderbar. **Wichtig: Die Stadtwache muss vor dem 23.11. mit diesem Stand laufen**, sonst fehlen Punkte.
3b. **Mitternachts-Los:** Zweiter Reward „Mitternachts-Los“ (15 Kanalpunkte). Nur im Fenster **29.11. 0:00 bis 0:30** kaufbar (Zeiten und Anzahl Extra-Lose in der Karte „Geburtstags-Ziehung“ änderbar), ein Los pro Person. Außerhalb des Fensters gibt es die Punkte zurück, und der Reward wird in Twitch pausiert. Das Extra-Los kommt **obendrauf** (zählt nicht gegen die Höchstzahl der Lose) und zählt nur zusammen mit dem Geburtstags-Ticket: Wer es um Mitternacht kauft und das Ticket erst am 30.11. holt, ist trotzdem dabei (der Chat sagt es ihr oder ihm). Abschalten: Haken „Mitternachts-Los anbieten“ in den Einstellungen.
4. **Tickets:** Reward „Geburtstags-Ticket“ (500 Kanalpunkte). Pro Person eines. Nur im Ticket-Fenster, sonst Punkte zurück. Fenster auch von Hand öffnen/schließen.
5. **Ziehen:** Erst „Test-Ziehung“ (speichert nichts, auch mit festem Seed), dann „Jetzt ziehen“. Das Ergebnis geht einmalig ins Protokoll, in den Chat (vom letzten zum ersten Platz) und ins OBS-Overlay `/gewinn/overlay` (Browserquelle 1920×1080, Test am Wochenende vorher).
6. **Gewinner** bekommen ihren Link per Twitch-Flüstern. Klappt das nicht und das Konto ist mit Discord verknüpft, wartet eine DM auf den VerwirrBot (Abruf `GET /api/community/gewinn/dm`, Quittung `POST /api/community/gewinn/dm/ack`; die Abholung im VerwirrBot läuft jede Minute). Sonst kopierst du den Link im Dashboard und schickst ihn selbst.
7. **Meldefrist 24 Stunden.** Danach zieht die Stadtwache automatisch nach (neuer Link). Key-Preis: Seite zeigt den Key. Sachpreis: erst melden, dann Adressformular (7 Tage Zeit).

## Sicherheit
- Von außen ohne Login ist für das Gewinnspiel nur `/gewinn/…` nötig. Teilnehmer, Protokolle und Adressen gibt es nur unter `/api/admin/gewinn` (Admin-Login). Die Overlay-Daten unter `/gewinn/api/overlay` zeigen nur bereits aufgedeckte Gewinner.
- Link-Codes: 256 Bit zufällig, 24 Stunden gültig, einmal nutzbar. Fehlversuche je Adresse werden gebremst (10 falsche Codes in 15 Minuten, dann 429).
- https: Über eine `https`-`SITE_URL` werden http-Aufrufe von außen weitergeleitet. In Cloudflare zusätzlich „Immer HTTPS verwenden“ einschalten.
- Cloudflare Access gehört weiterhin nur vor `/admin` und `/api/admin`, **nie** vor `/gewinn`.
- Adressen: AES-256-GCM, Schlüssel aus `GEWINN_KEY` (empfohlen als eigene Umgebungsvariable, sonst `SESSION_SECRET` oder `ADMIN_PASSWORD`; ändert sich der Schlüssel, sind gespeicherte Adressen nicht mehr lesbar). Sie stehen **nicht in den Sicherungen**. Automatisch gelöscht 30 Tage nach „versendet“, oder sofort mit „Adresse löschen“.

## Fakten für die Datenschutzerklärung (Marcel)
- Verarbeitet werden: Twitch-Name und -ID, Zeitpunkt des Tickets, Wochenpunkte (Anzahl Check-ins, Chat-Nachrichten gezählt, ohne Inhalt) im Zeitraum ab 23.11., bei Gewinnern von Sachpreisen Name, Anschrift, freiwillig E-Mail.
- Zweck: Durchführung und Nachweis der Ziehung, Versand. Speicherung lokal auf dem eigenen Server, keine Weitergabe an Dritte außer dem Versanddienstleister.
- Ziehungsprotokoll (Name, Lose, Zufalls-Seed) bleibt zur Nachvollziehbarkeit gespeichert. Adressen werden nach dem Versand gelöscht.
- Teilnahmebedingungen: Entwurf im Dashboard, nach Prüfung auf `/gewinn/bedingungen` veröffentlichen. Keine Rechtsberatung.
