// Baut aus src/ eine einzelne Scriptable-Datei (dist/Kaderplaner.js) und eine
// eigenstaendige HTML-Datei (dist/index.html) fuer Vorschau und Web-Version.
//   node build.mjs            -> nur bauen
//   node build.mjs --deploy   -> bauen und in den iCloud-Scriptable-Ordner kopieren
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const css = read('src/styles.css');
const js = ['src/calc.js', 'src/data.js', 'src/app.js'].map(read).join('\n');
const html = read('src/index.html')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

const wrapper = read('scriptable/wrapper.js');
const scriptable = wrapper.replace('/*__HTML__*/', () => JSON.stringify(html));

// Demo-Version mit simuliertem Backend (tools/mock.js) fuer Vorschau und Screenshots
const demo = read('src/index.html')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => read('tools/mock.js') + '\n' + js);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
fs.writeFileSync(path.join(root, 'dist/demo.html'), demo);
fs.writeFileSync(path.join(root, 'dist/Kaderplaner.js'), scriptable);
console.log(`dist/Kaderplaner.js  ${(scriptable.length / 1024).toFixed(1)} KB`);

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
