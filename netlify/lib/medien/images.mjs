// Bild-Plätze für die Alert-Schilder: ein großes Bild oder GIF über dem Schild (wie bei Meld). Fehlt es, sitzt das Lama darauf.
export const IMAGE_SLOTS = ['follow', 'sub', 'resub', 'gift', 'cheer', 'raid', 'rescue'];
export const IMAGE_FALLBACK = { resub: 'sub' };
export const imageKey = (slot) => `image/${slot}`;
export const IMAGE_MAX = 3_000_000; // Bytes (Netlify-Functions nehmen höchstens ca. 6 MB Anfrage, Base64 braucht ein Drittel mehr)

// Dateityp an den ersten Bytes erkennen, statt dem Browser zu glauben
export function sniffImage(buf) {
  const head = buf.subarray(0, 12);
  const ascii = head.toString('latin1');
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
