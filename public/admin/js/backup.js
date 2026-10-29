// Backup & Wiederherstellen (Reiter „Allgemein“): Der Download ist ein normaler Link, das Einspielen läuft über die API.
import { $, api, run, toast } from './core.js';
import { loadSettings } from './settings.js';
import { loadStatus } from './status.js';
import { loadUsers } from './visitors.js';
import { loadBoard } from './soundboard.js';
import { loadRaids } from './raids.js';

export function initBackup() {
  $('restoreFile').addEventListener('change', () => {
    const f = $('restoreFile').files[0];
    $('restoreInfo').textContent = f ? `${f.name} (${(f.size / 1_000_000).toFixed(2).replace('.', ',')} MB)` : '';
  });
  $('restoreBtn').addEventListener('click', run(async () => {
    const file = $('restoreFile').files[0];
    if (!file) throw new Error('Bitte zuerst eine Backup-Datei auswählen');
    let backup;
    try { backup = JSON.parse(await file.text()); } catch { throw new Error('Die Datei ist kein gültiges JSON'); }
    const n = Object.keys(backup?.entries ?? {}).length;
    const day = backup?.created ? new Date(backup.created).toLocaleString('de-DE') : 'unbekanntem Datum';
    if (!confirm(`Backup vom ${day} mit ${n} Einträgen einspielen?\n\nDer aktuelle Stand (Besucher, Einstellungen, Soundboard) wird dabei ersetzt.`)) return;
    const r = await api('POST', 'backup', { backup, confirm: true });
    $('restoreFile').value = ''; $('restoreInfo').textContent = '';
    await Promise.all([loadSettings(), loadUsers(), loadBoard(), loadRaids(), loadStatus()]);
    toast(`Wiederhergestellt: ${r.restored} Einträge. Bitte jetzt mit Twitch verbinden und Rewards abgleichen.`);
  }));
}
