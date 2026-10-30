// Hell/Dunkel-Schalter (Wahl wird im Browser gespeichert, wie im VerwirrBot-Dashboard)
(function () {
  var knopf = document.getElementById('thema');
  if (!knopf) return;
  knopf.addEventListener('click', function () {
    var jetzt = document.documentElement.dataset.theme ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    var neu = jetzt === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = neu;
    try { localStorage.setItem('theme', neu); } catch (e) {}
  });
})();
