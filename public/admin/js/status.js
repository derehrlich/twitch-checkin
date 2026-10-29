// Start-Reiter: Status der Einrichtung, Twitch-Verbindung, Rewards und Webhooks abgleichen, OBS-Adresse.
import { $, api, esc, fmtDuration, run, toast } from './core.js';

const check = (cls, text) => `<div class="check"><span class="dot ${cls}"></span><span>${text}</span></div>`;

export async function loadStatus() {
  const s = await api('GET', 'state');
  const envOk = s.env.TWITCH_CLIENT_ID && s.env.TWITCH_CLIENT_SECRET && s.env.EVENTSUB_SECRET;
  const missing = Object.entries(s.env).filter(([, v]) => !v).map(([k]) => k).join(', ');
  const sub = s.subscription;
  const reward = (id, on, label) => (on ? check(id ? 'ok' : 'warn', id ? `${label}-Reward angelegt` : `${label}-Reward noch nicht angelegt (bitte abgleichen)`) : check('', `${label} ist ausgeschaltet`));
  $('checks').innerHTML =
    check(envOk ? 'ok' : 'bad', envOk ? 'Netlify-Variablen gesetzt' : `Fehlende Netlify-Variablen: <b>${esc(missing)}</b>`) +
    check(s.connectedAs ? 'ok' : 'bad', s.connectedAs ? `Mit Twitch verbunden als <b>${esc(s.connectedAs)}</b>` : 'Noch nicht mit Twitch verbunden') +
    (s.missingScopes.length ? check('warn', `Es fehlen Twitch-Berechtigungen (${esc(s.missingScopes.join(', '))}) – bitte „Mit Twitch verbinden“ erneut klicken`) : '') +
    reward(s.rewardId, true, 'Check-in') + reward(s.checkoutRewardId, s.checkoutEnabled, 'Check-out') + reward(s.streakRewardId, s.streakRescueEnabled, 'Streak-Retter') +
    check(sub === 'enabled' ? 'ok' : sub ? 'warn' : 'bad',
      s.revoked ? `Webhook widerrufen (${esc(s.revoked)}), bitte neu abgleichen`
      : sub === 'enabled' ? 'Webhooks aktiv – Ereignisse werden empfangen'
      : sub ? `Webhook-Status: ${esc(sub)}` + (sub.includes('pending') ? ' (Twitch prüft gerade, kurz neu laden)' : '')
      : s.subscriptionError ? `Webhook nicht abfragbar: ${esc(s.subscriptionError)}` : 'Webhooks noch nicht eingerichtet');
  $('uRedirect').textContent = s.urls.redirect; $('uWebhook').textContent = s.urls.webhook; $('overlayUrl').value = s.urls.overlay;
  $('boardUrl2').textContent = s.urls.site + '/rangliste'; $('creditsUrl').textContent = s.urls.site + '/abspann'; $('boardUrl').textContent = s.urls.site + '/rangliste'; $('boardOverlayUrl').textContent = s.urls.site + '/rangliste?overlay';
  $('startStats').innerHTML = [[s.totals.users, 'Besucher gesamt'], [s.totals.today, `Heute (${esc(s.today)})`], [s.totals.checkins, 'Check-ins gesamt']]
    .map(([v, l]) => `<div class="stat"><b>${v}</b><span class="muted">${l}</span></div>`).join('');
  document.dispatchEvent(new CustomEvent('admin:status', { detail: s }));
  return s;
}

async function syncRewards() {
  const buttons = document.querySelectorAll('.js-sync');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const r = await api('POST', 'setup', {});
    const names = [r.reward, r.checkout, r.streak].filter(Boolean).map((x) => `„${x}“`).join(', ');
    if (r.warnings?.length) toast(`Abgleich nur teilweise geglückt: ${r.warnings.join(' · ')}`, true, 20000);
    else toast(`Rewards ${names}${r.soundboard ? ` und ${r.soundboard} Soundboard-Reward(s)` : ''} und Webhooks abgeglichen ✓`);
    $('syncHint').classList.add('hidden');
    await loadStatus();
    document.dispatchEvent(new Event('admin:synced'));
  } finally { buttons.forEach((b) => { b.disabled = false; }); }
}

export function initStatus() {
  document.addEventListener('click', (e) => { if (e.target.closest('.js-sync')) run(syncRewards)(); });
  $('copyOverlay').addEventListener('click', () => navigator.clipboard.writeText($('overlayUrl').value).then(() => toast('Kopiert ✓')));
}
