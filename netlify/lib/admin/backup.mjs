// /api/admin/backup: Sicherung als JSON herunterladen (GET) und wieder einspielen (POST).
// Enthalten: Besucher, Einstellungen, Soundboard, Raid-Zähler, Stream-Tage, Reward-IDs, Einlaufsound-Einträge, Verknüpfungen und Monatszahlen,
// dazu Events und Tickets, Glücksrad, Adventures, Gewinnspiele, Countdown, Chat-Stile, Zitate, Zähler, Bonuspunkte, Statistik, Mediakit und Umfragen.
// Nie enthalten: Twitch-Tokens (nach einem Restore neu verbinden) und kurzlebige Daten (event/, seen/).
// Töne und Bilder (auch die des Soundboards) sind groß und deshalb nur mit ?media=1 dabei (ein Download über den Browser wird sonst sehr groß).
import { db } from '../kern/store.mjs';
import { json } from '../kern/http.mjs';
import { backupStatus, runBackupNow } from '../system/autobackup.mjs';

const FORMAT = 'stadtwache-backup';
// Stand der Sicherung bis Version 1. Ältere Dateien kennen die neueren Bereiche nicht: Beim Einspielen werden nur Bereiche geleert, die die Datei selbst enthält.
const LEGACY_PREFIXES = ['user/', 'checked/', 'checkout/', 'streamday/', 'raid/', 'chatuser/', 'entrysound/', 'link/', 'cmonth/', 'dmonth/', 'award/', 'awardsound/', 'sport/', 'alpaca-color/', 'gw/', 'gwcode/', 'startscreen/'];
const DATA_PREFIXES = [...LEGACY_PREFIXES, 'ticket/', 'rad/', 'adv/', 'countdown/', 'chatstyle/', 'quote/', 'counter/', 'bonus/', 'bonuskey/', 'rescue/', 'stat/', 'mediakit/', 'poll/'];
const DATA_KEYS = ['config/settings', 'config/soundboard', 'config/state', 'config/catalog', 'config/commands'];
const MEDIA_PREFIXES = ['sound/', 'image/', 'soundboard/', 'entrysound-file/', 'catalog/', 'startbg/'];
const inScope = (key, media, prefixes = DATA_PREFIXES) => DATA_KEYS.includes(key) || [...prefixes, ...(media ? MEDIA_PREFIXES : [])].some((p) => key.startsWith(p));

async function keysOf(media, prefixes = DATA_PREFIXES) {
  const keys = [...DATA_KEYS];
  for (const p of [...prefixes, ...(media ? MEDIA_PREFIXES : [])]) keys.push(...(await db.list(p)));
  return keys;
}

/** Die Sicherung als Objekt (für den Download und für die automatische Sicherung). */
export async function buildBackup(media) {
  const entries = {};
  const keys = await keysOf(media);
  for (let i = 0; i < keys.length; i += 25) {
    await Promise.all(keys.slice(i, i + 25).map(async (k) => { const v = await db.get(k); if (v != null) entries[k] = v; }));
  }
  return { format: FORMAT, version: 2, created: new Date().toISOString(), media, prefixes: DATA_PREFIXES, entries };
}

export async function backup({ method, body, req, route }) {
  // Automatische Sicherung auf dem Heimserver: Status ansehen und von Hand auslösen
  if (route?.[1] === 'status' && method === 'GET') return json(await backupStatus());
  if (route?.[1] === 'now' && method === 'POST') return json(await runBackupNow(), 200);

  if (method === 'GET') {
    const media = new URL(req.url).searchParams.get('media') === '1';
    const file = await buildBackup(media);
    const stamp = file.created;
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
    // Nur die Bereiche ersetzen, die die Sicherung selbst kennt: eine ältere Datei löscht keine Tickets, Glücksräder usw., die es damals noch nicht gab
    const prefixes = Array.isArray(file.prefixes) ? file.prefixes.filter((p) => DATA_PREFIXES.includes(p)) : LEGACY_PREFIXES;
    const entries = Object.entries(file.entries).filter(([k]) => inScope(k, media, prefixes));
    if (!entries.length) return json({ error: 'Die Sicherung ist leer' }, 400);

    // Erst alles Bestehende im betroffenen Bereich entfernen, damit nach dem Restore genau der gesicherte Stand gilt.
    for (const k of await keysOf(media, prefixes)) await db.delete(k);
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
