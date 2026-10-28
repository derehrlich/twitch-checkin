// Speicher: Netlify Blobs in der Cloud. Mit LOCAL_STORE_DIR (nur für Tests) landen die Daten in Dateien.
//
// Schlüssel:
//   user/<twitchId>            { name, count, first, last, days: ['2026-10-28', ...] }
//   checked/<tag>/<twitchId>   Sperre: pro Stream-Tag nur ein Check-in (atomar per onlyIfNew)
//   seen/<redemptionId>        Twitch wiederholt Zustellungen, hier werden sie erkannt
//   event/<zeit>-<zufall>      Overlay-Ereignisse (kurzlebig)
//   config/settings|tokens|state
import { getStore } from '@netlify/blobs';
import fs from 'node:fs';
import path from 'node:path';

function fileStore(name) {
  const dir = path.join(process.env.LOCAL_STORE_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  const f = (k) => path.join(dir, encodeURIComponent(k));
  return {
    async get(k) { try { return JSON.parse(fs.readFileSync(f(k), 'utf8')); } catch { return null; } },
    async set(k, v) { fs.writeFileSync(f(k), JSON.stringify(v)); },
    async setIfNew(k, v) {
      try { fs.writeFileSync(f(k), JSON.stringify(v), { flag: 'wx' }); return true; } catch { return false; }
    },
    async delete(k) { fs.rmSync(f(k), { force: true }); },
    async list(prefix = '') { return fs.readdirSync(dir).map(decodeURIComponent).filter((k) => k.startsWith(prefix)).sort(); },
  };
}

function blobStore(name) {
  const s = getStore({ name, consistency: 'strong' });
  return {
    get: (k) => s.get(k, { type: 'json' }),
    set: (k, v) => s.setJSON(k, v),
    async setIfNew(k, v) { return (await s.setJSON(k, v, { onlyIfNew: true })).modified; },
    delete: (k) => s.delete(k),
    async list(prefix = '') {
      const keys = [];
      for await (const page of s.list({ prefix, paginate: true })) keys.push(...page.blobs.map((b) => b.key));
      return keys.sort();
    },
  };
}

export const db = process.env.LOCAL_STORE_DIR ? fileStore('checkin') : blobStore('checkin');
