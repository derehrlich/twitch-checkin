// Kanalpunkte-Soundboard: jeder Eintrag ist ein eigener Reward (Name, Preis, Abklingzeit) mit einer Sounddatei.
// Eintrag: { id, title, cost, cooldown, volume, enabled, soundName, soundVersion, rewardId }
import crypto from 'node:crypto';
import { db } from './store.mjs';
import { fill, pushOverlay } from './checkin.mjs';
import { sendChat, setRedemptionStatus } from './twitch.mjs';

export const MAX_ENTRIES = 20; // Twitch erlaubt höchstens 50 eigene Rewards pro Kanal, die anderen brauchen auch Platz
export const ID = /^[a-f0-9]{8}$/;
export const soundKey = (id) => `soundboard/${id}`;

export const getBoard = async () => (await db.get('config/soundboard')) ?? [];
export const saveBoard = (entries) => db.set('config/soundboard', entries);
export const newId = () => crypto.randomBytes(4).toString('hex');
export const isActive = (e) => Boolean(e.enabled && e.soundVersion);

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Bereinigt Eingaben aus dem Admin. Gibt nur die geänderten Felder zurück.
export function sanitizeEntry(input) {
  const out = {};
  if (typeof input.title === 'string' && input.title.trim()) out.title = input.title.trim().slice(0, 45);
  const num = (k, min, max, int = true) => {
    const n = Number(input[k]);
    if (input[k] !== '' && input[k] != null && Number.isFinite(n)) out[k] = clamp(int ? Math.round(n) : n, min, max);
  };
  num('cost', 1, 1_000_000);
  num('cooldown', 0, 86_400); // Sekunden, Twitch erzwingt sie je Reward
  num('volume', 0.1, 1, false);
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  return out;
}

/** Einlösung eines Soundboard-Rewards: Overlay spielt den Sound, Einlösung abschließen. Ohne Sound: Punkte zurück. */
export async function handleSoundboard(redemption, entry, settings) {
  const { id, user_name, reward } = redemption;
  if (!isActive(entry)) {
    await setRedemptionStatus(id, reward.id, 'CANCELED');
    return { ok: false };
  }
  await pushOverlay({ type: 'sound', id: entry.id, user: user_name, title: entry.title, volume: entry.volume, src: `/api/soundboard?id=${entry.id}&v=${entry.soundVersion}` });
  if (settings.chatEnabled && settings.soundboardChat) await sendChat(fill(settings.soundboardTemplate, { user: user_name, title: entry.title })).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
  await setRedemptionStatus(id, reward.id, 'FULFILLED');
  return { ok: true };
}
