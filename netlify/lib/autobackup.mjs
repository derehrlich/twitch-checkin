// Automatische Sicherung auf dem Heimserver: legt jede Nacht eine Datei im Backup-Ordner ab und räumt alte weg.
// Der Ordner ist BACKUP_DIR (in CasaOS auf eine Freigabe des NAS gelegt, also ein anderes Gerät als die Daten), sonst <Datenordner>/backups.
// Auf Netlify (ohne LOCAL_STORE_DIR) passiert nichts.
// Dateinamen: stadtwache-JJJJ-MM-TT.json (pro Tag eine, die jüngsten backupKeep bleiben).
import fs from 'node:fs';
import path from 'node:path';
import { db } from './store.mjs';
import { getSettings } from './settings.mjs';
import { buildBackup } from './admin/backup.mjs';

const NAME = /^stadtwache-(\d{4}-\d{2}-\d{2})\.json$/;
const STATE_KEY = 'config/backup-state'; // { lastOk, lastError } (gehört nicht in die Sicherung selbst)
export const backupDir = () => process.env.BACKUP_DIR || path.join(process.env.LOCAL_STORE_DIR ?? '.', 'backups');

// Datum und Stunde in der Zeitzone der Einstellungen
function localNow(tz, now = new Date()) {
  const [date, time] = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(now).split(' ');
  return { date, hour: Number(time.slice(0, 2)) };
}

const filesIn = (dir) => {
  try { return fs.readdirSync(dir).filter((n) => NAME.test(n)).sort(); } catch { return []; }
};

/** Eine Sicherung schreiben (erst in eine Hilfsdatei, dann umbenennen) und alte entfernen. */
export async function runBackupNow(now = new Date()) {
  if (!process.env.LOCAL_STORE_DIR) return { ok: false, error: 'Automatische Sicherung gibt es nur auf dem Heimserver' };
  const settings = await getSettings();
  const dir = backupDir();
  const state = (await db.get(STATE_KEY)) ?? {};
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `stadtwache-${localNow(settings.timezone, now).date}.json`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(await buildBackup(settings.backupMedia)));
    fs.renameSync(tmp, file);
    for (const old of filesIn(dir).slice(0, -settings.backupKeep)) fs.rmSync(path.join(dir, old), { force: true });
    await db.set(STATE_KEY, { lastOk: now.toISOString(), lastError: null });
    return { ok: true, name: path.basename(file) };
  } catch (e) {
    await db.set(STATE_KEY, { ...state, lastError: `${e.message}`, lastErrorAt: now.toISOString() });
    return { ok: false, error: `Sicherung fehlgeschlagen: ${e.message}` };
  }
}

/** Wird regelmäßig aufgerufen: sichert einmal pro Tag, sobald die eingestellte Uhrzeit erreicht ist. */
export async function backupTick(now = new Date()) {
  if (!process.env.LOCAL_STORE_DIR) return null;
  const settings = await getSettings();
  if (!settings.backupAutoEnabled) return null;
  const { date, hour } = localNow(settings.timezone, now);
  if (hour < settings.backupHour) return null;
  if (filesIn(backupDir()).includes(`stadtwache-${date}.json`)) return null; // heute schon gesichert
  return runBackupNow(now);
}

export async function backupStatus() {
  const settings = await getSettings();
  const dir = backupDir();
  const state = (await db.get(STATE_KEY)) ?? {};
  const files = filesIn(dir).reverse().map((name) => {
    const st = fs.statSync(path.join(dir, name));
    return { name, size: st.size, modified: st.mtime.toISOString() };
  });
  return { available: Boolean(process.env.LOCAL_STORE_DIR), enabled: settings.backupAutoEnabled, dir, hour: settings.backupHour, keep: settings.backupKeep, files, lastOk: state.lastOk ?? null, lastError: state.lastError ?? null };
}
