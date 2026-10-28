// Eingebaute Klänge (weiche Glockentöne mit leichtem Nachhall), je Ton-Platz ein eigener. Genutzt von Overlay und Admin.
// playChime(volume 0..1, slot)
(() => {
  // notes: [Frequenz, Startzeit in s]; type: Wellenform; decay: Länge der Töne in s
  const PATTERNS = {
    checkin: { notes: [[783.99, 0], [987.77, 0.11], [1174.66, 0.22], [1567.98, 0.36]] }, // G-Dur aufwärts
    checkout: { notes: [[1567.98, 0], [1174.66, 0.12], [987.77, 0.24], [783.99, 0.38]], decay: 1.3 }, // abwärts, wie ein Abschied
    milestone: { notes: [[523.25, 0], [659.25, 0.1], [783.99, 0.2], [1046.5, 0.3], [1318.51, 0.42], [1567.98, 0.56], [2093, 0.72]], decay: 1.8 }, // Fanfare
    raid: { notes: [[392, 0], [392, 0.16], [523.25, 0.32], [659.25, 0.56], [783.99, 0.56], [1046.5, 0.56]], type: 'triangle', decay: 1.6 }, // Horn
    follow: { notes: [[880, 0], [1318.51, 0.14]], decay: 0.9 }, // zwei sanfte Töne
    sub: { notes: [[659.25, 0], [830.61, 0.1], [987.77, 0.2], [1318.51, 0.32]], decay: 1.3 }, // E-Dur
    resub: { notes: [[587.33, 0], [739.99, 0.1], [880, 0.2], [1174.66, 0.3], [1479.98, 0.42]], decay: 1.5 }, // D-Dur mit Extra-Ton
    gift: { notes: [1318.51, 1567.98, 1760, 2093, 2349.32, 2637.02, 2093, 1760, 2093, 2637.02].map((f, i) => [f, i * 0.07]), decay: 0.7 }, // Glitzern
    cheer: { notes: [[1318.51, 0], [1975.53, 0.07]], decay: 0.45 }, // Münze
    rescue: { notes: [[392, 0], [587.33, 0.13], [783.99, 0.26], [987.77, 0.39], [1174.66, 0.58]], type: 'triangle', decay: 1.4 }, // heldenhaft
  };
  let audioCtx;
  window.playChime = function playChime(volume = 0.6, slot = 'checkin') {
    const { notes, type = 'sine', decay = 1.1 } = PATTERNS[slot] ?? PATTERNS.checkin;
    audioCtx ??= new AudioContext();
    audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = volume * 0.4;
    const echo = audioCtx.createDelay(); echo.delayTime.value = 0.17;
    const fb = audioCtx.createGain(); fb.gain.value = 0.32;
    const wet = audioCtx.createGain(); wet.gain.value = 0.45;
    master.connect(audioCtx.destination);
    master.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(audioCtx.destination);
    notes.forEach(([freq, at]) => {
      [[1, 1], [2, 0.28], [3.01, 0.1]].forEach(([mult, level]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq * mult;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(level * (type === 'triangle' ? 0.8 : 1), t0 + at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + decay / mult ** 0.5);
        osc.connect(gain).connect(master);
        osc.start(t0 + at);
        osc.stop(t0 + at + decay + 0.1);
      });
    });
  };
})();
