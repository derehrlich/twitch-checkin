// /api/admin/soundboard: Einträge des Kanalpunkte-Soundboards (ein Reward mit Sounddatei je Eintrag).
import { db } from '../store.mjs';
import { MAX_ENTRIES, ID, getBoard, newId, sanitizeEntry, saveBoard, soundKey } from '../soundboard.mjs';
import { json } from '../http.mjs';
import { deleteReward } from '../twitch.mjs';
import { audioUpload, cleanName, storeFile } from './common.mjs';

const duplicate = (board, title, exceptId) => board.some((e) => e.id !== exceptId && e.title === title);

export async function soundboard({ route, method, body }) {
  const board = await getBoard();
  if (route.length === 1 && method === 'GET') return json(board);
  if (route.length === 1 && method === 'POST') {
    if (board.length >= MAX_ENTRIES) return json({ error: `Höchstens ${MAX_ENTRIES} Einträge` }, 400);
    const fields = sanitizeEntry(body);
    if (!fields.title) return json({ error: 'Bitte einen Namen angeben' }, 400);
    if (duplicate(board, fields.title)) return json({ error: 'Es gibt schon einen Eintrag mit diesem Namen' }, 400);
    const entry = { id: newId(), cost: 100, cooldown: 0, volume: 1, enabled: true, soundName: null, soundVersion: null, rewardId: null, ...fields };
    await saveBoard([...board, entry]);
    return json(entry);
  }

  const entry = board.find((e) => e.id === route[1]);
  if (!ID.test(route[1] ?? '') || !entry) return json({ error: 'Eintrag nicht gefunden' }, 404);
  if (route.length === 2 && method === 'PUT') {
    const fields = sanitizeEntry(body);
    if (fields.title && duplicate(board, fields.title, entry.id)) return json({ error: 'Es gibt schon einen Eintrag mit diesem Namen' }, 400);
    Object.assign(entry, fields);
    await saveBoard(board);
    return json(entry);
  }
  if (route[2] === 'sound' && method === 'POST') {
    const up = audioUpload(body);
    if (up.error) return up.error;
    await storeFile(soundKey(entry.id), up);
    entry.soundName = cleanName(body.name, 'Ton');
    entry.soundVersion = Date.now();
    await saveBoard(board);
    return json(entry);
  }
  if (route.length === 2 && method === 'DELETE') {
    await saveBoard(board.filter((e) => e.id !== entry.id));
    await db.delete(soundKey(entry.id));
    if (entry.rewardId) await deleteReward(entry.rewardId);
    return json({ ok: true });
  }
}
