// Einlaufsound-Reiter: eingereichte Sounds anhören, freigeben, ablehnen (mit oder ohne Erstattung), Sounds entfernen.
import { $, api, esc, onAct, previewVolume, toast } from './core.js';

let entries = [];
const STATUS = { pending: 'Wartet auf Freigabe', awaiting: 'Kauf offen, Upload fehlt', active: 'Aktiv', expired: 'Abgelaufen (noch gespeichert)' };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE') : '–');

export async function loadEntrySounds() {
  const data = await api('GET', 'entrysound');
  entries = data.entries;
  const i = data.info;
  $('entryInfo').innerHTML = `Reward „${esc(i.titles.buy)}“: gilt ${esc(i.buyMonths)}. Reward „${esc(i.titles.extend)}“: ${esc(i.extendMonths)} mehr, höchstens ${esc(i.maxMonths)} Restlaufzeit. Sounds bis ${i.maxSeconds} Sekunden.`;
  $('entryUrl').textContent = `${location.origin}/einlaufsound`;
  $('entryRows').innerHTML = entries.length ? entries.map((e) => `
    <div class="entry" data-id="${esc(e.id)}">
      <p style="margin:0"><b>${esc(e.name)}</b> · ${STATUS[e.status]}${e.validUntil ? ` · gültig bis ${fmtDate(e.validUntil)}` : ''}${e.soundName ? ` · ${esc(e.soundName)}` : ''}</p>
      ${e.pending ? `<p class="muted" style="margin:4px 0">Neu eingereicht: <b>${esc(e.pending.name)}</b> (${new Date(e.pending.at).toLocaleString('de-DE')})${e.status === 'pending' && e.purchaseAt ? ' · Kauf, Punkte reserviert' : ''}</p>` : ''}
      ${e.rejected ? `<p class="muted" style="margin:4px 0">Zuletzt abgelehnt: ${esc(e.rejected.reason)}</p>` : ''}
      <div class="row" style="margin-top:6px">
        ${e.pending ? `<div><input data-f="reason" maxlength="120" placeholder="Grund für die Ablehnung (kommt in den Chat)"></div>
        <button data-act="listen">▶ Anhören</button><button data-act="approve">Freigeben</button>
        <button data-act="reject" class="ghost">Ablehnen</button>${e.purchaseAt ? '<button data-act="refund" class="danger">Ablehnen und erstatten</button>' : ''}` : ''}
        ${e.soundVersion ? '<button data-act="play" class="ghost">▶ Aktuellen Sound anhören</button>' : ''}
        <button data-act="del" class="danger">Entfernen</button>
      </div>
    </div>`).join('') : '<p class="muted">Noch keine Einlaufsounds. Sobald jemand den Reward einlöst, erscheint er hier.</p>';
}

let preview = null;
const play = (src, volume) => { preview?.pause(); preview = new Audio(src); preview.volume = volume; return preview.play(); };

export function initEntrySound() {
  document.addEventListener('admin:synced', () => loadEntrySounds().catch(() => {}));
  onAct($('entryRows'), '[data-id]', async (act, row) => {
    const id = row.dataset.id, entry = entries.find((x) => x.id === id);
    const reason = row.querySelector('[data-f=reason]')?.value ?? '';
    if (act === 'listen') {
      const f = await api('GET', `entrysound/${id}/pending`);
      await play(`data:${f.type};base64,${f.data}`, previewVolume());
    } else if (act === 'play') {
      await play(`/api/einlaufsound/audio?id=${id}&v=${entry.soundVersion}`, previewVolume());
    } else if (act === 'approve') {
      await api('POST', `entrysound/${id}/approve`, {}); await loadEntrySounds(); toast('Freigegeben ✓');
    } else if (act === 'reject') {
      await api('POST', `entrysound/${id}/reject`, { reason, refund: false }); await loadEntrySounds(); toast('Abgelehnt – die Person kann einen anderen Sound hochladen');
    } else if (act === 'refund') {
      if (!confirm('Kauf ablehnen und die Punkte erstatten?')) return;
      await api('POST', `entrysound/${id}/reject`, { reason, refund: true }); await loadEntrySounds(); toast('Abgelehnt, Punkte erstattet ✓');
    } else if (act === 'del') {
      if (!confirm(`Einlaufsound von ${entry.name} entfernen?${entry.status === 'awaiting' || entry.purchaseAt ? ' Ein offener Kauf wird erstattet.' : ''}`)) return;
      await api('DELETE', `entrysound/${id}`); await loadEntrySounds(); toast('Entfernt ✓');
    }
  });
}
