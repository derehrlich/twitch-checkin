// Soundboard-Reiter: Einträge anlegen, ändern, Ton hochladen, testen, löschen.
import { $, api, esc, onAct, previewVolume, readUpload, run, toast } from './core.js';

let entries = [];
export async function loadBoard() { entries = await api('GET', 'soundboard'); renderBoard(); document.dispatchEvent(new Event('admin:board')); }

function renderBoard() {
  $('boardRows').innerHTML = entries.length ? entries.map((e) => `
    <div class="entry" data-id="${esc(e.id)}">
      <div class="grid2">
        <div><label>Name des Rewards</label><input data-f="title" maxlength="45" value="${esc(e.title)}"></div>
        <div><label>Preis (Kanalpunkte)</label><input data-f="cost" type="number" min="1" value="${e.cost}"></div>
        <div><label>Abklingzeit (Sekunden, 0 = keine)</label><input data-f="cooldown" type="number" min="0" max="86400" value="${e.cooldown}"></div>
        <div><label>Lautstärke (0,1 bis 1)</label><input data-f="volume" type="number" min="0.1" max="1" step="0.1" value="${e.volume}"></div>
      </div>
      <label class="check big"><input data-f="enabled" type="checkbox" ${e.enabled ? 'checked' : ''}> Aktiv (als Reward in Twitch verfügbar)</label>
      <p class="muted" style="margin:4px 0">Ton: <b>${e.soundVersion ? esc(e.soundName) : 'noch keiner'}</b> · Reward: ${e.rewardId ? 'angelegt' : 'noch nicht angelegt'}</p>
      <div class="row">
        <div><input data-f="file" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg"></div>
        <button data-act="upload">Ton hochladen</button>
        <button data-act="save">Speichern</button>
        <button data-act="play" class="ghost" ${e.soundVersion ? '' : 'disabled'}>▶ Anhören</button>
        <button data-act="test" class="ghost" ${e.soundVersion ? '' : 'disabled'}>Im Overlay testen</button>
        <button data-act="del" class="danger">Löschen</button>
      </div>
    </div>`).join('') : '<p class="muted">Noch keine Einträge.</p>';
}

const fieldsOf = (row) => ({
  title: row.querySelector('[data-f=title]').value, cost: row.querySelector('[data-f=cost]').value, cooldown: row.querySelector('[data-f=cooldown]').value,
  volume: row.querySelector('[data-f=volume]').value, enabled: row.querySelector('[data-f=enabled]').checked,
});

let preview = null;
export function initSoundboard() {
  $('addBoard').addEventListener('click', run(async () => {
    await api('POST', 'soundboard', { title: $('newBoardTitle').value, cost: $('newBoardCost').value });
    $('newBoardTitle').value = '';
    await loadBoard(); toast('Eintrag angelegt ✓ – jetzt einen Ton hochladen');
  }));
  document.addEventListener('admin:synced', run(loadBoard));

  onAct($('boardRows'), '[data-id]', async (act, row, btn) => {
    const id = row.dataset.id, entry = entries.find((x) => x.id === id);
    if (act === 'save') {
      await api('PUT', `soundboard/${id}`, fieldsOf(row));
      await loadBoard(); toast('Gespeichert ✓ – zum Übernehmen in Twitch die Rewards abgleichen');
    } else if (act === 'upload') {
      const file = row.querySelector('[data-f=file]').files[0];
      const data = await readUpload(file, 1_500_000);
      btn.disabled = true;
      try { await api('POST', `soundboard/${id}/sound`, { name: file.name, data }); await loadBoard(); toast('Ton hochgeladen ✓ – jetzt die Rewards abgleichen'); } finally { btn.disabled = false; }
    } else if (act === 'play') {
      preview?.pause();
      preview = new Audio(`/api/soundboard?id=${id}&v=${entry.soundVersion}`);
      preview.volume = previewVolume() * (entry.volume || 1);
      await preview.play();
    } else if (act === 'test') {
      await api('POST', 'test', { target: 'soundboard', id, user: $('testUser').value });
      toast('Test gesendet (dauert bis ca. 3 s)');
    } else if (act === 'del') {
      if (!confirm(`„${entry.title}“ samt Reward in Twitch löschen?`)) return;
      await api('DELETE', `soundboard/${id}`);
      await loadBoard(); toast('Gelöscht ✓');
    }
  });
}
