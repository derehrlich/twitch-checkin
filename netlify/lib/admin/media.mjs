// Eigene Töne (je Platz: checkin, raid, follow, ...) und Bilder/GIFs für die Alert-Schilder.
import { db } from '../store.mjs';
import { setImage, setSound } from '../settings.mjs';
import { SLOTS, slotKey } from '../sounds.mjs';
import { IMAGE_SLOTS, imageKey } from '../images.mjs';
import { json } from '../http.mjs';
import { audioUpload, cleanName, imageUpload, storeFile } from './common.mjs';

/** POST lädt hoch, DELETE setzt zurück. Ohne Angabe eines Platzes gilt der Check-in-Ton (wie früher). */
export async function sounds({ method, body }) {
  const slot = body.slot ?? 'checkin';
  if (!SLOTS.includes(slot)) return json({ error: 'Unbekannter Ton-Platz' }, 400);
  if (method === 'POST') {
    const up = audioUpload(body);
    if (up.error) return up.error;
    await storeFile(slotKey(slot), up);
    return json(await setSound({ name: cleanName(body.name, 'Eigener Ton'), version: Date.now() }, slot));
  }
  if (method === 'DELETE') {
    await db.delete(slotKey(slot));
    return json(await setSound(null, slot));
  }
}

export async function images({ method, body }) {
  const slot = body.slot;
  if (!IMAGE_SLOTS.includes(slot)) return json({ error: 'Unbekannter Bild-Platz' }, 400);
  if (method === 'POST') {
    const up = imageUpload(body);
    if (up.error) return up.error;
    await storeFile(imageKey(slot), up);
    return json(await setImage({ name: cleanName(body.name, 'Eigenes Bild'), version: Date.now() }, slot));
  }
  if (method === 'DELETE') {
    await db.delete(imageKey(slot));
    return json(await setImage(null, slot));
  }
}
