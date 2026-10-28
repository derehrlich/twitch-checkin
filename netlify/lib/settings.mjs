import { db } from './store.mjs';

export const DEFAULTS = {
  rewardTitle: 'Check-in',
  rewardCost: 1,
  chatEnabled: true,
  // Platzhalter: {user} {count}
  chatTemplate: '✅ {user} ist eingecheckt – du warst jetzt schon {count}x dabei! 🎉',
  duplicateTemplate: '{user}, du bist heute schon eingecheckt (Besuch #{count}) ✅ Deine Punkte bekommst du zurück.',
  timezone: 'Europe/Berlin',
  // Der Stream-Tag wechselt zu dieser Uhrzeit (Streams nach Mitternacht zählen zum Vortag)
  dayRolloverHour: 5,
  volume: 0.6,
  duration: 5000,
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Bereinigt Eingaben aus dem Admin-Bereich. Unbekannte Felder fliegen raus.
function sanitize(input) {
  const out = {};
  const str = (k, max) => { if (typeof input[k] === 'string' && input[k].trim()) out[k] = input[k].trim().slice(0, max); };
  const num = (k, min, max, int = true) => {
    const n = Number(input[k]);
    if (input[k] !== '' && input[k] != null && Number.isFinite(n)) out[k] = clamp(int ? Math.round(n) : n, min, max);
  };
  str('rewardTitle', 45);
  str('chatTemplate', 400);
  str('duplicateTemplate', 400);
  num('rewardCost', 1, 1_000_000);
  num('dayRolloverHour', 0, 23);
  num('volume', 0, 1, false);
  num('duration', 2000, 30_000);
  if (typeof input.chatEnabled === 'boolean') out.chatEnabled = input.chatEnabled;
  if (typeof input.timezone === 'string') {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone }); out.timezone = input.timezone; } catch { /* ungültig, ignorieren */ }
  }
  return out;
}

export async function getSettings() {
  return { ...DEFAULTS, ...((await db.get('config/settings')) ?? {}) };
}

export async function saveSettings(input) {
  const next = { ...(await getSettings()), ...sanitize(input) };
  await db.set('config/settings', next);
  return next;
}
