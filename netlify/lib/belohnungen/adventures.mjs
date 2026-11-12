// Adventure-Einreichungen (Community-Tage): Zuschauer reichen per Twitch-Chat (!adventure) oder Discord (VerwirrBot) ein,
// alles landet in EINER Liste. Im Admin überträgst du sie mit einem Klick aufs Glücksrad.
//   adv/entry/<id>        { id, title, link, name, source ('twitch'|'discord'|'admin'), who, at, status }
//                         status: 'offen' | 'gedreht' (das Rad hat es gewählt) | 'gespielt'
//   adv/title/<sha256>    id   (setIfNew: dasselbe Adventure kommt nur einmal in die Liste)
// `who` ist der Schlüssel der Person: Twitch-ID, oder bei verknüpften Discord-Konten dieselbe Twitch-ID (zählt über beide Wege einmal).
import crypto from 'node:crypto';
import { db } from '../kern/store.mjs';
import { fill } from '../zuschauer/checkin.mjs';
import { linkByDiscord, DISCORD_ID } from './community.mjs';
import { createWheel, getWheel, updateWheel } from '../overlays/gluecksrad.mjs';

export const MAX_ENTRIES = 300;
export const STATUS = ['offen', 'gedreht', 'gespielt'];
const ID = /^[a-f0-9]{8}$/;
export const isEntryId = (v) => ID.test(String(v ?? ''));
const nid = () => crypto.randomBytes(4).toString('hex');
const entryKey = (id) => `adv/entry/${id}`;
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const URL_RE = /https?:\/\/[^\s<>"']+/i;

/** „Mein Adventure https://…“ -> { title, link }. Nur http(s)-Links, der Rest ist der Name. Ohne Namen dient der Host des Links. */
export function parseSubmission(text) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  const m = raw.match(URL_RE);
  const link = m ? m[0].slice(0, 300) : '';
  let title = (m ? raw.replace(m[0], ' ') : raw).replace(/\s+/g, ' ').replace(/^[-–:|,\s]+|[-–:|,\s]+$/g, '').slice(0, 80);
  if (!title && link) { try { title = new URL(link).hostname.replace(/^www\./, ''); } catch { /* Link ohne Host */ } }
  return { title, link };
}

export async function listEntries() {
  const out = [];
  for (const k of await db.list('adv/entry/')) { const e = await db.get(k); if (e) out.push(e); }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Eine Einreichung annehmen. `person` = { key, name }, `source` = 'twitch' | 'discord' | 'admin'. Gibt { ok, reason, reply } zurück, reply ist der Text für Chat oder Discord. */
export async function submit(settings, text, person, source, now = Date.now()) {
  const vars = { user: person.name, max: settings.advMaxPerPerson };
  const no = (reason, template) => ({ ok: false, reason, reply: fill(template, vars) });
  if (source !== 'admin' && (!settings.advEnabled || !settings.advOpen)) return no('closed', settings.advClosedTemplate);
  const { title, link } = parseSubmission(text);
  if (!title) return no('empty', settings.advNoTextTemplate);
  const all = await listEntries();
  if (source !== 'admin') {
    if (all.filter((e) => e.who === person.key).length >= settings.advMaxPerPerson) return no('limit', settings.advLimitTemplate);
  }
  if (all.length >= MAX_ENTRIES) return no('full', settings.advClosedTemplate);
  const id = nid();
  const dup = { ok: false, reason: 'duplicate', reply: fill(settings.advDuplicateTemplate, { ...vars, title }) };
  if (link && all.some((e) => e.link && e.link === link)) return dup;
  // Atomar: dasselbe Adventure (gleicher Name) nur einmal, auch bei gleichzeitigen Einreichungen
  if (!(await db.setIfNew(`adv/title/${sha(norm(title))}`, id))) return dup;
  const entry = { id, title, link, name: person.name, source, who: person.key, at: new Date(now).toISOString(), status: 'offen' };
  await db.set(entryKey(id), entry);
  return { ok: true, entry, count: all.length + 1, reply: fill(settings.advAddedTemplate, { ...vars, title, count: all.length + 1 }) };
}

/** Aus dem Twitch-Chat. */
export const submitFromTwitch = (settings, e, text) => submit(settings, text, { key: `t:${e.chatter_user_id}`, name: e.chatter_user_name }, 'twitch');

/** Vom VerwirrBot. Ist das Discord-Konto verknüpft, zählt die Person über beide Wege einmal (Twitch-ID als Schlüssel). */
export async function submitFromDiscord(settings, { discordId, discordName, text }) {
  if (!DISCORD_ID.test(String(discordId ?? ''))) return { ok: false, reason: 'invalid', reply: 'Ungültige Discord-ID', status: 400 };
  const link = await linkByDiscord(String(discordId));
  const person = link ? { key: `t:${link.twitchId}`, name: link.twitchName } : { key: `d:${discordId}`, name: String(discordName ?? 'Jemand').slice(0, 40) };
  return submit(settings, text, person, 'discord');
}

export async function updateEntry(id, input) {
  const e = isEntryId(id) ? await db.get(entryKey(id)) : null;
  if (!e) return null;
  const i = input ?? {};
  if (STATUS.includes(i.status)) e.status = i.status;
  if ('link' in i) e.link = parseSubmission(i.link).link;
  await db.set(entryKey(id), e);
  return e;
}

export async function removeEntry(id) {
  const e = isEntryId(id) ? await db.get(entryKey(id)) : null;
  if (!e) return false;
  await db.delete(entryKey(id));
  await db.delete(`adv/title/${sha(norm(e.title))}`);
  return true;
}

/** Liste leeren: alle, oder nur diejenigen mit diesem Status. */
export async function clearEntries(status) {
  let n = 0;
  for (const e of await listEntries()) if (!status || e.status === status) { await removeEntry(e.id); n++; }
  return n;
}

/** Offene Einreichungen aufs Glücksrad: neues Rad (name) oder die Felder eines bestehenden Rads ersetzen (wheelId). */
export async function toWheel({ wheelId, name, statuses = ['offen'] } = {}) {
  const entries = (await listEntries()).filter((e) => statuses.includes(e.status));
  if (entries.length < 2) throw new Error('Es braucht mindestens 2 Einreichungen, damit sich ein Rad lohnt');
  const segments = entries.map((e) => ({ label: e.title, note: `eingereicht von ${e.name}`, ref: e.id }));
  let wheel;
  if (wheelId) {
    if (!(await getWheel(wheelId))) throw new Error('Rad nicht gefunden');
    wheel = await updateWheel(wheelId, { rawSegments: segments, removeWon: true });
  } else wheel = await createWheel({ name: name || 'Adventures', segments, removeWon: true });
  return { wheel, used: Math.min(entries.length, wheel.segments.length), skipped: Math.max(0, entries.length - wheel.segments.length) };
}

export async function adminView(settings) {
  const entries = await listEntries();
  return { enabled: settings.advEnabled, open: settings.advOpen, command: settings.advCommand, max: settings.advMaxPerPerson, entries, counts: { all: entries.length, offen: entries.filter((e) => e.status === 'offen').length } };
}

/** Für den VerwirrBot: Titel und Einreicher, ohne Links und IDs. */
export async function botView(settings) {
  const entries = await listEntries();
  return { enabled: settings.advEnabled, open: settings.advOpen, count: entries.length, entries: entries.map((e) => ({ title: e.title, name: e.name, source: e.source, status: e.status })) };
}
