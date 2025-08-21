#!/usr/bin/env node

// Simple script to bump version.json manually for testing
// Run: node bump-version.js

const fs = require('fs');
const path = require('path');

const VERSION_FILE = path.join(__dirname, 'version.json');

try {
    let versionData;
    
    // Read existing version or create new one
    if (fs.existsSync(VERSION_FILE)) {
        versionData = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
        
        // Increment version (simple increment)
        const currentVersion = versionData.version;
        const match = currentVersion.match(/v(\d+)\.(\d+)\.(\d+)/);
        if (match) {
            const major = parseInt(match[1]);
            const minor = parseInt(match[2]);
            const patch = parseInt(match[3]) + 1;
            versionData.version = `v${major}.${minor}.${patch}`;
        } else {
            // Fallback to timestamp-based version
            versionData.version = `v${Math.floor(Date.now() / 1000)}`;
        }
    } else {
        // Create new version file
        versionData = {
            version: "v1.0.1",
            description: "Initial version"
        };
    }
    
    // Update timestamp
    versionData.updated = new Date().toISOString();
    
    // Write back to file
    fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData, null, 2));
    
    console.log(`✅ Version updated to: ${versionData.version}`);
    console.log(`📅 Updated: ${versionData.updated}`);
    console.log('\n💡 Restart your server to apply the changes');
    
} catch (error) {
    console.error('❌ Error updating version:', error.message);
    process.exit(1);
}
