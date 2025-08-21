// Simple development server without hot reload
// Use this to avoid the Dropbox sync refresh loop

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8001;

// Generate automatic version based on file modification times
function generateVersion() {
    try {
        // Get modification times of key files
        const files = ['app.js', 'style.css', 'index.html'];
        let latestTime = 0;
        
        files.forEach(file => {
            try {
                const stat = fs.statSync(path.join(__dirname, file));
                latestTime = Math.max(latestTime, stat.mtimeMs);
            } catch (err) {
                // File might not exist, skip
            }
        });
        
        // Create version from latest modification time
        return `v${Math.floor(latestTime / 1000)}`; // Convert to seconds
    } catch (error) {
        // Fallback to server start time
        return `v${Math.floor(Date.now() / 1000)}`;
    }
}

const APP_VERSION = generateVersion();
console.log(`📱 App version: ${APP_VERSION}`);

// Cache control middleware for PWA updates
app.use((req, res, next) => {
    // Service worker should never be cached
    if (req.url === '/sw.js') {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    } 
    // Manifest should have short cache for updates
    else if (req.url === '/manifest.json') {
        res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
    }
    // HTML files should have short cache to check for updates
    else if (req.url.endsWith('.html') || req.url === '/') {
        res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
    }
    // Static assets can be cached longer (service worker will handle updates)
    else {
        res.set('Cache-Control', 'public, max-age=86400'); // 1 day
    }
    
    next();
});

// API endpoint for version checking
app.get('/api/version', (req, res) => {
    res.json({ version: APP_VERSION });
});

// Serve static files from current directory
app.use(express.static('.'));

// Handle root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`
🚀 Simple development server running!
📱 Open your browser to: http://localhost:${PORT}
📝 Manual refresh needed - no hot reload (to avoid Dropbox sync issues)
    `);
});
