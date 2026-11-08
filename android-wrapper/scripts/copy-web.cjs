const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = path.join(root, 'app', 'static');
const dest = path.resolve(__dirname, '..', 'www');

fs.rmSync(dest, {recursive: true, force: true});
fs.mkdirSync(path.join(dest, 'static'), {recursive: true});
fs.copyFileSync(path.join(source, 'index.html'), path.join(dest, 'index.html'));
fs.copyFileSync(path.join(source, 'manifest.webmanifest'), path.join(dest, 'manifest.webmanifest'));
fs.copyFileSync(path.join(source, 'service-worker.js'), path.join(dest, 'service-worker.js'));
fs.copyFileSync(path.join(source, 'default-forms.json'), path.join(dest, 'static', 'default-forms.json'));
for (const file of ['styles.css', 'app.js', 'icon.svg']) {
  fs.copyFileSync(path.join(source, file), path.join(dest, 'static', file));
}
console.log(`Fichiers web copiés vers ${dest}`);
