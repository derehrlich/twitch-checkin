// Gemeinsame Hilfen für die Chat-Overlays (/chat und /chat-hoch): Alpaka-Bilder, Farben, Verlauf und Glitzer.
// Deine Alpaka-Bilder, je Nachricht eins (nach der Nachrichten-Kennung, so bleibt es nach einem Neuladen gleich)
const ALPAKAS = [
  'https://user-assets.meldstudio.co/99e838bc23a44b1c9f392c53f2d7a95c/ua/ast_mhyq6kt35g912r7w',
  'https://user-assets.meldstudio.co/99e838bc23a44b1c9f392c53f2d7a95c/ua/ast_y4kngmsfnywe8vt7',
  'https://user-assets.meldstudio.co/99e838bc23a44b1c9f392c53f2d7a95c/ua/ast_flchcoran15t0ic1',
  'https://user-assets.meldstudio.co/99e838bc23a44b1c9f392c53f2d7a95c/ua/ast_atpytgfw5o4colo8',
  'https://user-assets.meldstudio.co/99e838bc23a44b1c9f392c53f2d7a95c/ua/ast_i9vmvbmpumttu97g',
  'https://user-assets.meldstudio.co/99e838bc23a44b1c9f392c53f2d7a95c/ua/ast_67opte92pph2vvdf',
];
const hash = (str) => [...str].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return '#' + x(f(0)) + x(f(8)) + x(f(4));
}
function shiftHex(hex, deg) { // weitere Farben für Verlauf und Glitzer: Farbton gedreht
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  }
  // Mindestens kräftige Farbe, sonst sieht man bei Grau, Weiß oder Schwarz keinen Verlauf
  return hslToHex((h * 360 + deg + 360) % 360, Math.max(s, 0.75) * 100, Math.min(0.72, Math.max(0.5, l)) * 100);
}

const sig = (m) => JSON.stringify([m.c, m.g, m.s, m.gc, m.gl]);
function style(el, m) { // Farbe und Extras setzen, auch später, wenn sich der Stil der Person ändert
  const base = m.c || hslToHex(hash(m.n.toLowerCase()) % 360, 100, 75); // ohne eigene Farbe: pro Person immer dieselbe
  el.classList.toggle('fx-gradient', Boolean(m.g)); el.classList.toggle('fx-glitter', Boolean(m.s));
  el.dataset.sig = sig(m);
  el.querySelector('.name').style.color = m.g || m.s ? '' : base;
  el.style.setProperty('--c1', base);
  el.style.setProperty('--cg', /^#[0-9a-f]{6}$/i.test(m.gl ?? '') ? m.gl : base); // Glitzerfarbe: eigene, sonst die Namensfarbe
  // Verlauffarben: eigene (2 oder 3) oder automatisch aus der Namensfarbe (Farbton +70° und +140°)
  const own = (m.gc ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const cols = own.length >= 2 ? own : [own[0] ?? base, shiftHex(own[0] ?? base, 70), shiftHex(own[0] ?? base, 140)];
  const mid = cols.length > 2 ? `${cols[1]} 24%, ` : '', midEnd = cols.length > 2 ? `, ${cols[1]} 76%` : '';
  el.style.setProperty('--grad', `linear-gradient(90deg, ${cols.join(', ')})`);
  el.style.setProperty('--gradglit', `linear-gradient(100deg, ${cols[0]} 0%, ${mid}#fff 48%, #fff 52%${midEnd}, ${cols.at(-1)} 100%)`);
  el.style.setProperty('--c2', cols[1] ?? base);
}
