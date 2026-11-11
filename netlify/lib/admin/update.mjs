// Update-Knopf im Admin (Reiter „System“): zeigt die laufende Version und bittet Watchtower, nach einem neuen Image zu schauen.
// Watchtower (eigene App in CasaOS, docker-compose.watchtower.yml) lädt es bei Bedarf und startet die Stadtwache neu.
//   GET  /api/admin/update   { commit, builtAt, configured }
//   POST /api/admin/update   stößt Watchtower an
// Umgebung: WATCHTOWER_URL (z. B. http://192.168.178.144:8081) und WATCHTOWER_TOKEN (derselbe Schlüssel wie bei Watchtower)
import { json } from '../kern/http.mjs';

export async function update({ route, method }) {
  if (route[0] !== 'update') return;
  const url = (process.env.WATCHTOWER_URL ?? '').replace(/\/+$/, '');
  const token = process.env.WATCHTOWER_TOKEN ?? '';
  if (method === 'GET') return json({ commit: process.env.BUILD_SHA || null, builtAt: process.env.BUILD_DATE || null, configured: Boolean(url && token) });
  if (method !== 'POST') return;
  if (!url || !token) return json({ error: 'Updates sind nicht eingerichtet: WATCHTOWER_URL und WATCHTOWER_TOKEN fehlen in der Stadtwache-App' }, 503);

  // Ersetzt Watchtower die Stadtwache, wird diese Verbindung mitten drin beendet. Darum nicht ewig warten: nach ein paar Sekunden
  // gilt „Update läuft“, und die Seite prüft selbst, wann die Stadtwache wieder da ist und welche Version sie hat.
  const wait = Number(process.env.WATCHTOWER_WAIT_MS) || 5000;
  const call = fetch(`${url}/v1/update`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
    .then(async (r) => ({ status: r.status, text: await r.text().catch(() => '') }), (e) => ({ error: e.message }));
  const timer = new Promise((resolve) => setTimeout(() => resolve({ running: true }), wait));
  const r = await Promise.race([call, timer]);
  if (r.running) return json({ started: true });
  if (r.error) return json({ error: `Watchtower ist nicht erreichbar (${r.error}). Läuft die App, und stimmt WATCHTOWER_URL?` }, 502);
  if (r.status === 401 || r.status === 403) return json({ error: 'Watchtower hat den Schlüssel abgelehnt. WATCHTOWER_TOKEN muss in beiden Apps gleich sein.' }, 502);
  if (r.status >= 300) return json({ error: `Watchtower antwortet mit Fehler ${r.status}` }, 502);
  // Neuere Watchtower-Versionen melden mit, wie viele Container sie geprüft haben. Null heißt: sie hat die Stadtwache gar nicht gefunden.
  try { const d = JSON.parse(r.text); if ((d.summary ?? d).scanned === 0) return json({ error: 'Watchtower hat keinen Container zum Aktualisieren gefunden. Heißt die App „stadtwache“? (Name bei „command“ in der Watchtower-App)' }, 502); } catch { /* keine Zusammenfassung: dann wie bisher */ }
  return json({ done: true }); // Watchtower ist fertig, ohne dass die Stadtwache dabei neu gestartet wurde: nichts Neues da
}
