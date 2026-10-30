# Rangliste im Twitch-Panel

Die Kanalseite zeigt unter dem Stream Panels. Ein normales Panel besteht nur aus einem **festen Bild mit Link**, Live-Daten sind dort nicht möglich. Es gibt deshalb zwei Wege:

| | Link-Panel | Panel-Extension |
|---|---|---|
| Zeigt Plätze live im Panel | nein, öffnet die Seite `/rangliste` | **ja**: Besuche, Chat, Streaks und Monat in vier Reitern |
| Sichtbar für alle Zuschauer | **sofort** | erst **nach Twitch-Prüfung** (im Teststatus nur für dich und Testkonten) |
| Aufwand | 5 Minuten | Entwicklerkonsole, Zip hochladen, ggf. Prüfung |

Du kannst beides kombinieren: erst das Link-Panel anlegen, später die Extension nachziehen.

## Weg 1: Link-Panel (sofort)

1. Auf deiner Kanalseite **Info → Panel bearbeiten → Panel hinzufügen → Text oder Bild hinzufügen**.
2. Titel „Rangliste“, ein Bild hochladen (z. B. ein Screenshot von `/rangliste`) und als **Bildlink** `https://twitch-checkin.netlify.app/rangliste` eintragen.
3. Die Seite zeigt Anwesende (Besuche), Chatter (Nachrichten), aktuelle Streaks, Rekorde und Zeit im Stream und aktualisiert sich jede Minute.

## Weg 2: Panel-Extension (Live im Panel)

Die Extension liegt als Zip bereit: im Admin unter *Chat & Abspann → Extension-Zip herunterladen* oder unter `https://twitch-checkin.netlify.app/stadtwache-panel.zip`. Sie ist auf `https://twitch-checkin.netlify.app` eingestellt. Bei eigener Adresse neu bauen:

```bash
npm run build:extension -- https://deine-adresse.de
```

(Das Zip landet in `public/stadtwache-panel.zip`.)

**Einrichten** (die Bezeichnungen in der Twitch-Konsole können leicht abweichen):

1. In der [Twitch-Entwicklerkonsole](https://dev.twitch.tv/console/extensions) anmelden (Zwei-Faktor-Anmeldung muss aktiv sein) und **Erweiterung erstellen**. Name z. B. „Stadtwache Rangliste“.
2. **Typ: Panel.** Bei der Version einstellen: Anzeigepfad `panel.html`, Panel-Höhe z. B. `400`.
3. **Asset-Hosting:** das Zip hochladen.
4. **Fähigkeiten / URL-Abrufe:** unter „Allowlist for URL Fetching Domains“ `https://twitch-checkin.netlify.app` eintragen (deine Seite, ohne Pfad). Ohne das darf die Extension die Daten nicht laden.
5. **Zugriff:** unter „Testing Account Allowlist“ deine eigene Twitch-Konto-ID (nicht den Namen) eintragen, damit du die Extension im Test siehst. Änderungen daran greifen erst nach einem Statuswechsel (aus „Hosted Test“ nehmen und wieder hineinschieben).
6. Status auf **Hosted Test** setzen, dann **Installieren** und im Creator-Dashboard unter *Erweiterungen → Meine Erweiterungen* als **Panel** aktivieren.

**Sichtbarkeit:** Im Teststatus sehen nur du und die eingetragenen Testkonten die Extension, alle anderen Zuschauer sehen deinen Kanal ohne sie ([Twitch: Extension-Lebenszyklus](https://dev.twitch.tv/docs/extensions/life-cycle/)). Für alle Zuschauer musst du sie über die Konsole zur **Prüfung einreichen** und nach der Freigabe veröffentlichen. Twitch verlangt dafür unter anderem Angaben wie Beschreibung und Datenschutz. Die Extension selbst speichert nichts und holt nur öffentliche Zahlen (Namen und Werte).

## Was die Rangliste enthält

- **Besuche:** Besuche (Check-ins).
- **Chatter:** Chat-Nachrichten. Gezählt wird ab dem Einschalten von *Chat-Nachrichten zählen* im Admin, Twitch liefert keinen Verlauf. Dein eigener Name und die Bots aus der Ausnahmeliste zählen nicht.
- **Streaks:** aktuelle Streak und Rekord.
- **Monat:** Rangliste des laufenden Monats aus Twitch-Chat, Check-ins und Discord. Nur Konten, die sich selbst verknüpft haben, erscheinen (siehe README, „Community-Rangliste“). Unter der Liste steht der Hinweis, wie man mitmacht.

Die Rangliste lässt sich im Admin (*Chat & Abspann → Rangliste*) abschalten, dann zeigen Seite und Extension „nicht öffentlich“.
