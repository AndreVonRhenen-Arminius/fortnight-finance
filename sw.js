const CACHE = 'fortnight-finance-v10';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/config.js', './js/app.js', './js/utils.js', './js/storage.js', './js/sync.js', './js/backup.js',
  './samples/finance-setup-template.csv', './assets/icons/icon-192.png', './assets/icons/icon-512.png', './vendor/supabase.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Recovery guard: the old template link could navigate an installed PWA to
  // the CSV itself. Any attempt to open a CSV as a page now returns to the app.
  if (event.request.mode === 'navigate' && url.pathname.toLowerCase().endsWith('.csv')) {
    event.respondWith(Response.redirect(new URL('./', self.registration.scope).href, 302));
    return;
  }

  // Network-first keeps GitHub Pages updates current. The cache is used only
  // when the device is offline or GitHub Pages cannot be reached.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('Offline and resource is not cached.');
      })
  );
});
