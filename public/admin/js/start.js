// Startseite als Dashboard: was auf Marcel wartet (Freigaben, Störungen), was gerade läuft (Gewinnspiel, Events, Pause)
// und der technische Zustand. Liest nur vorhandene Admin-Abfragen, speichert nichts.
import { $, api, esc } from './core.js';

let status = null;
const get = (path) => api('GET', path).catch((e) => (e.message === 'Nicht angemeldet' ? Promise.reject(e) : null));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '');
const todo = (kind, text, tab, action) => ({ kind, text, tab, action });

function collectTodos(d) {
  const out = [];
  const s = status;
  if (s) {
    if (!s.connectedAs) out.push(todo('bad', 'Die Stadtwache ist noch nicht mit Twitch verbunden.', 'start', 'Unten verbinden'));
    else if (s.missingScopes.length) out.push(todo('warn', 'Es fehlen Twitch-Berechtigungen. Einmal neu mit Twitch verbinden.', 'start', 'Unten verbinden'));
    if (s.connectedAs && s.subscription !== 'enabled') out.push(todo('bad', s.revoked ? 'Twitch hat die Webhooks widerrufen. Bitte neu abgleichen.' : 'Die Webhooks sind nicht aktiv, Ereignisse kommen nicht an. Bitte abgleichen.', 'start', 'Unten abgleichen'));
  }
  for (const p of d.health?.problems ?? []) out.push(todo('bad', p, 'system', 'Zum System'));
  if (d.backup?.lastError) out.push(todo('warn', `Die letzte automatische Sicherung ist fehlgeschlagen: ${d.backup.lastError}`, 'system', 'Zur Sicherung'));
  const pending = (d.entry?.entries ?? []).filter((e) => e.pending);
  if (pending.length) out.push(todo('warn', `${pending.length === 1 ? 'Ein Einlaufsound wartet' : `${pending.length} Einlaufsounds warten`} auf deine Freigabe: ${pending.map((e) => e.name).join(', ')}`, 'einlaufsound', 'Anhören und freigeben'));
  const g = d.gewinn;
  for (const w of g?.winners ?? []) {
    if (w.status === 'verfallen') continue;
    if (w.kind === 'item' && w.status === 'adresse_erhalten') out.push(todo('warn', `Gewinnspiel: Die Adresse von ${w.name} ist da, der Preis „${w.prizeName}“ kann verschickt werden.`, 'gewinn', 'Zum Gewinnspiel'));
    else if (w.sendError && ['gezogen', 'link_verschickt'].includes(w.status)) out.push(todo('warn', `Gewinnspiel: ${w.name} hat den Gewinner-Link nicht bekommen. Bitte von Hand schicken.`, 'gewinn', 'Zum Gewinnspiel'));
  }
  if (g?.enabled && g.draw && !g.draw.drawnAt && !g.rewardReady) out.push(todo('warn', 'Gewinnspiel: Der Ticket-Reward fehlt noch bei Twitch.', 'start', 'Unten abgleichen'));
  for (const ev of d.tickets?.events ?? []) if (ev.status === 'open' && !ev.rewardId) out.push(todo('warn', `Event „${ev.name}“: Der Ticket-Reward fehlt noch bei Twitch.`, 'tickets', 'Zu den Events'));
  return out;
}

function collectLive(d) {
  const out = [];
  const g = d.gewinn;
  if (g?.enabled && g.draw) {
    const dr = g.draw;
    const state = dr.drawnAt ? `gezogen am ${fmt(dr.drawnAt)}` : { vorher: 'Tickets noch nicht offen', offen: 'Tickets offen', zu: 'Tickets geschlossen' }[g.window] ?? '';
    out.push({ icon: '🎁', title: dr.name, big: `${g.tickets?.length ?? 0}`, unit: 'Teilnehmer', sub: state, tab: 'gewinn' });
  }
  if (d.tickets?.enabled) for (const ev of d.tickets.events) if (['open', 'planned', 'closed'].includes(ev.status)) out.push({ icon: '🎟️', title: ev.name, big: `${ev.taken} / ${ev.seats}`, unit: 'Plätze vergeben', sub: `${ev.when} · ${ev.statusLabel}${ev.waiting ? ` · Warteliste ${ev.waiting}` : ''}`, tab: 'tickets' });
  if (d.pause?.state?.active) out.push({ icon: '☕', title: 'Pause läuft', big: d.pause.state.text || 'Pause', unit: '', sub: d.pause.state.until ? `bis ${fmt(d.pause.state.until)}` : 'ohne Zeitangabe', tab: 'pause' });
  const adv = d.adv;
  if (adv?.enabled) out.push({ icon: '🗺️', title: 'Adventure-Einreichung', big: `${adv.counts?.all ?? adv.entries?.length ?? 0}`, unit: 'eingereicht', sub: adv.open ? 'offen' : 'geschlossen', tab: 'adventure' });
  const sounds = (d.entry?.entries ?? []).filter((e) => e.soundVersion).length;
  if (sounds) out.push({ icon: '🎺', title: 'Einlaufsounds', big: `${sounds}`, unit: 'aktiv', sub: '', tab: 'einlaufsound' });
  return out;
}

function render(d) {
  const todos = collectTodos(d);
  $('dashTodo').innerHTML = todos.length
    ? todos.map((t) => `<div class="todo ${t.kind}"><span class="dot ${t.kind}"></span><span>${esc(t.text)}</span>${t.tab === 'start' ? `<small class="muted">${esc(t.action)}</small>` : `<a class="btn ghost" href="#${t.tab}" data-go="${t.tab}">${esc(t.action)}</a>`}</div>`).join('')
    : '<div class="todo ok"><span class="dot ok"></span><span>Alles erledigt. Gerade wartet nichts auf dich.</span></div>';
  const live = collectLive(d);
  $('dashLive').innerHTML = live.length
    ? live.map((l) => `<a class="tile" href="#${l.tab}" data-go="${l.tab}"><span class="tile-head"><span aria-hidden="true">${l.icon}</span>${esc(l.title)}</span><b>${esc(l.big)}</b><span class="muted">${esc([l.unit, l.sub].filter(Boolean).join(' · '))}</span></a>`).join('')
    : '<p class="muted" style="margin:0">Gerade läuft kein Gewinnspiel und kein Event. Sobald du eines startest, steht es hier.</p>';
  // Die Technik-Punkte klappen nur auf, wenn dort etwas nicht stimmt
  const techBad = Boolean(status) && (!status.connectedAs || status.subscription !== 'enabled' || status.missingScopes.length > 0);
  $('dashTech').open = techBad;
  $('dashTechState').textContent = techBad ? 'bitte ansehen' : 'alles in Ordnung';
  $('dashTechState').classList.toggle('on', !techBad);
}

export async function loadStart() {
  const [entry, tickets, gewinn, health, backup, pause, adv] = await Promise.all(['entrysound', 'tickets', 'gewinn', 'health', 'backup/status', 'pause', 'adventure'].map(get));
  render({ entry, tickets, gewinn, health, backup, pause, adv });
}

export function initStart() {
  document.addEventListener('admin:status', (e) => { status = e.detail; });
  // Beim Wechsel auf die Startseite und nach einem Abgleich frisch laden
  document.addEventListener('admin:tab', (e) => { if (e.detail === 'start' && status) loadStart().catch(() => {}); });
  document.addEventListener('admin:synced', () => loadStart().catch(() => {}));
}
