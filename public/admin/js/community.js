// Community-Reiter: Stand der Einrichtung, Top 10 des Monats, verknüpfte Konten (löschen möglich).
import { $, api, esc, onAct, toast } from './core.js';

export async function loadCommunity() {
  const d = await api('GET', 'community');
  $('comUrl').textContent = `${location.origin}/verknuepfen`;
  $('comInfo').innerHTML = `${d.secretSet ? '✅ Geheimwort <code>LINK_SECRET</code> ist gesetzt.' : '⚠️ <b>LINK_SECRET fehlt</b> in den Netlify-Variablen, ohne es kann niemand verknüpfen.'} ${d.enabled ? `Aktiv, ${esc(d.month)}.` : 'Noch ausgeschaltet.'} ${d.links.length} verknüpfte Konten.`;
  $('comTop').innerHTML = d.top.length ? `<h3>Top ${d.top.length} im ${esc(d.month)}</h3><ol>${d.top.map((r) => `<li>${esc(r.name)} · <b>${r.points}</b> Punkte <span class="muted">(Twitch ${r.twitchMsgs} · Discord ${r.discordMsgs} Nachrichten · ${r.checkins} Check-ins)</span></li>`).join('')}</ol>` : '';
  $('comRows').innerHTML = d.links.length ? d.links.map((l) => `<tr data-id="${esc(l.twitchId)}"><td>${esc(l.twitchName)}</td><td>${esc(l.discordName || '–')}</td><td>${new Date(l.at).toLocaleDateString('de-DE')}</td><td><button data-act="del" class="danger">Löschen</button></td></tr>`).join('') : '<tr><td colspan="4" class="muted">Noch niemand verknüpft.</td></tr>';
}

export function initCommunity() {
  onAct($('comRows'), 'tr[data-id]', async (act, row) => {
    if (act !== 'del') return;
    if (!confirm('Verknüpfung löschen? Die Person verschwindet aus der öffentlichen Rangliste.')) return;
    await api('DELETE', `community/${row.dataset.id}`); await loadCommunity(); toast('Verknüpfung gelöscht ✓');
  });
  document.addEventListener('admin:synced', () => loadCommunity().catch(() => {}));
}
