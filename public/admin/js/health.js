// Störungs-Meldungen (Reiter System): zeigt, was die Stadtwache gerade für ein Problem hält, und schickt eine Test-Nachricht an Discord.
import { $, api, esc, run, toast } from './core.js';

function render(h) {
  const state = !h.enabled ? 'Die Meldungen sind ausgeschaltet.' : !h.hasWebhook ? 'Es fehlt noch eine gültige Discord-Webhook-Adresse (oben eintragen und speichern).' : 'Die Meldungen sind eingeschaltet.';
  $('healthInfo').innerHTML = `<p class="muted">${esc(state)}</p>` + (h.problems.length
    ? `<p><b>Gerade nicht in Ordnung:</b></p><ul>${h.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
    : '<p>✅ Gerade ist alles in Ordnung.</p>');
}

export async function loadHealth() { render(await api('GET', 'health')); }

export function initHealth() {
  $('healthCheck').addEventListener('click', run(loadHealth));
  $('healthTest').addEventListener('click', run(async () => { await api('POST', 'health/test', {}); toast('Test-Nachricht gesendet ✓ – schau in deinen Discord-Kanal'); }));
  document.addEventListener('admin:settings', run(loadHealth));
}
