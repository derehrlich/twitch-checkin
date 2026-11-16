# Umfragen

Seite **Aktionen → Umfragen** im Admin. Eine Frage an den Chat mit bis zu 6 Antworten, die Anzeige läuft als Browserquelle im Stream.

## Einschalten
Auf der Seite ganz unten unter „Umfragen“ **Umfragen einschalten** anhaken und speichern. In OBS eine Browserquelle (1920×1080, Hintergrund durchsichtig) auf `/umfrage` deiner Stadtwache-Adresse anlegen. Sie bleibt unsichtbar, bis eine Umfrage läuft. Mit `?pos=right`, `top`, `bottom-left` … hinter der Adresse änderst du den Platz (Standard: links in der Mitte), mit `?size=0.7` die Größe. Die Vorschau auf der Seite zeigt ein Beispiel.

## Starten
- **Im Admin:** Frage, Antworten (eine pro Zeile, leer = „Ja“ und „Nein“) und Dauer eintragen, „Umfrage starten“.
- **Im Chat** (nur Mods und du): `!umfrage 3 Welches Spiel? | Enshrouded | Satisfactory`. Die Zahl vorn sind Minuten und ist optional. Ohne Antworten gibt es „Ja“ und „Nein“. Beenden mit `!umfrageende`. Beides braucht „Chat-Befehle“ und „Chat-Nachrichten“.

## Abstimmen
Der Chat schreibt die Zahl der Antwort (`1` oder `!1`). Jede Person hat eine Stimme und darf sich anders entscheiden. Die Balken im Stream laufen live mit. Nach dem Ende schreibt die Stadtwache das Ergebnis in den Chat (bei Gleichstand beide Sieger), und die Anzeige zeigt es noch 30 Sekunden.

## Gut zu wissen
- Es wird nie gespeichert, wer wie gestimmt hat, nur die Zahlen.
- „Aus dem Stream nehmen“ blendet die Anzeige aus und verwirft eine laufende Umfrage ohne Ergebnis im Chat.
- Eine Zahl im Chat zählt nur, solange eine Umfrage läuft. Auf der Ignorierliste des Abspanns stehende Namen (zum Beispiel Bots) können nicht abstimmen.
- Cloudflare Access darf **nicht** vor `/umfrage` und `/api/umfrage` stehen (wie bei den anderen Overlays).
