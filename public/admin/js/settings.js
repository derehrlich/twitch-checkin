// Einstellungsformulare: entstehen aus dem Schema, ein gemeinsames Speichern für alle Reiter.
import { $, api, esc, fill, run, state, toast } from './core.js';
import { CHECKS, FIELDS, SCHEMA, SYNC_KEYS } from './schema.js';

const attrString = (attrs = {}) => Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');

function renderItem(i) {
  if (i.type === 'check') return `<label class="check big"><input id="${i.id}" type="checkbox" data-setting> ${i.label}</label>`;
  if (i.type === 'area') return `<label for="${i.id}">${i.label}</label><textarea id="${i.id}" data-setting ${attrString(i.attrs)}></textarea>${i.preview ? `<div class="preview" data-preview="${i.id}"></div>` : ''}`;
  return `<div><label for="${i.id}">${i.label}</label><input id="${i.id}" type="${i.type}" data-setting ${attrString(i.attrs)}></div>`;
}

// Zusammenhängende Textfelder und Zahlen stehen in einem Raster, Haken und große Textfelder in voller Breite
function renderGroup(g) {
  let html = `<section class="px-box card"><h2>${g.title}</h2>`;
  let grid = [];
  const flush = () => { if (grid.length) html += `<div class="grid2">${grid.join('')}</div>`; grid = []; };
  for (const i of g.items) {
    if (i.type === 'text' || i.type === 'number') grid.push(renderItem(i));
    else { flush(); html += renderItem(i); }
  }
  flush();
  if (g.hint) html += `<p class="muted">${g.hint}</p>`;
  return html + '</section>';
}

const previews = () => Object.values(SCHEMA).flat().flatMap((g) => g.items).filter((i) => i.preview);
function updatePreviews() {
  for (const i of previews()) {
    const el = document.querySelector(`[data-preview="${i.id}"]`);
    if (el) el.textContent = 'Vorschau: ' + fill($(i.id).value, i.preview);
  }
}

const dirtyTabs = new Set();
function setDirty(on) {
  $('savebar').classList.toggle('hidden', !on);
  if (!on) { dirtyTabs.clear(); document.querySelectorAll('.tabs button.dirty').forEach((b) => b.classList.remove('dirty')); }
}

export function renderForms() {
  for (const el of document.querySelectorAll('[data-schema]')) el.innerHTML = SCHEMA[el.dataset.schema].map(renderGroup).join('');
  // Änderungen merken: Speichern-Leiste einblenden und den betroffenen Reiter markieren
  document.addEventListener('input', onChange);
  document.addEventListener('change', onChange);
}

function onChange(e) {
  if (!e.target.matches?.('[data-setting]')) return;
  updatePreviews();
  setDirty(true);
  const tab = e.target.closest('.tab-panel')?.dataset.panel;
  if (tab) document.querySelector(`.tabs button[data-tab="${tab}"]`)?.classList.add('dirty');
}

export function fillForms() {
  for (const f of FIELDS) $(f).value = state.settings[f] ?? '';
  for (const c of CHECKS) $(c).checked = Boolean(state.settings[c]);
  updatePreviews();
  setDirty(false);
}

export async function loadSettings() {
  state.settings = await api('GET', 'settings');
  fillForms();
  document.dispatchEvent(new Event('admin:settings'));
}

export function initSettings() {
  $('save').addEventListener('click', run(async () => {
    const before = state.settings;
    const body = Object.fromEntries(CHECKS.map((c) => [c, $(c).checked]));
    for (const f of FIELDS) body[f] = $(f).value;
    state.settings = await api('PUT', 'settings', body);
    fillForms();
    document.dispatchEvent(new Event('admin:settings'));
    const needsSync = SYNC_KEYS.some((k) => before[k] !== state.settings[k]);
    toast(needsSync ? 'Gespeichert ✓ – bitte jetzt Rewards und Webhooks abgleichen' : 'Gespeichert ✓');
    if (needsSync) $('syncHint').classList.remove('hidden');
  }));
  $('discard').addEventListener('click', () => fillForms());
}
