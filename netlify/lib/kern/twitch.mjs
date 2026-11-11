import { db } from './store.mjs';

export const SCOPES = ['channel:read:redemptions', 'channel:manage:redemptions', 'user:write:chat', 'moderator:manage:shoutouts', 'moderator:read:followers', 'channel:read:subscriptions', 'bits:read', 'user:read:chat', 'user:bot', 'channel:bot', 'moderator:manage:chat_messages', 'moderator:manage:banned_users'];

export const siteUrl = (req) =>
  (process.env.SITE_URL || process.env.URL || (req ? new URL(req.url).origin : '')).replace(/\/$/, '');

export async function tokenRequest(params) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, client_secret: process.env.TWITCH_CLIENT_SECRET, ...params }),
  });
  if (!res.ok) throw new Error(`Twitch-Token: ${res.status} ${await res.text()}`);
  return res.json();
}

export const toStored = (t, extra = {}) => ({
  access_token: t.access_token,
  refresh_token: t.refresh_token,
  expires_at: Date.now() + (t.expires_in - 60) * 1000,
  ...extra,
});

// Token des verbundenen Broadcasters (wird bei Bedarf erneuert)
export async function userToken() {
  const t = await db.get('config/tokens');
  if (!t) throw new Error('Twitch ist noch nicht verbunden');
  if (Date.now() >= t.expires_at) {
    const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    Object.assign(t, toStored(fresh));
    await db.set('config/tokens', t);
  }
  return t;
}

// App-Token (nötig für EventSub-Webhooks)
let appTok = null;
async function appToken() {
  if (appTok && Date.now() < appTok.exp) return appTok.token;
  const t = await tokenRequest({ grant_type: 'client_credentials' });
  appTok = { token: t.access_token, exp: Date.now() + (t.expires_in - 300) * 1000 };
  return appTok.token;
}

export async function helix(method, endpoint, { query, body, as = 'user' } = {}) {
  const url = new URL('https://api.twitch.tv/helix/' + endpoint);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const token = as === 'app' ? await appToken() : (await userToken()).access_token;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': process.env.TWITCH_CLIENT_ID, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status} ${raw}`);
  return raw ? JSON.parse(raw) : {};
}

export async function sendChat(message) {
  const { user_id } = await userToken();
  await helix('POST', 'chat/messages', { body: { broadcaster_id: user_id, sender_id: user_id, message: message.slice(0, 500) } });
}

// Moderation: Nachricht löschen und Zuschauer für eine Zeit stummschalten (Timeout). Der Bot handelt als Kanalinhaber.
export async function deleteChatMessage(messageId) {
  const { user_id } = await userToken();
  await helix('DELETE', 'moderation/chat', { query: { broadcaster_id: user_id, moderator_id: user_id, message_id: messageId } });
}

export async function timeoutChatter(userId, seconds, reason) {
  const { user_id } = await userToken();
  await helix('POST', 'moderation/bans', {
    query: { broadcaster_id: user_id, moderator_id: user_id },
    body: { data: { user_id: userId, duration: seconds, reason: String(reason).slice(0, 500) } },
  });
}

export async function setRedemptionStatus(redemptionId, rewardId, status) {
  const { user_id } = await userToken();
  try {
    await helix('PATCH', 'channel_points/custom_rewards/redemptions', {
      query: { id: redemptionId, broadcaster_id: user_id, reward_id: rewardId },
      body: { status },
    });
  } catch (e) {
    // Klappt nur bei Rewards, die diese App angelegt hat
    console.warn(`Einlösung nicht auf ${status} gesetzt:`, e.message);
  }
}

// Beschreibung des Glitzer-Rewards in Twitch (höchstens 200 Zeichen): kurze Anleitung mit der eingestellten Dauer
export const glitterPrompt = (settings) =>
  `✨ Dein Name und deine Chat-Nachrichten glitzern in der Chat-Leiste im Stream, ${settings.glitterDays > 0 ? `${settings.glitterDays} Tage lang` : 'für immer'}. Mit !glitter im Chat schaltest du es an/aus. Nochmal einlösen verlängert.`.slice(0, 200);

// Legt die Rewards an (oder passt Preis/Namen an) und merkt sich die IDs.
// Check-out nur, wenn aktiviert; ein früher angelegter Check-out-Reward wird dann in Twitch deaktiviert.
export async function ensureRewards(settings, entry = null) {
  const { user_id } = await userToken();
  const state = (await db.get('config/state')) ?? {};
  const { data: list } = await helix('GET', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, only_manageable_rewards: 'true' } });

  const make = async ({ stateKey, title, cost, prompt, color, syncPrompt = false, extra = {} }) => {
    let reward = list.find((r) => r.id === state[stateKey]) ?? list.find((r) => r.title === title);
    if (!reward) {
      try {
        reward = (await helix('POST', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id }, body: { title, cost, prompt, background_color: color, ...extra } })).data[0];
      } catch (e) {
        if (e.message.includes('DUPLICATE_REWARD')) {
          throw new Error(`Auf deinem Kanal gibt es schon einen Reward „${title}“, der nicht von dieser App stammt. Benenne oder lösche ihn in Twitch, oder wähle in den Einstellungen einen anderen Reward-Namen (und speichere).`);
        }
        throw e;
      }
    } else if (reward.title !== title || reward.cost !== cost || reward.is_enabled === false || (syncPrompt && reward.prompt !== prompt)) {
      reward = (await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: reward.id }, body: { title, cost, is_enabled: true, ...(syncPrompt ? { prompt } : {}) } })).data[0];
    }
    state[stateKey] = reward.id;
    return reward;
  };

  const checkin = await make({ stateKey: 'rewardId', title: settings.rewardTitle, cost: settings.rewardCost, prompt: 'Check-in für diesen Stream – dein Besuch wird mitgezählt!', color: '#9146FF' });
  let checkout = null;
  if (settings.checkoutEnabled) {
    checkout = await make({ stateKey: 'checkoutRewardId', title: settings.checkoutRewardTitle, cost: settings.checkoutRewardCost, prompt: 'Check-out: deine Zeit im Stream wird gespeichert.', color: '#F08A24' });
  } else if (state.checkoutRewardId) {
    await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: state.checkoutRewardId }, body: { is_enabled: false } }).catch(() => {});
    delete state.checkoutRewardId;
  }
  let streak = null;
  if (settings.streakRescueEnabled) {
    streak = await make({ stateKey: 'streakRewardId', title: settings.streakRewardTitle, cost: settings.streakRewardCost, prompt: 'Rettet deine Check-in-Streak, wenn du Streams verpasst hast.', color: '#E5533D' });
  } else if (state.streakRewardId) {
    await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: state.streakRewardId }, body: { is_enabled: false } }).catch(() => {});
    delete state.streakRewardId;
  }
  // Einlaufsound: Kauf und Verlängern. Titel und Beschreibung tragen die genaue Monatszahl (kommt fertig aus entrysound.mjs).
  let entryBuy = null, entryExtend = null;
  if (settings.entrySoundEnabled && entry) {
    entryBuy = await make({ stateKey: 'entryBuyRewardId', title: entry.titles.buy, cost: settings.entrySoundBuyCost, prompt: entry.prompts.buy, color: '#1F6FEB', syncPrompt: true });
    entryExtend = await make({ stateKey: 'entryExtendRewardId', title: entry.titles.extend, cost: settings.entrySoundExtendCost, prompt: entry.prompts.extend, color: '#1F6FEB', syncPrompt: true });
  } else {
    for (const k of ['entryBuyRewardId', 'entryExtendRewardId']) {
      if (!state[k]) continue;
      await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: state[k] }, body: { is_enabled: false } }).catch(() => {});
      delete state[k];
    }
  }
  // Alpaka färben: der Zuschauer schreibt die Farbe beim Einlösen dazu
  let alpaca = null;
  if (settings.alpacaEnabled) {
    alpaca = await make({ stateKey: 'alpacaRewardId', title: settings.alpacaRewardTitle, cost: settings.alpacaRewardCost, prompt: 'Färbe dein Alpaka im Stream! Schreib die Farbe dazu: z. B. rot, türkis, rosa, einen Hex-Code wie #ff8800 oder zufall. Bei unbekannter Farbe gibt es die Punkte zurück.', color: '#FF8FC0', syncPrompt: true, extra: { is_user_input_required: true } });
  } else if (state.alpacaRewardId) {
    await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: state.alpacaRewardId }, body: { is_enabled: false } }).catch(() => {});
    delete state.alpacaRewardId;
  }
  // Glitzer-Chat: schaltet den Glitzer in der Chat-Leiste frei
  let glitter = null;
  if (settings.glitterEnabled) {
    glitter = await make({ stateKey: 'glitterRewardId', title: settings.glitterRewardTitle, cost: settings.glitterRewardCost, prompt: glitterPrompt(settings), color: '#F5C230', syncPrompt: true });
  } else if (state.glitterRewardId) {
    await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: state.glitterRewardId }, body: { is_enabled: false } }).catch(() => {});
    delete state.glitterRewardId;
  }
  await db.set('config/state', state);
  return { checkin, checkout, streak, entryBuy, entryExtend, alpaca, glitter };
}

// Soundboard: legt je aktivem Eintrag einen Reward an oder passt ihn an (Name, Preis, Abklingzeit), schaltet Einträge
// ohne Ton oder abgeschaltete aus und merkt sich die Reward-ID im Eintrag.
export async function syncSoundboardRewards(entries) {
  const { user_id } = await userToken();
  const { data: list } = await helix('GET', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, only_manageable_rewards: 'true' } });
  for (const e of entries) {
    const active = Boolean(e.enabled && e.soundVersion);
    const fields = {
      title: e.title, cost: e.cost, is_enabled: active,
      prompt: `Spielt „${e.title}“ im Stream ab.`, background_color: '#2E8B6E',
      is_global_cooldown_enabled: e.cooldown > 0, ...(e.cooldown > 0 ? { global_cooldown_seconds: e.cooldown } : {}),
    };
    let reward = list.find((r) => r.id === e.rewardId) ?? list.find((r) => r.title === e.title);
    if (!reward) {
      if (!active) continue; // nichts anlegen, was ohnehin aus wäre
      try {
        reward = (await helix('POST', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id }, body: fields })).data[0];
      } catch (err) {
        if (err.message.includes('DUPLICATE_REWARD')) throw new Error(`Auf deinem Kanal gibt es schon einen Reward „${e.title}“, der nicht von dieser App stammt. Benenne oder lösche ihn in Twitch oder wähle für den Soundboard-Eintrag einen anderen Namen.`);
        throw err;
      }
    } else if (reward.title !== e.title || reward.cost !== e.cost || reward.is_enabled !== active || (reward.global_cooldown_setting?.global_cooldown_seconds ?? 0) !== (e.cooldown > 0 ? e.cooldown : 0) || Boolean(reward.global_cooldown_setting?.is_enabled) !== e.cooldown > 0) {
      reward = (await helix('PATCH', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: reward.id }, body: fields })).data[0];
    }
    e.rewardId = reward.id;
  }
  return entries;
}

// Reward in Twitch löschen (klappt nur bei Rewards dieser App; Fehler sind nicht schlimm)
export async function deleteReward(rewardId) {
  const { user_id } = await userToken();
  await helix('DELETE', 'channel_points/custom_rewards', { query: { broadcaster_id: user_id, id: rewardId } }).catch((e) => console.warn('Reward nicht gelöscht:', e.message));
}

export const EVENT_TYPE = 'channel.channel_points_custom_reward_redemption.add';
export const RAID_TYPE = 'channel.raid';
export const CHAT_TYPE = 'channel.chat.message';
// Alert-Ereignisse: Typ, Version und Bedingung (Follow braucht zusätzlich den Moderator)
export const ALERT_TYPES = ['channel.follow', 'channel.subscribe', 'channel.subscription.message', 'channel.subscription.gift', 'channel.cheer'];
const alertCondition = (type, userId) => (type === 'channel.follow' ? { broadcaster_user_id: userId, moderator_user_id: userId } : { broadcaster_user_id: userId });

// Meine Webhook-Subscriptions (alle Typen und Stati)
export async function listSubscriptions(webhookUrl) {
  const { data } = await helix('GET', 'eventsub/subscriptions', { as: 'app' });
  return data.filter((s) => s.transport?.callback === webhookUrl);
}

// Welche Twitch-Berechtigung ein Webhook braucht und wie er in Meldungen heißt
const NEEDS = {
  [RAID_TYPE]: { label: 'Raids' },
  // Chat per Webhook (App-Token) verlangt von Twitch zusätzlich user:bot und channel:bot; Chatter und Kanal sind hier dieselbe Person
  [CHAT_TYPE]: { label: 'Chat (Befehle, Abspann, Chatter-Rangliste)', scopes: ['user:read:chat', 'user:bot', 'channel:bot'] },
  'channel.follow': { label: 'Follows', scopes: ['moderator:read:followers'] },
  'channel.subscribe': { label: 'Subs', scopes: ['channel:read:subscriptions'] },
  'channel.subscription.message': { label: 'Resubs', scopes: ['channel:read:subscriptions'] },
  'channel.subscription.gift': { label: 'Gift-Subs', scopes: ['channel:read:subscriptions'] },
  'channel.cheer': { label: 'Bits', scopes: ['bits:read'] },
};
const RECONNECT = 'bitte oben auf „Mit Twitch verbinden“ klicken und danach erneut abgleichen';

const sameCondition = (a = {}, b = {}) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const hostOf = (url) => { try { return new URL(url).host; } catch { return 'einer anderen Adresse'; } };

// Eine Subscription pro Reward (so löst nicht jede fremde Einlösung im Kanal einen Aufruf aus),
// dazu optional Raids, Chat und Alerts. Die Reward-Abos sind Pflicht und werfen bei einem Fehler.
// Raids, Chat und Alerts sind Zusatz: scheitert eins (meist fehlt eine Berechtigung), laufen die anderen trotzdem
// weiter, und die Meldungen kommen als Liste zurück.
export async function subscribe(webhookUrl, rewardIds, { raids = false, alerts = false, chat = false } = {}) {
  const { user_id } = await userToken();
  const granted = (await db.get('config/tokens'))?.scopes; // fehlt bei sehr alten Verbindungen, dann einfach versuchen
  for (const sub of await listSubscriptions(webhookUrl)) {
    await helix('DELETE', 'eventsub/subscriptions', { as: 'app', query: { id: sub.id } });
  }
  const notes = [];
  const post = (type, condition, version) => helix('POST', 'eventsub/subscriptions', {
    as: 'app',
    body: { type, version, condition, transport: { method: 'webhook', callback: webhookUrl, secret: process.env.EVENTSUB_SECRET } },
  });
  // Twitch erlaubt je App und Kanal jede Ereignisart nur einmal (409). Blockiert eine alte Anmeldung unter einer anderen
  // Rückruf-Adresse (z. B. von früher), wird genau diese ersetzt und es noch einmal versucht.
  const create = async (type, condition, version = '1') => {
    try { return await post(type, condition, version); } catch (e) {
      if (!/-> 409/.test(e.message)) throw e;
      const { data } = await helix('GET', 'eventsub/subscriptions', { as: 'app', query: { type } });
      const blocking = (data ?? []).filter((x) => x.type === type && x.version === version && sameCondition(x.condition, condition));
      if (!blocking.length) throw e;
      for (const x of blocking) {
        await helix('DELETE', 'eventsub/subscriptions', { as: 'app', query: { id: x.id } });
        notes.push(`Alte Anmeldung für ${NEEDS[type]?.label ?? 'Rewards'} bei ${hostOf(x.transport?.callback)} ersetzt`);
        console.warn(`Alte Anmeldung ${type} (${x.transport?.callback}) ersetzt`);
      }
      return post(type, condition, version);
    }
  };
  for (const rewardId of rewardIds) await create(EVENT_TYPE, { broadcaster_user_id: user_id, reward_id: rewardId });

  const warnings = [];
  const optional = async (type, condition, version) => {
    const { label, scopes = [] } = NEEDS[type];
    const missing = Array.isArray(granted) ? scopes.filter((sc) => !granted.includes(sc)) : [];
    if (missing.length) { warnings.push(`${label}: Berechtigung ${missing.join(', ')} fehlt – ${RECONNECT}`); return; }
    try { await create(type, condition, version); } catch (e) {
      const status = /-> (\d{3})/.exec(e.message)?.[1];
      warnings.push(`${label}: Twitch hat das Abo abgelehnt${status ? ` (${status})` : ''}${status === '403' && scopes.length ? ` – vermutlich fehlt ${scopes.join(', ')}, ${RECONNECT}` : ''}${status === '409' ? ' – es gibt schon eine gleiche Anmeldung, die sich nicht ersetzen ließ' : ''}`);
      console.warn(`Abo ${type} fehlgeschlagen:`, e.message);
    }
  };
  if (raids) await optional(RAID_TYPE, { to_broadcaster_user_id: user_id });
  if (chat) await optional(CHAT_TYPE, { broadcaster_user_id: user_id, user_id });
  if (alerts) for (const type of ALERT_TYPES) await optional(type, alertCondition(type, user_id), type === 'channel.follow' ? '2' : '1');
  return { warnings, notes };
}

// ---- Raid-Helfer (öffentliche Daten, brauchen nur den App-Token)

// Anzeigename, Profilbild und zuletzt gespieltes Spiel eines Kanals
/** Twitch-Konto zu einem Login-Namen: { id, name } oder null. */
export async function lookupUser(login) {
  const { data } = await helix('GET', 'users', { as: 'app', query: { login } });
  return data?.[0] ? { id: data[0].id, name: data[0].display_name } : null;
}

export async function channelInfo(broadcasterId) {
  const [ch, us] = await Promise.all([
    helix('GET', 'channels', { as: 'app', query: { broadcaster_id: broadcasterId } }),
    helix('GET', 'users', { as: 'app', query: { id: broadcasterId } }),
  ]);
  const c = ch.data?.[0] ?? {};
  const u = us.data?.[0] ?? {};
  return { id: broadcasterId, login: u.login ?? c.broadcaster_login, name: c.broadcaster_name ?? u.display_name, game: c.game_name || '', avatar: u.profile_image_url ?? null };
}

// Live-Daten des Kanals (für Platzhalter in Commands): läuft der Stream, seit wann, Zuschauer, Spiel und Titel
export async function streamInfo(broadcasterId) {
  const [st, ch] = await Promise.all([
    helix('GET', 'streams', { as: 'app', query: { user_id: broadcasterId } }),
    helix('GET', 'channels', { as: 'app', query: { broadcaster_id: broadcasterId } }),
  ]);
  const s = st.data?.[0], c = ch.data?.[0] ?? {};
  return { live: Boolean(s), game: s?.game_name || c.game_name || '', title: s?.title || c.title || '', viewers: s?.viewer_count ?? 0, startedAt: s?.started_at ?? null };
}

export async function userByLogin(login) {
  const { data } = await helix('GET', 'users', { as: 'app', query: { login } });
  return data?.[0] ?? null;
}

// Zufälliger Clip aus den beliebtesten Clips des Kanals, höchstens maxSeconds lang
export async function pickClip(broadcasterId, maxSeconds) {
  const { data } = await helix('GET', 'clips', { as: 'app', query: { broadcaster_id: broadcasterId, first: '50' } });
  const fits = (data ?? []).filter((c) => c.duration > 0 && c.duration <= maxSeconds).slice(0, 10); // Liste ist nach Aufrufen sortiert
  if (!fits.length) return null;
  const c = fits[Math.floor(Math.random() * fits.length)];
  return { id: c.id, title: c.title, duration: Math.ceil(c.duration), creator: c.creator_name };
}

// Ein einzelner Clip über seine Kennung (Slug aus dem Link): Ersteller und Kanal
export async function clipById(id) {
  const { data } = await helix('GET', 'clips', { as: 'app', query: { id } });
  const c = data?.[0];
  return c ? { id: c.id, title: c.title, creatorId: c.creator_id, creator: c.creator_name, broadcasterId: c.broadcaster_id } : null;
}

// Offizieller Twitch-Shoutout (Karte im Chat). Twitch erlaubt höchstens einen alle 2 Minuten.
export async function shoutout(toBroadcasterId) {
  const { user_id } = await userToken();
  await helix('POST', 'chat/shoutouts', { query: { from_broadcaster_id: user_id, to_broadcaster_id: toBroadcasterId, moderator_id: user_id } });
}
