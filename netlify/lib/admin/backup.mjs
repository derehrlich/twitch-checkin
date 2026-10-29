// /api/admin/backup: Sicherung als JSON herunterladen (GET) und wieder einspielen (POST).
// Enthalten: Besucher, Einstellungen, Soundboard, Raid-Zähler, Stream-Tage und Reward-IDs.
// Nie enthalten: Twitch-Tokens (nach einem Restore neu verbinden) und kurzlebige Daten (event/, seen/).
// Töne und Bilder (auch die des Soundboards) sind groß und deshalb nur mit ?media=1 dabei (Netlify-Functions schaffen höchstens ca. 6 MB je Anfrage).
import { db } from '../store.mjs';
import { json } from '../http.mjs';

const FORMAT = 'stadtwache-backup';
const DATA_PREFIXES = ['user/', 'checked/', 'checkout/', 'streamday/', 'raid/', 'chatuser/'];
const DATA_KEYS = ['config/settings', 'config/soundboard', 'config/state'];
const MEDIA_PREFIXES = ['sound/', 'image/', 'soundboard/'];
const inScope = (key, media) => DATA_KEYS.includes(key) || [...DATA_PREFIXES, ...(media ? MEDIA_PREFIXES : [])].some((p) => key.startsWith(p));

async function keysOf(media) {
  const prefixes = [...DATA_PREFIXES, ...(media ? MEDIA_PREFIXES : [])];
  const keys = [...DATA_KEYS];
  for (const p of prefixes) keys.push(...(await db.list(p)));
  return keys;
}

export async function backup({ method, body, req }) {
  if (method === 'GET') {
    const media = new URL(req.url).searchParams.get('media') === '1';
    const entries = {};
    const keys = await keysOf(media);
    for (let i = 0; i < keys.length; i += 25) {
      await Promise.all(keys.slice(i, i + 25).map(async (k) => { const v = await db.get(k); if (v != null) entries[k] = v; }));
    }
    const stamp = new Date().toISOString();
    const file = { format: FORMAT, version: 1, created: stamp, media, entries };
    return new Response(JSON.stringify(file), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="stadtwache-backup-${stamp.slice(0, 10)}${media ? '-mit-medien' : ''}.json"`,
      },
    });
  }

  if (method === 'POST') {
    const file = body.backup;
    if (file?.format !== FORMAT || typeof file.entries !== 'object' || file.entries === null) return json({ error: 'Das ist keine Stadtwache-Sicherung' }, 400);
    if (body.confirm !== true) return json({ error: 'Bitte das Wiederherstellen bestätigen' }, 400);
    const media = file.media === true;
    const entries = Object.entries(file.entries).filter(([k]) => inScope(k, media));
    if (!entries.length) return json({ error: 'Die Sicherung ist leer' }, 400);

    // Erst alles Bestehende im betroffenen Bereich entfernen, damit nach dem Restore genau der gesicherte Stand gilt.
    for (const k of await keysOf(media)) await db.delete(k);
    for (const [k, v] of entries) await db.set(k, v);

    // Hinweise auf Töne/Bilder, die nicht mehr existieren, aus den Einstellungen entfernen
    const settings = (await db.get('config/settings')) ?? {};
    let changed = false;
    const prune = async (field, keyOf) => {
      for (const slot of Object.keys(settings[field] ?? {})) {
        if (!(await db.get(keyOf(slot)))) { delete settings[field][slot]; changed = true; }
      }
    };
    await prune('sounds', (s) => `sound/${s}`);
    await prune('images', (s) => `image/${s}`);
    if (settings.soundName && !(await db.get('sound/data'))) { settings.soundName = null; settings.soundVersion = null; changed = true; }
    if (changed) await db.set('config/settings', settings);

    // Soundboard-Einträge ohne Tondatei wieder als „ohne Ton“ kennzeichnen
    const board = (await db.get('config/soundboard')) ?? [];
    let boardChanged = false;
    for (const e of board) {
      if (e.soundVersion && !(await db.get(`soundboard/${e.id}`))) { e.soundName = null; e.soundVersion = null; boardChanged = true; }
    }
    if (boardChanged) await db.set('config/soundboard', board);

    return json({ ok: true, restored: entries.length, media });
  }
}
