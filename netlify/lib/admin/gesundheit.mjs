// /api/admin/health: aktuelle Probleme ansehen (GET) und eine Test-Nachricht an Discord senden (POST health/test).
import { getSettings } from '../kern/settings.mjs';
import { json } from '../kern/http.mjs';
import { collect, sendDiscord, validHook } from '../system/gesundheit.mjs';

export async function health({ route, method }) {
  const settings = await getSettings();
  if (route.length === 1 && method === 'GET') {
    return json({ enabled: settings.healthEnabled, hasWebhook: validHook(settings.healthDiscordWebhook), problems: Object.values(await collect(settings)) });
  }
  if (route[1] === 'test' && method === 'POST') {
    if (!validHook(settings.healthDiscordWebhook)) return json({ error: 'Bitte zuerst eine gültige Discord-Webhook-Adresse eintragen und speichern' }, 400);
    try { await sendDiscord(settings.healthDiscordWebhook.trim(), '✅ **Stadtwache:** Test erfolgreich. Störungen werden hier gemeldet.'); } catch (e) { return json({ error: `Senden fehlgeschlagen: ${e.message}` }, 502); }
    return json({ ok: true });
  }
}
