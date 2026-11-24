// Lichtshows in Home Assistant: bei Raid, Follow, Sub/Resub/Gift-Sub und Bits genau ein Webhook-Aufruf (POST, ohne Body).
// Farben und Dauer der Shows stehen in Home Assistant, hier wird nur der passende Webhook ausgelöst.
// Adresse: Einstellung „lichtUrl“ (Admin → Alerts) oder Umgebungsvariable HA_URL, z. B. http://192.168.1.50:8123
// Kanalpunkte-Effekte: je Effekt ein eigener Reward (Schlüssel lichtRewardId<n> in config/state) und ein eigener HA-Webhook.
// Die Szene selbst (Fire, Aurora, Starry Sky) und die Dauer stehen in Home Assistant (Automation „Twitch: Licht-Effekte“, Timer).
export const EFFEKTE = [
  { key: 'fire', n: 1, name: 'Feuer', path: '/api/webhook/twitch-fx-fire-d4k9p2x7', color: '#E8561A' },
  { key: 'aurora', n: 2, name: 'Nordlicht', path: '/api/webhook/twitch-fx-aurora-m8v3c6t1', color: '#2FBF8F' },
  { key: 'stars', n: 3, name: 'Sternenhimmel', path: '/api/webhook/twitch-fx-stars-r5h2w9n4', color: '#3B4BC8' },
];

// Party-Szene (Soundboard-Eintrag mit Haken „Party“): Sound, Tiles, Desktoplampen blinken so lange, wie der Sound dauert (Body { seconds }).
export const PARTY = { key: 'party', path: '/api/webhook/twitch-party-j6t2q8z3', minSeconds: 5, maxSeconds: 120 };

export const SHOWS = {
  party: PARTY.path,
  raid: '/api/webhook/twitch-raid-p4x8m2k7',
  follow: '/api/webhook/twitch-follow-q9w3n6t5',
  sub: '/api/webhook/twitch-sub-h7c2v8r4',
  ...Object.fromEntries(EFFEKTE.map((x) => [x.key, x.path])),
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
export async function triggerShow(show, settings, body = null) {
  const path = SHOWS[show];
  const base = baseUrl(settings);
  if (!path) return { ok: false, error: 'Unbekannte Show' };
  if (!base) return { ok: false, error: 'Keine Home-Assistant-Adresse eingetragen' };
  try {
    const res = await fetch(base + path, { method: 'POST', signal: AbortSignal.timeout(5000), ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
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
