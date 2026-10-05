// Copies the MAX web app from the repository root into native/www so the
// native shell ships with the app bundled (works offline, passes store
// review as a real app rather than a website wrapper).
const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '..', '..'); const www = path.resolve(__dirname, '..', 'www');
const FILES = ['index.html', 'max.js', 'privacy.html', 'manifest.webmanifest', 'icon.png'];
const DIRS = ['icons'];
fs.rmSync(www, { recursive: true, force: true }); fs.mkdirSync(www, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(root, f), path.join(www, f));
for (const d of DIRS) fs.cpSync(path.join(root, d), path.join(www, d), { recursive: true });
console.log('Copied ' + FILES.length + ' files and ' + DIRS.join(', ') + '/ into native/www');
