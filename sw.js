// Service Worker for Canvas Drawing App
// This manages caching and automatic updates for home screen users

// Dynamic version - automatically updates on every deployment
let CACHE_VERSION = null;
let CACHE_NAME = null;

// Get the current version from the server
async function getCurrentVersion() {
    try {
        // Try static version file first (for GitHub Pages and static hosting)
        try {
            const response = await fetch('./version.json');
            if (response.ok) {
                const data = await response.json();
                console.log('Version fetched from version.json:', data.version);
                return data.version;
            }
        } catch (err) {
            console.log('No version.json found, trying server endpoints');
        }
        
        // Try server endpoints (for local/custom server)
        const endpoints = [
            '/api/version',           // For local/custom server
            './api/version',          // Relative path
        ];
        
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint);
                if (response.ok) {
                    const data = await response.json();
                    console.log(`Version fetched from ${endpoint}:`, data.version);
                    return data.version;
                }
            } catch (err) {
                console.log(`Failed to fetch from ${endpoint}:`, err.message);
            }
        }
        
        // If all endpoints fail, use file-based versioning
        console.log('All version endpoints failed, using file-based versioning');
        return await getFileBasedVersion();
        
    } catch (error) {
        // Ultimate fallback to timestamp
        console.log('Using timestamp fallback versioning');
        return `v${Date.now()}`;
    }
}

// File-based version detection as backup
async function getFileBasedVersion() {
    try {
        // Fetch main files and use their headers/content to determine version
        const files = ['app.js', 'style.css', 'index.html'];
        let latestTime = 0;
        
        for (const file of files) {
            try {
                const response = await fetch(file, { method: 'HEAD' });
                if (response.ok) {
                    const lastModified = response.headers.get('last-modified');
                    if (lastModified) {
                        const time = new Date(lastModified).getTime();
                        latestTime = Math.max(latestTime, time);
                    }
                }
            } catch (err) {
                // File might not exist or network error
            }
        }
        
        return latestTime > 0 ? `v${Math.floor(latestTime / 1000)}` : `v${Date.now()}`;
    } catch (error) {
        return `v${Date.now()}`;
    }
}

// Initialize cache version
async function initializeCacheVersion() {
    if (!CACHE_VERSION) {
        CACHE_VERSION = await getCurrentVersion();
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
    './manifest.json',
    './version.json'
];

// Install event - cache assets when service worker is first installed
self.addEventListener('install', (event) => {
    event.waitUntil(
        initializeCacheVersion().then((version) => {
            console.log('🔧 Service Worker: Installing version', version);
            
            return caches.open(CACHE_NAME)
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
                });
        })
    );
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', (event) => {
    event.waitUntil(
        initializeCacheVersion().then((version) => {
            console.log('🚀 Service Worker: Activating version', version);
            
            return Promise.all([
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
            });
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
    
    // Skip API requests that might not exist on all hosting platforms
    if (event.request.url.includes('/api/')) {
        return;
    }

    // Skip external resources (fonts, etc.)
    if (event.request.url.includes('googleapis.com') || 
        event.request.url.includes('fonts.gstatic.com')) {
        return;
    }

    event.respondWith(
        initializeCacheVersion().then(() => {
            return caches.match(event.request);
        }).then((cachedResponse) => {
            // If we have a cached version, serve it immediately
            if (cachedResponse) {
                // In the background, fetch fresh version for next time (but don't wait for it)
                fetchAndCache(event.request).catch(() => {
                    // Silently fail background updates
                });
                return cachedResponse;
            }
            
            // If not cached, fetch from network
            return fetchAndCache(event.request);
        }).catch((error) => {
            console.error('Service Worker: Fetch failed:', error);
            
            // Try to serve cached index.html for navigation requests
            if (event.request.mode === 'navigate') {
                return caches.match('./index.html').then((indexResponse) => {
                    if (indexResponse) {
                        return indexResponse;
                    }
                    return new Response('App is offline. Please check your connection.', {
                        status: 503,
                        statusText: 'Service Unavailable',
                        headers: { 'Content-Type': 'text/html' }
                    });
                });
            }
            
            return new Response('Resource not available offline.', {
                status: 503,
                statusText: 'Service Unavailable'
            });
        })
    );
});

// Helper function to fetch and cache resources
async function fetchAndCache(request) {
    try {
        await initializeCacheVersion(); // Ensure cache name is set
        const response = await fetch(request);
        
        // Only cache successful responses
        if (response.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            // Clone the response as it can only be consumed once
            cache.put(request, response.clone());
        }
        
        return response;
    } catch (error) {
        console.error('Service Worker: Network fetch failed:', error);
        throw error;
    }
}

// Listen for messages from the main app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('Service Worker: Received skip waiting message');
        self.skipWaiting();
    }
});

// Background sync for future enhancements (optional)
self.addEventListener('sync', (event) => {
    console.log('Service Worker: Background sync triggered:', event.tag);
});

console.log('📱 Service Worker: Loaded with dynamic versioning');
