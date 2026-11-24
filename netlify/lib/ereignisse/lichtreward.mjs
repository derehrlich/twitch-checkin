// Licht-Effekte per Kanalpunkte: drei Rewards (Feuer, Nordlicht, Rotlicht). Eine Einlösung löst in Home Assistant den Effekt aus.
// Dazu die Party: ein Soundboard-Eintrag mit Haken „party“ spielt den Sound und startet die Party-Szene, so lange der Sound dauert.
// Es läuft immer nur ein Effekt (oder eine Party): nach einer Einlösung sind alle diese Rewards für die eingestellte Sperrzeit
// (bei der Party mindestens so lange wie der Sound) pausiert, und eine Einlösung innerhalb der Sperrzeit bekommt die Punkte zurück.
//
// Speicher:
//   licht/lock   { until: ms, fx: 'fire'|…, paused: boolean }   Sperre nach der letzten Einlösung
import { db } from '../kern/store.mjs';
import { fill } from '../zuschauer/checkin.mjs';
import { helix, sendChat, setRedemptionStatus, userToken } from '../kern/twitch.mjs';
import { getBoard, handleSoundboard } from '../belohnungen/soundboard.mjs';
import { EFFEKTE, PARTY, triggerShow } from './licht.mjs';

export const LOCK_KEY = 'licht/lock';
export const rewardKey = (fx) => `lichtRewardId${fx.n}`;
export const effektFor = (state, rewardId) => EFFEKTE.find((x) => state[rewardKey(x)] && state[rewardKey(x)] === rewardId);
// So lange läuft ein Effekt (Einstellung in Minuten); die Sperre dauert mindestens so lange plus eine halbe Minute
export const effektSeconds = (settings) => Math.round(settings.lichtEffektMinuten * 60);
export const effektLock = (settings) => Math.max(settings.lichtSperreMinuten * 60_000, (effektSeconds(settings) + 30) * 1000);
export const effektTitle = (settings, fx) => settings[`lichtReward${fx.n}Title`];

let chain = Promise.resolve(); // ein Server-Prozess: Einlösungen laufen nacheinander, so startet nie ein zweiter Effekt
const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

// Alle Rewards, die sich eine Sperre teilen: die drei Effekte und die Party-Einträge im Soundboard
async function lockedRewardIds() {
  const state = (await db.get('config/state')) ?? {};
  const party = (await getBoard()).filter((e) => e.party && e.rewardId).map((e) => e.rewardId);
  return [...EFFEKTE.map((fx) => state[rewardKey(fx)]).filter(Boolean), ...party];
}

async function setPaused(paused) {
  const { user_id } = await userToken();
  for (const id of await lockedRewardIds()) {
    await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id }, body: { is_paused: paused } })
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
  const r = await triggerShow(fx.key, settings, { seconds: effektSeconds(settings) });
  if (!r.ok) { await refund(r.error); return { ok: false, reason: 'ha' }; }
  await db.set(LOCK_KEY, { until: now + effektLock(settings), fx: fx.key, paused: false });
  await setRedemptionStatus(id, reward.id, 'FULFILLED');
  await say(settings, settings.lichtRewardTemplate, { user, effect: fx.name });
  await setPaused(true); // alle drei Rewards sind in Twitch bis zum Ende der Sperre nicht kaufbar
  await db.set(LOCK_KEY, { until: now + effektLock(settings), fx: fx.key, paused: true });
  return { ok: true, fx: fx.key };
});

// Party-Szene: Soundboard-Eintrag mit Haken „party“. Gleiche Sperre wie die Effekte; Home Assistant bekommt die Länge des Sounds.
export const partySeconds = (entry) => Math.min(PARTY.maxSeconds, Math.max(PARTY.minSeconds, Math.round(entry.soundSeconds) || 20));

export const handleParty = (redemption, entry, settings, now = Date.now()) => serial(async () => {
  const { id, user_name: user, reward } = redemption;
  if (!settings.lichtEnabled || !entry.soundVersion) return handleSoundboard(redemption, entry, settings); // ohne Lichtshows: einfach nur der Sound
  const refund = (why) => { console.warn(`Party „${entry.title}“ abgelehnt: ${why}`); return setRedemptionStatus(id, reward.id, 'CANCELED'); };
  const lock = await db.get(LOCK_KEY);
  if (lock && lock.until > now) {
    await refund('es läuft schon ein Effekt');
    await say(settings, settings.lichtBusyTemplate, { user, minutes: Math.max(1, Math.ceil((lock.until - now) / 60_000)) });
    return { ok: false, reason: 'busy' };
  }
  const seconds = partySeconds(entry);
  const r = await triggerShow(PARTY.key, settings, { seconds });
  if (!r.ok) { await refund(r.error); return { ok: false, reason: 'ha' }; }
  const until = now + Math.max(settings.lichtSperreMinuten * 60_000, (seconds + 30) * 1000);
  await db.set(LOCK_KEY, { until, fx: PARTY.key, paused: false });
  const played = await handleSoundboard(redemption, entry, settings); // spielt den Sound im Overlay und schließt die Einlösung ab
  await setPaused(true);
  await db.set(LOCK_KEY, { until, fx: PARTY.key, paused: true });
  return { ...played, party: seconds };
});

// Jede halbe Minute: ist die Sperre vorbei, werden die Rewards wieder freigegeben.
export async function lichtTick(now = Date.now()) {
  const lock = await db.get(LOCK_KEY);
  if (!lock?.paused || lock.until > now) return false;
  await setPaused(false);
  await db.set(LOCK_KEY, { ...lock, paused: false });
  return true;
}
