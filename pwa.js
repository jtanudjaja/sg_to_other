/* Install support is optional; the departure board also works from file://. */
(() => {
  const help = document.getElementById('installHelp');
  const button = document.getElementById('installBtn');
  const status = document.getElementById('installStatus');
  const offline = document.getElementById('offlineNote');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installPrompt = null;

  function syncInstalled() {
    help.hidden = standalone.matches || navigator.standalone === true;
  }
  function syncConnection() {
    offline.hidden = navigator.onLine !== false;
  }
  syncInstalled();
  syncConnection();
  standalone.addEventListener('change', syncInstalled);
  window.addEventListener('online', syncConnection);
  window.addEventListener('offline', syncConnection);

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    button.hidden = false;
    status.textContent = '';
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    button.hidden = true;
    help.hidden = true;
  });
  button.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    button.hidden = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      status.textContent = choice.outcome === 'accepted'
        ? 'Installation requested. Open Ferry Departures from your home screen or apps.'
        : 'You can install later from your browser menu.';
    } catch {
      status.textContent = 'Use your browser menu to install Ferry Departures.';
    }
  });

  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      // Updates wait for existing tabs to close so a visit uses one complete release.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) registration.update().catch(() => {});
      });
    } catch (error) {
      console.warn('Offline support could not be enabled.', error);
    }
  });
})();
