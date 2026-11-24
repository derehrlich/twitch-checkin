// /api/admin/licht: POST licht/test { show: 'raid' | 'follow' | 'sub' } löst eine Show von Hand aus.
import { json } from '../kern/http.mjs';
import { getSettings } from '../kern/settings.mjs';
import { EFFEKTE, SHOWS, baseUrl, triggerShow } from '../ereignisse/licht.mjs';
import { effektSeconds } from '../ereignisse/lichtreward.mjs';

export async function licht({ route, method, body }) {
  if (route[1] === 'test' && method === 'POST') {
    if (!Object.hasOwn(SHOWS, body?.show)) return json({ error: 'Unbekannte Show' }, 400);
    const settings = await getSettings();
    if (!baseUrl(settings)) return json({ error: 'Trag zuerst die Adresse von Home Assistant ein und speichere.' }, 400);
    const r = await triggerShow(body.show, settings, body.show === 'party' ? { seconds: 15 } : EFFEKTE.some((x) => x.key === body.show) ? { seconds: effektSeconds(settings) } : null);
    return r.ok ? json({ ok: true }) : json({ error: `Home Assistant nicht erreicht: ${r.error}` }, 502);
  }
}
