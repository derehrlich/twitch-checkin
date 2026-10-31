// /api/admin/commands: eigene Commands anlegen, ändern, testen, löschen.
import { db } from '../store.mjs';
import { getSettings } from '../settings.mjs';
import { getBoard, isActive } from '../soundboard.mjs';
import { ID, MAX_COMMANDS, getCommands, newId, runActions, sanitize, saveCommands } from '../commands.mjs';
import { json } from '../http.mjs';

export async function commands({ route, method, body }) {
  const list = await getCommands();
  if (route.length === 1 && method === 'GET') {
    const sounds = (await getBoard()).filter((e) => isActive({ ...e, enabled: true })).map((e) => ({ id: e.id, title: e.title }));
    return json({ commands: list, sounds });
  }
  if (route.length === 1 && method === 'POST') {
    if (list.length >= MAX_COMMANDS) return json({ error: `Höchstens ${MAX_COMMANDS} Commands` }, 400);
    const fields = sanitize(body);
    if (fields.error) return json({ error: fields.error }, 400);
    if (fields.trigger.type === 'command' && list.some((c) => c.trigger.word === fields.trigger.word)) return json({ error: `${fields.trigger.word} gibt es schon` }, 400);
    const cmd = { id: newId(), ...fields };
    await saveCommands([...list, cmd]);
    return json(cmd);
  }
  const cmd = list.find((c) => c.id === route[1]);
  if (!ID.test(route[1] ?? '') || !cmd) return json({ error: 'Command nicht gefunden' }, 404);
  if (route.length === 2 && method === 'PUT') {
    const fields = sanitize(body, cmd);
    if (fields.error) return json({ error: fields.error }, 400);
    if (fields.trigger.type === 'command' && list.some((c) => c.id !== cmd.id && c.trigger.word === fields.trigger.word)) return json({ error: `${fields.trigger.word} gibt es schon` }, 400);
    Object.assign(cmd, fields);
    await saveCommands(list);
    return json(cmd);
  }
  if (route[2] === 'test' && method === 'POST') { // ignoriert Rolle, Abklingzeit und Aktivität, ändert nichts am Timer
    await runActions(cmd, { user: String(body.user || 'TestUser').slice(0, 40), args: 'Beispiel', channel: 'Kanal' }, await getSettings());
    return json({ ok: true });
  }
  if (route.length === 2 && method === 'DELETE') {
    await saveCommands(list.filter((c) => c.id !== cmd.id));
    await db.delete(`cooldown/cmd-${cmd.id}`); await db.delete(`cooldown/timer-${cmd.id}`);
    return json({ ok: true });
  }
}
