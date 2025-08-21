// Service Worker for Canvas Drawing App
// This manages caching and automatic updates for home screen users

// Dynamic version - automatically updates on every deployment
let CACHE_VERSION = null;
let CACHE_NAME = null;

// Simple version that works everywhere
function getCurrentVersion() {
    // Use a simple timestamp-based version that changes when SW is updated
    // This ensures existing installations keep working
    return 'v1703525000'; // Fixed GitHub Pages paths
}

// Initialize cache version - simple and reliable
function initializeCacheVersion() {
    if (!CACHE_VERSION) {
        CACHE_VERSION = getCurrentVersion();
        CACHE_NAME = `canvas-app-${CACHE_VERSION}`;
        console.log('📱 Service Worker: Using version', CACHE_VERSION);
    }
    return CACHE_VERSION;
}

// Files to cache - these will be downloaded and stored locally
const STATIC_ASSETS = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './favicon.png',
    './manifest.json'
];

// Install event - cache assets when service worker is first installed
self.addEventListener('install', (event) => {
    const version = initializeCacheVersion();
    console.log('🔧 Service Worker: Installing version', version);
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📦 Service Worker: Caching assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('✅ Service Worker: Assets cached successfully');
                // Force activation of new service worker
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('❌ Service Worker: Failed to cache assets:', error);
                // Don't fail completely - try to continue
            })
    );
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', (event) => {
    const version = initializeCacheVersion();
    console.log('🚀 Service Worker: Activating version', version);
    
    event.waitUntil(
        Promise.all([
            // Clean up old caches
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName.startsWith('canvas-app-') && cacheName !== CACHE_NAME) {
                            console.log('🗑️ Service Worker: Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            // Take control of all pages immediately
            self.clients.claim()
        ]).then(() => {
            console.log('✅ Service Worker: Activated and ready');
            // Notify all clients about the update
            return self.clients.matchAll();
        }).then((clients) => {
            clients.forEach((client) => {
                client.postMessage({
                    type: 'SW_UPDATED',
                    version: CACHE_VERSION
                });
            });
        }).catch((error) => {
            console.log('Service Worker: Activation completed with some errors:', error);
        })
    );
});

// Fetch event - serve cached content and handle updates
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip cross-origin requests and external resources
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    // Skip external resources (fonts, etc.)
    if (event.request.url.includes('googleapis.com') || 
        event.request.url.includes('fonts.gstatic.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // If we have a cached version, serve it immediately
            if (cachedResponse) {
                // In the background, try to fetch fresh version for next time
                fetch(event.request).then((response) => {
                    if (response.status === 200) {
                        initializeCacheVersion();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, response.clone());
                        });
                    }
                }).catch(() => {
                    // Network error - just use cached version
                });
                
                return cachedResponse;
            }
            
            // If not cached, try to fetch from network
            return fetch(event.request).then((response) => {
                if (response.status === 200) {
                    // Cache successful responses
                    initializeCacheVersion();
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            });
        }).catch((error) => {
            console.error('Service Worker: Fetch failed:', error);
            
            // Try to serve cached index.html for navigation requests
            if (event.request.mode === 'navigate') {
                return caches.match('./index.html').then((indexResponse) => {
                    return indexResponse || caches.match('./');
                });
            }
            
            // For other requests, just fail gracefully
            throw error;
        })
    );
});

// Listen for messages from the main app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('Service Worker: Received skip waiting message');
        self.skipWaiting();
    }
});

console.log('📱 Service Worker: Loaded and ready');
