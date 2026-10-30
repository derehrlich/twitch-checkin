// Katalog der Top des Monats: Sounds anlegen, umbenennen, hochladen, anhören, löschen; Gewinner der letzten Monate.
import { $, api, esc, onAct, previewVolume, readUpload, run, toast } from './core.js';

let entries = [];
const fmtDate = (iso) => new Date(iso).toLocaleDateString('de-DE');

export async function loadCatalog() {
  const d = await api('GET', 'catalog');
  entries = d.entries;
  $('catMax').textContent = d.max;
  $('addCat').disabled = entries.length >= d.max;
  $('catRows').innerHTML = entries.length ? entries.map((e) => `
    <div class="entry" data-id="${esc(e.id)}">
      <div class="row">
        <div><label>Name</label><input data-f="name" maxlength="40" value="${esc(e.name)}"></div>
        <div><label>Datei</label><input data-f="file" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg"></div>
      </div>
      <p class="muted" style="margin:4px 0">Sound: <b>${e.soundVersion ? esc(e.soundName) : 'noch keiner (erscheint erst nach dem Hochladen in der Auswahl)'}</b></p>
      <div class="row">
        <button data-act="save">Namen speichern</button><button data-act="upload">Datei hochladen</button>
        <button data-act="play" class="ghost" ${e.soundVersion ? '' : 'disabled'}>▶ Anhören</button><button data-act="del" class="danger">Löschen</button>
      </div>
    </div>`).join('') : '<p class="muted">Noch kein Sound im Katalog.</p>';
  $('awardRows').innerHTML = d.awards.length ? d.awards.map((a) => `
    <p style="margin:10px 0 2px"><b>${esc(a.label)}</b> <span class="muted">· ${a.open ? `Auswahl läuft bis ${fmtDate(a.deadline)}` : 'Auswahl beendet'}</span></p>
    ${a.winners.length ? `<ol style="margin:0">${a.winners.map((w) => `<li>${esc(w.name)} (${w.points} Punkte) – ${w.choice ? `gewählt: <b>${esc(w.choice)}</b>` : 'noch nicht gewählt'}</li>`).join('')}</ol>` : '<p class="muted" style="margin:0">Niemand hatte Punkte.</p>'}`).join('') : '<p class="muted">Noch kein Monat abgeschlossen.</p>';
}

let preview = null;
export function initCatalog() {
  $('addCat').addEventListener('click', run(async () => {
    await api('POST', 'catalog', { name: $('newCatName').value });
    $('newCatName').value = ''; await loadCatalog(); toast('Angelegt ✓ – jetzt eine Datei hochladen');
  }));
  $('closeAward').addEventListener('click', run(async () => {
    const r = await api('POST', 'catalog/close', {});
    await loadCatalog(); toast(r.created ? `Vormonat abgeschlossen (${r.winners} Gewinner) ✓` : 'Der Vormonat war schon abgeschlossen');
  }));
  onAct($('catRows'), '[data-id]', async (act, row, btn) => {
    const id = row.dataset.id, entry = entries.find((x) => x.id === id);
    if (act === 'save') { await api('PUT', `catalog/${id}`, { name: row.querySelector('[data-f=name]').value }); await loadCatalog(); toast('Gespeichert ✓'); }
    else if (act === 'upload') {
      const file = row.querySelector('[data-f=file]').files[0];
      const data = await readUpload(file, 1_500_000);
      btn.disabled = true;
      try { await api('POST', `catalog/${id}/sound`, { name: file.name, data }); await loadCatalog(); toast('Sound hochgeladen ✓'); } finally { btn.disabled = false; }
    } else if (act === 'play') {
      preview?.pause(); preview = new Audio(`/api/einlaufsound/catalog-audio?id=${id}&v=${entry.soundVersion}`); preview.volume = previewVolume(); await preview.play();
    } else if (act === 'del') {
      if (!confirm(`„${entry.name}“ aus dem Katalog löschen? Wer ihn schon gewählt hat, hört dann wieder den normalen Ton.`)) return;
      await api('DELETE', `catalog/${id}`); await loadCatalog(); toast('Gelöscht ✓');
    }
  });
}
