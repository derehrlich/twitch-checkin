// Lichtshows von Hand auslösen (Reiter „Alerts“).
import { api, run, toast } from './core.js';

export function initLicht() {
  document.querySelectorAll('[data-licht]').forEach((b) => b.addEventListener('click', run(async () => {
    await api('POST', 'licht/test', { show: b.dataset.licht });
    toast('Show gestartet ✓');
  })));
}
