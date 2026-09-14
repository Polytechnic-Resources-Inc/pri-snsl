// ===== SERVICE WORKER v8.8.5 =====
// Caching strategy for offline scanning with automatic cache updates

// Update this version with each release - triggers automatic cache refresh
const CACHE_VERSION = 'v8.8.5';
const CACHE_NAME = `seescan-${CACHE_VERSION}-offline`;

// Core assets to cache immediately on install
const CORE_ASSETS = [
    './',
    './index.html',
    './app.js',
    './supabase-health.js',
    './scan-cache.js',
    './manifest.json',
    './product_rules_master_truth.js'
];

// Optional assets - cached in background
const OPTIONAL_ASSETS = [
    './dashboard.html',
    './my-scans.html'
];

// ===== INSTALL EVENT =====
// Cache core assets immediately
self.addEventListener('install', event => {
    console.log(`📦 Service Worker installing: ${CACHE_VERSION}`);

    // Force immediate activation - no waiting for tabs to close
    self.skipWaiting();

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('📦 Caching core assets...');
                return cache.addAll(CORE_ASSETS);
            })
            .then(() => {
                console.log('✅ Core assets cached');
                // Optionally cache non-critical assets in background
                return caches.open(CACHE_NAME).then(cache => {
                    return cache.addAll(OPTIONAL_ASSETS.map(url =>
                        fetch(url).then(response => {
                            if (response.ok) return cache.put(url, response);
                        }).catch(() => {
                            // Optional assets failed - not critical
                            console.warn(`⚠️ Optional asset not cached: ${url}`);
                        })
                    ));
                });
            })
            .catch(error => {
                console.error('❌ Cache installation failed:', error);
            })
    );
});

// ===== FETCH EVENT =====
// Smart caching strategy
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // IMPORTANT: Never cache Supabase API requests
    // These must always go to network for real-time data
    if (url.hostname.includes('supabase.co')) {
        event.respondWith(
            fetch(event.request)
                .catch(error => {
                    // Network error - return appropriate response
                    console.error('Supabase request failed:', event.request.url);
                    // For scan operations, the app will queue locally
                    return new Response(JSON.stringify({ error: 'offline' }), {
                        status: 503,
                        statusText: 'Service Unavailable',
                        headers: { 'Content-Type': 'application/json' }
                    });
                })
        );
        return;
    }

    // IMPORTANT: Never cache other external APIs
    if (url.hostname.includes('api.') ||
        url.hostname.includes('unpkg.com') ||
        url.protocol === 'https:') {
        // Network only for external requests
        event.respondWith(fetch(event.request));
        return;
    }

    // For static assets: Cache First with Network Fallback
    // This ensures the app loads even when offline
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    // Cache hit - return cached asset
                    // Also fetch in background to check for updates
                    fetch(event.request).then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200) {
                            // Update cache with fresh version
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, networkResponse);
                            });
                        }
                    }).catch(() => {
                        // Network unavailable - stale cache is fine
                    });

                    return cachedResponse;
                }

                // Cache miss - fetch from network
                return fetch(event.request)
                    .then(networkResponse => {
                        // Don't cache if request failed
                        if (!networkResponse || networkResponse.status !== 200) {
                            return networkResponse;
                        }

                        // Clone and cache the response
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseToCache);
                        });

                        return networkResponse;
                    })
                    .catch(() => {
                        // Network failed completely - return offline fallback
                        if (event.request.destination === 'document') {
                            // For navigation requests, return index.html (app handles routing)
                            return caches.match('./index.html');
                        }
                        // For other requests, return a network error
                        return new Response('Offline - resource not cached', {
                            status: 503,
                            statusText: 'Service Unavailable'
                        });
                    });
            })
    );
});

// ===== ACTIVATE EVENT =====
// Clean up old caches and claim all clients
self.addEventListener('activate', event => {
    console.log(`🔄 Service Worker activating: ${CACHE_VERSION}`);

    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                console.log('🗑️ Checking for old caches to clean up...');

                // Delete all caches except current version
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log(`🗑️ Deleting old cache: ${cacheName}`);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('✅ Old caches cleaned up');

                // Take control of all open pages immediately
                // This ensures the new service worker controls all clients
                return self.clients.claim();
            })
            .then(() => {
                // Force all clients to reload to get the latest version
                return self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        // Navigate to the same URL - this forces a hard reload
                        client.navigate(client.url);
                    });
                });
            })
            .then(() => {
                // Notify all clients about the update
                // This triggers a reload on all open pages to get the latest version
                return self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        console.log(`📢 Notifying client about update: ${client.url}`);
                        client.postMessage({
                            type: 'SERVICE_WORKER_UPDATE',
                            version: CACHE_VERSION
                        });
                    });
                });
            })
    );
});

// ===== MESSAGE EVENT =====
// Handle messages from clients
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        // Force activation immediately
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        // Clear all caches and reload
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => caches.delete(cacheName))
            );
        }).then(() => {
            event.ports[0].postMessage({ type: 'CACHE_CLEARED' });
        });
    }
});

console.log(`🚀 Service Worker loaded: ${CACHE_VERSION}`);
