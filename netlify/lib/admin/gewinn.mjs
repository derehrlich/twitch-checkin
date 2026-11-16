// /api/admin/gewinn: Gewinnspiele verwalten (alles hinter dem Admin-Login).
import { json } from '../kern/http.mjs';
import { getSettings } from '../kern/settings.mjs';
import {
  adminView, applyConfig, createDraw, currentDraw, deleteDraw, getDraw, getResult, isId, readAddress, redrawLog, runDraw, saveDraw, setCurrent, setOverlay, setWindow, testDraw, winnerAction, forgetCache,
} from '../belohnungen/gewinn.mjs';
import { lookupUser } from '../kern/twitch.mjs';

const fail = (res) => json({ error: res.error }, res.status ?? 400);

export async function gewinn({ route, method, body }) {
  const settings = await getSettings();
  // Mit einer Kennung vorn (gewinn/<id>/…) gilt die Aktion für dieses Gewinnspiel, ohne für die Ticket-Ziehung (gw/current)
  const drawId = isId(route[1]) ? route[1] : null;
  if (drawId) route = [route[0], ...route.slice(2)];
  const view = async (id = drawId) => json(await adminView(settings, Date.now(), id));
  if (route.length === 1 && method === 'GET') return view();
  if (route[1] === 'new' && method === 'POST') {
    const kind = ['bday', 'simple', 'quick', 'period'].includes(body?.kind) ? body.kind : body?.simple === true ? 'simple' : 'bday';
    const made = await createDraw(settings, { kind });
    return view(body?.kind ? made.id : null);
  }
  if (route[1] === 'select' && method === 'POST') { if (!(await setCurrent(String(body.id ?? '')))) return json({ error: 'Nicht gefunden (nur Gewinnspiele mit Kanalpunkte-Ticket können den Reward bekommen)' }, 404); return view(); }
  if (drawId && route.length === 1 && method === 'DELETE') { const res = await deleteDraw(drawId); return res.error ? fail(res) : view(null); }

  const draw = drawId ? await getDraw(drawId) : await currentDraw();
  if (!draw) return json({ error: drawId ? 'Dieses Gewinnspiel gibt es nicht' : 'Es gibt noch keine Ziehung. Lege zuerst eine an.' }, 404);

  if (route[1] === 'config' && method === 'PUT') {
    try { await saveDraw(applyConfig(draw, body, settings)); } catch (e) { return json({ error: e.message }, 400); }
    forgetCache();
    return view();
  }
  if (route[1] === 'window' && method === 'POST') { // Teilnahme von Hand öffnen oder schließen
    const res = await setWindow(draw, body.action, settings);
    return res.error ? fail(res) : view();
  }
  if (route[1] === 'block' && method === 'POST') {
    const name = String(body.name ?? '').trim().replace(/^@/, '').slice(0, 40);
    if (!name) return json({ error: 'Bitte einen Twitch-Namen angeben' }, 400);
    const u = await lookupUser(name).catch(() => null); // mit Twitch-ID, damit eine Namensänderung nicht hilft (ohne Twitch geht es auch per Name)
    const shown = u && u.name.toLowerCase() === name.toLowerCase() ? u.name : name; // Anzeigename nur, wenn er derselbe Name ist
    if (!(draw.blocked ?? []).some((b) => b.name.toLowerCase() === shown.toLowerCase())) draw.blocked = [...(draw.blocked ?? []), { name: shown, id: u?.id ?? null }].slice(0, 500);
    await saveDraw(draw); forgetCache();
    return view();
  }
  if (route[1] === 'block' && route[2] && method === 'DELETE') {
    draw.blocked = (draw.blocked ?? []).filter((b) => b.name.toLowerCase() !== decodeURIComponent(route[2]).toLowerCase());
    await saveDraw(draw); forgetCache();
    return view();
  }
  if (route[1] === 'test-draw' && method === 'POST') return json(await testDraw(draw, String(body.seed ?? '').slice(0, 64), settings));
  if (route[1] === 'draw' && method === 'POST') {
    if (body.confirm !== true) return json({ error: 'Bitte die Ziehung bestätigen' }, 400);
    const res = await runDraw(settings, { seed: String(body.seed ?? '').slice(0, 64) || undefined, drawId: draw.id });
    return res.error ? fail(res) : view();
  }
  if (route[1] === 'overlay' && method === 'POST') { const res = await setOverlay(body.action, Date.now(), draw.id); return res.error ? fail(res) : view(); }
  if (route[1] === 'protocol' && method === 'GET') {
    const result = await getResult(draw.id);
    return result ? json({ result, redraws: await redrawLog(draw.id) }) : json({ error: 'Noch nicht gezogen' }, 404);
  }
  if (route[1] === 'winner' && isId(route[2])) {
    if (route[3] === 'address' && method === 'GET') {
      const a = await readAddress(route[2]);
      return a ? json({ address: a }) : json({ error: 'Keine Adresse gespeichert' }, 404);
    }
    if (method === 'POST' && route[3]) {
      const res = await winnerAction(settings, route[2], route[3], Date.now(), draw.id);
      return res.error ? fail(res) : view();
    }
  }
}
