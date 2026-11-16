// Seite „Gewinnspiel“: Liste aller Gewinnspiele, Vorlagen für neue, Einzelheiten zum ausgewählten.
import { $, api, esc, onAct, run, toast } from './core.js';

let data = null;
let sel = null; // Kennung des ausgewählten Gewinnspiels (alle Aufrufe gehen an gewinn/<sel>/…)
const path = (rest = '') => `gewinn${sel ? '/' + sel : ''}${rest ? '/' + rest : ''}`;
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const time = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const pct = (x) => `${(x * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
const WINDOW = { vorher: 'noch nicht offen', offen: 'offen', zu: 'geschlossen' };
const SOURCE_HELP = {
  none: 'Jede Person hat genau ein Los, egal wie aktiv sie war.',
  month: 'Ein Los fürs Mitmachen, dazu ein Bonuslos je X Monatspunkte (Twitch-Chat, Check-ins und bei verknüpften Konten Discord, wie in der Rangliste). Es zählt der Stand im Moment der Ziehung. Damit Chat-Punkte zählen, muss die Community-Rangliste eingeschaltet sein.',
  draw: 'Ein Los fürs Mitmachen, dazu ein Bonuslos je X Punkte. Punkte gibt es ab dem eingestellten Zeitpunkt für Check-ins, Streak und Chat-Nachrichten, nur für dieses Gewinnspiel.',
};
let prizes = [];

const stateOf = (x) => (x.drawn ? `gezogen${x.drawnAt ? ' am ' + fmt(x.drawnAt) : ''}` : x.entry === 'reward' && !x.current ? 'wartet (Ticket-Reward gehört zu einem anderen)' : x.window === 'offen' && x.ticketClose ? `offen bis ${time(x.ticketClose)}` : WINDOW[x.window]);

function renderDraws() {
  const d = data;
  const rows = (d.draws ?? []).map((x) => `<tr data-id="${esc(x.id)}" class="${x.id === sel ? 'gw-sel' : ''}">
    <td><b>${esc(x.name)}</b></td>
    <td>${x.entry === 'chat' ? `Chat <code>${esc(x.command)}</code>` : 'Kanalpunkte-Ticket'}</td>
    <td><span class="pill${!x.drawn && x.window === 'offen' && (x.entry === 'chat' || x.current) ? ' on' : ''}">${esc(stateOf(x))}</span></td>
    <td>${x.count} dabei</td>
    <td class="tk-act">${x.drawn ? '' : x.entry === 'reward' && !x.current ? '<button data-act="select" class="ghost">Ticket-Reward hierher</button>' : x.window === 'offen' ? '<button data-act="close" class="ghost">Schließen</button>' : '<button data-act="open">Öffnen</button>'}
      ${x.id === sel ? '' : '<button data-act="show" class="ghost">Ansehen</button>'}</td></tr>`).join('');
  $('gwDraws').innerHTML = rows
    ? `<div style="overflow-x:auto"><table class="tk"><thead><tr><th>Name</th><th>Mitmachen</th><th>Stand</th><th>Teilnehmer</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p class="muted">Es gibt noch kein Gewinnspiel. Such dir unten eine Vorlage aus.</p>';
}

// Felder zeigen, die zur Art des Gewinnspiels passen (data-if: chat, reward, points, draw)
function showFields() {
  const on = { chat: $('gwEntry').value === 'chat', reward: $('gwEntry').value === 'reward', points: $('gwSource').value !== 'none', draw: $('gwSource').value === 'draw' };
  for (const el of document.querySelectorAll('#gwDetail [data-if]')) el.classList.toggle('hidden', !on[el.dataset.if]);
  $('gwSourceHelp').textContent = SOURCE_HELP[$('gwSource').value];
}

function render() {
  const d = data;
  sel = d.draw?.id ?? null;
  renderDraws();
  $('gwHint').classList.toggle('hidden', d.enabled);
  $('gwOverlayUrl').textContent = location.origin + '/gewinn/overlay';
  $('gwDetail').classList.toggle('hidden', !d.draw);
  if (!d.draw) return;
  const dr = d.draw;
  const chat = dr.entry === 'chat';
  $('gwTitle').textContent = dr.name;
  const warn = [];
  if (!chat && !dr.current && !dr.drawnAt) warn.push('Der Ticket-Reward gehört gerade zu einem anderen Gewinnspiel. Oben „Ticket-Reward hierher“ klicken, damit hier Tickets ankommen.');
  if (!chat && dr.current && !d.rewardReady) warn.push('Der Ticket-Reward fehlt noch bei Twitch (auf der Startseite abgleichen).');
  if (!chat && dr.current && dr.bonusOpen && !d.bonusRewardReady) warn.push('Der Mitternachts-Los-Reward fehlt noch bei Twitch (auf der Startseite abgleichen).');
  if (dr.pointsSource === 'month' && !d.communityEnabled) warn.push('Die Community-Rangliste ist ausgeschaltet: Bei den Monatspunkten zählen dann nur Check-ins.');
  $('gwStatus').innerHTML = `<p>${chat ? `Mitmachen mit <code>${esc(dr.command)}</code> im Chat` : 'Mitmachen mit dem Kanalpunkte-Ticket'} · Stand: <b>${dr.drawnAt ? 'gezogen am ' + fmt(dr.drawnAt) : d.window === 'offen' && dr.closesAt ? 'offen bis ' + time(dr.closesAt) : WINDOW[d.window]}</b>${!chat && dr.bonusOpen ? ` · Mitternachts-Los: <b>${WINDOW[d.bonusWindow]}</b>` : ''}</p>
    <div class="stats"><div class="stat"><b>${d.stats.participants}</b><span class="muted">Teilnehmer</span></div><div class="stat"><b>${d.stats.totalLots}</b><span class="muted">Lose im Topf</span></div><div class="stat"><b>${dr.prizes.length}</b><span class="muted">${dr.prizes.length === 1 ? 'Preis' : 'Preise'}</span></div></div>
    ${warn.map((w) => `<p class="bad" style="margin:10px 0 0">⚠️ ${esc(w)}</p>`).join('')}`;
  $('gwHelp').textContent = dr.drawnAt ? 'Die Ziehung ist gelaufen. Die Gewinner stehen unten.' : chat
    ? `„Jetzt öffnen“ sagt das Gewinnspiel im Chat an${dr.minutes ? ` und schließt es nach ${dr.minutes} Minuten von selbst` : ''}. „Jetzt ziehen“ zeigt die Gewinner im Overlay und im Chat.`
    : 'Tickets öffnen und schließen sich zu den eingestellten Zeiten von selbst, die Knöpfe sind für den Fall, dass du es von Hand machen willst.';
  $('gwOpen').disabled = $('gwClose').disabled = Boolean(dr.drawnAt);
  $('gwOpen').classList.toggle('ghost', d.window === 'offen'); $('gwDraw').classList.toggle('ghost', d.window !== 'zu' && d.stats.participants === 0);
  $('gwDelete').classList.toggle('hidden', Boolean(dr.drawnAt));
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v ?? ''; };
  set('gwEntry', dr.entry); set('gwCommand', dr.command); set('gwMinutes', dr.minutes); set('gwSource', dr.pointsSource); $('gwReply').checked = dr.replyEntry; showFields();
  set('gwName', dr.name); set('gwFrom', dr.pointsFrom); set('gwOpenAt', dr.ticketOpen); set('gwCloseAt', dr.ticketClose); set('gwPlanned', dr.plannedDraw); set('gwBonusOpen', dr.bonusOpen); set('gwBonusClose', dr.bonusClose); set('gwBonusLots', dr.bonusLots);
  set('gwPer', dr.perPoints); set('gwMax', dr.maxLots); set('gwWCheckin', dr.weights.checkin); set('gwWStreak', dr.weights.streak); set('gwWStreakCap', dr.weights.streakCap);
  set('gwWChat', dr.weights.chat); set('gwWChatCap', dr.weights.chatDayCap); set('gwWChatGap', dr.weights.chatGap); set('gwHours', dr.winnerHours); set('gwAddrDays', dr.addressDays); set('gwKeep', dr.keepDays);
  for (const cb of document.querySelectorAll('.gwCountry')) cb.checked = dr.countries.includes(cb.value);
  if (document.activeElement !== $('gwTerms')) $('gwTerms').value = dr.terms;
  $('gwTermsPub').checked = dr.termsPublished;
  $('gwTermsPill').textContent = dr.termsPublished ? 'veröffentlicht' : 'Entwurf'; $('gwTermsPill').classList.toggle('on', dr.termsPublished);
  $('gwPrizeCount').textContent = dr.prizes.map((p) => p.name).join(' · ');
  prizes = dr.prizes.map((p) => ({ ...p }));
  renderPrizes();
  $('gwDraw').disabled = Boolean(dr.drawnAt); $('gwTest').disabled = Boolean(dr.drawnAt);
  $('gwStats').innerHTML = d.stats.rows.length ? `<table class="tk"><thead><tr><th>Lose</th><th>Personen</th><th>Anteil an allen Losen</th><th>Chance auf Platz 1 (je Person)</th></tr></thead><tbody>${d.stats.rows.map((r) => `<tr><td>${r.lots}</td><td>${r.persons}</td><td>${pct(r.share)}</td><td>${pct(r.chance)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Noch macht niemand mit.</p>';
  $('gwTickets').innerHTML = d.tickets.length ? `<table class="tk"><thead><tr><th>Name</th><th>Dabei seit</th><th>Punkte beim Mitmachen</th><th>Punkte jetzt</th><th>Lose</th><th></th></tr></thead><tbody>${d.tickets.map((t) => `<tr data-name="${esc(t.name)}"><td>${esc(t.name)}${t.blocked ? ' 🚫' : ''}${t.eligible ? '' : ' <span class="muted">(zählt nicht)</span>'}</td><td>${fmt(t.at)}</td><td>${t.pointsAtTicket}</td><td>${t.points}</td><td>${t.lots}${t.extra ? ' 🌙' : ''}</td><td>${t.blocked ? '' : '<button data-act="block" class="danger">Sperren</button>'}</td></tr>`).join('')}</tbody></table>` : '';
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
    <div><select data-f="kind" aria-label="Art"><option value="key"${p.kind === 'key' ? ' selected' : ''}>Key</option><option value="item"${p.kind === 'item' ? ' selected' : ''}>Sachpreis</option><option value="none"${p.kind === 'none' ? ' selected' : ''}>Ohne Link (nur Ansage)</option></select></div>
    <div><input data-f="key" maxlength="200" value="${esc(p.key ?? '')}" placeholder="Key (nur bei Key-Preis)" ${p.kind === 'key' ? '' : 'disabled'} autocomplete="off"></div>
    <button class="ghost" data-act="up" ${i ? '' : 'disabled'}>↑</button><button class="ghost" data-act="down" ${i < prizes.length - 1 ? '' : 'disabled'}>↓</button><button class="danger" data-act="rm">Entfernen</button></div>`).join('');
}

const apply = (res) => { data = res; render(); };
export async function loadGewinn() { apply(await api('GET', path())); }

function config() {
  const n = (id) => $(id).value;
  const c = {
    entry: n('gwEntry'), command: n('gwCommand'), minutes: n('gwMinutes'), replyEntry: $('gwReply').checked, pointsSource: n('gwSource'),
    name: n('gwName'), pointsFrom: n('gwFrom'), ticketOpen: n('gwOpenAt'), ticketClose: n('gwCloseAt'), plannedDraw: n('gwPlanned'), bonusOpen: n('gwBonusOpen'), bonusClose: n('gwBonusClose'), bonusLots: n('gwBonusLots'), perPoints: n('gwPer'), maxLots: n('gwMax'),
    weights: { checkin: n('gwWCheckin'), streak: n('gwWStreak'), streakCap: n('gwWStreakCap'), chat: n('gwWChat'), chatDayCap: n('gwWChatCap'), chatGap: n('gwWChatGap') },
    winnerHours: n('gwHours'), addressDays: n('gwAddrDays'), keepDays: n('gwKeep'), countries: [...document.querySelectorAll('.gwCountry')].filter((c) => c.checked).map((c) => c.value),
  };
  // Chat-Gewinnspiele öffnen und schließen per Knopf: die Ticket-Zeiten bleiben, wie der Server sie gesetzt hat
  if (c.entry === 'chat') for (const k of ['ticketOpen', 'ticketClose', 'bonusOpen', 'bonusClose', 'bonusLots']) delete c[k];
  return c;
}

export function initGewinn() {
  onAct($('gwDraws'), '[data-id]', async (act, row) => {
    const id = row.dataset.id;
    if (act === 'show') { sel = id; await loadGewinn(); $('gwDetail').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (act === 'select') { await api('POST', 'gewinn/select', { id }); sel = id; await loadGewinn(); toast('Der Ticket-Reward gehört jetzt zu diesem Gewinnspiel ✓'); return; }
    sel = id; apply(await api('POST', path('window'), { action: act })); toast(act === 'open' ? 'Geöffnet ✓' : 'Geschlossen ✓');
  });
  $('gwNew').addEventListener('click', run(async (e) => {
    const b = e.target.closest('[data-kind]'); if (!b) return;
    apply(await api('POST', 'gewinn/new', { kind: b.dataset.kind }));
    $('gwFoldConfig').open = true; $('gwFoldPrizes').open = true; $('gwDetail').scrollIntoView({ block: 'start', behavior: 'smooth' });
    toast('Angelegt ✓ – jetzt Name, Preis und Zeiten anpassen');
  }));
  $('gwEntry').addEventListener('change', showFields); $('gwSource').addEventListener('change', showFields);
  $('gwDelete').addEventListener('click', run(async () => {
    if (!confirm(`„${data.draw.name}“ mit allen Teilnehmern löschen?`)) return;
    const res = await api('DELETE', path()); sel = null; apply(res); toast('Gelöscht ✓');
  }));
  $('gwSave').addEventListener('click', run(async () => { apply(await api('PUT', path('config'), config())); toast('Gespeichert ✓'); }));
  $('gwSaveTerms').addEventListener('click', run(async () => { apply(await api('PUT', path('config'), { terms: $('gwTerms').value, termsPublished: $('gwTermsPub').checked })); toast('Gespeichert ✓'); }));
  $('gwOpen').addEventListener('click', run(async () => { apply(await api('POST', path('window'), { action: 'open' })); toast('Geöffnet ✓'); }));
  $('gwClose').addEventListener('click', run(async () => { apply(await api('POST', path('window'), { action: 'close' })); toast('Geschlossen ✓'); }));
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
  $('gwSavePrizes').addEventListener('click', run(async () => { apply(await api('PUT', path('config'), { prizes })); toast('Preise gespeichert ✓'); }));
  $('gwBlock').addEventListener('click', run(async () => { apply(await api('POST', path('block'), { name: $('gwBlockName').value })); $('gwBlockName').value = ''; toast('Gesperrt ✓'); }));
  onAct($('gwTickets'), '[data-name]', async (act, row) => { if (act === 'block' && confirm(`${row.dataset.name} sperren?`)) apply(await api('POST', path('block'), { name: row.dataset.name })); });
  $('gwBlocked').addEventListener('click', run(async (e) => { const n = e.target.dataset.unblock; if (n) apply(await api('DELETE', path(`block/${encodeURIComponent(n)}`))); }));
  $('gwTest').addEventListener('click', run(async () => {
    const r = await api('POST', path('test-draw'), { seed: $('gwSeed').value });
    $('gwTestOut').textContent = `Test (Seed ${r.seed}, ${r.participants} Teilnehmer):\n` + r.winners.map((w) => `${w.place}. ${w.name} (${w.lots} Lose) → ${w.prize}`).join('\n');
  }));
  $('gwDraw').addEventListener('click', run(async () => {
    if (!confirm('Jetzt wirklich ziehen? Das geht nur einmal, das Ergebnis erscheint sofort im Overlay und im Chat, und die Gewinner bekommen ihren Link.')) return;
    apply(await api('POST', path('draw'), { confirm: true, seed: $('gwSeed').value })); toast('Gezogen ✓');
  }));
  $('gwReplay').addEventListener('click', run(async () => { apply(await api('POST', path('overlay'), { action: 'show' })); toast('Overlay läuft neu ✓'); }));
  $('gwHide').addEventListener('click', run(async () => { apply(await api('POST', path('overlay'), { action: 'hide' })); toast('Overlay aus ✓'); }));
  $('gwProtocol').addEventListener('click', run(async () => { const r = await api('GET', path('protocol')); $('gwProtocolOut').textContent = JSON.stringify(r, null, 2); }));
  onAct($('gwWinners'), '[data-id]', async (act, row) => {
    const id = row.dataset.id, w = data.winners.find((x) => x.id === id);
    if (act === 'copy') { await navigator.clipboard.writeText(w.link); toast('Link kopiert ✓'); return; }
    if (act === 'address') { const r = await api('GET', path(`winner/${id}/address`)); const a = r.address; alert(`${a.name}\n${a.street}\n${a.zip} ${a.city}\n${a.country}${a.email ? '\n' + a.email : ''}`); return; }
    const ask = { redraw: `${w.name} ersetzen und nachziehen?`, 'delete-address': 'Adresse jetzt endgültig löschen?', link: 'Neuen Link erzeugen? Der alte wird ungültig.' }[act];
    if (ask && !confirm(ask)) return;
    apply(await api('POST', path(`winner/${id}/${act}`), {})); toast('Erledigt ✓');
  });
}
