// Bump version.json "build" before deploy so home-screen / cached clients load new app.js + style.css
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'version.json');
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
j.build = (Number(j.build) || 0) + 1;
fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');

const indexPath = path.join(root, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(
    /href="style\.css(\?b=[^"]*)?"/,
    `href="style.css?b=${j.build}"`
);
fs.writeFileSync(indexPath, html);

console.log('version.json build →', j.build);
console.log('index.html stylesheet href → style.css?b=' + j.build);
