// Lichtshows in Home Assistant: bei Raid, Follow, Sub/Resub/Gift-Sub und Bits genau ein Webhook-Aufruf (POST, ohne Body).
// Farben und Dauer der Shows stehen in Home Assistant, hier wird nur der passende Webhook ausgelöst.
// Adresse: Einstellung „lichtUrl“ (Admin → Alerts) oder Umgebungsvariable HA_URL, z. B. http://192.168.1.50:8123
export const SHOWS = {
  raid: '/api/webhook/twitch-raid-p4x8m2k7',
  follow: '/api/webhook/twitch-follow-q9w3n6t5',
  sub: '/api/webhook/twitch-sub-h7c2v8r4',
};

// Welche Show gehört zu welchem EventSub-Ereignis? null = keine Show.
export function showFor(type, e = {}) {
  if (type === 'channel.raid') return 'raid';
  if (type === 'channel.follow') return 'follow';
  if (type === 'channel.subscribe') return e.is_gift ? null : 'sub'; // geschenkte Subs löst das Gift-Paket einmal aus, nicht jeder Beschenkte
  if (type === 'channel.subscription.message' || type === 'channel.subscription.gift' || type === 'channel.cheer') return 'sub';
  return null;
}

export const baseUrl = (settings) => String(settings.lichtUrl || process.env.HA_URL || '').trim().replace(/\/+$/, '');

// Löst eine Show aus. Wirft nie: Fehler werden nur protokolliert, der Bot läuft immer weiter.
export async function triggerShow(show, settings) {
  const path = SHOWS[show];
  const base = baseUrl(settings);
  if (!path) return { ok: false, error: 'Unbekannte Show' };
  if (!base) return { ok: false, error: 'Keine Home-Assistant-Adresse eingetragen' };
  try {
    const res = await fetch(base + path, { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
  } catch (err) {
    console.warn(`Lichtshow „${show}“ fehlgeschlagen:`, err.message);
    return { ok: false, error: err.message };
  }
}

// Vom Twitch-Webhook aufgerufen. Wartet nicht auf Home Assistant.
export function handleLicht(type, e, settings) {
  if (!settings.lichtEnabled) return;
  const show = showFor(type, e);
  if (show) void triggerShow(show, settings);
}
