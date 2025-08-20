// Hot reload development server
// This server watches for file changes and automatically refreshes your browser

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const chokidar = require('chokidar');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Inject hot reload script into HTML files first (before static middleware)
app.get('/', (req, res) => {
    const fs = require('fs');
    let html = fs.readFileSync('index.html', 'utf8');
    
    // Add hot reload script before closing body tag
    const hotReloadScript = `
    <script>
        // Hot reload WebSocket connection
        const ws = new WebSocket('ws://localhost:8001');
        ws.onmessage = function(event) {
            if (event.data === 'reload') {
                console.log('Hot reload triggered!');
                window.location.reload();
            }
        };
        ws.onopen = function() {
            console.log('Hot reload connected!');
        };
        ws.onclose = function() {
            console.log('Hot reload disconnected, trying to reconnect...');
            // Try to reconnect every 2 seconds if connection is lost
            setTimeout(() => window.location.reload(), 2000);
        };
        ws.onerror = function(error) {
            console.log('Hot reload error:', error);
        };
    </script>
    `;
    
    html = html.replace('</body>', hotReloadScript + '</body>');
    res.send(html);
});

// Also handle index.html requests specifically
app.get('/index.html', (req, res) => {
    const fs = require('fs');
    let html = fs.readFileSync('index.html', 'utf8');
    
    // Add hot reload script before closing body tag
    const hotReloadScript = `
    <script>
        // Hot reload WebSocket connection
        const ws = new WebSocket('ws://localhost:8001');
        ws.onmessage = function(event) {
            if (event.data === 'reload') {
                console.log('Hot reload triggered!');
                window.location.reload();
            }
        };
        ws.onopen = function() {
            console.log('Hot reload connected!');
        };
        ws.onclose = function() {
            console.log('Hot reload disconnected, trying to reconnect...');
            // Try to reconnect every 2 seconds if connection is lost
            setTimeout(() => window.location.reload(), 2000);
        };
        ws.onerror = function(error) {
            console.log('Hot reload error:', error);
        };
    </script>
    `;
    
    html = html.replace('</body>', hotReloadScript + '</body>');
    res.send(html);
});

// Serve static files from current directory (after HTML routes)
app.use(express.static('.'));

// WebSocket connections for hot reload
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('Client connected for hot reload');
    
    ws.on('close', () => {
        clients.delete(ws);
        console.log('Client disconnected');
    });
});

// Watch for file changes with robust debouncing for Dropbox/cloud sync environments
const fs = require('fs');

// Track file contents to only reload on actual content changes
const fileContents = new Map();

// Initialize file contents
['index.html', 'style.css', 'app.js'].forEach(file => {
    try {
        if (fs.existsSync(file)) {
            fileContents.set(file, fs.readFileSync(file, 'utf8'));
        }
    } catch (err) {
        console.log(`Could not read ${file}:`, err.message);
    }
});

const watcher = chokidar.watch([
    '*.html',
    '*.css', 
    '*.js'
], {
    ignored: ['node_modules/**', 'server.js'],
    ignoreInitial: true,
    // More stable settings for cloud sync environments
    awaitWriteFinish: {
        stabilityThreshold: 1000,  // Wait for file to be stable for 1 second
        pollInterval: 100
    },
    ignorePermissionErrors: true
});

// Robust debounce reload that checks actual content changes
let reloadTimeout;
function debounceReload(filepath) {
    clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
        try {
            // Check if file content actually changed
            const currentContent = fs.readFileSync(filepath, 'utf8');
            const previousContent = fileContents.get(filepath);
            
            if (currentContent !== previousContent) {
                fileContents.set(filepath, currentContent);
                console.log(`File content changed: ${filepath}`);
                console.log('Reloading browser...');
                
                // Send reload message to all connected clients
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send('reload');
                    }
                });
            } else {
                console.log(`File touched but content unchanged: ${filepath}`);
            }
        } catch (err) {
            console.log(`Error reading ${filepath}:`, err.message);
        }
    }, 2000); // Wait 2 seconds for file to stabilize
}

watcher.on('change', (filepath) => {
    debounceReload(filepath);
});

// Start server
const PORT = 8001;
server.listen(PORT, () => {
    console.log(`
🚀 Development server running!
📱 Open your browser to: http://localhost:${PORT}
🔄 Hot reload is active - your browser will refresh automatically when you save changes
    `);
});
