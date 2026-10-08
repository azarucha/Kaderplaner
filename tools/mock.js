// Demo-Modus: simuliert die benoetigten Kickbase-Endpunkte mit erfundenen Daten.
// Wird nur in dist/demo.html eingebunden (Vorschau, Screenshots), nie in die App.
(function(){
  "use strict";
  var seed = 7;
  function rnd(){ seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  function pick(a){ return a[Math.floor(rnd() * a.length)]; }
  function round(n, s){ return Math.round(n / s) * s; }

  var LID = "900001", ME = "1", NOW = Date.now(), DAY = 86400000;
  var created = new Date(NOW - 60 * DAY).toISOString();
  var managers = [
    {i: ME, n: "Demo Manager"}, {i: "2", n: "FC Pfostenbruch"}, {i: "3", n: "Dynamo Tresen"},
    {i: "4", n: "Real Abstieg"}, {i: "5", n: "Inter Mailand-Süd"}
  ];
  var first = ["Lukas","Jonas","Finn","Leon","Paul","Ben","Elias","Noah","Felix","Moritz","Tim","Jan","Nico","Max","Luca","Emil","Anton","Theo","Erik","Ole"];
  var last = ["Brandt","Kowalski","Yilmaz","Hoffmann","Becker","Novak","Schäfer","Kraus","Lindner","Wagner","Petersen","Albers","Vogt","Demir","Krüger","Seidel","Fuchs","Haas","Marx","Ritter","Ziegler","Böhm","Kaiser","Sommer","Arnold","Frank","Lorenz","Busch","Pohl","Engel"];
  var clubs = [];
  for (var c = 1; c <= 18; c++) clubs.push({tid: String(100 + c), tn: ["Hafenstadt","Nordheim","Bergdorf","Waldau","Seefeld","Ostbrück","Felsingen","Altmark","Grünwald","Steinach","Rheinhall","Kleefeld","Mühlbach","Rotheim","Sandhausen-Nord","Eichenau","Lindtal","Kronberg"][c-1]});

  var players = [], pid = 1000;
  for (var k = 0; k < 160; k++){
    var pos = [1,2,2,2,2,3,3,3,3,4,4,4][k % 12];
    var mv = round(300000 + Math.pow(rnd(), 2.6) * 14000000, 1000);
    var form = rnd();
    var pts = {};
    for (var d = 1; d <= 6; d++) pts[d] = Math.max(0, Math.round((15 + form * 75) * (0.2 + rnd() * 1.6) + (rnd() < 0.04 ? 180 : 0)));
    players.push({i: String(pid++), fn: pick(first), n: pick(last), pos: pos, tid: pick(clubs).tid, mv: mv,
      mvgl: round((rnd() - 0.45) * mv * 0.06, 1000), ap: Math.round(60 + form * 110), st: rnd() < 0.08 ? 1 : 0, pts: pts});
  }

  // Kader verteilen: je 13-16 Spieler, Kaufpreis = MW +/- Aufschlag
  var squads = {}, transfers = {}, cursor = 0;
  managers.forEach(function(m, idx){
    var size = 13 + (idx % 4);
    squads[m.i] = players.slice(cursor, cursor + size); cursor += size;
    transfers[m.i] = [];
    var t = Date.parse(created) + 3600000;
    squads[m.i].forEach(function(p){
      p.prc = round(p.mv * (0.85 + rnd() * 0.35), 1000);
      transfers[m.i].push({pi: p.i, pn: p.n, tid: p.tid, tty: 1, trp: p.prc, dt: new Date(t += rnd() * 3 * DAY).toISOString()});
    });
    for (var x = 0; x < 6 + idx * 5; x++){
      var tp = players[100 + Math.floor(rnd() * 55)], buy = round(tp.mv * (0.8 + rnd() * 0.3), 1000);
      var bt = Date.parse(created) + rnd() * 50 * DAY;
      transfers[m.i].push({pi: tp.i + "x" + x, pn: tp.n, tid: tp.tid, tty: 1, trp: buy, dt: new Date(bt).toISOString()});
      transfers[m.i].push({pi: tp.i + "x" + x, pn: tp.n, tid: tp.tid, tty: 2, trp: round(buy * (0.8 + rnd() * 0.6), 1000), dt: new Date(bt + rnd() * 8 * DAY).toISOString()});
    }
    transfers[m.i].sort(function(a, b){ return a.dt < b.dt ? 1 : -1; });
  });

  var market = players.slice(cursor, cursor + 14).map(function(p, i){
    var offer = i % 5 === 4 ? managers[1 + (i % 4)] : null;
    var o = {i: p.i, fn: p.fn, n: p.n, pos: p.pos, tid: p.tid, mv: p.mv, st: p.st, ap: p.ap, ofc: Math.floor(rnd() * 3),
      prc: offer ? round(p.mv * 1.2, 10000) : p.mv, mvt: rnd() < 0.5 ? 1 : 2};
    if (offer) o.u = {i: offer.i, n: offer.n}; else o.exs = Math.round(600 + rnd() * 80000);
    return o;
  });

  function lineup(uid){ return squads[uid].slice(0, 11).map(function(p){ return Number(p.i); }); }
  function mdp(uid, d){ return lineup(uid).reduce(function(s, id){ return s + byId[String(id)].pts[d]; }, 0); }
  var byId = {}; players.forEach(function(p){ byId[p.i] = p; });
  function tv(uid){ return squads[uid].reduce(function(s, p){ return s + p.mv; }, 0); }
  function tp(uid){ var s = 0; for (var d = 1; d <= 6; d++) s += mdp(uid, d); return s; }
  function wins(uid){ var w = 0; for (var d = 1; d <= 6; d++){ var best = managers.reduce(function(b, m){ return mdp(m.i, d) > mdp(b.i, d) ? m : b; }, managers[0]); if (best.i === uid) w++; } return w; }
  function mdDate(d){ return new Date(Date.parse(created) + (3 + d * 7) * DAY).toISOString(); }
  function sqItem(p, own){
    // Eigener Kader: mvgl = Gewinn seit Kauf, tfhmvt = Aenderung 24h; fremder Kader: prc = Kaufpreis
    if (own) return {i: p.i, n: p.n, pos: p.pos, tid: p.tid, mv: p.mv, mvgl: p.mv - p.prc, tfhmvt: p.mvgl, ap: p.ap, st: p.st, ofc: p.i.slice(-1) === "3" ? 1 : 0};
    return {pi: p.i, pn: p.n, pos: p.pos, tid: p.tid, mv: p.mv, ap: p.ap, st: p.st, prc: p.prc};
  }

  // Spielplan (Rundenturnier, Kreismethode): Spieltage 1-6 gespielt, 7-9 kommen noch
  var strength = {}; clubs.forEach(function(c){ strength[c.tid] = rnd() * 2 - 1; });
  var schedule = [], ids = clubs.map(function(c){ return c.tid; });
  function fixDate(d){ return d <= 6 ? NOW - (7 - d) * 7 * DAY : NOW + ((d - 7) * 7 + 2) * DAY + 3600000; }
  for (var day = 1; day <= 9; day++){
    for (var g = 0; g < 9; g++){
      var a = ids[g], b = ids[17 - g], home = day % 2 ? a : b, away = home === a ? b : a;
      var mt = {mi: String(day * 100 + g), day: day, md: new Date(fixDate(day)).toISOString(), t1: home, t2: away};
      if (day <= 6){
        mt.t1g = Math.max(0, Math.round(1.4 + 0.6 * (strength[home] - strength[away]) + rnd() * 2 - 1));
        mt.t2g = Math.max(0, Math.round(1.1 + 0.6 * (strength[away] - strength[home]) + rnd() * 2 - 1));
      }
      schedule.push(mt);
    }
    ids.splice(1, 0, ids.pop());   // alle ausser dem ersten rotieren
  }
  function matchOf(tid, day){ return schedule.filter(function(m){ return m.day === day && (m.t1 === tid || m.t2 === tid); })[0]; }

  var routes = [
    [/^\/leagues\/selection$/, function(){ return {it: [{i: LID, n: "Demo-Liga", cpi: "2", un: managers.length}]}; }],
    [/^\/leagues\/\d+\/me$/, function(){
      // Kontostand passend zu den Demo-Transfers, damit der Pruefstein aufgeht
      var net = transfers[ME].reduce(function(s, t){ return s + (t.tty === 1 ? -t.trp : t.trp); }, 0);
      var login = window.KBCalc ? KBCalc.loginStreakTotal(KBCalc.calendarDaysInclusive(Date.parse(created), NOW), 5000, 50000) : 0;
      return {b: 75000000 + net + tp(ME) * 1000 + login + 1150000, mppu: 16, mpst: 3}; }],
    [/^\/leagues\/\d+\/overview$/, function(){ return {i: LID, b: 75000000, dt: created, mppu: 16, mpst: 3, mgc: managers.length, cpi: "2"}; }],
    [/^\/leagues\/\d+\/squad$/, function(){ return {it: squads[ME].map(function(p){ return sqItem(p, true); })}; }],
    [/^\/leagues\/\d+\/market$/, function(){ return {it: market, day: 7}; }],
    [/^\/leagues\/\d+\/ranking$/, function(){ return {day: 7, us: managers.map(function(m){ return {i: m.i, n: m.n, sp: tp(m.i), tv: Math.round(tv(m.i) * 0.8), lp: lineup(m.i)}; })}; }],
    [/^\/competitions\/\d+\/table$/, function(){ return {it: clubs}; }],
    [/^\/leagues\/\d+\/activitiesFeed$/, function(){
      var af = []; for (var d = 0; d < 30; d++) af.push({t: 22, dt: new Date(NOW - d * DAY).toISOString(), data: {bn: 50000, day: 60 - d}}); return {af: af}; }],
    [/^\/leagues\/\d+\/user\/achievements$/, function(){ return {it: [{t: 5, ac: 0}, {t: 600, ac: 1}, {t: 500, ac: 1}]}; }],
    [/^\/leagues\/\d+\/user\/achievements\/(\d+)$/, function(m){ return {t: +m[1], er: ({5: 500000, 600: 500000, 500: 50000})[m[1]] || 0}; }],
    [/^\/leagues\/\d+\/managers\/(\d+)\/transfer$/, function(m, q){ var s = +(q.get("start") || 0); return {it: transfers[m[1]].slice(s, s + 25)}; }],
    [/^\/leagues\/\d+\/managers\/(\d+)\/squad$/, function(m){ return {it: squads[m[1]].map(function(p){ return sqItem(p); })}; }],
    [/^\/leagues\/\d+\/managers\/(\d+)\/dashboard$/, function(m){ return {tv: tv(m[1]), tp: tp(m[1]), mdw: wins(m[1]), t: transfers[m[1]].length}; }],
    [/^\/leagues\/\d+\/managers\/(\d+)\/performance$/, function(m){
      var it = []; for (var d = 1; d <= 8; d++) it.push({day: d, md: mdDate(d), mdp: d <= 6 ? mdp(m[1], d) : null});
      return {it: [{sn: "2026/2027", it: it}]}; }],
    [/^\/leagues\/\d+\/users\/\d+\/teamcenter$/, function(m, q){
      var d = +q.get("dayNumber"); return {us: managers.map(function(x){ return {i: x.i, unm: x.n, mdp: mdp(x.i, d), lp: lineup(x.i)}; })}; }],
    [/^\/competitions\/\d+\/players\/(\d+)\/performance$/, function(m){
      // wie die echte API: Startelf st 5, eingewechselt st 3, ohne Einsatz "0'"
      var p = byId[m[1]] || {pts: {}}; var ph = [];
      for (var d = 1; d <= 9; d++){
        var mt = matchOf(p.tid, d) || {}, base = {day: d, mi: mt.mi, md: mt.md, t1: mt.t1, t2: mt.t2, t1g: mt.t1g, t2g: mt.t2g, pt: p.tid};
        if (d > 6){ ph.push(Object.assign(base, {st: 0, t1g: undefined, t2g: undefined})); continue; }
        var pt = p.pts[d] || 0, sub = pt > 0 && pt < 40;
        ph.push(Object.assign(base, pt > 0 ? {p: pt, mp: sub ? "25'" : "90'", st: sub ? 3 : 5} : {p: 0, mp: "0'", st: 4}));
      }
      return {it: [{ti: "2026/2027", ph: ph}]}; }],
    [/^\/leagues\/\d+\/players\/(\d+)\/marketvalue\/(\d+)$/, function(m){
      // Zufallsweg rueckwaerts vom heutigen Marktwert, ein Wert pro Tag (dt = Tagesindex)
      var p = byId[m[1]] || {mv: 1000000, mvgl: 0}, today = Math.floor(NOW / DAY), v = p.mv, it = [];
      var drift = (p.mvgl || 0) / Math.max(1, p.mv), wseed = +m[1];
      function wr(){ wseed = (wseed * 16807) % 2147483647; return (wseed - 1) / 2147483646; }
      for (var k = 0; k < +m[2]; k++){
        it.unshift({dt: today - k, mv: round(v, 1000)});
        v = Math.max(100000, v / (1 + drift * 0.4 + (wr() - 0.5) * 0.05));
      }
      return {it: it, hmv: Math.max.apply(null, it.map(function(x){ return x.mv; })), lmv: Math.min.apply(null, it.map(function(x){ return x.mv; }))}; }],
    [/^\/leagues\/\d+\/players\/(\d+)\/transferHistory$/, function(m){
      var it = [];
      managers.forEach(function(mg){
        transfers[mg.i].forEach(function(t){ if (t.pi === m[1] && t.tty === 1) it.push({u: mg.i, unm: mg.n, dt: t.dt, trp: t.trp, t: 1}); });
      });
      return {it: it}; }],
    [/^\/competitions\/\d+\/teams\/(\d+)\/teamprofile$/, function(m){
      return {tid: m[1], it: players.filter(function(p){ return p.tid === m[1]; }).map(function(p){ return {i: p.i, n: p.n, pos: p.pos, ap: p.ap, st: p.st, tid: p.tid}; })}; }]
  ];

  var realFetch = window.fetch;
  // OpenLigaDB nachgebildet: dieselben erfundenen Vereine und Ergebnisse
  function openLiga(url){
    var mm = /getmatchdata\/(bl\d)\/(\d{4})$/.exec(url), list = [];
    var team = function(tid){ var c = clubs.filter(function(x){ return x.tid === tid; })[0]; return {teamId: +tid, teamName: c.tn, shortName: c.tn}; };
    if (mm && mm[1] === "bl2" && +mm[2] === new Date(NOW).getFullYear() - (new Date(NOW).getMonth() < 6 ? 1 : 0)){
      list = schedule.map(function(x){
        return {matchDateTimeUTC: x.md, team1: team(x.t1), team2: team(x.t2), matchIsFinished: x.t1g != null,
          matchResults: x.t1g != null ? [{resultTypeID: 2, pointsTeam1: x.t1g, pointsTeam2: x.t2g}] : []};
      });
    }
    return Promise.resolve(new Response(JSON.stringify(list), {status: 200, headers: {"Content-Type": "application/json"}}));
  }
  window.fetch = function(url, opts){
    if (String(url).indexOf("https://api.openligadb.de/") === 0) return openLiga(String(url));
    if (String(url).indexOf("https://api.kickbase.com/v4") !== 0) return realFetch.apply(this, arguments);
    var u = new URL(url), path = u.pathname.replace(/^\/v4/, "");
    for (var r = 0; r < routes.length; r++){
      var m = path.match(routes[r][0]);
      if (m){
        var body = JSON.stringify(routes[r][1](m, u.searchParams));
        return new Promise(function(res){ setTimeout(function(){ res(new Response(body, {status: 200, headers: {"Content-Type": "application/json"}})); }, 40 + rnd() * 120); });
      }
    }
    return Promise.resolve(new Response("{}", {status: 404}));
  };

  // Unsignierter Demo-Token (kein echter Zugang), damit die App ohne Eingabe startet.
  function b64(o){ return btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); }
  var demoToken = b64({alg: "none"}) + "." + b64({"kb.uid": ME, "kb.name": "Demo Manager", exp: Math.floor(NOW / 1000) + 86400 * 365}) + ".demo";
  window.__KP_DEMO = true;
  // ?shot=1 (README-Screenshots): ohne Demo-Hinweis, die Bildunterschrift sagt es schon
  if (typeof document !== "undefined" && !/[?&]shot=1/.test(location.search)) document.addEventListener("DOMContentLoaded", function(){
    var a = document.createElement("a");
    a.className = "demo-badge";
    a.href = "index.html";
    a.innerHTML = "Demo mit erfundenen Daten · <b>Eigene Liga verbinden</b>";
    document.body.appendChild(a);
  });
  // Nur im Speicher, nie in localStorage: Demo und echte App teilen sich im Web eine Origin.
  window.__KP_TOKEN = demoToken;
  try {
    localStorage.setItem("kp_demo_token", demoToken);   // fuer tools/widget-harness.mjs
    Object.keys(localStorage).forEach(function(k){ if (k.indexOf("kp_md_" + LID) === 0) localStorage.removeItem(k); });
  } catch(e){}
})();
