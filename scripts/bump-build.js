// Bump version.json "build" before deploy so home-screen / cached clients load new app.js + style.css
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'version.json');
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
j.build = (Number(j.build) || 0) + 1;
fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
console.log('version.json build →', j.build);
