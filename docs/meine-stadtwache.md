# Meine Stadtwache

Eine persönliche Seite für Zuschauer unter `/meine` deiner Stadtwache-Adresse (Admin: **Belohnungen → Meine Stadtwache**).

## Was Zuschauer sehen
Nach der Anmeldung mit Twitch sieht jede Person **nur die eigenen Zahlen**:
- Streak (mit Rekord), Besuche, Zeit im Stream, ob heute schon eingecheckt ist
- wie viele Besuche bis zum nächsten Meilenstein fehlen
- Punkte und Platz in der Monatsrangliste, aufgeschlüsselt nach Chat-Nachrichten, aktiven Tagen, Check-ins und Bonus
- Stand des Einlaufsounds mit Link zur Einlaufsound-Seite

## Einschalten
Unter „Meine Stadtwache“ ganz unten **einschalten** und speichern. Der Chat-Befehl `!meine` schreibt den Link in den Chat (Befehl und Text sind einstellbar). Neue Funktionen sind wie immer erst einmal aus.

## Wichtig
- **Datenschutz:** Die Anmeldung gibt der Stadtwache keine Berechtigungen, Twitch bestätigt nur, wer die Person ist. Es wird nichts Neues gespeichert, alles wird aus den vorhandenen Zählungen berechnet (nie der Inhalt von Nachrichten).
- **Rangliste:** In der öffentlichen Rangliste steht nur, wer sein Discord-Konto verknüpft hat (`/verknuepfen`). Alle anderen sehen auf ihrer Seite die eigenen Punkte und wo sie damit stünden, mit dem Hinweis auf die Verknüpfung.
- Cloudflare Access darf **nicht** vor `/meine` und `/api/meine` stehen, sonst können sich Zuschauer nicht anmelden.
