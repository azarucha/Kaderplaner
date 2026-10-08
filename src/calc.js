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
  function expectedPoints(p){ return (p.ap || 0) * availability(p.status); }

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
    var toEntry = function(p){ return {id: p.id, pos: p.pos, mv: p.mv || 0, pts: expectedPoints(p)}; };
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
    var money = new Float64Array(size), best = null, fewest = null;
    var top = {TW: [0, 0, 0, 0, 0, 0, 0], ABW: [0, 0, 0, 0, 0, 0, 0], MF: [0, 0, 0, 0, 0, 0, 0], ANG: [0, 0, 0, 0, 0, 0, 0]};

    for (var mask = 1; mask < size; mask++){
      var low = mask & -mask, bit = 31 - Math.clz32(low);
      money[mask] = money[mask ^ low] + cand[bit].mv;
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
      var cand1 = {mask: mask, money: money[mask], points: pts, count: cnt, formation: form};
      if (!best || pts > best.points || (pts === best.points && (cnt < best.count || (cnt === best.count && cand1.money > best.money)))) best = cand1;
      if (!fewest || cnt < fewest.count || (cnt === fewest.count && (pts > fewest.points || (pts === fewest.points && cand1.money > fewest.money)))) fewest = cand1;
    }

    function describe(r){
      if (!r) return null;
      var ids = [];
      for (var b = 0; b < n; b++) if ((r.mask >> b) & 1) ids.push(cand[b].id);
      return {ids: ids, money: r.money, points: r.points, loss: base.points - r.points, formation: r.formation, count: r.count};
    }
    var out = {base: base, need: need, possible: !!best, points: describe(best), fewest: describe(fewest)};
    if (out.points && out.fewest && out.points.ids.join() === out.fewest.ids.join()) out.fewest = null;
    return out;
  }

  return {
    FORMATIONS: FORMATIONS,
    availability: availability,
    expectedPoints: expectedPoints,
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
