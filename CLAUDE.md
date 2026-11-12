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
- Nächtliche Sicherung: `netlify/lib/system/autobackup.mjs` (Timer in `server.mjs`, Ordner `BACKUP_DIR`, Admin-Routen `backup/status` und `backup/now`).

## Ausliefern
- Branch → Pull Request → Merge in `main` → GitHub Action baut das Image `ghcr.io/derehrlich/twitch-checkin` → Marcel drückt im Admin (Allgemein → Updates) „Auf Updates prüfen“, Watchtower lädt das Image und startet die Stadtwache neu (`docs/casaos.md`, Route `netlify/lib/admin/update.mjs`). Nie ohne Marcels Auftrag mergen.
- Neue Funktionen sind standardmäßig **ausgeschaltet** und werden im Admin eingeschaltet.

## Technik und Ordner
```
netlify/functions/   die HTTP-Endpunkte (admin, auth, community, einlaufsound, overlay, twitch-webhook …)
netlify/lib/         Logik, ein Ordner je Admin-Reiter:
  kern/                store, http, settings, twitch (Grundlagen für alles)
  zuschauer/           checkin, streak
  ereignisse/          alerts, raid
  chat/                chat (Webhook), befehle (feste Befehle als Liste BEFEHLE), commands (eigene Commands), extras (Shoutout, Zitate), moderation (Links, Wörter, Caps, Wiederholung, Emote-Spam), chatlog
  belohnungen/         soundboard, playlock, entrysound, award (Top des Monats), community, alpaca
  overlays/            credits (Abspann), sport
  medien/              images, sounds
  system/              autobackup, gesundheit (Störungs-Meldungen an Discord)
netlify/lib/admin/   Admin-Routen je Reiter
public/              Admin-Oberfläche (public/admin), Overlays, Rangliste, Einlaufsound-Seite, Sport-Overlay (sport.html), Alpaka-Leiste (alpakas.html), waagerechter Chat (chat.html, Daten aus `netlify/lib/chatlog.mjs`, Schlüssel `chatlog`)
test/run.mjs         Unit-Tests (npm test), test/e2e/admin.mjs Browser-Test (npm run test:e2e)
```
- Einstellungen: **eine Stelle** – `public/admin/js/schema.js`. Je Einstellung eine Zeile mit Name, Standardwert, Beschriftung und Grenzen (`t`/`a`/`n`/`c`, Erklärung am Dateikopf). Daraus entstehen Formular, Standardwerte (`DEFAULTS`) und Prüfung (`sanitize` in `netlify/lib/kern/settings.mjs`, liest die Schema-Datei). Neue Einstellung = nur eine Zeile im Schema. Neuer fester Chat-Befehl = nur eine Zeile in `BEFEHLE` (`netlify/lib/chat/befehle.mjs`). Nur Rewards/Webhooks-Änderungen kommen zusätzlich in `SYNC_KEYS`; Werte ohne Formular (Töne, Bilder) stehen in `HIDDEN` in `settings.mjs`.
- Admin-Reiter (nach Aufgabe sortiert): Start · Zuschauer · Twitch-Ereignisse · Chat · Belohnungen · Overlays · Medien · System. Die Formulare hängen an `<div data-schema="…">` in `public/admin/index.html`, der Schlüssel steht in `schema.js`. Alte Links (`#abspann` …) übersetzt `OLD_TABS` in `main.js`.
- Speicher: `netlify/lib/kern/store.mjs` (`db.get/set/list/setIfNew`), Schlüssel stehen am Kopf der jeweiligen Datei (z. B. `award/<YYYY-MM>`, `entrysound/<id>`, `sport/config`, `sport/log/<id>`, `quote/<n>`, `counter/<commandId>`, `modlog/<zeit>`, `modstrike/<id>`, `modlast/<id>`, `modpermit/<login>`, `chatstyle/<id>` (Farbe, Glitzer, `glitterUntil`), `health/state`, `alpaca-active`, `alpaca-color/<id>`).

## Tests
- `npm ci && npm test` (aktuell 122 Tests). Vor jedem Pull Request ausführen; neue Funktionen bekommen einen Test in `test/run.mjs`.
- Der Browser-Test läuft mit `npm run test:e2e`.

## Stolperfallen
- Störungs-Meldungen (`netlify/lib/system/gesundheit.mjs`, Timer alle 5 Minuten in `server.mjs`): meldet per **Discord-Webhook** (Einstellungen `healthEnabled`, `healthDiscordWebhook`, Admin → System), nicht über den VerwirrBot. Geprüft: widerrufene Webhooks (`config/state.revoked`), Twitch-Token, Anmeldungen (`subscriptionState` aus `admin/status.mjs`, braucht `config/state.webhookUrl`, das `setup` speichert) und `config/backup-state`. Erst nach 2 Prüfungen in Folge melden, dann höchstens täglich erinnern, Entwarnung bei Behebung. Neue Prüfung = ein Eintrag in `collect()` plus Label.
- Glitzer- und Verlauf-Reward (`glitterRewardId`/`gradientRewardId`, `handleStyleReward` in `netlify/lib/chat/chatlog.mjs`): Kauf setzt `chatstyle/<id>.glitterUntil` bzw. `gradientUntil` (FOREVER = Jahr 3000) und macht das Extra an; ab dann darf die Person `!glitter` bzw. `!verlauf` auch ohne Abo schalten. Abgelaufen: nur noch, wer Abo/VIP/Mod ist, sieht es. Beides kombinierbar. Beim Verlauf-Reward schreibt der Käufer 2–3 Farben dazu (`is_user_input_required`, `parseColors` in `belohnungen/alpaca.mjs`; leer oder „auto“ = automatischer Verlauf, unbekannt = Punkte zurück), speichert in `chatstyle/<id>.gradientColors`, ändern geht per `!verlauf rot blau`. Ohne eingeschaltete Chat-Leiste gibt es die Punkte zurück. Der Verlauf nutzt drei Farben (Farbton +70°/+140°, Mindest-Sättigung), sonst sieht man ihn bei blassen oder grauen Farben nicht (`public/chat.html`).
- Neue Twitch-Berechtigungen (`SCOPES` in `netlify/lib/kern/twitch.mjs`) bekommt der Bot erst, wenn Marcel im Admin auf Start → „Mit Twitch verbinden“ klickt; der Status zeigt fehlende an (`missingScopes`). Die Moderation braucht `moderator:manage:chat_messages` und `moderator:manage:banned_users`.
- Moderation: Broadcaster und Mods werden nie moderiert, VIPs/Abos/Stammgäste nur bei gesperrten Wörtern. Twitch-Clips sind immer erlaubt (`modAllowClips`), Marcel will, dass jeder Clips teilen darf. Neue Regeln zuerst im Testmodus (`modTestMode`, standardmäßig an).
- Der Twitch-Chat-Text kommt aus Vorlagen in den Einstellungen (`…Template`); neue Platzhalter immer auch im Hinweistext der Gruppe in `schema.js` nennen. Zahlen im Schema brauchen immer `min` und `max`, Text `maxlength` (der Test prüft das).
- Chat-Nachrichten dürfen höchstens 500 Zeichen haben (wird gekürzt).
- Ein ewiger Einlaufsound hat `validUntil` 2999-12-31 und `permanent: true`; `fmtDate` zeigt „unbegrenzt“.
- Neu gezogene Gewinner haben eine eigene Frist (`winner.deadline`), die Auswahl-Frist gilt also je Gewinner.
- Streaks werden nicht gespeichert, sondern in `computeStreak` (`netlify/lib/zuschauer/streak.mjs`) aus den Besuchstagen berechnet. Von Hand übernommene Streaks (Admin → Besucher → „Streaks übernehmen“, `POST /api/admin/users/streaks`) liegen als `user.streakImport = { count, asOf }` am Nutzer und werden dort mit eingerechnet, nicht in den Besuchen.
