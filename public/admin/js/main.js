// Einstieg der Admin-Oberfläche: Anmeldung, Reiter und Start der einzelnen Bereiche.
import { $, api, run } from './core.js';
import { initSettings, loadSettings, renderForms } from './settings.js';
import { initStatus, loadStatus } from './status.js';
import { initMedia, renderMedia } from './media.js';
import { initSoundboard, loadBoard } from './soundboard.js';
import { initEntrySound, loadEntrySounds } from './entrysound.js';
import { initVisitors, loadUsers } from './visitors.js';
import { initTests } from './tests.js';
import { initRaids, loadRaids } from './raids.js';
import { initBackup } from './backup.js';

const TABS = ['start', 'checkin', 'alerts', 'raids', 'abspann', 'soundboard', 'einlaufsound', 'medien', 'besucher', 'tests', 'allgemein'];

function showTab(name) {
  if (!TABS.includes(name)) name = 'start';
  for (const p of document.querySelectorAll('.tab-panel')) p.classList.toggle('hidden', p.dataset.panel !== name);
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}

function showLogin(disabled) {
  $('login').classList.remove('hidden'); $('app').classList.add('hidden'); $('logout').classList.add('hidden');
  $('loginHint').textContent = disabled ? 'Die Umgebungsvariable ADMIN_PASSWORD ist in Netlify noch nicht gesetzt.' : '';
}

async function init() {
  await loadStatus();
  $('login').classList.add('hidden'); $('app').classList.remove('hidden'); $('logout').classList.remove('hidden');
  await Promise.all([loadSettings(), loadUsers(), loadBoard(), loadRaids(), loadEntrySounds()]);
  if (new URLSearchParams(location.search).has('verbunden')) {
    $('syncHint').classList.remove('hidden');
    history.replaceState(null, '', '/admin/' + location.hash);
  }
}

renderForms();
initSettings(); initStatus(); initMedia(); initSoundboard(); initEntrySound(); initVisitors(); initTests(); initRaids(); initBackup();
document.addEventListener('admin:settings', renderMedia);
document.addEventListener('admin:loggedout', (e) => showLogin(e.detail.adminDisabled));

$('tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
addEventListener('hashchange', () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));

$('logout').addEventListener('click', run(async () => { await api('POST', 'logout', {}); showLogin(false); }));
$('loginForm').addEventListener('submit', run(async (e) => {
  e.preventDefault();
  await api('POST', 'login', { password: $('pw').value }); $('pw').value = '';
  await init();
}));
init().catch(() => {});
