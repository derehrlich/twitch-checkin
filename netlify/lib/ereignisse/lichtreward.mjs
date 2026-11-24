// Licht-Effekte per Kanalpunkte: drei Rewards (Feuer, Nordlicht, Sternenhimmel). Eine Einlösung löst in Home Assistant den Effekt aus.
// Es läuft immer nur ein Effekt: nach einer Einlösung sind alle drei Rewards für die eingestellte Sperrzeit pausiert,
// und eine Einlösung innerhalb der Sperrzeit (z. B. gleichzeitig) bekommt die Punkte zurück.
//
// Speicher:
//   licht/lock   { until: ms, fx: 'fire'|…, paused: boolean }   Sperre nach der letzten Einlösung
import { db } from '../kern/store.mjs';
import { fill } from '../zuschauer/checkin.mjs';
import { helix, sendChat, setRedemptionStatus, userToken } from '../kern/twitch.mjs';
import { EFFEKTE, triggerShow } from './licht.mjs';

export const LOCK_KEY = 'licht/lock';
export const rewardKey = (fx) => `lichtRewardId${fx.n}`;
export const effektFor = (state, rewardId) => EFFEKTE.find((x) => state[rewardKey(x)] && state[rewardKey(x)] === rewardId);
export const effektTitle = (settings, fx) => settings[`lichtReward${fx.n}Title`];

let chain = Promise.resolve(); // ein Server-Prozess: Einlösungen laufen nacheinander, so startet nie ein zweiter Effekt
const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

async function setPaused(paused) {
  const state = (await db.get('config/state')) ?? {};
  const { user_id } = await userToken();
  for (const fx of EFFEKTE) {
    if (!state[rewardKey(fx)]) continue;
    await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: state[rewardKey(fx)] }, body: { is_paused: paused } })
      .catch((e) => console.warn(`Licht-Reward nicht ${paused ? 'pausiert' : 'freigegeben'}:`, e.message));
  }
}

const say = (settings, template, vars) => (settings.chatEnabled ? sendChat(fill(template, vars)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message)) : null);

export const handleLichtReward = (redemption, fx, settings, now = Date.now()) => serial(async () => {
  const { id, user_name: user, reward } = redemption;
  const refund = (why) => { console.warn(`Licht-Effekt „${fx.name}“ abgelehnt: ${why}`); return setRedemptionStatus(id, reward.id, 'CANCELED'); }; // Punkte zurück
  if (!settings.lichtEnabled || !settings.lichtRewardsEnabled) { await refund('Lichtshows sind ausgeschaltet'); return { ok: false, reason: 'off' }; }
  const lock = await db.get(LOCK_KEY);
  if (lock && lock.until > now) {
    const minutes = Math.max(1, Math.ceil((lock.until - now) / 60_000));
    await refund('es läuft schon ein Effekt');
    await say(settings, settings.lichtBusyTemplate, { user, minutes });
    return { ok: false, reason: 'busy' };
  }
  const r = await triggerShow(fx.key, settings);
  if (!r.ok) { await refund(r.error); return { ok: false, reason: 'ha' }; }
  await db.set(LOCK_KEY, { until: now + settings.lichtSperreMinuten * 60_000, fx: fx.key, paused: false });
  await setRedemptionStatus(id, reward.id, 'FULFILLED');
  await say(settings, settings.lichtRewardTemplate, { user, effect: fx.name });
  await setPaused(true); // alle drei Rewards sind in Twitch bis zum Ende der Sperre nicht kaufbar
  await db.set(LOCK_KEY, { until: now + settings.lichtSperreMinuten * 60_000, fx: fx.key, paused: true });
  return { ok: true, fx: fx.key };
});

// Jede halbe Minute: ist die Sperre vorbei, werden die Rewards wieder freigegeben.
export async function lichtTick(now = Date.now()) {
  const lock = await db.get(LOCK_KEY);
  if (!lock?.paused || lock.until > now) return false;
  await setPaused(false);
  await db.set(LOCK_KEY, { ...lock, paused: false });
  return true;
}
