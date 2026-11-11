# Stadtwache (twitch-checkin) – Projektwissen für Claude Code

## Wer und was
- **Auftraggeber:** Marcel Ehrlich, Streamer „EhrlichVerwirrt“ (Twitch). **Marcel ist kein Programmierer.** Alles auf **Deutsch**, einfache Worte, keine Fachbegriffe ohne Erklärung. Kleine Dinge einfach entscheiden und sagen, was entschieden wurde; bei Unklarem kurz nachfragen.
- **Projekt:** Twitch-Bot „Stadtwache“ (Check-in, Streak, Alerts, Raids, Soundboard, Einlaufsound, Community-Rangliste, Admin-Oberfläche). Läuft auf Marcels NAS mit CasaOS (Docker, Dateispeicher in `/data`). Der Code ist noch im Netlify-Functions-Stil geschrieben (Ordner `netlify/`), `server.mjs` führt ihn aus. **Netlify wird nicht mehr benutzt.**

## Schwesterprojekt: VerwirrBot (Repo `derehrlich/verwirrbot`)
Der VerwirrBot ist der Discord-Bot mit Dashboard (Python, läuft auf Marcels NAS mit CasaOS). Die beiden Projekte arbeiten über eine kleine Schnittstelle zusammen. **Bei Änderungen, die beide betreffen, immer beide Repos in derselben Sitzung bearbeiten** (`add_repo` für `derehrlich/verwirrbot`), damit Marcel nicht zwei Chats braucht.
- **Schnittstelle:** `/api/community/*` (`netlify/functions/community.mjs`), Anmeldung mit `Authorization: Bearer <LINK_SECRET>` (gleiches Geheimwort in der Umgebung der Stadtwache auf dem NAS und in `data/verwirrbot.env` des Bots). Die Adresse der Stadtwache steht im Bot als Dashboard-Einstellung.
  - `GET board`, `GET link`, `POST sync`, `POST bonus`, `POST unlink`, `GET award`, `POST award/announce`.
- **Wer macht was:**
  - Stadtwache: Punkte und Monatsrangliste (Twitch-Chat, Check-ins, Discord-Zahlen vom Bot), Konto-Verknüpfung (`/verknuepfen`), **Top des Monats** (Gewinner, Katalog-Sound, Wahl, Frist, Neu ziehen, Broadcaster gewinnt nie), Einlaufsound (Kauf, Freigabe, von Hand vergeben), alle Twitch-Chat-Nachrichten.
  - VerwirrBot: Discord-Nachrichten zählen und melden, **Hall of Fame** im Discord, die **Goldene Kelle** (= Rolle für den Monatssieger, Einstellungen dort: Ausnahmen, Neu ziehen), ClipMaster, Erwähnung und Erinnerung der Top des Monats im Discord (fragt `GET award` ab; „erneut ankündigen“ ruft `POST award/announce`).
- **Reihenfolge beim Ausliefern:** erst die Stadtwache (Merge in `main`, die Action baut das Image, Marcel lädt es in CasaOS neu), dann den VerwirrBot einspielen (ZIP im Dashboard unter System → Update einspielen). Die ZIP baut die GitHub Action im Bot-Repo bei jedem Stand von `main`.
- **Was ich nicht von hier aus kann:** Den Bot auf dem NAS einspielen (macht Marcel im Dashboard) und die Live-Seiten per `curl` prüfen (Proxy blockt). Die Stadtwache auf dem NAS aktualisiert Marcel selbst per Knopf im Admin (siehe `docs/casaos.md`). Ob das Image gebaut wurde, sehe ich in der GitHub Action `docker-image.yml`.

## Betrieb zu Hause (CasaOS)
- `server.mjs` + `Dockerfile` + `docker-compose.yml` lassen dieselben Functions auf Marcels NAS laufen (Dateispeicher in `/data`, Port 3000). Die Action `.github/workflows/docker-image.yml` baut bei jedem Stand von `main` das Image `ghcr.io/derehrlich/twitch-checkin`. Schritt-für-Schritt-Anleitung für Marcel: `docs/casaos.md`.
- Geplante Adresse: `https://wache.ehrlichverwirrt.de` über einen Cloudflare Tunnel (Domain `ehrlichverwirrt.de`, DNS bei Cloudflare). Cloudflare Access nur vor `/admin` und `/api/admin`, **nie** vor Webhook, Auth, Overlay, Rangliste oder `/api/community/*`.
- Neue Functions brauchen nichts am Server: `export const config = { path: ... }` genügt, `server.mjs` findet sie. Neue Weiterleitungen in `netlify.toml` werden ebenfalls übernommen (nur `from`/`to`/`status`).
- Test: `npm test` führt auch `test/server.mjs` aus.
- Nächtliche Sicherung: `netlify/lib/autobackup.mjs` (Timer in `server.mjs`, Ordner `BACKUP_DIR`, Admin-Routen `backup/status` und `backup/now`).

## Ausliefern
- Branch → Pull Request → Merge in `main` → GitHub Action baut das Image `ghcr.io/derehrlich/twitch-checkin` → Marcel drückt im Admin (Allgemein → Updates) „Auf Updates prüfen“, Watchtower lädt das Image und startet die Stadtwache neu (`docs/casaos.md`, Route `netlify/lib/admin/update.mjs`). Nie ohne Marcels Auftrag mergen.
- Neue Funktionen sind standardmäßig **ausgeschaltet** und werden im Admin eingeschaltet.

## Technik und Ordner
```
netlify/functions/   die HTTP-Endpunkte (admin, auth, community, einlaufsound, overlay, twitch-webhook …)
netlify/lib/         Logik: checkin, streak, award (Top des Monats), entrysound, community, settings, twitch, store …
netlify/lib/admin/   Admin-Routen je Reiter
public/              Admin-Oberfläche (public/admin), Overlays, Rangliste, Einlaufsound-Seite, Sport-Overlay (sport.html), Alpaka-Leiste (alpakas.html), waagerechter Chat (chat.html, Daten aus `netlify/lib/chatlog.mjs`, Schlüssel `chatlog`)
test/run.mjs         Unit-Tests (npm test), test/e2e/admin.mjs Browser-Test (npm run test:e2e)
```
- Einstellungen: `netlify/lib/settings.mjs` (Standardwerte und Prüfung), Admin-Formulare in `public/admin/js/schema.js`.
- Speicher: `netlify/lib/store.mjs` (`db.get/set/list/setIfNew`), Schlüssel stehen am Kopf der jeweiligen Datei (z. B. `award/<YYYY-MM>`, `entrysound/<id>`, `sport/config`, `sport/log/<id>`, `alpaca-active`, `alpaca-color/<id>`).

## Tests
- `npm ci && npm test` (aktuell 110 Tests). Vor jedem Pull Request ausführen; neue Funktionen bekommen einen Test in `test/run.mjs`.
- Der Browser-Test läuft mit `npm run test:e2e`.

## Stolperfallen
- Der Twitch-Chat-Text kommt aus Vorlagen in den Einstellungen (`…Template`); neue Platzhalter immer auch im Admin-Schema (`schema.js`) eintragen.
- Chat-Nachrichten dürfen höchstens 500 Zeichen haben (wird gekürzt).
- Ein ewiger Einlaufsound hat `validUntil` 2999-12-31 und `permanent: true`; `fmtDate` zeigt „unbegrenzt“.
- Neu gezogene Gewinner haben eine eigene Frist (`winner.deadline`), die Auswahl-Frist gilt also je Gewinner.
- Streaks werden nicht gespeichert, sondern in `computeStreak` (`netlify/lib/streak.mjs`) aus den Besuchstagen berechnet. Von Hand übernommene Streaks (Admin → Besucher → „Streaks übernehmen“, `POST /api/admin/users/streaks`) liegen als `user.streakImport = { count, asOf }` am Nutzer und werden dort mit eingerechnet, nicht in den Besuchen.
