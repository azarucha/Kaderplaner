// Baut aus src/ zwei Ausgaben:
//   dist/Kaderplaner.js  Scriptable-App mit Widget (eine Datei)
//   dist/web/            Web-App (PWA) mit Demo, Manifest, Service Worker und Icons
//   node build.mjs            -> nur bauen
//   node build.mjs --deploy   -> bauen und in den iCloud-Scriptable-Ordner kopieren
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };

const css = read('src/styles.css');
const js = ['src/calc.js', 'src/data.js', 'src/charts.js', 'src/app.js'].map(read).join('\n');
const page = ({ head = '', boot = '', script = js }) => read('src/index.html')
  .replace('<!--__HEAD__-->', () => head)
  .replace('/*__CSS__*/', () => css)
  .replace('/*__BOOT__*/', () => boot)
  .replace('/*__JS__*/', () => script);

// Scriptable: der Wrapper ersetzt /*__BOOT__*/ zur Laufzeit (Token aus der Keychain).
const scriptable = read('scriptable/wrapper.js')
  .replace('/*__HTML__*/', () => JSON.stringify(page({ boot: '/*__BOOT__*/' })));
write('dist/Kaderplaner.js', scriptable);

// Web-App: gleiche Oberflaeche plus Manifest, Service Worker und Icons.
const head = read('web/head.html');
const index = page({ head });
const demo = page({ head, script: read('tools/mock.js') + '\n' + js });
const version = crypto.createHash('sha1').update(index + demo).digest('hex').slice(0, 10);
fs.rmSync(path.join(root, 'dist/web'), { recursive: true, force: true });
write('dist/web/index.html', index);
write('dist/web/demo.html', demo);
write('dist/web/manifest.webmanifest', read('web/manifest.webmanifest'));
write('dist/web/sw.js', read('web/sw.js').replace('__VERSION__', version));
fs.cpSync(path.join(root, 'web/icons'), path.join(root, 'dist/web/icons'), { recursive: true });
fs.cpSync(path.join(root, 'web/fonts'), path.join(root, 'dist/web/fonts'), { recursive: true });
// GitHub Pages soll die Dateien unveraendert ausliefern
write('dist/web/.nojekyll', '');

console.log(`dist/Kaderplaner.js  ${(scriptable.length / 1024).toFixed(1)} KB`);
console.log(`dist/web/            Version ${version}`);

if (process.argv.includes('--deploy')) {
  const dir = process.env.SCRIPTABLE_DIR ||
    path.join(os.homedir(), 'iCloudDrive', 'iCloud~dk~simonbs~Scriptable');
  if (!fs.existsSync(dir)) {
    console.error('Scriptable-Ordner nicht gefunden: ' + dir + ' (SCRIPTABLE_DIR setzen)');
    process.exit(1);
  }
  const target = path.join(dir, 'Kaderplaner.js');
  const backup = path.join(dir, 'Kaderplaner (alt).js');
  if (fs.existsSync(target) && !fs.existsSync(backup)) fs.copyFileSync(target, backup);
  fs.writeFileSync(target, scriptable);
  console.log('deployed -> ' + target);
}
