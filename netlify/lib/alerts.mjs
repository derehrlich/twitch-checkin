import { fill, pushOverlay } from './checkin.mjs';
import { sendChat } from './twitch.mjs';

const TIERS = { 1000: 'Stufe 1', 2000: 'Stufe 2', 3000: 'Stufe 3' };
export const tierName = (t) => TIERS[t] ?? 'Stufe 1'; // Prime meldet Twitch als Stufe 1

// Übersetzt ein EventSub-Ereignis in eine Overlay-Karte plus Chat-Vorlage. null = nichts anzeigen.
export function buildAlert(type, e, settings) {
  const user = e.is_anonymous || !e.user_name ? 'Anonym' : e.user_name;
  switch (type) {
    case 'channel.follow':
      return settings.alertFollow ? { card: { kind: 'follow', user }, template: settings.followTemplate, vars: { user } } : null;
    case 'channel.subscribe': {
      if (e.is_gift || !settings.alertSub) return null; // Geschenkte Subs zeigt der Gift-Alert, sonst käme jeder doppelt
      const tier = tierName(e.tier);
      return { card: { kind: 'sub', user, tier, months: 1 }, template: settings.subTemplate, vars: { user, tier, months: 1 } };
    }
    case 'channel.subscription.message': {
      if (!settings.alertSub) return null;
      const tier = tierName(e.tier);
      const months = Number(e.cumulative_months) || 1;
      return { card: { kind: 'resub', user, tier, months, message: String(e.message?.text ?? '').slice(0, 140) }, template: settings.subTemplate, vars: { user, tier, months } };
    }
    case 'channel.subscription.gift': {
      if (!settings.alertGift) return null;
      const total = Number(e.total) || 1;
      return { card: { kind: 'gift', user, tier: tierName(e.tier), total }, template: settings.giftTemplate, vars: { user, tier: tierName(e.tier), total } };
    }
    case 'channel.cheer': {
      const bits = Number(e.bits) || 0;
      if (!settings.alertCheer || bits < settings.alertCheerMin) return null;
      return { card: { kind: 'cheer', user, bits, message: String(e.message ?? '').slice(0, 140) }, template: settings.cheerTemplate, vars: { user, bits } };
    }
    default:
      return null;
  }
}

export async function handleAlert(type, event, settings) {
  if (!settings.alertsEnabled) return { ok: false, skipped: true };
  const alert = buildAlert(type, event, settings);
  if (!alert) return { ok: false, skipped: true };
  await pushOverlay({ type: 'alert', ...alert.card });
  if (settings.chatEnabled && settings.alertChat) await sendChat(fill(alert.template, alert.vars)).catch((e) => console.warn('Chat fehlgeschlagen:', e.message));
  return { ok: true, kind: alert.card.kind };
}
