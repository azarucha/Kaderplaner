// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: futbol;
// Kaderplaner - Scriptable Mini-App
// Generiert aus https://github.com/ (src/) via build.mjs - nicht direkt bearbeiten.

const html = /*__HTML__*/;

const webView = new WebView();
await webView.loadHTML(html);
await webView.present(true);
