// Medien-Reiter: eigene Töne und Bilder/GIFs je Alert.
import { $, api, esc, onAct, previewVolume, readUpload, state, toast } from './core.js';

const SOUND_SLOTS = [
  ['checkin', 'Check-in', 'eingebaut: aufsteigendes Glockenspiel'],
  ['checkout', 'Check-out', 'sonst Check-in-Ton'],
  ['milestone', 'Meilenstein', 'sonst Check-in-Ton'],
  ['raid', 'Raid', 'eingebaut: Horn-Fanfare'],
  ['follow', 'Follow', 'eingebaut: zwei sanfte Töne'],
  ['sub', 'Sub / Prime', 'eingebaut: Dur-Akkord'],
  ['resub', 'Resub', 'sonst Sub-Ton'],
  ['gift', 'Gift-Subs', 'eingebaut: Glitzern'],
  ['cheer', 'Bits', 'eingebaut: Münzklang'],
  ['rescue', 'Streak-Rettung', 'eingebaut: heldenhafter Aufstieg'],
];
const IMAGE_SLOTS = [['follow', 'Follow'], ['sub', 'Sub / Prime'], ['resub', 'Resub (sonst Sub-Bild)'], ['gift', 'Gift-Subs'], ['cheer', 'Bits'], ['raid', 'Raid'], ['rescue', 'Streak-Rettung']];

const soundMeta = (slot) => {
  const s = state.settings;
  return slot === 'checkin' ? (s.soundName ? { name: s.soundName, version: s.soundVersion } : null) : s.sounds?.[slot] ?? null;
};

export function renderMedia() {
  $('soundRows').innerHTML = SOUND_SLOTS.map(([slot, label, hint]) => {
    const m = soundMeta(slot);
    return `<div class="row slot-row" data-slot="${slot}">
      <div class="name"><b>${label}</b><br><span class="muted">${m ? esc(m.name) : esc(hint)}</span></div>
      <div><input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg"></div>
      <button data-act="up">Hochladen</button>
      <button data-act="play" class="ghost">▶ Anhören</button>
      <button data-act="reset" class="ghost" ${m ? '' : 'disabled'}>Zurücksetzen</button>
    </div>`;
  }).join('');
  $('imageRows').innerHTML = IMAGE_SLOTS.map(([slot, label]) => {
    const m = state.settings.images?.[slot];
    return `<div class="row slot-row" data-slot="${slot}">
      <div class="name"><b>${label}</b><br><span class="muted">${m ? esc(m.name) : 'Lama'}</span></div>
      ${m ? `<img src="/api/image?slot=${slot}&v=${m.version}" alt="">` : ''}
      <div><input type="file" accept="image/gif,image/png,image/jpeg,image/webp,.gif,.png,.jpg,.jpeg,.webp"></div>
      <button data-act="up">Hochladen</button>
      <button data-act="reset" class="ghost" ${m ? '' : 'disabled'}>Zurücksetzen</button>
    </div>`;
  }).join('');
}

let preview = null;
export function initMedia() {
  // Der Ton- und Bildspeicher steckt in den Einstellungen; ein Upload liefert sie aktualisiert zurück (ohne ungespeicherte Formularwerte anzutasten)
  const keepForm = (fresh) => { state.settings = { ...state.settings, sounds: fresh.sounds, soundName: fresh.soundName, soundVersion: fresh.soundVersion, images: fresh.images }; renderMedia(); };

  onAct($('soundRows'), '[data-slot]', async (act, row, btn) => {
    const slot = row.dataset.slot, m = soundMeta(slot);
    if (act === 'play') {
      preview?.pause();
      if (m) { preview = new Audio(`/api/sound?slot=${slot}&v=${m.version}`); preview.volume = previewVolume(); await preview.play(); } else playChime(previewVolume(), slot);
    } else if (act === 'up') {
      const data = await readUpload(row.querySelector('input[type=file]').files[0], 1_500_000);
      btn.disabled = true;
      try { keepForm(await api('POST', 'sound', { slot, name: row.querySelector('input[type=file]').files[0].name, data })); toast('Ton hochgeladen ✓'); } finally { btn.disabled = false; }
    } else if (act === 'reset') {
      if (!confirm('Eigenen Ton entfernen und wieder den eingebauten Klang verwenden?')) return;
      keepForm(await api('DELETE', 'sound', { slot })); toast('Eingebauter Ton aktiv ✓');
    }
  });

  onAct($('imageRows'), '[data-slot]', async (act, row, btn) => {
    const slot = row.dataset.slot;
    if (act === 'up') {
      const file = row.querySelector('input[type=file]').files[0];
      const data = await readUpload(file, 3_000_000);
      btn.disabled = true;
      try { keepForm(await api('POST', 'image', { slot, name: file.name, data })); toast('Bild hochgeladen ✓'); } finally { btn.disabled = false; }
    } else if (act === 'reset') {
      if (!confirm('Eigenes Bild entfernen und wieder das Lama zeigen?')) return;
      keepForm(await api('DELETE', 'image', { slot })); toast('Lama aktiv ✓');
    }
  });
}
