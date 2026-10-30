// Gemeinsame Helfer der Admin-API: Uploads prüfen, Nutzer laden.
import { db } from '../store.mjs';
import { json } from '../http.mjs';
import { IMAGE_MAX, sniffImage } from '../images.mjs';

// Dateityp an den ersten Bytes erkennen, statt dem Browser zu glauben
export function sniffAudio(buf) {
  const head = buf.subarray(0, 12).toString('latin1');
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (head.startsWith('OggS')) return 'audio/ogg';
  if (head.startsWith('ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

export const AUDIO_MAX = 1_500_000; // Bytes

// Liest { data: base64 } aus dem Body und prüft Größe und Dateityp. Ergebnis: { buf, type } oder { error: Response }
function readUpload(body, { max, sniff, tooBig, badType }) {
  const buf = Buffer.from(typeof body.data === 'string' ? body.data : '', 'base64');
  if (!buf.length) return { error: json({ error: 'Keine Datei empfangen' }, 400) };
  if (buf.length > max) return { error: json({ error: tooBig }, 413) };
  const type = sniff(buf);
  if (!type) return { error: json({ error: badType }, 400) };
  return { buf, type };
}
export const audioUpload = (body) => readUpload(body, { max: AUDIO_MAX, sniff: sniffAudio, tooBig: 'Die Datei ist zu groß (maximal 1,5 MB)', badType: 'Nur MP3-, WAV- oder OGG-Dateien sind erlaubt' });
// Wie audioUpload, aber mit eigener Höchstgröße (Zuschauer-Uploads sind kleiner)
export const audioUploadMax = (body, max) => readUpload(body, { max, sniff: sniffAudio, tooBig: `Die Datei ist zu groß (maximal ${Math.round(max / 1000)} KB)`, badType: 'Nur MP3-, WAV- oder OGG-Dateien sind erlaubt' });
export const imageUpload = (body) => readUpload(body, { max: IMAGE_MAX, sniff: sniffImage, tooBig: 'Die Datei ist zu groß (maximal 3 MB)', badType: 'Nur GIF-, PNG-, JPG- oder WebP-Dateien sind erlaubt' });

// Hochgeladene Datei so ablegen, wie die Auslieferungs-Functions sie lesen
export const storeFile = (key, { buf, type }) => db.set(key, { type, data: buf.toString('base64') });

// Dateiname aus dem Upload ohne Zeichen, die in HTML Ärger machen könnten
export const cleanName = (name, fallback) => String(name || fallback).replace(/[<>"]/g, '').slice(0, 80);

export async function allUsers() {
  const keys = await db.list('user/');
  const users = [];
  for (let i = 0; i < keys.length; i += 25) { // in Blöcken laden
    const chunk = await Promise.all(keys.slice(i, i + 25).map(async (k) => ({ id: k.slice(5), ...(await db.get(k)) })));
    users.push(...chunk);
  }
  return users;
}
