// Einstieg der Admin-Oberfläche: Anmeldung, Reiter und Start der einzelnen Bereiche.
import { $, api, run } from './core.js';
import { initSettings, loadSettings, renderForms } from './settings.js';
import { initStatus, loadStatus } from './status.js';
import { initMedia, renderMedia } from './media.js';
import { initSoundboard, loadBoard } from './soundboard.js';
import { initEntrySound, loadEntrySounds } from './entrysound.js';
import { initCommunity, loadCommunity } from './community.js';
import { initCommands, loadCommands } from './commands.js';
import { initCatalog, loadCatalog } from './catalog.js';
import { initVisitors, loadUsers } from './visitors.js';
import { initTests } from './tests.js';
import { initRaids, loadRaids } from './raids.js';
import { initBackup, loadAutoBackup } from './backup.js';
import { initUpdate, loadUpdate } from './update.js';
import { initSport, loadSport } from './sport.js';
import { initModeration, loadModeration } from './moderation.js';
import { initHealth, loadHealth } from './health.js';
import { initTickets, loadTickets } from './tickets.js';
import { initGewinn, loadGewinn } from './gewinn.js';
import { initFeier, loadFeier } from './feier.js';
import { initPause, loadPause } from './pause.js';
import { initKochen, loadKochen } from './kochen.js';
import { initLicht } from './licht.js';
import { initStartscreen, loadStartscreen } from './startscreen.js';
import { initNav } from './nav.js';
import { initStart, loadStart } from './start.js';
import { initStats, loadStats } from './statistik.js';
import { initMediakit, loadMediakit } from './mediakit.js';
import { initPoll, loadPoll } from './umfrage.js';
import { initLevel, loadLevel } from './level.js';

function showLogin(disabled) {
  $('login').classList.remove('hidden'); $('app').classList.add('hidden'); $('logout').classList.add('hidden');
  $('loginHint').textContent = disabled ? 'Die Umgebungsvariable ADMIN_PASSWORD ist noch nicht gesetzt.' : '';
}

async function init() {
  await loadStatus();
  $('login').classList.add('hidden'); $('app').classList.remove('hidden'); $('logout').classList.remove('hidden');
  await Promise.all([loadSettings(), loadUsers(), loadBoard(), loadCommands(), loadRaids(), loadEntrySounds(), loadCommunity(), loadCatalog(), loadSport(), loadModeration(), loadHealth(), loadTickets(), loadGewinn(), loadFeier(), loadPause(), loadKochen(), loadStartscreen(), loadUpdate(), loadAutoBackup(), loadStart(), loadStats(), loadMediakit(), loadPoll(), loadLevel()]);
  if (new URLSearchParams(location.search).has('verbunden')) {
    $('syncHint').classList.remove('hidden');
    history.replaceState(null, '', '/admin/' + location.hash);
  }
}

renderForms();
$('alpacaUrl').textContent = location.origin + '/alpakas';
$('chatUrl').textContent = location.origin + '/chat';
$('chatHochUrl').textContent = location.origin + '/chat-hoch';
initSettings(); initStatus(); initMedia(); initSoundboard(); initCommands(); initEntrySound(); initCatalog(); initCommunity(); initVisitors(); initTests(); initRaids(); initBackup(); initSport(); initModeration(); initHealth(); initUpdate(); initTickets(); initGewinn(); initFeier(); initPause(); initKochen(); initLicht(); initStartscreen();
document.addEventListener('admin:settings', renderMedia);
document.addEventListener('admin:loggedout', (e) => showLogin(e.detail.adminDisabled));

initStart(); initStats(); initMediakit(); initPoll(); initLevel(); initNav();

$('logout').addEventListener('click', run(async () => { await api('POST', 'logout', {}); showLogin(false); }));
$('loginForm').addEventListener('submit', run(async (e) => {
  e.preventDefault();
  await api('POST', 'login', { password: $('pw').value }); $('pw').value = '';
  await init();
}));
init().catch(() => {});
