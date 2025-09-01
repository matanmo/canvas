// Simple development server without hot reload
// Use this to avoid the Dropbox sync refresh loop

const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve static files from current directory
app.use(express.static('.'));

// Handle root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Listen on all network interfaces (0.0.0.0) instead of just localhost
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🚀 Simple development server running!
📱 Open your browser to: http://localhost:${PORT}
🌐 Or access from other devices on your network: http://[YOUR_IP]:${PORT}
📝 Manual refresh needed - no hot reload (to avoid Dropbox sync issues)
    `);
});
