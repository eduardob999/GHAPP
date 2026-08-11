/**
 * Registers the app-shell service worker.
 *
 * Production only, on purpose: a worker that caches assets fights the dev
 * server's hot reload and hands you yesterday's bundle while you are editing.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;

  if (!('serviceWorker' in navigator)) {
    console.info('[pwa] This browser has no service worker support; offline shell disabled.');
    return;
  }

  window.addEventListener('load', () => {
    // BASE_URL is Vite's build-time base ('./' by default), which resolves to
    // the right sub-path on GitHub Pages without hardcoding the repo name.
    const workerUrl = new URL('service-worker.js', new URL(import.meta.env.BASE_URL, location.href));

    navigator.serviceWorker
      .register(workerUrl, { updateViaCache: 'none' })
      .then((registration) => {
        console.info('[pwa] Service worker registered for', registration.scope);
      })
      .catch((error: unknown) => {
        console.error('[pwa] Service worker registration failed.', error);
      });
  });

  // The worker calls skipWaiting(), so a new build takes control mid-session.
  // Reload once so the running JS matches the assets now being served.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}
