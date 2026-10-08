// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: futbol;
// Kaderplaner - Scriptable-App und Homescreen-Widget fuer Kickbase.
// Generiert mit build.mjs aus src/ - Aenderungen bitte dort vornehmen.

const TOKEN_KEY = "kaderplaner.kickbase.token";
const LEAGUE_KEY = "kaderplaner.kickbase.league";
const API = "https://api.kickbase.com/v4";

const keyGet = (k) => (Keychain.contains(k) ? Keychain.get(k) : null);
const keyDel = (k) => { if (Keychain.contains(k)) Keychain.remove(k); };

if (config.runsInWidget) {
  Script.setWidget(await buildWidget(config.widgetFamily || "small"));
} else if (args.queryParameters && args.queryParameters.preview) {
  // Vorschau aus der App: kaderplaner-Skript mit ?preview=small|medium|large starten
  const fam = args.queryParameters.preview;
  const w = await buildWidget(fam);
  if (fam === "large") await w.presentLarge();
  else if (fam === "medium") await w.presentMedium();
  else await w.presentSmall();
} else {
  await runApp();
}
Script.complete();

// ---------------------------------------------------------------- App
async function runApp() {
  let html = /*__HTML__*/;
  const token = keyGet(TOKEN_KEY);
  const boot = "window.__KP_SCRIPTABLE=true;" +
    (token ? "window.__KP_TOKEN=" + JSON.stringify(token) + ";" : "") +
    (keyGet(LEAGUE_KEY) ? "window.__KP_LEAGUE=" + JSON.stringify(keyGet(LEAGUE_KEY)) + ";" : "");
  html = html.replace("/*__BOOT__*/", () => boot);

  const webView = new WebView();
  // Die Seite meldet Token und gewaehlte Liga ueber kaderplaner://-Links zurueck.
  webView.shouldAllowRequest = (request) => {
    const url = String(request.url || "");
    if (!url.startsWith("kaderplaner://")) return true;
    const [kind, ...rest] = url.slice("kaderplaner://".length).split("/");
    const value = decodeURIComponent(rest.join("/"));
    if (kind === "token") Keychain.set(TOKEN_KEY, value);
    else if (kind === "league") Keychain.set(LEAGUE_KEY, value);
    else if (kind === "logout") { keyDel(TOKEN_KEY); keyDel(LEAGUE_KEY); }
    return false;
  };
  await webView.loadHTML(html);
  await webView.present(true);
}

// ------------------------------------------------------------- Widget
async function api(path, token) {
  const req = new Request(API + path);
  req.headers = { Authorization: "Bearer " + token, Accept: "application/json" };
  req.timeoutInterval = 15;
  const data = await req.loadJSON();
  const status = req.response && req.response.statusCode;
  if (status === 401 || status === 403) throw new Error("auth");
  if (status && status >= 400) throw new Error("http-" + status);
  return data;
}

function short(n) {
  n = n || 0;
  const a = Math.abs(n);
  let s;
  if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(".", ",") + " Mio";
  else if (a >= 1e3) s = Math.round(a / 1e3) + "k";
  else s = String(Math.round(a));
  return (n < 0 ? "−" : "") + s;
}

function countdown(sec) {
  if (sec == null) return "";
  if (sec <= 0) return "jetzt";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? h + "h " + m + "m" : m + "m";
}

async function loadWidgetData() {
  const token = keyGet(TOKEN_KEY);
  if (!token) return { error: "Öffne den Kaderplaner einmal und füge deinen Token ein." };
  try {
    const sel = await api("/leagues/selection", token);
    const leagues = (sel && sel.it) || [];
    if (!leagues.length) return { error: "Keine Liga gefunden." };
    // Widget-Parameter (Liganame oder ID) vor zuletzt geoeffneter Liga vor erster Liga
    const param = (args.widgetParameter || "").trim().toLowerCase();
    const stored = keyGet(LEAGUE_KEY);
    const league =
      (param && leagues.find((l) => String(l.i) === param || (l.n || "").toLowerCase().includes(param))) ||
      leagues.find((l) => String(l.i) === stored) || leagues[0];
    const id = league.i;
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const uid = payload["kb.uid"];

    const [me, squad, market, perf] = await Promise.all([
      api(`/leagues/${id}/me`, token),
      api(`/leagues/${id}/squad`, token),
      api(`/leagues/${id}/market`, token),
      uid ? api(`/leagues/${id}/managers/${uid}/performance`, token).catch(() => null) : null
    ]);
    const players = (squad && squad.it) || [];
    const tv = players.reduce((s, p) => s + (p.mv || 0), 0);
    const budget = me.b || 0;
    const room = budget + 0.33 * (tv + budget);
    let kickoff = null;
    const season = perf && perf.it && perf.it[0];
    ((season && season.it) || []).forEach((d) => {
      const t = d.md ? Date.parse(d.md) : null;
      if (t && t > Date.now() && (kickoff == null || t < kickoff)) kickoff = t;
    });
    const pos = { 1: "TW", 2: "ABW", 3: "MF", 4: "ANG" };
    const expiring = ((market && market.it) || [])
      .filter((p) => p.exs != null && !p.u)
      .sort((a, b) => a.exs - b.exs)
      .map((p) => ({ name: p.n, pos: pos[p.pos] || "", price: p.prc != null ? p.prc : p.mv, exs: p.exs, bids: p.ofc || 0 }));
    const offers = players.reduce((s, p) => s + (p.ofc || 0), 0);
    return { league: league.n, budget, room, squad: players.length, limit: me.mppu, kickoff, expiring, offers };
  } catch (e) {
    if (String(e.message) === "auth") return { error: "Token abgelaufen. Im Kaderplaner neu einfügen." };
    return { error: "Kickbase nicht erreichbar.", retry: true };
  }
}

async function buildWidget(family) {
  const d = await loadWidgetData();
  // Gleiche Farben wie die App: Schwarz/Weiss, Gruen nur fuer den Spielraum, Rot fuer Minus.
  const dyn = (light, dark) => Color.dynamic(new Color(light), new Color(dark));
  const w = new ListWidget();
  w.backgroundColor = dyn("#ffffff", "#0e0e0e");
  w.setPadding(14, 14, 14, 14);
  w.url = URLScheme.forRunningScript();
  const white = dyn("#111111", "#f2f2f0");   // Haupttext
  const soft = dyn("#6b6b6b", "#9a9a96");    // Nebentext
  const acc = dyn("#1a7f4e", "#3fb37a");
  const neg = dyn("#b42318", "#ff7a6b");

  const text = (stack, str, size, opts = {}) => {
    const t = stack.addText(str);
    t.font = opts.bold ? Font.boldRoundedSystemFont(size) : Font.mediumSystemFont(size);
    t.textColor = opts.color || white;
    t.lineLimit = 1;
    if (opts.min) t.minimumScaleFactor = opts.min;
    return t;
  };

  if (d.error) {
    text(w, "Kaderplaner", 13, { bold: true });
    w.addSpacer(6);
    const t = text(w, d.error, 12, { color: soft });
    t.lineLimit = 4;
    w.refreshAfterDate = new Date(Date.now() + (d.retry ? 15 : 60) * 60000);
    return w;
  }

  const head = w.addStack();
  head.centerAlignContent();
  text(head, d.league || "Kickbase", 11, { color: soft, min: 0.7 });
  head.addSpacer();
  if (d.offers) text(head, d.offers + " Angebot" + (d.offers > 1 ? "e" : ""), 10, { bold: true });

  const isSmall = family === "small";
  const body = w.addStack();
  body.layoutHorizontally();

  const left = body.addStack();
  left.layoutVertically();
  left.addSpacer(4);
  text(left, "Kontostand", 10, { color: soft });
  text(left, short(d.budget), isSmall ? 24 : 26, { bold: true, min: 0.6, color: d.budget < 0 ? neg : white });
  left.addSpacer(4);
  text(left, "Spielraum " + short(d.room), 11, { color: d.room < 0 ? neg : acc, min: 0.7 });
  text(left, "Kader " + d.squad + (d.limit ? "/" + d.limit : ""), 11, { color: soft });
  if (d.kickoff) {
    const df = new DateFormatter();
    df.dateFormat = "EE HH:mm";
    df.locale = "de_DE";
    text(left, "Anpfiff " + df.string(new Date(d.kickoff)), 11, { color: soft, min: 0.7 });
  }

  if (!isSmall) {
    body.addSpacer(12);
    const right = body.addStack();
    right.layoutVertically();
    right.addSpacer(4);
    text(right, "Läuft ab", 10, { color: soft });
    const n = family === "large" ? 8 : 3;
    d.expiring.slice(0, n).forEach((p) => {
      right.addSpacer(3);
      const row = right.addStack();
      row.centerAlignContent();
      text(row, p.pos, 9, { bold: true, color: soft });
      row.addSpacer(4);
      text(row, p.name, 12, { bold: true, min: 0.7 });
      row.addSpacer();
      text(row, short(p.price), 11, {});
      const sub = right.addStack();
      text(sub, countdown(p.exs) + (p.bids ? " · " + p.bids + " Gebot" + (p.bids > 1 ? "e" : "") : ""), 10, {
        color: p.exs < 1800 ? neg : soft,
      });
    });
    if (!d.expiring.length) text(right, "Markt ist leer", 11, { color: soft });
  }
  w.addSpacer();

  // Neu laden nach 30 Minuten oder kurz nach dem naechsten Marktablauf
  let next = Date.now() + 30 * 60000;
  if (d.expiring.length) next = Math.min(next, Date.now() + (d.expiring[0].exs + 60) * 1000);
  w.refreshAfterDate = new Date(Math.max(next, Date.now() + 5 * 60000));
  return w;
}
