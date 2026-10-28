// Tests-Reiter: Beispiel-Ereignisse ans Overlay oder in den Chat schicken (verändert keine Zähler) und Raids nachtragen.
import { $, api, run, toast } from './core.js';

export function initTests() {
  document.addEventListener('click', run(async (e) => {
    const btn = e.target.closest('button[data-test]');
    if (!btn) return;
    const res = await api('POST', 'test', { target: btn.dataset.test, user: $('testUser').value, count: $('testCount').value, raider: $('testRaider').value });
    if (btn.dataset.test === 'raid') toast(res.clip ? `Raid-Test gesendet mit Clip „${res.clip}“ (dauert bis ca. 3 s)` : 'Raid-Test gesendet – es wurde kein passender Clip gefunden');
    else toast(btn.dataset.test.endsWith('chat') ? 'Nachricht im Chat gesendet ✓' : 'Test gesendet (dauert bis ca. 3 s)');
  }));
  $('raidSeed').addEventListener('click', run(async () => {
    const r = await api('POST', 'raids', { login: $('raidSeedLogin').value, count: $('raidSeedCount').value });
    toast(`${r.name}: ${r.count} bisherige Raids gespeichert ✓`);
  }));
}
