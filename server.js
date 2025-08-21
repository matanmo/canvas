// Simple development server without hot reload
// Use this to avoid the Dropbox sync refresh loop

const express = require('express');
const path = require('path');

const app = express();
const PORT = 8001;

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
