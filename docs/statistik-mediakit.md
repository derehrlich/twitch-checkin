# Twitch-Statistik und Mediakit

Beides gehört zur Admin-Gruppe **Zahlen**. Es kommt aus dem VerwirrBot (dort „Phase 7k“) und ist jetzt in der Stadtwache. Der VerwirrBot wird dafür nicht mehr gebraucht.

## Twitch-Statistik
1. Unter **Zahlen → Twitch-Statistik** ganz unten „Zuschauer, Follower und Abos messen“ anhaken und speichern. Neue Twitch-Berechtigungen sind nicht nötig, die Stadtwache hat sie schon.
2. Ab dann fragt die Stadtwache **jede Minute** bei Twitch nach, ob du live bist, und merkt sich die Zuschauerzahl. Follower und Abos holt sie alle 10 Minuten (außerhalb des Streams alle 6 Stunden). Abos gibt es nur mit Affiliate oder Partner, sonst steht dort ein Strich.
3. Die Seite zeigt Gesamtzahlen, die letzten 30 Tage, Säulen je Stream (hell = Höchstwert, kräftig = Durchschnitt), den Follower-Verlauf und eine Liste der Streams. „Verlauf“ zeigt die Zuschauer eines Streams über die Zeit.
4. Eine Pause unter 10 Minuten (zum Beispiel Absturz oder Pause-Overlay) zählt als derselbe Stream.

Wichtig: Gemessen wird erst ab dem Einschalten. Für die Zeit davor kannst du im Mediakit den Twitch-Export hochladen.

Die Zahlen stehen nur im Admin. Es wird nichts in den Chat und nichts nach Discord geschrieben.

## Rückblick auf jeden Stream
Oben auf der Seite **Zahlen → Twitch-Statistik** steht der Rückblick auf deinen letzten Stream, nur für dich (nichts geht in den Chat oder nach Discord):
- Dauer, Ø Zuschauer (mit Vergleich zu den bis zu 10 Streams davor), Rekord und wann er war, neue Follower, Check-ins am Stream-Tag
- die **aktivsten Chatter** (Anzahl der Nachrichten, nie der Inhalt) und wie viele insgesamt geschrieben haben
- was sonst passiert ist: neue Follower, Abos, verschenkte Abos, Bits und **Raids**
- die Zuschauerzahl über die Zeit

In der Liste darunter öffnet „Rückblick“ den Rückblick auf einen älteren Stream. Die Chatter werden erst ab dem Update gezählt, bei älteren Streams steht dort „noch nicht gezählt“. Gezählt wird nur, solange die Messung eingeschaltet ist und du live bist. Der Bot (du) und die Namen auf der Ignorierliste des Abspanns zählen nicht.

## Mediakit
Eine öffentliche Seite mit deinen Kennzahlen, Zeitplan, Zielgruppe und Partnerformaten, zum Beispiel für Anfragen von Firmen.
1. **Zahlen:** Entweder die eigene Messung (letzte 30 Tage) oder ein Twitch-Export. Export: Twitch Creator-Dashboard → Statistiken → „Analysen und Einnahmen nach Tag“ als CSV. Auf der Mediakit-Seite hochladen. Gelesen werden nur Streamzeiten, Zuschauer und Follower, **keine Einnahmen**, und die Datei selbst wird nicht gespeichert.
2. **Angaben:** Zielgruppe (Alter, Geschlecht, Land aus deinen Twitch-Statistiken), Preise und Geschäfts-E-Mail eintragen. Zeitplan und Formate sind vorbelegt und änderbar.
3. **Vorschau** ansehen, dann „Seite veröffentlichen“ anhaken und speichern. Die Seite hat die Adresse `/mediakit` auf deiner Stadtwache-Adresse.
4. Fehlen noch Zielgruppe, Preise oder E-Mail, steht auf der Seite ein Platzhalter in eckigen Klammern, und sie ist für Suchmaschinen gesperrt. Die Admin-Seite sagt dir dann, was noch offen ist.
5. **Anbieter-Kriterien** (zum Beispiel GPORTAL mit 40 Zuschauern) sind nur für dich. Du siehst einen Balken, wie weit du entfernt bist. Sie stehen nie auf der öffentlichen Seite.

## Cloudflare
`/mediakit` muss **ohne** Cloudflare Access erreichbar sein, wie die Rangliste. Cloudflare Access bleibt nur vor `/admin` und `/api/admin`.

## Eigene Adresse (`mediakit.ehrlichverwirrt.de`)
Im Cloudflare-Tunnel eine zweite Adresse auf dieselbe Stadtwache legen und dort `/` auf `/mediakit` umleiten. Wenn du das möchtest, sag Bescheid.
