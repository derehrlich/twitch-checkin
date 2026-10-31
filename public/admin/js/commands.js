// Commands-Reiter: eigene Chat-Befehle, Stichwörter und zeitgesteuerte Regeln mit mehreren Aktionen nacheinander.
import { $, api, esc, onAct, run, toast } from './core.js';

let list = [], sounds = [];
export async function loadCommands() { ({ commands: list, sounds } = await api('GET', 'commands')); render(); }

const TRIGGERS = { command: 'Chat-Befehl (!ant)', keyword: 'Stichwort im Chat', timer: 'Zeitgesteuert (nur bei Chat-Aktivität)' };
const ROLES = { all: 'Alle', sub: 'Abonnenten und höher', vip: 'VIPs und höher', mod: 'Moderatoren und höher', owner: 'Nur ich' };
const opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');

function actionHtml(a) {
  if (a.type === 'chat') return `<div class="act" data-type="chat"><label>💬 Chat-Text</label><input data-a="text" maxlength="450" value="${esc(a.text ?? '')}" placeholder="z. B. Hallo {user}!"></div>`;
  if (a.type === 'alert') return `<div class="act" data-type="alert"><label>🪧 Overlay-Alert (Titel und Text)</label><div class="row"><input data-a="title" maxlength="60" value="${esc(a.title ?? '')}" placeholder="Titel"><input data-a="message" maxlength="200" value="${esc(a.message ?? '')}" placeholder="Text, z. B. {args}"></div></div>`;
  const choices = sounds.map((s) => `<option value="${s.id}"${s.id === a.soundId ? ' selected' : ''}>${esc(s.title)}</option>`).join('');
  return `<div class="act" data-type="sound"><label>🔊 Sound aus dem Soundboard</label><select data-a="soundId"><option value="">– wählen –</option>${choices}</select></div>`;
}

function cmdHtml(c) {
  const t = c.trigger;
  return `<div class="entry" data-id="${esc(c.id)}">
    <div class="grid2">
      <div><label>Name</label><input data-f="name" maxlength="45" value="${esc(c.name)}"></div>
      <div><label>Auslöser</label><select data-f="type">${opts(TRIGGERS, t.type)}</select></div>
      ${t.type === 'timer'
        ? `<div><label>Alle … Minuten</label><input data-f="minutes" type="number" min="5" max="720" value="${t.minutes}"></div>
           <div><label>Mindestens … Chat-Nachrichten seit dem letzten Mal</label><input data-f="minMessages" type="number" min="1" max="100" value="${t.minMessages}"></div>`
        : `<div><label>${t.type === 'command' ? 'Befehl' : 'Stichwort (ganzes Wort)'}</label><input data-f="word" maxlength="40" value="${esc(t.word ?? '')}"></div>
           <div><label>Wer darf?</label><select data-f="role">${opts(ROLES, c.role)}</select></div>
           <div><label>Abklingzeit (Sekunden, für alle zusammen)</label><input data-f="cooldown" type="number" min="0" max="86400" value="${c.cooldown}"></div>`}
    </div>
    <p class="muted" style="margin:10px 0 4px">Aktionen laufen nacheinander. Platzhalter: <code>{user}</code> <code>{args}</code> (Text nach dem Befehl) <code>{channel}</code></p>
    <div class="acts">${c.actions.map(actionHtml).join('')}</div>
    <div class="row" style="margin-top:8px">
      <button class="ghost" data-act="add-chat">+ Chat-Text</button><button class="ghost" data-act="add-alert">+ Alert</button><button class="ghost" data-act="add-sound">+ Sound</button>
      <button class="ghost" data-act="rm-last">Letzte Aktion entfernen</button>
    </div>
    <label class="check big"><input data-f="enabled" type="checkbox" ${c.enabled ? 'checked' : ''}> Aktiv</label>
    <div class="row"><button data-act="save">Speichern</button><button class="ghost" data-act="test">Testen</button><button class="danger" data-act="del">Löschen</button></div>
  </div>`;
}

function render() {
  $('cmdRows').innerHTML = list.length ? list.map(cmdHtml).join('') : '<p class="muted">Noch keine Commands.</p>';
}

function read(row) {
  const f = (k) => row.querySelector(`[data-f=${k}]`);
  const type = f('type').value;
  return {
    name: f('name').value, enabled: f('enabled').checked, role: f('role')?.value, cooldown: f('cooldown')?.value,
    trigger: { type, word: f('word')?.value, minutes: f('minutes')?.value, minMessages: f('minMessages')?.value },
    actions: [...row.querySelectorAll('.act')].map((el) => {
      const a = { type: el.dataset.type };
      for (const i of el.querySelectorAll('[data-a]')) a[i.dataset.a] = i.value;
      return a;
    }),
  };
}

export function initCommands() {
  $('addCommand').addEventListener('click', run(async () => {
    const type = $('newCmdType').value, word = $('newCmdWord').value;
    const trigger = type === 'timer' ? { type } : { type, word };
    if (type !== 'timer' && !word.trim()) { toast('Bitte Befehl bzw. Stichwort eintragen', true); return; }
    await api('POST', 'commands', { trigger, actions: [{ type: 'chat', text: 'Hallo {user}!' }] });
    $('newCmdWord').value = '';
    await loadCommands(); toast('Command angelegt ✓ – Aktionen anpassen und speichern');
  }));
  $('newCmdType').addEventListener('change', () => { $('newCmdWord').parentElement.classList.toggle('hidden', $('newCmdType').value === 'timer'); });
  document.addEventListener('admin:board', run(loadCommands)); // Soundliste hat sich geändert

  // Änderungen am Auslöser-Typ ändern die Felder: erst speichern, dann neu zeichnen
  $('cmdRows').addEventListener('change', (e) => {
    if (!e.target.matches('[data-f=type]')) return;
    const row = e.target.closest('[data-id]'), c = list.find((x) => x.id === row.dataset.id), v = read(row);
    Object.assign(c, { name: v.name, enabled: v.enabled, actions: v.actions.length ? v.actions : c.actions });
    c.trigger = e.target.value === 'timer' ? { type: 'timer', minutes: 20, minMessages: 3 } : { type: e.target.value, word: e.target.value === 'command' ? '!' : '' };
    render();
  });

  onAct($('cmdRows'), '[data-id]', async (act, row) => {
    const id = row.dataset.id, c = list.find((x) => x.id === id);
    if (act.startsWith('add-')) {
      c.actions = read(row).actions;
      c.actions.push({ chat: { type: 'chat', text: '' }, alert: { type: 'alert', title: '', message: '' }, sound: { type: 'sound', soundId: '' } }[act.slice(4)]);
      render();
    } else if (act === 'rm-last') {
      c.actions = read(row).actions.slice(0, -1); render();
    } else if (act === 'save') {
      await api('PUT', `commands/${id}`, read(row));
      await loadCommands(); toast('Gespeichert ✓');
    } else if (act === 'test') {
      await api('PUT', `commands/${id}`, read(row)); // erst speichern, damit der Test den sichtbaren Stand zeigt
      await api('POST', `commands/${id}/test`, { user: $('testUser')?.value || 'TestUser' });
      toast('Test gesendet (Overlay dauert bis ca. 3 s, Chat sofort)');
    } else if (act === 'del') {
      if (!confirm(`„${c.name}“ löschen?`)) return;
      await api('DELETE', `commands/${id}`);
      await loadCommands(); toast('Gelöscht ✓');
    }
  });
}
