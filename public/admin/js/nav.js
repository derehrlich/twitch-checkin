// Menü der Admin-Oberfläche: Gruppen mit Seiten, Suche über alle Seiten und Einstellungen, Schublade am Handy.
// Eine neue Seite braucht hier eine Zeile und in index.html einen <div class="tab-panel" data-panel="…">.
import { $, esc, toast } from './core.js';

export const NAV = [
  ['', [['start', '🏠', 'Start']]],
  ['Stream', [['zuschauer', '✅', 'Check-in und Besucher'], ['ereignisse', '🔔', 'Alerts'], ['raids', '⚔️', 'Raids']]],
  ['Chat', [['commands', '💬', 'Eigene Commands'], ['chat', '❗', 'Befehle und Shoutout'], ['moderation', '🛡️', 'Moderation'], ['chatleiste', '🗨️', 'Chat im Stream']]],
  ['Belohnungen', [['soundboard', '🔊', 'Soundboard'], ['einlaufsound', '🎺', 'Einlaufsound'], ['alpakas', '🦙', 'Alpakas'], ['community', '🏆', 'Rangliste'], ['level', '🏗️', 'Dorf-Level'], ['meine', '🙋', 'Meine Stadtwache']]],
  ['Zahlen', [['statistik', '📈', 'Twitch-Statistik'], ['mediakit', '📰', 'Mediakit']]],
  ['Aktionen', [['tickets', '🎟️', 'Events und Tickets'], ['gewinn', '🎁', 'Gewinnspiel'], ['umfrage', '📊', 'Umfragen'], ['feier', '🎂', 'Geburtstagswoche'], ['rad', '🎡', 'Glücksrad'], ['adventure', '🗺️', 'Adventures']]],
  ['Overlays', [['obs', '🎬', 'OBS-Adressen'], ['startscreen', '⏳', 'Startbildschirm'], ['pause', '☕', 'Pause'], ['kochen', '🍳', 'Kochen'], ['abspann', '📜', 'Abspann und Panel'], ['sport', '🏃', 'Sport']]],
  ['Verwaltung', [['medien', '🎵', 'Töne und Bilder'], ['tests', '🧪', 'Tests'], ['system', '⚙️', 'System']]],
];
export const PAGES = NAV.flatMap(([group, items]) => items.map(([id, icon, name]) => ({ id, icon, name, group })));
// Alte Adressen (#belohnungen, #besucher …) führen weiter an die richtige Stelle
const OLD = { checkin: 'zuschauer', besucher: 'zuschauer', alerts: 'ereignisse', belohnungen: 'soundboard', overlays: 'obs', allgemein: 'system', backup: 'system' };

// Weitere Overlays für die Seite „OBS-Adressen“: Name, Pfad, empfohlene Größe, zugehörige Seite
const OVERLAYS = [
  ['Chat-Leiste (waagerecht)', '/chat', '1920 × 120', 'chatleiste'], ['Klassischer Chat', '/chat-hoch', '560 × 420', 'chatleiste'],
  ['Alpaka-Leiste', '/alpakas', '1920 × 120', 'alpakas'], ['Startbildschirm', '/startscreen', '1920 × 1080', 'startscreen'],
  ['Pause', '/pause', '1920 × 1080', 'pause'], ['Kochen', '/kochen', '1920 × 1080', 'kochen'], ['Abspann', '/abspann', '1920 × 1080', 'abspann'], ['Rangliste', '/rangliste?overlay', 'frei', 'abspann'],
  ['Sport-Scoreboard', '/sport', '1920 × 1080', 'sport'], ['Countdown', '/countdown', '1920 × 1080', 'feier'],
  ['Glücksrad', '/rad', '1920 × 1080', 'rad'], ['Gewinnspiel-Ziehung', '/gewinn/overlay', '1920 × 1080', 'gewinn'], ['Umfrage', '/umfrage', '1920 × 1080', 'umfrage'], ['Meine Stadtwache (Zuschauer-Seite)', '/meine', 'Browser', 'meine'],
  ['Mediakit (öffentliche Seite)', '/mediakit', 'Browser', 'mediakit'],
];

const page = (id) => PAGES.find((p) => p.id === id);
const drawer = (open) => {
  $('tabs').classList.toggle('open', open); $('navBack').classList.toggle('hidden', !open);
  $('burger').setAttribute('aria-expanded', String(open));
};

export function showTab(name) {
  name = OLD[name] ?? name;
  const p = page(name) ?? PAGES[0];
  for (const el of document.querySelectorAll('.tab-panel')) el.classList.toggle('hidden', el.dataset.panel !== p.id);
  for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === p.id));
  $('pageIcon').textContent = p.icon; $('pageTitle').textContent = p.name;
  if (location.hash !== '#' + p.id) history.replaceState(null, '', '#' + p.id);
  drawer(false);
  document.dispatchEvent(new CustomEvent('admin:tab', { detail: p.id }));
}

/** Springt zu einer Stelle: Seite öffnen, zugeklappte Karte aufklappen, hinscrollen und kurz hervorheben. */
export function goTo(tab, el) {
  showTab(tab);
  if (!el) { scrollTo({ top: 0 }); return; }
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  const target = el.matches('input, textarea, select') ? el.closest('label.check') ?? el.parentElement : el;
  target.scrollIntoView({ block: 'center' });
  target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1800);
}

// ---- Suche: Seiten, Karten-Überschriften und jede einzelne Einstellung
let index = [];
function buildIndex() {
  index = PAGES.map((p) => ({ text: p.name, where: p.group || 'Seite', tab: p.id, el: null }));
  for (const panel of document.querySelectorAll('.tab-panel')) {
    const p = page(panel.dataset.panel); if (!p) continue;
    for (const h of panel.querySelectorAll('section.card > h2, .fold-title')) index.push({ text: h.textContent, where: p.name, tab: p.id, el: h.closest('section, details') });
    for (const f of panel.querySelectorAll('[data-setting]')) {
      const label = f.closest('label') ?? panel.querySelector(`label[for="${f.id}"]`);
      if (label) index.push({ text: label.textContent.trim(), where: `${p.name} › ${f.closest('details')?.querySelector('.fold-title')?.textContent ?? ''}`, tab: p.id, el: f });
    }
  }
}
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function search(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const box = $('navResults');
  if (!words.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const hits = index.filter((e) => words.every((w) => norm(e.text + ' ' + e.where).includes(w))).slice(0, 12);
  box.innerHTML = hits.length
    ? hits.map((h) => `<button type="button" data-hit="${index.indexOf(h)}"><b>${esc(h.text)}</b><small>${esc(h.where)}</small></button>`).join('')
    : '<p class="muted">Nichts gefunden.</p>';
  box.classList.remove('hidden');
}

export function initNav() {
  $('tabs').innerHTML = '<div class="nav-search"><input id="navSearch" type="search" placeholder="Suchen …" aria-label="Seiten und Einstellungen durchsuchen" autocomplete="off"><div id="navResults" class="nav-results hidden"></div></div>'
    + NAV.map(([group, items]) => (group ? `<div class="nav-group">${group}</div>` : '')
      + items.map(([id, icon, name]) => `<button type="button" data-tab="${id}"><span class="nav-icon" aria-hidden="true">${icon}</span><span>${name}</span></button>`).join('')).join('');
  $('tabs').addEventListener('click', (e) => {
    const hit = e.target.closest('button[data-hit]');
    if (hit) { const h = index[Number(hit.dataset.hit)]; $('navSearch').value = ''; search(''); goTo(h.tab, h.el); return; }
    const b = e.target.closest('button[data-tab]'); if (b) { showTab(b.dataset.tab); scrollTo({ top: 0 }); }
  });
  $('navSearch').addEventListener('input', (e) => search(e.target.value));
  $('navSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('navResults').querySelector('button')?.click();
    if (e.key === 'Escape') { e.target.value = ''; search(''); }
  });
  $('burger').addEventListener('click', () => drawer(!$('tabs').classList.contains('open')));
  $('navBack').addEventListener('click', () => drawer(false));
  addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  // Verweise im Text: <a data-go="seite">
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); goTo(a.dataset.go); } });

  $('obsList').innerHTML = '<div style="overflow-x:auto"><table><thead><tr><th>Overlay</th><th>Adresse</th><th>Größe</th><th></th></tr></thead><tbody>'
    + OVERLAYS.map(([name, path, size, tab]) => `<tr><td><a href="#${tab}" data-go="${tab}">${name}</a></td><td><code>${esc(location.origin + path)}</code></td><td>${size}</td><td><button type="button" class="ghost" data-copy="${esc(location.origin + path)}">Kopieren</button></td></tr>`).join('')
    + '</tbody></table></div>';
  $('obsList').addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Kopiert ✓')); });

  $('meineUrl').textContent = location.origin + '/meine';
  buildIndex();
  showTab(location.hash.slice(1));
}
