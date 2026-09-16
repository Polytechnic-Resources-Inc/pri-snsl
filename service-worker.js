// Offline shell: versioned assets, no API caching, no forced reload during scanning.
const CACHE_VERSION = 'v8.8.9';
const CACHE_NAME = `seescan-${CACHE_VERSION}-offline`;
const CORE_ASSETS = [
    './', './index.html', './app.js', './supabase-health.js', './scan-cache.js',
    './manifest.json', './vendor/supabase.min.js', './icon-192.png', './icon-512.png',
    './dashboard.html', './my-scans.html'
];
self.addEventListener('install', event => {
    // Reject a partial install so the previous complete offline shell remains available.
    // Let the browser activate the update when old clients close, not mid-scan.
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    const pathname = url.pathname;
    const isShell = CORE_ASSETS.some(asset => new URL(asset, self.location.origin + '/').pathname === pathname);
    if (!isShell) return; // In particular, never cache REST/configuration requests.
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
    }));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(names => Promise.all(
        names.filter(name => name.startsWith('seescan-') && name !== CACHE_NAME)
            .map(name => caches.delete(name))
    )).then(() => self.clients.claim()));
});
