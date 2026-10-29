// Gemeinsame Basis aller Admin-Skripte: Zugriff auf die API, Meldungen, kleine Helfer.
export const $ = (id) => document.getElementById(id);

// Gemeinsamer Zustand, damit die Bereiche nicht ständig Daten untereinander reichen müssen
export const state = { settings: {}, users: [] };

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);

// 134 -> "2 Std 14 Min"
export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} Min`;
  return m % 60 ? `${Math.floor(m / 60)} Std ${m % 60} Min` : `${Math.floor(m / 60)} Std`;
}

export function toast(msg, err = false, ms = 3800) {
  const t = $('toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), ms);
}

/** Aufruf der Admin-API. Bei 401 meldet es das per Ereignis, damit die Anmeldung erscheint. */
export async function api(method, path, body) {
  const write = method !== 'GET';
  const res = await fetch('/api/admin/' + path, {
    method,
    headers: write ? { 'content-type': 'application/json' } : {},
    body: write ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') {
    document.dispatchEvent(new CustomEvent('admin:loggedout', { detail: { adminDisabled: data.adminEnabled === false } }));
    throw new Error('Nicht angemeldet');
  }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Fängt Fehler eines Klick-Handlers ab und zeigt sie als Meldung. */
export const run = (fn) => async (...a) => {
  try { await fn(...a); } catch (e) { if (e.message !== 'Nicht angemeldet') toast(e.message, true); }
};

/** Datei prüfen und als Base64 lesen (für den Upload). */
export function readUpload(file, maxBytes) {
  if (!file) throw new Error('Bitte zuerst eine Datei auswählen');
  if (file.size > maxBytes) throw new Error(`Die Datei ist zu groß (maximal ${String(maxBytes / 1_000_000).replace('.', ',')} MB)`);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    r.readAsDataURL(file);
  });
}

/** Lautstärke aus dem Feld „Allgemein“ für Vorschauen im Admin. */
export const previewVolume = () => Math.min(1, Math.max(0, Number($('volume')?.value) || 0));

/** Klicks auf Knöpfe mit data-act innerhalb einer Liste (je Zeile ein data-Attribut als Schlüssel). */
export function onAct(container, rowSelector, handler) {
  container.addEventListener('click', run(async (e) => {
    const btn = e.target.closest('button[data-act]');
    const row = btn?.closest(rowSelector);
    if (btn && row) await handler(btn.dataset.act, row, btn);
  }));
}
