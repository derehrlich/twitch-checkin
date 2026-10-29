// Baut das Zip für die Twitch-Panel-Extension (Hosted Test): node scripts/build-extension.mjs [SITE_URL] [Zieldatei]
// Standard: SITE_URL aus der Umgebung oder https://twitch-checkin.netlify.app, Ziel public/stadtwache-panel.zip
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  ['panel.html', 'extension/panel.html'], ['panel.css', 'extension/panel.css'], ['panel.js', 'extension/panel.js'],
  ['fonts/fredoka-latin-400-normal.woff2', 'public/fonts/fredoka-latin-400-normal.woff2'],
  ['fonts/fredoka-latin-600-normal.woff2', 'public/fonts/fredoka-latin-600-normal.woff2'],
  ['fonts/OFL-Fredoka.txt', 'public/fonts/OFL-Fredoka.txt'],
];

/** Minimaler Zip-Schreiber (Deflate), damit kein zusätzliches Paket nötig ist. */
export function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (46 << 9) | (1 << 5) | 1; // feste Zeit, damit das Zip bei gleichem Inhalt gleich bleibt
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name), packed = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(DOS_TIME, 10); head.writeUInt16LE(DOS_DATE, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    parts.push(head, nameBuf, packed);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(DOS_TIME, 12); cen.writeUInt16LE(DOS_DATE, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

export function buildExtension(siteUrl) {
  const site = String(siteUrl).replace(/\/$/, '');
  if (!/^https:\/\/[^\s/]+$/.test(site)) throw new Error('SITE_URL muss eine https-Adresse ohne Pfad sein, z. B. https://meine-seite.netlify.app');
  return zip(FILES.map(([name, src]) => {
    let data = fs.readFileSync(path.join(root, src));
    if (name === 'panel.js') data = Buffer.from(data.toString('utf8').replaceAll('__SITE_URL__', site));
    return [name, data];
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const site = process.argv[2] || process.env.SITE_URL || 'https://twitch-checkin.netlify.app';
  const out = path.resolve(process.argv[3] || path.join(root, 'public/stadtwache-panel.zip'));
  fs.writeFileSync(out, buildExtension(site));
  console.log(`${out} gebaut für ${site}`);
}
