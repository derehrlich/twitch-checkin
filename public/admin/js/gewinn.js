// Reiter „Gewinnspiel“: Geburtstags-Ziehung verwalten.
import { $, api, esc, onAct, run, toast } from './core.js';

let data = null;
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const pct = (x) => `${(x * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
const WINDOW = { vorher: 'noch nicht offen', offen: 'offen', zu: 'geschlossen' };
let prizes = [];

function renderDraws() {
  const d = data;
  const cur = d.draw?.id;
  const rows = (d.draws ?? []).map((x) => `<tr data-id="${esc(x.id)}"><td>${esc(x.name)}${x.id === cur ? ' <b>(aktiv)</b>' : ''}</td><td>${x.drawn ? 'gezogen' : 'offen'}</td><td>${x.id === cur ? '' : '<button data-act="select" class="ghost">Aktiv schalten</button>'}</td></tr>`).join('');
  $('gwDraws').innerHTML = `<p class="muted">Es ist immer nur <b>eine</b> Ziehung aktiv: Für sie gelten das Ticket, der Chat und die Anzeige unten.</p>${rows ? `<table class="tk"><tbody>${rows}</tbody></table>` : ''}
    <div class="row" style="margin:8px 0"><button id="gwNewSimple" class="ghost">Neue einfache Verlosung (1 Preis, 1 Los je Ticket)</button><button id="gwNewBday" class="ghost">Neue Geburtstags-Ziehung</button></div>`;
  $('gwNewSimple').onclick = run(async () => { data = await api('POST', 'gewinn/new', { simple: true }); render(); toast('Angelegt ✓ (zum Benutzen „Aktiv schalten“)'); });
  $('gwNewBday').onclick = run(async () => { data = await api('POST', 'gewinn/new', {}); render(); toast('Angelegt ✓ (zum Benutzen „Aktiv schalten“)'); });
}

function render() {
  const d = data;
  renderDraws();
  $('gwHint').classList.toggle('hidden', d.enabled);
  $('gwOverlayUrl').textContent = location.origin + '/gewinn/overlay';
  if (!d.draw) {
    $('gwStatus').innerHTML = '<p>Es gibt noch keine Ziehung. Lege oben eine an.</p>';
    return;
  }
  const dr = d.draw;
  $('gwStatus').innerHTML = `<p><b>${esc(dr.name)}</b> · Tickets: <b>${WINDOW[d.window]}</b> · Mitternachts-Los: <b>${WINDOW[d.bonusWindow]}</b>${dr.drawnAt ? ` · gezogen am ${fmt(dr.drawnAt)}` : ''}${d.rewardReady ? '' : ' · <span class="bad">Reward fehlt noch (Rewards abgleichen)</span>'}${d.bonusRewardReady || !d.draw.bonusOpen ? '' : ' · <span class="bad">Mitternachts-Los-Reward fehlt noch (Rewards abgleichen)</span>'}</p><p class="muted">${d.stats.participants} Teilnehmer · ${d.stats.totalLots} Lose</p>`;
  $('gwOpen').disabled = $('gwClose').disabled = Boolean(dr.drawnAt);
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v ?? ''; };
  set('gwName', dr.name); set('gwFrom', dr.pointsFrom); set('gwOpenAt', dr.ticketOpen); set('gwCloseAt', dr.ticketClose); set('gwPlanned', dr.plannedDraw); set('gwBonusOpen', dr.bonusOpen); set('gwBonusClose', dr.bonusClose); set('gwBonusLots', dr.bonusLots);
  set('gwPer', dr.perPoints); set('gwMax', dr.maxLots); set('gwWCheckin', dr.weights.checkin); set('gwWStreak', dr.weights.streak); set('gwWStreakCap', dr.weights.streakCap);
  set('gwWChat', dr.weights.chat); set('gwWChatCap', dr.weights.chatDayCap); set('gwWChatGap', dr.weights.chatGap); set('gwHours', dr.winnerHours); set('gwAddrDays', dr.addressDays); set('gwKeep', dr.keepDays);
  for (const cb of document.querySelectorAll('.gwCountry')) cb.checked = dr.countries.includes(cb.value);
  if (document.activeElement !== $('gwTerms')) $('gwTerms').value = dr.terms;
  $('gwTermsPub').checked = dr.termsPublished;
  prizes = dr.prizes.map((p) => ({ ...p }));
  renderPrizes();
  $('gwDraw').disabled = Boolean(dr.drawnAt); $('gwTest').disabled = Boolean(dr.drawnAt);
  $('gwStats').innerHTML = d.stats.rows.length ? `<table class="tk"><thead><tr><th>Lose</th><th>Personen</th><th>Anteil an allen Losen</th><th>Chance auf Platz 1 (je Person)</th></tr></thead><tbody>${d.stats.rows.map((r) => `<tr><td>${r.lots}</td><td>${r.persons}</td><td>${pct(r.share)}</td><td>${pct(r.chance)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Noch keine Tickets.</p>';
  $('gwTickets').innerHTML = d.tickets.length ? `<table class="tk"><thead><tr><th>Name</th><th>Ticket</th><th>Punkte beim Einlösen</th><th>Punkte jetzt</th><th>Lose</th><th></th></tr></thead><tbody>${d.tickets.map((t) => `<tr data-name="${esc(t.name)}"><td>${esc(t.name)}${t.blocked ? ' 🚫' : ''}${t.eligible ? '' : ' <span class="muted">(zählt nicht)</span>'}</td><td>${fmt(t.at)}</td><td>${t.pointsAtTicket}</td><td>${t.points}</td><td>${t.lots}${t.extra ? ' 🌙' : ''}</td><td>${t.blocked ? '' : '<button data-act="block" class="danger">Sperren</button>'}</td></tr>`).join('')}</tbody></table>` : '';
  $('gwBlocked').innerHTML = dr.blocked.length ? 'Gesperrt: ' + dr.blocked.map((b) => `${esc(b.name)} <button class="ghost" data-unblock="${esc(b.name)}">frei</button>`).join(' · ') : '';
  const w = d.winners;
  $('gwWinners').innerHTML = w.length ? `<table class="tk"><thead><tr><th>Platz</th><th>Preis</th><th>Gewinner</th><th>Status</th><th>Frist</th><th>Aktionen</th></tr></thead><tbody>${w.map((x) => {
    const live = x.status !== 'verfallen';
    const keyPrize = d.draw.prizes.find((p) => p.id === x.prizeId);
    return `<tr data-id="${esc(x.id)}" class="${live ? '' : 'muted'}"><td>${x.place}</td><td>${esc(x.prizeName)}</td><td>${esc(x.name)} <small class="muted">(${x.lots} Lose)</small></td>
    <td>${esc(x.statusLabel)}${x.expired ? ' <span class="bad">Frist um</span>' : ''}${x.sendError || x.dmQueued ? `<br><small class="muted">${x.dmQueued ? 'Discord-DM vorgemerkt' : 'Flüstern fehlgeschlagen: Link von Hand schicken'}</small>` : ''}${x.kind === 'key' && keyPrize && !keyPrize.key && live ? '<br><small class="bad">Key fehlt!</small>' : ''}</td>
    <td>${x.status === 'gemeldet' && x.addressUntil ? 'Adresse bis ' + fmt(x.addressUntil) : fmt(x.deadline)}</td>
    <td>${live ? [
      x.link ? '<button data-act="copy" class="ghost">Link kopieren</button>' : '',
      ['gezogen', 'link_verschickt', 'gemeldet'].includes(x.status) ? '<button data-act="link" class="ghost">Link neu erzeugen</button>' : '',
      x.status === 'gezogen' ? '<button data-act="sent" class="ghost">Link verschickt</button>' : '',
      ['gezogen', 'link_verschickt'].includes(x.status) ? '<button data-act="reported" class="ghost">Gemeldet</button>' : '',
      x.hasAddress ? '<button data-act="address" class="ghost">Adresse zeigen</button>' : '',
      x.kind === 'item' && ['adresse_erhalten'].includes(x.status) ? '<button data-act="shipped">Versendet</button>' : '',
      x.hasAddress ? '<button data-act="delete-address" class="danger">Adresse löschen</button>' : '',
      ['gemeldet', 'versendet'].includes(x.status) ? '<button data-act="complete" class="ghost">Abschließen</button>' : '',
      '<button data-act="redraw" class="danger">Nachziehen</button>',
    ].join(' ') : ''}</td></tr>`;
  }).join('')}</tbody></table>` : '<p class="muted">Noch nicht gezogen.</p>';
}

function renderPrizes() {
  $('gwPrizes').innerHTML = prizes.map((p, i) => `<div class="row" data-i="${i}"><b style="min-width:54px">Platz ${i + 1}</b>
    <div><input data-f="name" maxlength="80" value="${esc(p.name)}" aria-label="Name"></div>
    <div><select data-f="kind" aria-label="Art"><option value="key"${p.kind === 'key' ? ' selected' : ''}>Key</option><option value="item"${p.kind === 'item' ? ' selected' : ''}>Sachpreis</option></select></div>
    <div><input data-f="key" maxlength="200" value="${esc(p.key ?? '')}" placeholder="Key (nur bei Key-Preis)" ${p.kind === 'key' ? '' : 'disabled'} autocomplete="off"></div>
    <button class="ghost" data-act="up" ${i ? '' : 'disabled'}>↑</button><button class="ghost" data-act="down" ${i < prizes.length - 1 ? '' : 'disabled'}>↓</button><button class="danger" data-act="rm">Entfernen</button></div>`).join('');
}

const apply = (res) => { data = res; render(); };
export async function loadGewinn() { apply(await api('GET', 'gewinn')); }

function config() {
  const n = (id) => $(id).value;
  return {
    name: n('gwName'), pointsFrom: n('gwFrom'), ticketOpen: n('gwOpenAt'), ticketClose: n('gwCloseAt'), plannedDraw: n('gwPlanned'), bonusOpen: n('gwBonusOpen'), bonusClose: n('gwBonusClose'), bonusLots: n('gwBonusLots'), perPoints: n('gwPer'), maxLots: n('gwMax'),
    weights: { checkin: n('gwWCheckin'), streak: n('gwWStreak'), streakCap: n('gwWStreakCap'), chat: n('gwWChat'), chatDayCap: n('gwWChatCap'), chatGap: n('gwWChatGap') },
    winnerHours: n('gwHours'), addressDays: n('gwAddrDays'), keepDays: n('gwKeep'), countries: [...document.querySelectorAll('.gwCountry')].filter((c) => c.checked).map((c) => c.value),
  };
}

export function initGewinn() {
  onAct($('gwDraws'), '[data-id]', async (act, row) => { if (act === 'select') { apply(await api('POST', 'gewinn/select', { id: row.dataset.id })); toast('Aktiv ✓'); } });
  $('gwSave').addEventListener('click', run(async () => { apply(await api('PUT', 'gewinn/config', config())); toast('Gespeichert ✓'); }));
  $('gwSaveTerms').addEventListener('click', run(async () => { apply(await api('PUT', 'gewinn/config', { terms: $('gwTerms').value, termsPublished: $('gwTermsPub').checked })); toast('Gespeichert ✓'); }));
  $('gwOpen').addEventListener('click', run(async () => { apply(await api('POST', 'gewinn/window', { action: 'open' })); toast('Tickets sind offen ✓'); }));
  $('gwClose').addEventListener('click', run(async () => { apply(await api('POST', 'gewinn/window', { action: 'close' })); toast('Tickets sind geschlossen ✓'); }));
  $('gwAddPrize').addEventListener('click', () => { prizes.push({ name: 'Neuer Preis', kind: 'item', key: '' }); renderPrizes(); });
  $('gwPrizes').addEventListener('input', (e) => {
    const row = e.target.closest('[data-i]'); if (!row || !e.target.dataset.f) return;
    prizes[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
    if (e.target.dataset.f === 'kind') renderPrizes();
  });
  onAct($('gwPrizes'), '[data-i]', async (act, row) => {
    const i = Number(row.dataset.i);
    if (act === 'rm') prizes.splice(i, 1);
    else { const j = act === 'up' ? i - 1 : i + 1; [prizes[i], prizes[j]] = [prizes[j], prizes[i]]; }
    renderPrizes();
  });
  $('gwSavePrizes').addEventListener('click', run(async () => { apply(await api('PUT', 'gewinn/config', { prizes })); toast('Preise gespeichert ✓'); }));
  $('gwBlock').addEventListener('click', run(async () => { apply(await api('POST', 'gewinn/block', { name: $('gwBlockName').value })); $('gwBlockName').value = ''; toast('Gesperrt ✓'); }));
  onAct($('gwTickets'), '[data-name]', async (act, row) => { if (act === 'block' && confirm(`${row.dataset.name} sperren?`)) apply(await api('POST', 'gewinn/block', { name: row.dataset.name })); });
  $('gwBlocked').addEventListener('click', run(async (e) => { const n = e.target.dataset.unblock; if (n) apply(await api('DELETE', `gewinn/block/${encodeURIComponent(n)}`)); }));
  $('gwTest').addEventListener('click', run(async () => {
    const r = await api('POST', 'gewinn/test-draw', { seed: $('gwSeed').value });
    $('gwTestOut').textContent = `Test (Seed ${r.seed}, ${r.participants} Teilnehmer):\n` + r.winners.map((w) => `${w.place}. ${w.name} (${w.lots} Lose) → ${w.prize}`).join('\n');
  }));
  $('gwDraw').addEventListener('click', run(async () => {
    if (!confirm('Jetzt wirklich ziehen? Das geht nur einmal, das Ergebnis erscheint sofort im Overlay und im Chat, und die Gewinner bekommen ihren Link.')) return;
    apply(await api('POST', 'gewinn/draw', { confirm: true, seed: $('gwSeed').value })); toast('Gezogen ✓');
  }));
  $('gwReplay').addEventListener('click', run(async () => { apply(await api('POST', 'gewinn/overlay', { action: 'show' })); toast('Overlay läuft neu ✓'); }));
  $('gwHide').addEventListener('click', run(async () => { apply(await api('POST', 'gewinn/overlay', { action: 'hide' })); toast('Overlay aus ✓'); }));
  $('gwProtocol').addEventListener('click', run(async () => { const r = await api('GET', 'gewinn/protocol'); $('gwProtocolOut').textContent = JSON.stringify(r, null, 2); }));
  onAct($('gwWinners'), '[data-id]', async (act, row) => {
    const id = row.dataset.id, w = data.winners.find((x) => x.id === id);
    if (act === 'copy') { await navigator.clipboard.writeText(w.link); toast('Link kopiert ✓'); return; }
    if (act === 'address') { const r = await api('GET', `gewinn/winner/${id}/address`); const a = r.address; alert(`${a.name}\n${a.street}\n${a.zip} ${a.city}\n${a.country}${a.email ? '\n' + a.email : ''}`); return; }
    const ask = { redraw: `${w.name} ersetzen und nachziehen?`, 'delete-address': 'Adresse jetzt endgültig löschen?', link: 'Neuen Link erzeugen? Der alte wird ungültig.' }[act];
    if (ask && !confirm(ask)) return;
    apply(await api('POST', `gewinn/winner/${id}/${act}`, {})); toast('Erledigt ✓');
  });
}
