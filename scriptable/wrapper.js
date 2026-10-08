// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: futbol;
// Kaderplaner - Scriptable-App fuer Kickbase.
// Generiert mit build.mjs aus src/ - Aenderungen bitte dort vornehmen.

const KEY = "kaderplaner.kickbase.token";
let html = /*__HTML__*/;

// Token liegt in der iOS-Keychain und wird beim Start in die Seite gereicht.
const token = Keychain.contains(KEY) ? Keychain.get(KEY) : null;
const boot = "window.__KP_SCRIPTABLE=true;" + (token ? "window.__KP_TOKEN=" + JSON.stringify(token) + ";" : "");
html = html.replace("/*__BOOT__*/", () => boot);

const webView = new WebView();
// Die Seite meldet Token-Aenderungen ueber kaderplaner://-Links zurueck.
webView.shouldAllowRequest = (request) => {
  const url = String(request.url || "");
  if (url.startsWith("kaderplaner://token/")) {
    Keychain.set(KEY, decodeURIComponent(url.slice("kaderplaner://token/".length)));
    return false;
  }
  if (url.startsWith("kaderplaner://logout")) {
    if (Keychain.contains(KEY)) Keychain.remove(KEY);
    return false;
  }
  return true;
};
await webView.loadHTML(html);
await webView.present(true);
