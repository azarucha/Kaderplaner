// Kaderplaner - reine Rechenfunktionen (kein DOM, kein Netzwerk).
// Im Browser als globales `KBCalc`, in Node per require() fuer die Tests.
// Herleitung und Messungen: docs/kickbase-api-notes.md
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KBCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  "use strict";

  var DAY_MS = 86400000;

  // ---------- 33%-Regel ----------
  // help.kickbase.com/help/wie-weit-darf-ich-ins-minus: Grenze = 33% von
  // (Mannschaftswert + Kontostand). Beispiel dort: 100 Mio + (-10 Mio) = 90 Mio,
  // davon 33% -> bis -30 Mio. Geprueft wird beim Gebot, alle offenen Gebote zaehlen.
  // Ein Verkauf zum Marktwert laesst (Teamwert + Konto) und damit die Grenze gleich.
  var MINUS_RATE = 0.33;

  function maxNegative(teamValue, budget){
    return -MINUS_RATE * ((teamValue || 0) + (budget || 0));
  }

  // Wie viel kann noch geboten werden, bevor der Kontostand unter die Grenze faellt?
  function bidRoom(teamValue, budget, openBids){
    var floor = maxNegative(teamValue, budget);
    return { maxNegative: floor, headroom: (budget || 0) - (openBids || 0) - floor };
  }

  // Tiefster Kontostand, der sich mit der Regel ueberhaupt erreichen laesst:
  // b >= -0.33 * (tv + b)  <=>  b >= -(0.33 / 1.33) * tv. Gilt nur im Moment eines
  // Gebots - faellt danach der Marktwert, darf ein Konto auch tiefer liegen.
  function minReachableBudget(teamValue){
    return -(MINUS_RATE / (1 + MINUS_RATE)) * (teamValue || 0);
  }

  // ---------- Kalendertage (Europe/Berlin) ----------
  var dayFmt = null;
  function berlinDayIndex(ms){
    if (!dayFmt) dayFmt = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Berlin', year:'numeric', month:'2-digit', day:'2-digit'});
    var p = dayFmt.format(new Date(ms)).split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY_MS);
  }

  // Anzahl Kalendertage von `fromMs` bis `toMs`, beide Tage eingeschlossen.
  function calendarDaysInclusive(fromMs, toMs){
    if (fromMs == null || toMs == null || toMs < fromMs) return 0;
    return berlinDayIndex(toMs) - berlinDayIndex(fromMs) + 1;
  }

  // ---------- Auflaufpraemie ----------
  // Tag n einer ununterbrochenen Serie bringt min(step * n, cap).
  // 1. Liga: 10k-Schritte bis 100k, 2. Liga: 5k-Schritte bis 50k.
  function loginDefaults(cpi){
    return String(cpi) === "1" ? {step:10000, cap:100000} : {step:5000, cap:50000};
  }

  function loginStreakTotal(days, step, cap){
    var total = 0;
    for (var d = 1; d <= days; d++) total += Math.min(step * d, cap);
    return total;
  }

  // Summe fuer eine Liste von Login-Tagen (Tagesindizes). Eine Luecke startet die
  // Serie neu - konservative Annahme fuer die Untergrenze.
  function loginTotalForDays(dayIndices, step, cap){
    var days = dayIndices.slice().sort(function(a,b){ return a-b; });
    var total = 0, streak = 0, prev = null;
    days.forEach(function(d){
      if (d === prev) return;
      streak = (prev != null && d === prev + 1) ? streak + 1 : 1;
      total += Math.min(step * streak, cap);
      prev = d;
    });
    return total;
  }

  // ---------- Transfers ----------
  // transfers: Eintraege aus /managers/{uid}/transfer, tty 1 = Kauf, 2 = Verkauf.
  function transferLedger(transfers){
    var list = (transfers || []).slice().sort(function(a,b){ return a.dt < b.dt ? -1 : (a.dt > b.dt ? 1 : 0); });
    var buys = 0, sells = 0, open = {}, profits = [];
    list.forEach(function(x){
      var key = String(x.pi);
      if (x.tty === 1){
        buys += x.trp || 0;
        open[key] = x;
      } else {
        sells += x.trp || 0;
        if (open[key]){
          profits.push((x.trp || 0) - (open[key].trp || 0));
          delete open[key];
        }
      }
    });
    return { buys:buys, sells:sells, net:sells - buys, count:list.length, profits:profits, open:open };
  }

  // MVP-Auto-Verkaeufe tauchen in der Transferliste nicht auf. Ein gekaufter Spieler,
  // der weder verkauft wurde noch im Kader steht, ist automatisch verkauft worden.
  // feedSales: {pi -> trp} aus Feedtyp 32 (nur ca. 1 Monat Feed-Historie);
  // fehlt der Betrag, dient der Kaufpreis als Schaetzung.
  function detectAutoSales(ledger, squadIds, feedSales){
    var inSquad = {};
    (squadIds || []).forEach(function(id){ inSquad[String(id)] = true; });
    var out = [];
    Object.keys(ledger.open).forEach(function(pi){
      if (inSquad[pi]) return;
      var buy = ledger.open[pi];
      var known = feedSales && feedSales[pi] != null;
      out.push({ pi:pi, pn:buy.pn, trp: known ? feedSales[pi] : (buy.trp || 0), estimated: !known });
    });
    return out;
  }

  // ---------- Erfolge ----------
  // Schwellen laut /user/achievements/{t} (Feld d). Gestaffelte Erfolge werden
  // gemeinsam vergeben: ein 403-Punkte-Spieler bringt 300, 301 und 302.
  // "once" = einmal pro Saison, sonst pro Ereignis wiederholbar.
  var ACH = {
    MD_WIN: 5, MD_WINS: [[1,3],[2,5],[3,10],[4,25]],
    MD_POINTS_ONCE: [100, 500], MD_POINTS: [[101,1000],[102,1500],[103,2000]],
    SEASON_POINTS: [[200,1000],[201,5000],[202,15000],[203,30000],[204,40000]],
    PLAYER_POINTS: [[300,200],[301,300],[302,400],[303,500]],
    TEAM_VALUE: [[400,125e6],[401,150e6],[402,200e6],[403,250e6],[404,350e6]],
    TRANSFERS: [[500,1],[501,50],[502,250],[503,500],[504,1000]],
    LEAGUE_SIZE: [[600,3],[601,6],[602,12],[603,18]],
    PROFIT_ONCE: [700, 1e6], PROFIT: [[701,3e6],[702,5e6],[703,10e6],[704,25e6]],
    MVP: 5001
  };

  // Gemessene Praemien der 2. Liga (er aus der API). Die 1. Liga zahlt das Doppelte.
  var REWARDS_LIGA2 = {
    1:250000, 2:500000, 3:750000, 4:1000000, 5:500000,
    100:50000, 101:125000, 102:500000, 103:1000000,
    200:50000, 201:125000, 202:250000, 203:500000, 204:1000000,
    300:50000, 301:250000, 302:500000, 303:1000000,
    400:50000, 401:125000, 402:250000, 403:500000, 404:1000000,
    500:50000, 501:125000, 502:250000, 503:500000, 504:1000000,
    600:500000, 601:500000, 602:500000, 603:500000,
    700:50000, 701:125000, 702:250000, 703:500000, 704:1000000,
    5001:500000
  };

  function defaultRewards(cpi){
    var f = String(cpi) === "1" ? 2 : 1;
    var r = {};
    Object.keys(REWARDS_LIGA2).forEach(function(k){ r[k] = REWARDS_LIGA2[k] * f; });
    return r;
  }

  function add(counts, t, n){ if (n > 0) counts[t] = (counts[t] || 0) + n; }

  // s: { wins, matchdayPoints:[...], maxPlayerPoints:[...], seasonPoints,
  //      transferCount, profits:[...], managerCount, teamValue, mvpCount }
  function achievementCounts(s){
    var c = {};
    add(c, ACH.MD_WIN, s.wins || 0);
    ACH.MD_WINS.forEach(function(a){ if ((s.wins || 0) >= a[1]) add(c, a[0], 1); });

    var md = s.matchdayPoints || [];
    if (md.some(function(p){ return p >= ACH.MD_POINTS_ONCE[1]; })) add(c, ACH.MD_POINTS_ONCE[0], 1);
    md.forEach(function(p){ ACH.MD_POINTS.forEach(function(a){ if (p >= a[1]) add(c, a[0], 1); }); });

    ACH.SEASON_POINTS.forEach(function(a){ if ((s.seasonPoints || 0) >= a[1]) add(c, a[0], 1); });

    (s.maxPlayerPoints || []).forEach(function(p){
      ACH.PLAYER_POINTS.forEach(function(a){ if (p >= a[1]) add(c, a[0], 1); });
    });

    ACH.TEAM_VALUE.forEach(function(a){ if ((s.teamValue || 0) >= a[1]) add(c, a[0], 1); });
    ACH.TRANSFERS.forEach(function(a){ if ((s.transferCount || 0) >= a[1]) add(c, a[0], 1); });
    ACH.LEAGUE_SIZE.forEach(function(a){ if ((s.managerCount || 0) >= a[1]) add(c, a[0], 1); });

    var profits = s.profits || [];
    if (profits.some(function(p){ return p >= ACH.PROFIT_ONCE[1]; })) add(c, ACH.PROFIT_ONCE[0], 1);
    profits.forEach(function(p){ ACH.PROFIT.forEach(function(a){ if (p >= a[1]) add(c, a[0], 1); }); });

    add(c, ACH.MVP, s.mvpCount || 0);
    return c;
  }

  function achievementTotal(counts, rewards){
    var total = 0;
    Object.keys(counts).forEach(function(t){ total += (rewards[t] || 0) * counts[t]; });
    return total;
  }

  // ---------- Kontostand-Schaetzung ----------
  // Alle Betraege in Euro. Liefert Untergrenze/Erwartung/Obergrenze plus Bestandteile.
  //   startBudget, ledger (transferLedger), autoSales (detectAutoSales),
  //   seasonPoints, pointValue, achievements (Betrag),
  //   loginHigh (taeglicher Login seit Ligastart), loginLow (nur belegte Aktivitaetstage)
  function estimateBudget(o){
    var autoSum = 0, autoUncertain = 0;
    (o.autoSales || []).forEach(function(a){
      autoSum += a.trp;
      if (a.estimated) autoUncertain += Math.abs(a.trp) * 0.15;
    });
    var points = (o.seasonPoints || 0) * (o.pointValue || 0);
    var base = (o.startBudget || 0) + o.ledger.net + autoSum + points + (o.achievements || 0);
    var high = base + (o.loginHigh || 0) + autoUncertain;
    var low = base + (o.loginLow || 0) - autoUncertain;
    return {
      low: low, high: high, mid: base + (o.loginHigh || 0),
      parts: {
        start: o.startBudget || 0, transfers: o.ledger.net, autoSales: autoSum,
        points: points, achievements: o.achievements || 0,
        loginLow: o.loginLow || 0, loginHigh: o.loginHigh || 0
      }
    };
  }

  // ---------- Verkaufsempfehlung ----------
  // Ziel: mit Verkaeufen an Kickbase (zum Marktwert) mindestens `need` Euro
  // einnehmen und dabei moeglichst wenige erwartete Punkte der besten Elf verlieren.
  var FORMATIONS = ['3-4-3', '3-5-2', '3-6-1', '4-2-4', '4-3-3', '4-4-2', '4-5-1', '5-2-3', '5-3-2', '5-4-1'];
  var EMPTY_SLOT = -100;   // Kickbase zieht fuer jeden leeren Aufstellungsplatz 100 Punkte ab

  // Statuscodes: 1 verletzt, 2 angeschlagen, 4 Reha, 16 Sperre, 256 freigestellt.
  // Ein Verkauf wirkt die ganze Saison, ein Ausfall meist nur einige Spieltage -
  // deshalb Abschlaege nach typischer Ausfalldauer statt "faellt aus = 0".
  function availability(status){
    status = status || 0;
    if (status & 256) return 0;      // verlaesst den Verein
    if (status & 4) return 0.2;      // Reha, lange raus
    if (status & 1) return 0.4;      // verletzt, Dauer unklar
    if (status & 16) return 0.8;     // Sperre, meist ein bis zwei Spiele
    if (status & 2) return 0.9;      // angeschlagen
    return 1;
  }
  // Erwartete Punkte pro Spieltag. Mit Leistungsdaten (p.form) kombiniert das Modell
  //   Einsatzchance = 60 % letzte 5 Spieltage + 40 % ganze Saison
  //   Qualitaet     = je halb Saisonschnitt pro Einsatz (ap) und Schnitt der letzten Einsaetze
  // und multipliziert mit der Verfuegbarkeit. Ohne Leistungsdaten: ap x Verfuegbarkeit.
  // Optional: p.fixture ist der Gegnerfaktor der naechsten Spiele (Standard 1), er
  // wirkt nur auf die Qualitaet, nicht auf Einsatzchance und Verfuegbarkeit.
  function expectedPoints(p){
    var avail = availability(p.status), f = p.form;
    var ap = p.ap;
    var fix = p.fixture != null ? p.fixture : 1;
    if (!f || !f.teamDays || f.teamDays < 2) return (ap || 0) * fix * avail;
    var chance = 0.6 * (f.recentApps / Math.max(1, f.recentDays)) + 0.4 * (f.apps / f.teamDays);
    var recentQ = f.recentApps ? f.recentPoints / f.recentApps : null;
    var quality = ap != null
      ? (recentQ != null ? 0.5 * ap + 0.5 * recentQ : ap)
      : (recentQ != null ? recentQ : 0);
    return quality * fix * chance * avail;
  }

  // ---------- Gegnerstaerke ----------
  // Gemessen an 475 Spielern der 2. Liga (4.644 Startelf-Einsaetze, jeder Spieltag nur
  // mit den Daten davor vorhergesagt): Ein Gegnerfaktor aus "Gegner laesst auf dieser
  // Position viele Punkte zu" und der Teamstaerke senkt den Fehler messbar; ein
  // eigener Gegnereffekt je Spieler oder ein getrimmter Schnitt verbessern nichts.
  var OPP = {
    lambda: 8,          // Teamstaerke: Zug zum Mittel (in Spielen)
    prevSeason: 0.35,   // Gewicht der letzten Saison fuer Teamstaerke und Gegnerwerte
    allowK: 100,        // Gegnerwert: Zug zu 0 (in Einsaetzen)
    allowWeight: 0.7,
    edgeWeight: 0.5,
    // Startwerte je Position (1 TW, 2 ABW, 3 MF, 4 ANG): relative Punktaenderung pro Tor
    // erwarteter Tordifferenz, live aus allen Spielern nachgeschaetzt
    slope: {1: 0.13, 2: 0.38, 3: 0.43, 4: 0.7}
  };

  // matches: [{home, away, hg, ag, w}]. Modell: erwartete Tordifferenz =
  // r[home] - r[away] + H, Ridge-Regression mit Zug zum Mittel, Tordifferenz auf +-3 gekappt.
  function teamRatings(matches, opts){
    opts = opts || {};
    var lambda = opts.lambda != null ? opts.lambda : OPP.lambda, cap = opts.cap || 3;
    var r = {}, games = {};
    var list = (matches || []).filter(function(m){ return m.hg != null && m.ag != null && (m.w == null || m.w > 0); });
    list.forEach(function(m){
      [m.home, m.away].forEach(function(t){ if (r[t] == null){ r[t] = 0; games[t] = []; } });
      games[m.home].push(m); games[m.away].push(m);
    });
    var gd = function(m){ return Math.max(-cap, Math.min(cap, m.hg - m.ag)); };
    var wt = function(m){ return m.w == null ? 1 : m.w; };
    var H = 0, teams = Object.keys(r);
    for (var it = 0; it < 40; it++){
      var hs = 0, hw = 0;
      list.forEach(function(m){ hs += wt(m) * (gd(m) - r[m.home] + r[m.away]); hw += wt(m); });
      H = hw ? hs / (hw + lambda) : 0;
      teams.forEach(function(t){
        var s = 0, wsum = lambda;
        games[t].forEach(function(m){
          s += m.home === t ? wt(m) * (gd(m) - H + r[m.away]) : wt(m) * (r[m.home] + H - gd(m));
          wsum += wt(m);
        });
        r[t] = s / wsum;
      });
    }
    return {r: r, home: H};
  }

  // Spielschwierigkeit aus Sicht eines Spielers, positiv = leichter. Die eigene
  // Teamstaerke steckt schon im Punkteschnitt, deshalb zaehlen Gegner und Heimvorteil.
  function matchEdge(ratings, opp, home){
    if (!ratings || ratings.r[opp] == null) return null;
    return (home ? ratings.home : -ratings.home) / 2 - ratings.r[opp];
  }

  // Wie viele Punkte laesst ein Gegner je Position zu? players: [{pos, games:
  // [{p, opp, prev}]}] (nur Startelf). Je Einsatz: Punkte relativ zum Saisonschnitt
  // des Spielers ohne dieses Spiel, gemittelt je Gegner und Position, zu 0 gezogen.
  function opponentAllowance(players, opts){
    opts = opts || {};
    var k = opts.k != null ? opts.k : OPP.allowK, sums = {};
    (players || []).forEach(function(pl){
      var seasons = {};
      (pl.games || []).forEach(function(g){ var b = seasons[g.prev ? 1 : 0] = seasons[g.prev ? 1 : 0] || {s: 0, n: 0}; b.s += g.p; b.n++; });
      (pl.games || []).forEach(function(g){
        var b = seasons[g.prev ? 1 : 0];
        if (b.n < 4) return;
        var ref = (b.s - g.p) / (b.n - 1);
        if (ref < 20) return;
        var w = g.prev ? OPP.prevSeason : 1, key = g.opp + '|' + pl.pos;
        var a = sums[key] = sums[key] || {s: 0, w: 0};
        a.s += w * Math.max(-1.5, Math.min(2.5, g.p / ref - 1)); a.w += w;
      });
    });
    // Punkte/Schnitt ist im Mittel leicht positiv (Ausreisser nach oben): je Position
    // auf 0 zentrieren, damit ein durchschnittlicher Gegner den Faktor 1 ergibt.
    var out = {}, mean = {};
    Object.keys(sums).forEach(function(key){
      out[key] = sums[key].s / (sums[key].w + k);
      var pos = key.split('|')[1], m = mean[pos] = mean[pos] || {s: 0, n: 0};
      m.s += out[key]; m.n++;
    });
    Object.keys(out).forEach(function(key){ var m = mean[key.split('|')[1]]; out[key] -= m.s / m.n; });
    return out;
  }

  // Gepoolte Punktaenderung je Tor Spielschwierigkeit fuer eine Position.
  // entries: [{quality, games: [{p, x, w}]}]; zu `base` gezogen.
  function positionSlope(entries, base, opts){
    var k = opts && opts.k != null ? opts.k : 4, pts = [];
    (entries || []).forEach(function(e){
      if (!(e.quality >= 20)) return;
      (e.games || []).forEach(function(g){ if (g.x != null && g.p != null) pts.push({x: g.x, y: g.p / e.quality - 1, w: g.w == null ? 1 : g.w}); });
    });
    if (pts.length < 10) return base;
    var W = pts.reduce(function(s, g){ return s + g.w; }, 0);
    var mx = pts.reduce(function(s, g){ return s + g.w * g.x; }, 0) / W;
    var my = pts.reduce(function(s, g){ return s + g.w * g.y; }, 0) / W;
    var sxx = 0, sxy = 0;
    pts.forEach(function(g){ sxx += g.w * (g.x - mx) * (g.x - mx); sxy += g.w * (g.x - mx) * (g.y - my); });
    return sxx < 1e-6 ? base : (sxy + k * base) / (sxx + k);
  }

  // Faktor fuer ein Spiel: 1 + 0,7 x Gegnerwert + 0,5 x Steigung x Schwierigkeit, 0,6..1,4.
  function matchFactor(allow, slope, edge){
    var f = 1 + OPP.allowWeight * (allow || 0) + (edge != null ? OPP.edgeWeight * (slope || 0) * edge : 0);
    return Math.max(0.6, Math.min(1.4, f));
  }

  // Naechste Spiele gewichtet 50/30/20 (bei weniger Spielen neu normiert).
  var HORIZON_WEIGHTS = [0.5, 0.3, 0.2];
  function horizonFactor(factors, horizon){
    var n = Math.min(horizon || 1, factors.length, HORIZON_WEIGHTS.length), s = 0, w = 0;
    for (var i = 0; i < n; i++){ if (factors[i] == null) continue; s += HORIZON_WEIGHTS[i] * factors[i]; w += HORIZON_WEIGHTS[i]; }
    return w ? s / w : 1;
  }

  // Konstanz aus Startelf-Einsaetzen [{p, w}]: share = Anteil der Spiele mit mindestens
  // der Haelfte des eigenen Schnitts; label ab 5 Spielen. Aendert die Punkte nicht, dient
  // als Anzeige und bei Gleichstand in der Verkaufsempfehlung.
  function playerConsistency(games){
    var items = (games || []).filter(function(g){ return g && g.p != null; });
    var wsum = items.reduce(function(s, g){ return s + (g.w == null ? 1 : g.w); }, 0);
    if (!items.length || !wsum) return {n: 0, mean: null, share: null, label: null};
    var mean = items.reduce(function(s, g){ return s + g.p * (g.w == null ? 1 : g.w); }, 0) / wsum;
    var ref = Math.max(mean, 1);
    var share = items.reduce(function(s, g){ return s + (g.p >= 0.5 * ref ? (g.w == null ? 1 : g.w) : 0); }, 0) / wsum;
    var label = items.length < 5 ? null : (share >= 0.75 ? 'konstant' : (share < 0.5 ? 'schwankend' : null));
    return {n: items.length, mean: mean, share: share, label: label};
  }

  // Leistungsdaten aus /competitions/{cpi}/players/{id}/performance (Liste ph der
  // aktuellen Saison mit day, p, mp, st) fuer die Spieltage 1..lastDay.
  // st 5 = Startelf, 3 = eingewechselt; ohne st zaehlt ein Eintrag mit Minuten > 0.
  function formFromPerformance(ph, lastDay, window){
    window = window || 5;
    var byDay = {};
    (ph || []).forEach(function(h){ if (h && h.day != null) byDay[h.day] = h; });
    var appeared = function(h){
      if (!h) return false;
      if (h.st === 5 || h.st === 3) return true;
      return parseInt(String(h.mp || '0'), 10) > 0;
    };
    var f = {teamDays: lastDay || 0, apps: 0, starts: 0, recentDays: 0, recentApps: 0, recentStarts: 0, recentPoints: 0, last: []};
    for (var d = 1; d <= lastDay; d++){
      var h = byDay[d], on = appeared(h), recent = d > lastDay - window;
      if (on){ f.apps++; if (h.st === 5) f.starts++; }
      if (recent){
        f.recentDays++;
        f.last.push(on ? (h.p || 0) : null);
        if (on){ f.recentApps++; f.recentPoints += h.p || 0; if (h.st === 5) f.recentStarts++; }
      }
    }
    return f;
  }

  // Lexikografischer Vergleich: hoehere Punkte, niedrigerer Trend (fallende Werte
  // lieber verkaufen), weniger Verkaeufe, mehr Geld - je nach Reihenfolge in keys.
  function better(a, b, keys){
    for (var i = 0; i < keys.length; i++){
      var k = keys[i], x = a[k], y = b[k];
      if (x === y) continue;
      var higherWins = k === 'rp' || k === 'money';
      return higherWins ? x > y : x < y;
    }
    return false;
  }

  function formationCounts(f){
    var n = f.split('-').map(Number);
    return {TW: 1, ABW: n[0], MF: n[1], ANG: n[2]};
  }

  // Beste Elf ueber alle Formationen: Summe der erwarteten Punkte, leere Plaetze -100.
  function bestEleven(players){
    var byPos = {TW: [], ABW: [], MF: [], ANG: []};
    players.forEach(function(p){ if (byPos[p.pos]) byPos[p.pos].push(p.pts != null ? p.pts : expectedPoints(p)); });
    Object.keys(byPos).forEach(function(k){ byPos[k].sort(function(a, b){ return b - a; }); });
    var best = -Infinity, formation = null;
    FORMATIONS.forEach(function(f){
      var c = formationCounts(f), s = 0;
      Object.keys(c).forEach(function(pos){
        for (var k = 0; k < c[pos]; k++) s += k < byPos[pos].length ? byPos[pos][k] : EMPTY_SLOT;
      });
      if (s > best){ best = s; formation = f; }
    });
    return {points: best, formation: formation};
  }

  // players: [{id, pos, mv, ap, status}] (nur verkaufbare). need: fehlender Betrag.
  // Liefert zwei Vorschlaege: "points" (wenigste Punkte verloren) und "fewest"
  // (wenigste Verkaeufe, dann wenigste Punkte). Bei mehr als maxN Spielern
  // werden nur die maxN wertvollsten als Kandidaten betrachtet.
  function recommendSales(players, need, opts){
    opts = opts || {};
    var maxN = opts.maxN || 20;
    // trend: Marktwertaenderung in Euro pro Tag (fallend = negativ)
    // cons: Konstanz (Anteil guter Spiele, siehe playerConsistency), bei Gleichstand lieber schwankende verkaufen
    var toEntry = function(p){ return {id: p.id, pos: p.pos, mv: p.mv || 0, pts: expectedPoints(p), trend: p.trend || 0, cons: p.cons != null ? p.cons : 0.6}; };
    var sellable = players.map(toEntry);
    // opts.fixed: Spieler, die sicher dazukommen (z. B. vorgemerkte Kaeufe) - zaehlen fuer die Elf, sind aber nicht verkaufbar
    var all = sellable.concat((opts.fixed || []).map(toEntry));
    var base = bestEleven(all);
    var total = sellable.reduce(function(s, p){ return s + p.mv; }, 0);
    if (need <= 0) return {base: base, need: need, possible: true, points: null, fewest: null};
    if (total < need) return {base: base, need: need, possible: false, total: total, points: null, fewest: null};

    var cand = sellable.slice().sort(function(a, b){ return b.mv - a.mv; }).slice(0, maxN);
    var n = cand.length, size = 1 << n;

    // Spieler je Position nach Punkten sortiert (Kandidaten mit Index, feste ohne)
    var POS = ['TW', 'ABW', 'MF', 'ANG'], lists = {};
    POS.forEach(function(pos){
      lists[pos] = all.filter(function(p){ return p.pos === pos; })
        .map(function(p){ return {pts: p.pts, bit: cand.indexOf(p)}; })
        .sort(function(a, b){ return b.pts - a.pts; });
    });
    var counts = FORMATIONS.map(formationCounts);
    var money = new Float64Array(size), trend = new Float64Array(size), cons = new Float64Array(size), best = null, fewest = null;
    var top = {TW: [0, 0, 0, 0, 0, 0, 0], ABW: [0, 0, 0, 0, 0, 0, 0], MF: [0, 0, 0, 0, 0, 0, 0], ANG: [0, 0, 0, 0, 0, 0, 0]};

    for (var mask = 1; mask < size; mask++){
      var low = mask & -mask, bit = 31 - Math.clz32(low);
      money[mask] = money[mask ^ low] + cand[bit].mv;
      trend[mask] = trend[mask ^ low] + cand[bit].trend;
      cons[mask] = cons[mask ^ low] + cand[bit].cons;
      if (money[mask] < need) continue;

      // Praefixsummen der besten verbleibenden Spieler je Position (bis 6 Plaetze)
      for (var q = 0; q < 4; q++){
        var pos = POS[q], list = lists[pos], arr = top[pos], k = 0, sum = 0;
        for (var j = 0; j < list.length && k < 6; j++){
          var b = list[j].bit;
          if (b >= 0 && (mask >> b) & 1) continue;
          sum += list[j].pts; k++; arr[k] = sum;
        }
        for (; k < 6; k++){ sum += EMPTY_SLOT; arr[k + 1] = sum; }
      }
      var pts = -Infinity, form = null;
      for (var fi = 0; fi < counts.length; fi++){
        var c = counts[fi];
        var s = top.TW[c.TW] + top.ABW[c.ABW] + top.MF[c.MF] + top.ANG[c.ANG];
        if (s > pts){ pts = s; form = FORMATIONS[fi]; }
      }
      var cnt = 0;
      for (var m = mask; m; m &= m - 1) cnt++;
      // Punkte auf ganze Punkte gerundet; bei Gleichstand lieber schwankende als konstante
      // Spieler verkaufen, dann fallende statt steigende Marktwerte, dann weniger
      // Verkaeufe, dann mehr Geld.
      var cand1 = {mask: mask, money: money[mask], points: pts, rp: Math.round(pts), cons: Math.round(cons[mask] / cnt * 100) / 100, trend: trend[mask], count: cnt, formation: form};
      if (!best || better(cand1, best, ['rp', 'cons', 'trend', 'count', 'money'])) best = cand1;
      if (!fewest || better(cand1, fewest, ['count', 'rp', 'cons', 'trend', 'money'])) fewest = cand1;
    }

    function describe(r){
      if (!r) return null;
      var ids = [];
      for (var b = 0; b < n; b++) if ((r.mask >> b) & 1) ids.push(cand[b].id);
      return {ids: ids, money: r.money, points: r.points, loss: base.points - r.points, formation: r.formation, count: r.count, trend: r.trend};
    }
    var out = {base: base, need: need, possible: !!best, points: describe(best), fewest: describe(fewest)};
    if (out.points && out.fewest && out.points.ids.join() === out.fewest.ids.join()) out.fewest = null;
    return out;
  }

  // Kaufempfehlung auf derselben Grundlage wie die Verkaeufe: Wie viele erwartete
  // Punkte gewinnt die beste Elf pro Spieltag mit diesem Marktspieler dazu? Reicht
  // das Geld nicht (oder ist der Kader voll), rechnet recommendSales mit, wer dafuer
  // gehen soll; empfohlen wird nur, was unterm Strich Punkte bringt.
  //   sellable: eigene Spieler nach Plan, fixed: vorgemerkte Kaeufe,
  //   market: [{id, pos, price, tid, ap, form, fixture, status, trend, cons}]
  //   opts: after (Konto nach Plan), teamValue (Wert nach Plan), squadLimit,
  //         clubLimit, clubCounts {tid: n}, finance (wie viele Kandidaten mit Verkauf)
  function recommendBuys(sellable, fixed, market, opts){
    opts = opts || {};
    sellable = sellable || []; fixed = fixed || [];
    var squad = sellable.concat(fixed), after = opts.after || 0;
    var have = {};
    squad.forEach(function(p){ have[p.id] = true; });
    var base = bestEleven(squad).points;
    // Steht das Konto schon im Minus, ist der Vergleich die Elf nach den noetigen Verkaeufen
    var ref = base;
    if (after < 0){
      var fix = recommendSales(sellable, -after, {fixed: fixed, maxN: 14});
      ref = fix.points ? fix.points.points : -Infinity;
    }
    var full = opts.squadLimit && squad.length >= opts.squadLimit;
    var gains = {}, list = [];
    (market || []).forEach(function(m){
      if (have[m.id]) return;
      if (opts.clubLimit && m.tid != null && ((opts.clubCounts || {})[m.tid] || 0) >= opts.clubLimit) return;
      var gain = bestEleven(squad.concat([m])).points - base;
      gains[m.id] = gain;
      if (gain >= 0.5) list.push({m: m, gain: gain});
    });
    list.sort(function(a, b){ return b.gain - a.gain; });
    var out = [];
    list.slice(0, opts.finance || 5).forEach(function(c){
      var m = c.m, price = m.price || 0;
      var need = Math.max(price - after, full ? 1 : 0), sells = [], money = 0, soldValue = 0, points = base + c.gain;
      if (need > 0){
        var r = recommendSales(sellable, need, {fixed: fixed.concat([m]), maxN: 14});
        if (!r.points) return;
        sells = r.points.ids; money = r.points.money; points = r.points.points;
        sellable.forEach(function(p){ if (sells.indexOf(p.id) >= 0) soldValue += p.mv || 0; });
      }
      var net = points - ref;
      if (net < 0.5) return;
      // 33%-Regel im Moment des Gebots: Verkaeufe sind gebucht, das Gebot zaehlt als offen
      var room = bidRoom((opts.teamValue || 0) - soldValue, after + money, price);
      out.push({id: m.id, gain: c.gain, net: net, price: price, perMio: net / Math.max(0.1, price / 1e6),
        sells: sells, money: money, after: after + money - price, ok: room.headroom >= 0,
        trend: m.trend || 0, cons: m.cons != null ? m.cons : 0.6});
    });
    out.sort(function(a, b){
      return Math.round(b.net) - Math.round(a.net) || b.perMio - a.perMio || b.trend - a.trend || b.cons - a.cons;
    });
    return {base: base, ref: ref, gains: gains, list: out};
  }

  // ---------- Kontostand im Verlauf ----------
  // Ein Wert je Tag vom Ligastart bis jetzt. Transfers und Punktepraemien stehen mit
  // Datum fest; was kein Datum hat (Erfolge, Auflaufpraemie, Auto-Verkaeufe, Rundung
  // der Punkte), wird gleichmaessig ueber die Zeit verteilt, sodass der letzte Wert
  // genau `target` ist (Schaetzung Mitte, beim eigenen Konto der echte Stand).
  // o: {start, created, now, target, transfers [{dt, tty, trp}], matchdays [{at, points}], pointValue}
  function balanceHistory(o){
    var events = [];
    (o.transfers || []).forEach(function(x){
      var t = Date.parse(x.dt);
      if (isFinite(t)) events.push({t: t, v: x.tty === 1 ? -(x.trp || 0) : (x.trp || 0)});
    });
    (o.matchdays || []).forEach(function(m){
      if (isFinite(m.at)) events.push({t: m.at, v: (m.points || 0) * (o.pointValue || 0)});
    });
    events.sort(function(a, b){ return a.t - b.t; });
    var total = events.reduce(function(s, e){ return s + e.v; }, 0);
    var spread = o.target - (o.start || 0) - total, span = Math.max(1, o.now - o.created);
    var out = [], sum = o.start || 0, k = 0;
    for (var t = o.created; ; t = Math.min(t + DAY_MS, o.now)){
      while (k < events.length && events[k].t <= t){ sum += events[k].v; k++; }
      out.push({t: t, v: Math.round(sum + spread * (t - o.created) / span)});
      if (t >= o.now) break;
    }
    return out;
  }

  // ---------- Gebotshilfe ----------
  // Aufschlag beim Kauf = Preis / Marktwert am Kauftag - 1. Kaeufe von anderen
  // Managern koennen unter Marktwert liegen; Median und 75%-Quantil sind dagegen robust.
  function markupStats(list){
    var r = (list || []).filter(function(x){ return x.mv > 0 && x.price > 0; })
      .map(function(x){ return x.price / x.mv - 1; }).sort(function(a, b){ return a - b; });
    if (!r.length) return null;
    var q = function(p){ var i = (r.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return r[lo] + (r[hi] - r[lo]) * (i - lo); };
    return {n: r.length, median: q(0.5), p75: q(0.75)};
  }

  // Gebot, das drei von vier bisherigen Ligakaeufen ueberboten haette (auf 10.000 aufgerundet)
  function suggestBid(mv, stats){
    if (!stats || !mv) return null;
    return Math.ceil(mv * (1 + Math.max(0, stats.p75)) / 10000) * 10000;
  }

  // ---------- Spieler-Detail ----------
  // Marktwertverlauf aus /players/{P}/marketvalue/92: dt ist ein Tagesindex seit
  // 1970 (zur Sicherheit auch ms oder ISO-Text). Sortiert, ohne Luecken-Eintraege.
  function mvSeries(it){
    return (it || []).map(function(x){
      var t = typeof x.dt === 'number' ? (x.dt < 1e7 ? x.dt * DAY_MS : x.dt) : Date.parse(x.dt);
      return {t: t, mv: x.mv};
    }).filter(function(x){ return isFinite(x.t) && typeof x.mv === 'number'; })
      .sort(function(a, b){ return a.t - b.t; });
  }

  // Marktwert zum Zeitpunkt t: letzter Wert davor, null wenn t vor dem Verlauf liegt
  function mvAt(series, t){
    var v = null;
    for (var i = 0; i < series.length && series[i].t <= t; i++) v = series[i].mv;
    return v;
  }

  // Gespielte Spieltage einer Saison (ph aus /performance): Punkte und Art des
  // Einsatzes. Kommende Spiele (st 0 ohne Punkte) fehlen.
  function matchdayPoints(ph){
    return (ph || []).filter(function(h){ return h && h.day != null && !(h.st === 0 && h.p == null); })
      .map(function(h){
        var mins = parseInt(String(h.mp || '0'), 10) || 0;
        var kind = h.st === 5 ? 'start' : (h.st === 3 || mins > 0 ? 'sub' : 'out');
        return {day: h.day, p: kind === 'out' ? 0 : (h.p || 0), kind: kind};
      })
      .sort(function(a, b){ return a.day - b.day; });
  }

  return {
    balanceHistory: balanceHistory,
    markupStats: markupStats,
    suggestBid: suggestBid,
    mvSeries: mvSeries,
    mvAt: mvAt,
    matchdayPoints: matchdayPoints,
    FORMATIONS: FORMATIONS,
    recommendBuys: recommendBuys,
    availability: availability,
    expectedPoints: expectedPoints,
    formFromPerformance: formFromPerformance,
    OPP: OPP,
    teamRatings: teamRatings,
    matchEdge: matchEdge,
    opponentAllowance: opponentAllowance,
    positionSlope: positionSlope,
    matchFactor: matchFactor,
    horizonFactor: horizonFactor,
    playerConsistency: playerConsistency,
    bestEleven: bestEleven,
    recommendSales: recommendSales,
    MINUS_RATE: MINUS_RATE,
    maxNegative: maxNegative,
    bidRoom: bidRoom,
    minReachableBudget: minReachableBudget,
    berlinDayIndex: berlinDayIndex,
    calendarDaysInclusive: calendarDaysInclusive,
    loginDefaults: loginDefaults,
    loginStreakTotal: loginStreakTotal,
    loginTotalForDays: loginTotalForDays,
    transferLedger: transferLedger,
    detectAutoSales: detectAutoSales,
    ACH: ACH,
    defaultRewards: defaultRewards,
    achievementCounts: achievementCounts,
    achievementTotal: achievementTotal,
    estimateBudget: estimateBudget
  };
});
