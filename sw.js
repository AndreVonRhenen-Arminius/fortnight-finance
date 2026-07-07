const CACHE = 'fortnight-finance-v2';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/config.js', './js/app.js', './js/utils.js', './js/storage.js', './js/sync.js', './js/backup.js',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png', './vendor/supabase.min.js'
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

  // Network-first prevents an old config.js or application file from being
  // retained after a GitHub Pages update, while the cache remains available
  // when the device is offline.
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
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('Offline and resource is not cached.');
      })
  );
});
