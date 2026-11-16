// Seite „Mediakit“: Kennzahlen, Anbieter-Kriterien, Angaben, Veröffentlichung, Vorschau und Twitch-Export (CSV).
import { $, api, esc, run, toast } from './core.js';
import { fmtNum } from './charts.js';

let data = null;
const stat = (v, label) => `<div class="stat"><b>${v}</b><span class="muted">${label}</span></div>`;
const short = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : '');
const long = (iso) => (iso ? `${short(iso)}${iso.slice(0, 4)}` : '');

function fill() {
  const c = data.config;
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v ?? ''; };
  set('mkIntro', c.intro); set('mkAudience', c.audience); set('mkPrices', c.prices); set('mkEmail', c.email); set('mkSchedule', c.schedule); set('mkFormats', c.formats); set('mkCriteriaText', c.criteria);
  $('mkPublished').checked = c.published;
  for (const r of document.querySelectorAll('[name=mkSourceSel]')) r.checked = r.value === c.source;
  $('mkSourceCsv').disabled = !data.csv;
}

function render() {
  const d = data, k = d.numbers;
  $('mkTiles').innerHTML = stat(fmtNum(k.avgViewers), 'Ø Zuschauer an Streamtagen') + stat(k.maxViewers, 'Rekord') + stat(fmtNum(k.hoursWatched), 'Stunden gesehen') + stat(fmtNum(k.hoursStreamed), 'Stunden gestreamt') + stat(k.streamDays, 'Streamtage') + stat(k.newFollowers != null ? fmtNum(k.newFollowers) : '–', 'neue Follower');
  const range = k.from && k.to ? ` (${short(k.from)} bis ${long(k.to)})` : '';
  $('mkSource').innerHTML = `Quelle der Zahlen: <b>${k.source === 'csv' ? 'Twitch-Export' : 'eigene Messung'}</b>${range}.`
    + (k.source !== 'csv' && !d.statsEnabled ? ' <span class="bad">Die Messung ist ausgeschaltet.</span> Schalte sie auf der Seite „Twitch-Statistik“ ein oder lade unten einen Twitch-Export hoch.' : '');
  $('mkCriteria').innerHTML = d.criteria.length
    ? d.criteria.map((c) => `<p style="margin:10px 0 4px"><b>${esc(c.name)}</b>: Ø ${fmtNum(c.now)} von ${fmtNum(c.goal)} Zuschauern, ${c.percent} %${c.ok ? ' ✅ erreicht' : ''}</p><progress max="100" value="${c.percent}" style="width:100%" aria-label="${esc(c.name)}"></progress>${c.hint ? `<p class="muted" style="margin:4px 0 0">${esc(c.hint)}</p>` : ''}`).join('')
      + `<p class="muted">Zeitplan-Konstanz seit Messbeginn: ${d.weeks.ok} von ${d.weeks.counted} Wochen mit mindestens 2 Streamtagen (die laufende Woche zählt noch nicht). Diese Angaben stehen nicht auf der öffentlichen Seite.</p>`
    : '<p class="muted">Noch keine Anbieter eingetragen (unten bei „Anbieter-Kriterien“).</p>';
  const pub = d.config.published;
  $('mkState').innerHTML = `<p style="margin:0 0 8px">${pub ? (d.missing.length ? `🟡 Veröffentlicht, aber noch offen: <b>${esc(d.missing.join(', '))}</b>. Solange das fehlt, steht dort ein Platzhalter und die Seite ist für Suchmaschinen gesperrt.` : '🟢 Veröffentlicht und vollständig.') : '⚪ Noch nicht veröffentlicht. Besucher sehen eine „Nicht gefunden“-Seite.'}</p>`;
  $('mkUrl').textContent = location.origin + '/mediakit';
  $('mkCsvInfo').textContent = d.csv ? `Zuletzt eingelesen am ${long(d.csv.readAt)}: Ø ${fmtNum(d.csv.avgViewers)} Zuschauer, ${d.csv.streamDays} Streamtage, Rekord ${d.csv.maxViewers}.` : '';
  $('mkRemoveCsv').classList.toggle('hidden', !d.csv);
  fill();
}

async function preview() { $('mkPreview').srcdoc = (await api('GET', 'mediakit/preview')).html; $('mkPreviewBox').open = true; }
export async function loadMediakit() { data = await api('GET', 'mediakit'); render(); }

export function initMediakit() {
  $('mkSave').addEventListener('click', run(async () => {
    const src = document.querySelector('[name=mkSourceSel]:checked')?.value ?? 'stats';
    data = await api('PUT', 'mediakit', { intro: $('mkIntro').value, audience: $('mkAudience').value, prices: $('mkPrices').value, email: $('mkEmail').value, schedule: $('mkSchedule').value, formats: $('mkFormats').value, criteria: $('mkCriteriaText').value, source: src, published: $('mkPublished').checked });
    render(); toast('Gespeichert ✓'); if ($('mkPreviewBox').open) await preview();
  }));
  $('mkPreviewBtn').addEventListener('click', run(preview));
  $('mkImport').addEventListener('click', run(async () => {
    const f = $('mkFile').files[0];
    if (!f) throw new Error('Bitte zuerst eine CSV-Datei auswählen');
    if (f.size > 2_000_000) throw new Error('Die Datei ist zu groß');
    data = await api('POST', 'mediakit/csv', { text: await f.text() });
    $('mkFile').value = ''; render(); toast('Eingelesen ✓ – die Seite nutzt jetzt diese Zahlen');
  }));
  $('mkRemoveCsv').addEventListener('click', run(async () => { if (!confirm('Die eingelesenen Zahlen entfernen? Die Seite nimmt dann wieder die eigene Messung.')) return; data = await api('DELETE', 'mediakit/csv'); render(); toast('Entfernt ✓'); }));
  document.addEventListener('admin:tab', (e) => { if (e.detail === 'mediakit' && data) loadMediakit().catch(() => {}); });
  document.addEventListener('admin:settings', () => { if (data) loadMediakit().catch(() => {}); });
}
