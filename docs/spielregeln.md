# Spielregeln und Teilnahmebedingungen – Gewinnspiel EhrlichVerwirrt

> Vorlage, keine Rechtsberatung. Stellen in **[eckigen Klammern]** musst du selbst füllen oder prüfen. Wer in Deutschland regelmäßig Gewinnspiele veranstaltet, sollte den fertigen Text einmal von jemandem mit Rechtskenntnis (z. B. Verbraucherzentrale-Merkblatt oder Anwalt) gegenlesen lassen, besonders zu Alter, Datenschutz und Impressum.

## Teil 1: Spielregeln (Spiellogik)

Diese Regeln sind genau so im Bot umgesetzt (`netlify/lib/giveaway.mjs`). Alle Zahlen sind je Gewinnspiel im Dashboard einstellbar; hier stehen die Standardwerte.

1. **Zeitraum.** Es zählen nur Streams zwischen Beginn und Ende des Gewinnspiels (jeweils einschließlich). Ein Stream-Tag wechselt um 5 Uhr (Streams nach Mitternacht zählen zum Vortag).
2. **Punkte pro Stream** (nicht pro Woche):
   - **Check-in:** 1 Punkt, höchstens einmal pro Stream, per Kanalpunkte-Reward.
   - **Chat aktiv:** +1 Punkt, wenn du im selben Stream mindestens 3 gezählte Nachrichten schreibst und zwischen der ersten und letzten gezählten Nachricht mindestens 30 Minuten liegen.
   - **Chat sehr aktiv:** +1 weiterer Punkt ab 10 gezählten Nachrichten (zusätzlich zu den Bedingungen von „Chat aktiv").
   - Chatpunkte gibt es nur in Streams, in denen du eingecheckt warst. Maximal also 3 Punkte pro Stream.
3. **Gezählte Nachrichten.** Pro Person zählt höchstens eine Nachricht in 30 Sekunden. Befehle (beginnen mit „!"), Nachrichten von Bots und die des Streamers zählen nicht. Wer den Chat nur zum Punktesammeln zumüllt, kann ausgeschlossen werden (siehe Teil 2, Punkt 6).
4. **Streak-Bonus.** Wer in einer Kalenderwoche (Mo bis So) an allen festen Streams (Montag und Freitag) eingecheckt war, bekommt +2 Punkte für diese Woche. Fällt ein fester Stream aus, wird er für diese Woche nicht verlangt. Ausgefallene Streams geben keine Punkte, auch nicht für Check-ins an diesem Tag.
5. **Teilnahmeschwelle.** Zur Ziehung zugelassen ist nur, wer an mindestens **6 verschiedenen Streams** eingecheckt war, verteilt auf mindestens **3 verschiedene Kalenderwochen**. Wer nur Punkte, aber die Schwelle nicht erreicht, kommt nicht in den Topf.
6. **Ziehung.** Jeder Punkt ist ein Los. Gezogen wird nacheinander Platz 1, 2, 3; wer schon gewonnen hat, scheidet aus. Mehr Punkte heißen bessere Chancen, aber keine Gewinngarantie. Beim Start der Ziehung wird der Punktestand eingefroren. Zeitpunkt, Teilnehmerliste mit Punkten und Ergebnis werden gespeichert und können auf Nachfrage eingesehen werden.
7. **Keine Kopplung an Geld.** Abos, Bits, Spenden und andere bezahlte Aktionen geben **keine** Punkte oder Lose und haben keinen Einfluss auf die Gewinnchance. Die Teilnahme ist immer kostenlos möglich.

## Teil 2: Allgemeine Teilnahmebedingungen

1. **Veranstalter.** [Name / Kanalbetreiber, Anschrift laut Impressum]. Das Gewinnspiel steht in keiner Verbindung zu Twitch (Amazon) oder Discord und wird von ihnen weder gesponsert noch unterstützt. Fragen und Beschwerden richtest du an den Veranstalter, nicht an Twitch.
2. **Teilnahme.** Teilnehmen kann, wer [mindestens 18 Jahre alt ist / mit Zustimmung der Eltern teilnimmt – **bitte festlegen und gegen die Altersfreigabe des Preises prüfen**] und einen Twitch-Account hat. Pro Person zählt ein Account. Der Streamer, seine Bots und [Moderatoren – optional festlegen] sind ausgeschlossen. Die Teilnahme ist kostenlos; mit dem Check-in und dem Mitspielen akzeptierst du diese Bedingungen.
3. **Ziehung live und Anwesenheit.** Die Ziehung findet zum angekündigten Termin **live im Stream** statt. Der Gewinner wird im Stream und im Chat genannt und muss sich **innerhalb von 10 Minuten nach der Verkündung im Twitch-Chat** (während der Stream läuft) bei [Kanalname] melden. Wer die Frist verpasst, verliert den Gewinn; für denselben Platz wird sofort ein **Nachrücker** aus demselben Topf gezogen. Die Frist gilt für jeden Platz einzeln und beginnt mit der Verkündung des jeweiligen Platzes. Die Ziehung wird nur gestartet, wenn der Stream noch mindestens [30] Minuten läuft.
4. **Gewinne.**
   - Platz 1: Enshrouded Premium Edition als Steam-Key [Plattform / Region prüfen]. Der Key wird nach der Meldung digital übermittelt [Weg festlegen, z. B. Twitch-Flüstern oder Discord-Nachricht]. Keine Barauszahlung, kein Umtausch. Der Veranstalter haftet nicht für Einschränkungen des Keys (Region, Plattform, Aktivierung).
   - Platz 2: Wunschbau im Stream. Du gibst ein Gebäude oder einen Dungeon-Raum vor, der Streamer baut ihn im Rahmen des Machbaren. Er entscheidet, ob und wie er ihn umsetzt (Aufwand, Spiellogik, Jugendschutz); das Ergebnis ist kein Rechtsanspruch auf ein bestimmtes Aussehen. Ein Termin im Stream wird gemeinsam abgesprochen.
   - Platz 3: Namensschild oder Namenswand im Spiel, im Rahmen der Spielmöglichkeiten. Der Name muss unbedenklich sein (keine Beleidigungen, Rechte Dritter, politische Parolen); sonst wird ein Ersatzname vereinbart.
   - Die Preise sind nicht übertragbar. Es gelten die Preise, die in der Ankündigung stehen.
5. **Melden und Übergabe.** Für die Übergabe brauchen wir nur das, was dafür nötig ist (bei Platz 1 einen Weg, den Key zu übermitteln). Ohne Rückmeldung zur Übergabe innerhalb von [7 Tagen] nach der Meldung verfällt der Gewinn und kann neu vergeben werden.
6. **Ausschluss.** Wer manipuliert, kann ausgeschlossen werden und verliert Punkte und Gewinne. Dazu zählen: mehrere Accounts für eine Person, Bots oder Skripte, Chat-Spam zum Punktesammeln, Ausnutzen von Fehlern, falsche Angaben. Der Streamer entscheidet im Zweifel nach pflichtgemäßem Ermessen und begründet es auf Nachfrage.
7. **Fehler, Änderung, Abbruch.** Fehlerhafte Punktstände werden korrigiert (die Punkte lassen sich jederzeit aus den gespeicherten Check-ins und Chatdaten nachrechnen). Bei technischen Problemen, Ausfällen oder Manipulation kann das Gewinnspiel angepasst, verschoben oder abgebrochen werden. Ausgefallene Streams werden nicht nachgeholt, sondern aus der Wertung genommen.
8. **Datenschutz.** Verarbeitet werden dein Twitch-Name und -ID, Check-ins, Anzahl und Zeit deiner gezählten Chatnachrichten sowie die daraus berechneten Punkte, zum Zweck der Durchführung des Gewinnspiels (Art. 6 Abs. 1 lit. b bzw. f DSGVO). Gewinner werden mit Namen im Stream und im Chat genannt. Die Daten bleiben bis [Ende des Gewinnspiels + Verjährungsfrist / festlegen] gespeichert. Du kannst Auskunft und Löschung verlangen, was zum Verlust der Teilnahme führt. Mehr dazu in der Datenschutzerklärung [Link].
9. **Haftung.** Der Veranstalter haftet nur bei Vorsatz und grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper und Gesundheit; zwingende gesetzliche Haftung bleibt unberührt.
10. **Schlussbestimmungen.** Es gilt deutsches Recht. Ist eine Bestimmung unwirksam, bleibt der Rest gültig. Der Rechtsweg ist, soweit gesetzlich zulässig, ausgeschlossen.

## Kurzfassung für Chat und Discord

> 🎁 [Name]: Check-in = 1 Punkt pro Stream, Chat-Aktivität und alle festen Streams geben Bonuspunkte. Teilnehmen darf, wer an 6 Streams in 3 Wochen eingecheckt war. Teilnahme kostenlos – Abos und Bits haben keinen Einfluss auf die Gewinnchance. Ziehung live am [Datum] um [Uhrzeit]: Wer gezogen wird, meldet sich innerhalb von 10 Minuten im Chat, sonst rückt jemand nach. Alle Regeln: [Link]
