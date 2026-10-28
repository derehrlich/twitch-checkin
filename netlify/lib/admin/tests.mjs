// POST /api/admin/test: schickt Beispiel-Ereignisse ans Overlay oder in den Chat. Verändert keine Zähler.
import { db } from '../store.mjs';
import { getSettings } from '../settings.mjs';
import { fill, fmtDuration, pushOverlay, signText } from '../checkin.mjs';
import { raiderPackage, raidVars, raidCard } from '../raid.mjs';
import { buildAlert } from '../alerts.mjs';
import { getBoard } from '../soundboard.mjs';
import { json } from '../http.mjs';
import { sendChat, userByLogin } from '../twitch.mjs';

// Beispieldaten je Alert (EventSub-Typ und Ereignis)
const alertSamples = (user, count) => ({
  follow: ['channel.follow', { user_name: user }],
  sub: ['channel.subscribe', { user_name: user, tier: '1000', is_gift: false }],
  resub: ['channel.subscription.message', { user_name: user, tier: '2000', cumulative_months: count, message: { text: 'Immer wieder gerne! 🎉' } }],
  gift: ['channel.subscription.gift', { user_name: user, tier: '1000', total: Math.min(count, 100) }],
  cheer: ['channel.cheer', { user_name: user, bits: count * 10, message: 'Cheer100 für dich!' }],
});

// Raid-Test mit echten Kanaldaten (Spiel, Clip); ein Shoutout wird nie ausgelöst
async function raidTest(body, settings) {
  const login = String(body.raider || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25) || (await db.get('config/tokens'))?.login;
  const who = login && (await userByLogin(login));
  if (!who) return json({ error: 'Kanal nicht gefunden' }, 404);
  const viewers = Math.max(1, Number(body.count) || 42);
  const pkg = await raiderPackage(who.id, who.display_name, settings);
  const raids = ((await db.get(`raid/${who.id}`))?.count ?? 0) + 1; // so würde der nächste Raid gezählt, der Test ändert nichts
  if (body.target === 'raid-chat') await sendChat(fill(settings.raidTemplate, raidVars(pkg, viewers, raids)));
  else await pushOverlay(raidCard(pkg, viewers, raids, settings));
  return json({ ok: true, clip: pkg.clip?.title ?? null });
}

export async function tests({ method, body }) {
  if (method !== 'POST') return;
  const settings = await getSettings();
  const user = String(body.user || 'TestUser').slice(0, 40);
  const count = Math.max(1, Number(body.count) || 7);
  const target = String(body.target);

  if (target === 'chat') await sendChat(fill(settings.chatTemplate, { user, count }));
  else if (target === 'checkout') await pushOverlay({ type: 'checkout', user, minutes: 134, count });
  else if (target === 'checkout-chat') await sendChat(fill(settings.checkoutTemplate, { user, count, duration: fmtDuration(134) }));
  else if (target === 'milestone') await pushOverlay({ type: 'checkin', user, count: Math.max(1, Number(body.count) || 100), streak: 12, milestone: true });
  else if (target === 'milestone-chat') await sendChat(fill(settings.milestoneTemplate, { user, count: Math.max(1, Number(body.count) || 100), streak: 12, record: 15 }));
  else if (target === 'rescue') await pushOverlay({ type: 'alert', kind: 'rescue', user, streak: 12, days: 2, ...signText(settings, 'rescue', { user, streak: 12, days: 2 }) });
  else if (target === 'raid' || target === 'raid-chat') return raidTest(body, settings);
  else if (target === 'soundboard') {
    const entry = (await getBoard()).find((e) => e.id === body.id);
    if (!entry || !entry.soundVersion) return json({ error: 'Eintrag hat noch keinen Ton' }, 400);
    await pushOverlay({ type: 'sound', id: entry.id, user, title: entry.title, volume: entry.volume, src: `/api/soundboard?id=${entry.id}&v=${entry.soundVersion}` });
  } else if (target.startsWith('alert-')) {
    // unabhängig vom Schalter „Alerts aktiv“, aber mit den Anzeigeregeln der Einstellungen
    const sample = alertSamples(user, count)[target.slice(6)];
    if (!sample) return json({ error: 'Unbekannter Alert' }, 400);
    const alert = buildAlert(sample[0], sample[1], { ...settings, alertFollow: true, alertSub: true, alertGift: true, alertCheer: true, alertCheerMin: 1 });
    await pushOverlay({ type: 'alert', ...alert.card });
    if (body.chat) await sendChat(fill(alert.template, alert.vars));
  } else await pushOverlay({ type: 'checkin', user, count });
  return json({ ok: true });
}
