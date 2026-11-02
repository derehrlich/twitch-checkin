# Stadtwache (twitch-checkin) – Projektwissen für Claude Code

## Wer und was
- **Auftraggeber:** Marcel Ehrlich, Streamer „EhrlichVerwirrt“ (Twitch). **Marcel ist kein Programmierer.** Alles auf **Deutsch**, einfache Worte, keine Fachbegriffe ohne Erklärung. Kleine Dinge einfach entscheiden und sagen, was entschieden wurde; bei Unklarem kurz nachfragen.
- **Projekt:** Twitch-Bot „Stadtwache“ (Check-in, Streak, Alerts, Raids, Soundboard, Einlaufsound, Community-Rangliste, Admin-Oberfläche). Läuft als Netlify Functions (Node) mit Netlify Blobs als Speicher.

## Schwesterprojekt: VerwirrBot (Repo `derehrlich/verwirrbot`)
Der VerwirrBot ist der Discord-Bot mit Dashboard (Python, läuft auf Marcels NAS mit CasaOS). Die beiden Projekte arbeiten über eine kleine Schnittstelle zusammen. **Bei Änderungen, die beide betreffen, immer beide Repos in derselben Sitzung bearbeiten** (`add_repo` für `derehrlich/verwirrbot`), damit Marcel nicht zwei Chats braucht.
- **Schnittstelle:** `/api/community/*` (`netlify/functions/community.mjs`), Anmeldung mit `Authorization: Bearer <LINK_SECRET>` (gleiches Geheimwort in Netlify und in `data/verwirrbot.env` des Bots). Die Adresse der Stadtwache steht im Bot als Dashboard-Einstellung.
  - `GET board`, `GET link`, `POST sync`, `POST bonus`, `POST unlink`, `GET award`, `POST award/announce`.
- **Wer macht was:**
  - Stadtwache: Punkte und Monatsrangliste (Twitch-Chat, Check-ins, Discord-Zahlen vom Bot), Konto-Verknüpfung (`/verknuepfen`), **Top des Monats** (Gewinner, Katalog-Sound, Wahl, Frist, Neu ziehen, Broadcaster gewinnt nie), Einlaufsound (Kauf, Freigabe, von Hand vergeben), alle Twitch-Chat-Nachrichten.
  - VerwirrBot: Discord-Nachrichten zählen und melden, **Hall of Fame** im Discord, die **Goldene Kelle** (= Rolle für den Monatssieger, Einstellungen dort: Ausnahmen, Neu ziehen), ClipMaster, Erwähnung und Erinnerung der Top des Monats im Discord (fragt `GET award` ab; „erneut ankündigen“ ruft `POST award/announce`).
- **Reihenfolge beim Ausliefern:** erst die Stadtwache (Merge in `main`, Netlify deployt automatisch), dann den VerwirrBot einspielen (ZIP im Dashboard unter System → Update einspielen). Die ZIP baut die GitHub Action im Bot-Repo bei jedem Stand von `main`.
- **Was ich nicht von hier aus kann:** Den Bot auf dem NAS einspielen (macht Marcel im Dashboard) und die Live-Seiten per `curl` prüfen (Proxy blockt). Den Deploy der Stadtwache prüfe ich mit dem Netlify-Werkzeug (Projekt `stadtwache`, `get-project` → `currentDeploy`, `commit_ref` mit `main` vergleichen).

## Ausliefern
- Branch → Pull Request → Merge in `main` → Netlify baut und deployt automatisch (Seite `stadtwache.netlify.app`, Netlify-Projekt `stadtwache`). Nie ohne Marcels Auftrag mergen.
- Neue Funktionen sind standardmäßig **ausgeschaltet** und werden im Admin eingeschaltet.

## Technik und Ordner
```
netlify/functions/   die HTTP-Endpunkte (admin, auth, community, einlaufsound, overlay, twitch-webhook …)
netlify/lib/         Logik: checkin, streak, award (Top des Monats), entrysound, community, settings, twitch, store …
netlify/lib/admin/   Admin-Routen je Reiter
public/              Admin-Oberfläche (public/admin), Overlays, Rangliste, Einlaufsound-Seite, Sport-Overlay (sport.html)
test/run.mjs         Unit-Tests (npm test), test/e2e/admin.mjs Browser-Test (npm run test:e2e)
```
- Einstellungen: `netlify/lib/settings.mjs` (Standardwerte und Prüfung), Admin-Formulare in `public/admin/js/schema.js`.
- Speicher: `netlify/lib/store.mjs` (`db.get/set/list/setIfNew`), Schlüssel stehen am Kopf der jeweiligen Datei (z. B. `award/<YYYY-MM>`, `entrysound/<id>`, `sport/config`, `sport/log/<id>`).

## Tests
- `npm ci && npm test` (aktuell 104 Tests). Vor jedem Pull Request ausführen; neue Funktionen bekommen einen Test in `test/run.mjs`.
- Der Browser-Test läuft mit `npm run test:e2e`.

## Stolperfallen
- Der Twitch-Chat-Text kommt aus Vorlagen in den Einstellungen (`…Template`); neue Platzhalter immer auch im Admin-Schema (`schema.js`) eintragen.
- Chat-Nachrichten dürfen höchstens 500 Zeichen haben (wird gekürzt).
- Ein ewiger Einlaufsound hat `validUntil` 2999-12-31 und `permanent: true`; `fmtDate` zeigt „unbegrenzt“.
- Neu gezogene Gewinner haben eine eigene Frist (`winner.deadline`), die Auswahl-Frist gilt also je Gewinner.
