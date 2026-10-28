// Eingebautes Glockenspiel (G-Dur aufwärts, leichter Nachhall). Wird von Overlay und Admin genutzt.
// volume: 0..1
(() => {
  let audioCtx;
  window.playChime = function playChime(volume = 0.6) {
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
    [[783.99, 0], [987.77, 0.11], [1174.66, 0.22], [1567.98, 0.36]].forEach(([freq, at]) => {
      [[1, 1], [2, 0.28], [3.01, 0.1]].forEach(([mult, level]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(level, t0 + at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.1 / mult ** 0.5);
        osc.connect(gain).connect(master);
        osc.start(t0 + at);
        osc.stop(t0 + at + 1.2);
      });
    });
  };
})();
