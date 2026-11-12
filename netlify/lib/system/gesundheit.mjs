// Störungs-Meldungen: prüft regelmäßig, ob die Stadtwache gesund ist, und meldet Probleme per Discord-Webhook.
// Geprüft wird: von Twitch widerrufene Webhooks, ungültige Twitch-Verbindung, fehlende oder kaputte Webhook-Anmeldungen
// und eine fehlgeschlagene nächtliche Sicherung. Eine Meldung kommt erst, wenn das Problem bei zwei Prüfungen
// hintereinander da war (kurze Aussetzer bleiben still), danach höchstens einmal am Tag erneut, und eine
// „wieder in Ordnung“-Nachricht, wenn es weg ist.
//   health/state   { problems: { <schlüssel>: { text, label, seen, notifiedAt } } }
import { db } from '../kern/store.mjs';
import { getSettings } from '../kern/settings.mjs';
import { userToken } from '../kern/twitch.mjs';
import { subscriptionState } from '../admin/status.mjs';

export const NOTIFY_AFTER = 2; // so viele Prüfungen hintereinander, dann wird gemeldet
export const REMIND_MS = 24 * 3_600_000;
const STATE_KEY = 'health/state';
const LABELS = { revoked: 'Twitch-Webhooks (widerrufen)', token: 'Twitch-Verbindung', subs: 'Twitch-Webhooks', backup: 'Nächtliche Sicherung' };

/** Was ist gerade nicht in Ordnung? { schlüssel: Text }. Leer = alles gut. */
export async function collect(settings = null) {
  settings ??= await getSettings();
  const problems = {};
  const state = (await db.get('config/state')) ?? {};
  const tokens = await db.get('config/tokens');
  if (state.revoked) problems.revoked = `Twitch hat die Webhooks widerrufen (${state.revoked}). Bitte im Admin „Rewards & Webhooks abgleichen“ drücken.`;
  let tokenOk = false;
  if (tokens) {
    try { await userToken(); tokenOk = true; } catch (e) {
      problems.token = `Die Twitch-Verbindung funktioniert nicht (${String(e.message).slice(0, 120)}). Bitte im Admin auf Start → „Mit Twitch verbinden“ klicken.`;
    }
  }
  if (tokenOk && state.webhookUrl) {
    const { subscription, subscriptionError } = await subscriptionState(state.webhookUrl, settings, state, tokens);
    if (subscriptionError) problems.subs = `Die Webhooks lassen sich bei Twitch nicht abfragen (${String(subscriptionError).slice(0, 120)}).`;
    else if (subscription && subscription !== 'enabled') problems.subs = `Die Twitch-Webhooks sind nicht in Ordnung („${subscription}“). Bitte im Admin „Rewards & Webhooks abgleichen“ drücken.`;
  }
  if (process.env.LOCAL_STORE_DIR && settings.backupAutoEnabled) {
    const b = await db.get('config/backup-state');
    if (b?.lastError && (!b.lastOk || (b.lastErrorAt ?? '') > b.lastOk)) problems.backup = `Die nächtliche Sicherung ist fehlgeschlagen: ${String(b.lastError).slice(0, 150)}`;
  }
  return problems;
}

const HOOK = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,100}$/;
export const validHook = (url) => HOOK.test(String(url ?? '').trim());

/** Nachricht an den Discord-Webhook. Wirft bei einem Fehler. */
export async function sendDiscord(url, text) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ username: 'Stadtwache', content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw new Error(`Discord antwortet mit ${res.status}`);
}

/**
 * Regelmäßig aufrufen (alle paar Minuten). Prüft, meldet neue Probleme und Entwarnungen.
 * Gibt die gesendeten Nachrichten zurück, oder null, wenn die Meldungen aus sind.
 */
export async function healthTick(now = Date.now()) {
  const settings = await getSettings();
  if (!settings.healthEnabled || !validHook(settings.healthDiscordWebhook)) return null;
  const problems = await collect(settings);
  const old = ((await db.get(STATE_KEY)) ?? {}).problems ?? {};
  const next = {}, lines = [];
  for (const [key, text] of Object.entries(problems)) {
    const prev = old[key];
    const seen = (prev?.seen ?? 0) + 1;
    const due = seen >= NOTIFY_AFTER && (!prev?.notifiedAt || now - prev.notifiedAt >= REMIND_MS);
    next[key] = { text, label: LABELS[key], seen, notifiedAt: prev?.notifiedAt ?? null, pending: due };
    if (due) lines.push(`⚠️ **Stadtwache:** ${text}`);
  }
  for (const [key, prev] of Object.entries(old)) if (!problems[key] && prev.notifiedAt) lines.push(`✅ **Stadtwache:** ${prev.label ?? LABELS[key] ?? key} ist wieder in Ordnung.`);
  let sent = [];
  if (lines.length) {
    try {
      await sendDiscord(settings.healthDiscordWebhook.trim(), lines.join('\n'));
      sent = lines;
      for (const v of Object.values(next)) if (v.pending) v.notifiedAt = now;
    } catch (e) { console.warn('Störungs-Meldung nicht gesendet:', e.message); } // beim nächsten Mal noch einmal versuchen
  }
  for (const v of Object.values(next)) delete v.pending;
  await db.set(STATE_KEY, { problems: next });
  return sent;
}
