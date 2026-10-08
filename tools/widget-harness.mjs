// Fuehrt dist/Kaderplaner.js als Widget in Node aus: Scriptable-APIs sind
// nachgebildet, Kickbase-Aufrufe gehen an das Demo-Backend (tools/mock.js).
//   node tools/widget-harness.mjs [small|medium|large] [notoken]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const family = process.argv[2] || 'medium';
const noToken = process.argv.includes('notoken');

// --- Browser-Umgebung fuer mock.js
const store = {};
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
Object.defineProperty(localStorage, 'keys', { enumerable: false, value: () => Object.keys(store) });
const realKeys = Object.keys;
Object.keys = (o) => (o === localStorage ? realKeys(store) : realKeys(o));
new Function(fs.readFileSync(path.join(root, 'tools/mock.js'), 'utf8'))();
Object.keys = realKeys;

// --- Scriptable-Nachbildung
const keychain = noToken ? {} : { 'kaderplaner.kickbase.token': store.kp_demo_token };
const lines = [];
const node = (kind, depth) => {
  const n = {
    addText(s){ lines.push('  '.repeat(depth + 1) + 'text: ' + s); return {}; },
    addStack(){ lines.push('  '.repeat(depth + 1) + 'stack'); return node('stack', depth + 1); },
    addSpacer(){}, setPadding(){}, layoutHorizontally(){}, layoutVertically(){}, centerAlignContent(){},
    presentSmall: async () => {}, presentMedium: async () => {}, presentLarge: async () => {}
  };
  return n;
};
const g = globalThis;
g.config = { runsInWidget: true, widgetFamily: family };
g.args = { widgetParameter: null, queryParameters: {} };
g.Keychain = { contains: (k) => k in keychain, get: (k) => keychain[k], set: (k, v) => { keychain[k] = v; }, remove: (k) => { delete keychain[k]; } };
g.Request = class {
  constructor(url){ this.url = url; this.headers = {}; }
  async loadJSON(){ const r = await fetch(this.url, { headers: this.headers }); this.response = { statusCode: r.status }; return r.json(); }
};
g.ListWidget = class { constructor(){ lines.push('widget (' + family + ')'); Object.assign(this, node('widget', 0)); } };
g.LinearGradient = class {}; g.Point = class {}; g.Color = class { static white(){ return new Color(); } };
g.Font = { boldRoundedSystemFont: () => ({}), mediumSystemFont: () => ({}) };
g.DateFormatter = class { string(d){ return d.toISOString().slice(0, 16); } };
g.URLScheme = { forRunningScript: () => 'scriptable:///run/Kaderplaner' };
g.Script = { setWidget: (w) => { g.__widget = w; }, complete(){} };
g.WebView = class {};

const src = fs.readFileSync(path.join(root, 'dist/Kaderplaner.js'), 'utf8');
await new (Object.getPrototypeOf(async function(){}).constructor)(src)();
if (!g.__widget) throw new Error('Script.setWidget wurde nicht aufgerufen');
console.log(lines.join('\n'));
console.log('refresh:', g.__widget.refreshAfterDate && g.__widget.refreshAfterDate.toISOString(), '| url:', g.__widget.url);
