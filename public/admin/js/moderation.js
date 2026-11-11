// Moderation (Reiter Chat): Protokoll, was der Bot gelöscht hat (oder im Testmodus gelöscht hätte).
import { $, api, esc, run, toast } from './core.js';

const RULES = { link: 'Link', word: 'Gesperrtes Wort', caps: 'Großbuchstaben', repeat: 'Wiederholung', emotes: 'Emote-Spam' };
const fmt = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function render(log) {
  $('modLog').innerHTML = log.length
    ? `<div style="overflow-x:auto"><table><thead><tr><th>Wann</th><th>Wer</th><th>Regel</th><th>Nachricht</th><th>Was passierte</th></tr></thead><tbody>${log.map((e) => `<tr><td>${esc(fmt(e.t))}</td><td>${esc(e.user)}</td><td>${esc(RULES[e.rule] ?? e.rule)}</td><td>${esc(e.text)}</td><td>${esc(e.action)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Noch nichts im Protokoll.</p>';
}

export async function loadModeration() { render((await api('GET', 'moderation')).log); }

export function initModeration() {
  $('modReload').addEventListener('click', run(loadModeration));
  $('modClear').addEventListener('click', run(async () => {
    if (!confirm('Das Protokoll leeren?')) return;
    render((await api('DELETE', 'moderation')).log); toast('Protokoll geleert ✓');
  }));
}
