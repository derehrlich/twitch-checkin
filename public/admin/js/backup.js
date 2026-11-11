// Backup & Wiederherstellen (Reiter „Allgemein“): Der Download ist ein normaler Link, das Einspielen läuft über die API.
import { $, api, esc, run, toast } from './core.js';
import { loadSettings } from './settings.js';
import { loadStatus } from './status.js';
import { loadUsers } from './visitors.js';
import { loadBoard } from './soundboard.js';
import { loadRaids } from './raids.js';

const mb = (b) => `${(b / 1_000_000).toFixed(1).replace('.', ',')} MB`;
const when = (iso) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export async function loadAutoBackup() {
  const s = await api('GET', 'backup/status');
  if (!s.available) { $('autoInfo').textContent = 'Die automatische Sicherung gibt es nur auf dem Heimserver.'; $('autoNow').disabled = true; return; }
  const last = s.files[0];
  $('autoInfo').innerHTML = [
    s.enabled ? `Jede Nacht ab ${s.hour} Uhr, die letzten ${s.keep} bleiben liegen.` : '⚠️ Ist ausgeschaltet (Einstellung „Automatische Sicherung“ oben).',
    `Ordner: <code>${esc(s.dir)}</code>`,
    last ? `Letzte Sicherung: <b>${esc(when(last.modified))}</b> (${mb(last.size)}), insgesamt ${s.files.length} Dateien.` : 'Es gibt noch keine Sicherung.',
    s.lastError ? `⚠️ Letzter Fehler: ${esc(s.lastError)}. Ist der Ordner erreichbar und beschreibbar?` : '',
  ].filter(Boolean).join('<br>');
}

export function initBackup() {
  $('autoNow').addEventListener('click', run(async () => {
    $('autoNow').disabled = true;
    try {
      const r = await api('POST', 'backup/now');
      if (!r.ok) throw new Error(r.error);
      toast(`Gesichert: ${r.name}`);
    } finally { $('autoNow').disabled = false; await loadAutoBackup(); }
  }));
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
