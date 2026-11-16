# Dorf-Level, !discord und !plan

## Dorf-Level
Admin-Seite **Belohnungen → Dorf-Level**. Aus allen Punkten wird eine Stufe mit Titel im Bau-Thema:

| Stufe | Titel | ab Punkten |
|---|---|---|
| 1 | Zaungast | 0 |
| 2 | Hilfsarbeiter | 100 |
| 3 | Handlanger | 300 |
| 4 | Maurerlehrling | 600 |
| 5 | Geselle | 1000 |
| 6 | Vorarbeiter | 1600 |
| 7 | Polier | 2500 |
| 8 | Bauleiter | 4000 |
| 9 | Baumeister | 6000 |
| 10 | Dorfältester | 10000 |

Titel und Punkte änderst du unten auf der Seite (eine Zeile pro Stufe: `Punkte | Titel`, die erste beginnt bei 0, höchstens 20 Stufen).

**So wird gerechnet:** wie in der Community-Rangliste (Chat-Nachrichten, aktive Tage, Check-ins, Bonus, bei verknüpften Konten auch Discord), aber **alle Monate zusammen**. Sonst würde jeder am Monatsanfang wieder bei null beginnen. Die Gewichte stellst du auf der Seite „Rangliste“ ein.

**Ein erreichtes Level geht nie verloren**, auch wenn du später Gewichte oder Stufen änderst.

**Wo man es sieht:**
- `!level` im Chat: „Mia, du bist Level 4: Maurerlehrling mit 650 Punkten. Noch 350 Punkte bis Geselle.“
- beim Check-in wird ein **Aufstieg im Chat gefeiert** (einmal pro Stufe, abschaltbar)
- auf „Meine Stadtwache“ mit Fortschrittsbalken
- im **Discord als Rolle** (nur für verknüpfte Konten): Das macht der VerwirrBot, siehe seine Anleitung (Dashboard → Community → Dorf-Level). Dafür brauchst du das Bot-Update.

**Einschalten:** Auf der Seite ganz unten „Dorf-Level einschalten“ und speichern. Beim ersten Mal bekommen alle, die einchecken, ihre Stufe angesagt (auch wer schon lange dabei ist).

## !discord
Schreibt den Einladungslink zu deinem Discord-Server in den Chat. Admin → Chat → **Befehle und Shoutout** → „Discord-Link und Streamplan“: „!discord einschalten“, Link prüfen (derselbe Link wird auch beim Clip-Hinweis benutzt), speichern.

## !plan
Schreibt die nächsten Streams aus dem **Kalender des VerwirrBots** in den Chat, zum Beispiel: „📅 Streamplan: heute 19:00 Bauabend · Fr 20:00 Enshrouded“. Abgesagte Streams stehen nicht drin.
- Der Bot schickt den Plan alle 5 Minuten an die Stadtwache (Bot-Dashboard → Community → „Streamplan an die Stadtwache schicken“, standardmäßig an). Ohne Bot-Update gibt es keinen Plan, dann antwortet `!plan` mit einem Hinweis auf den Discord.
- Ist der Plan älter als 3 Tage (Bot nicht erreichbar), sagt `!plan` das ebenfalls.
- Einschalten: gleiche Gruppe wie `!discord`, „!plan einschalten“.

Reihenfolge beim Einspielen: **erst die Stadtwache, dann der VerwirrBot.**
