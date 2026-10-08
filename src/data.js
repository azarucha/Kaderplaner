// Kaderplaner - Datenschicht: laedt alles, was fuer die Kontostand-Schaetzung der
// Gegner noetig ist, und rechnet sie mit KBCalc. Nur GET-Aufrufe.
// Ergebnis pro Manager: { low, mid, high, parts, teamValue, squadSize, ... }
(function (root) {
  "use strict";
  var C = root.KBCalc;
  var API = "https://api.kickbase.com/v4";

  function createClient(getToken){
    function get(path){
      return fetch(API + path, {headers: {"Authorization": "Bearer " + getToken(), "Accept": "application/json"}})
        .then(function(res){
          if (res.status === 401 || res.status === 403){ var e = new Error("auth"); e.auth = true; throw e; }
          if (!res.ok) throw new Error("http-" + res.status);
          return res.json();
        });
    }
    return { get: get };
  }

  // Fuehrt fn fuer alle items mit hoechstens `limit` parallelen Aufrufen aus.
  function pool(items, limit, fn){
    var results = new Array(items.length), next = 0;
    function worker(){
      if (next >= items.length) return Promise.resolve();
      var i = next++;
      return Promise.resolve(fn(items[i], i)).then(function(r){ results[i] = r; return worker(); });
    }
    var workers = [];
    for (var k = 0; k < Math.min(limit, items.length); k++) workers.push(worker());
    return Promise.all(workers).then(function(){ return results; });
  }

  // Im Demo-Modus nichts speichern: Demo und echte App teilen sich im Web eine Origin.
  function cacheGet(key){
    if (root.__KP_DEMO) return null;
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch(e){ return null; }
  }
  function cacheSet(key, value){
    if (root.__KP_DEMO) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch(e){}
  }

  // Gesamte Transferhistorie eines Managers (25 pro Seite, reicht bis Ligastart).
  function fetchTransfers(client, leagueId, uid){
    var all = [];
    function page(start){
      return client.get("/leagues/" + leagueId + "/managers/" + uid + "/transfer?start=" + start).then(function(d){
        var it = (d && d.it) || [];
        all = all.concat(it);
        if (it.length < 25 || start > 5000) return all;
        return page(start + 25);
      });
    }
    return page(0);
  }

  // Activity-Feed (nur ca. ein Monat Historie). Gebraucht fuer Typ 22 (eigene
  // Auflaufpraemie) und Typ 32 (MVP-Auto-Verkauf mit Betrag).
  function fetchFeed(client, leagueId){
    var all = [];
    function page(start){
      return client.get("/leagues/" + leagueId + "/activitiesFeed?start=" + start + "&max=500").then(function(d){
        var it = (d && d.af) || [];
        all = all.concat(it);
        if (it.length < 500 || start > 20000) return all;
        return page(start + 500);
      });
    }
    return page(0);
  }

  // Pro abgeschlossenem Spieltag: Punkte jedes Managers und Punkte seines besten
  // aufgestellten Spielers. Abgeschlossene Spieltage aendern sich nicht -> Cache.
  // Ergebnis: {byDay: {day: {uid: {mdp, mpp}}}, dates: {day: Anstoss in ms}}
  function fetchMatchdays(client, leagueId, cpi, myUid, onProgress){
    return client.get("/leagues/" + leagueId + "/managers/" + myUid + "/performance").then(function(perf){
      var season = ((perf && perf.it) || [])[0] || {};
      var now = Date.now(), dates = {};
      var days = (season.it || []).filter(function(d){
        return d.md && Date.parse(d.md) + 3 * 86400000 < now && d.mdp != null;
      }).map(function(d){ dates[d.day] = Date.parse(d.md); return d.day; });

      var result = {}, missing = [];
      days.forEach(function(day){
        var c = cacheGet("kp_md_" + leagueId + "_" + day);
        if (c) result[day] = c; else missing.push(day);
      });
      if (!missing.length) return {byDay: result, dates: dates};

      return pool(missing, 3, function(day){
        return client.get("/leagues/" + leagueId + "/users/" + myUid + "/teamcenter?dayNumber=" + day)
          .then(function(tc){ return {day: day, us: (tc && tc.us) || []}; });
      }).then(function(lineups){
        var ids = {};
        lineups.forEach(function(l){ l.us.forEach(function(u){ (u.lp || []).forEach(function(p){ ids[String(p)] = true; }); }); });
        var idList = Object.keys(ids), points = {}, done = 0;
        return pool(idList, 8, function(pid){
          return client.get("/competitions/" + cpi + "/players/" + pid + "/performance").then(function(d){
            var seasons = (d && d.it) || [];
            var cur = seasons.filter(function(s){ return s.ti === season.sn; })[0] || seasons[seasons.length - 1] || {};
            var m = {};
            (cur.ph || []).forEach(function(h){ if (h.p != null) m[h.day] = h.p; });
            points[pid] = m;
          }).catch(function(){ points[pid] = {}; }).then(function(){
            done++;
            if (onProgress && done % 10 === 0) onProgress("Spielerpunkte " + done + "/" + idList.length);
          });
        }).then(function(){
          lineups.forEach(function(l){
            var byUser = {};
            l.us.forEach(function(u){
              var best = 0;
              (u.lp || []).forEach(function(p){ best = Math.max(best, (points[String(p)] || {})[l.day] || 0); });
              byUser[String(u.i)] = {mdp: u.mdp || 0, mpp: best};
            });
            result[l.day] = byUser;
            cacheSet("kp_md_" + leagueId + "_" + l.day, byUser);
          });
          return {byDay: result, dates: dates};
        });
      });
    });
  }

  // Praemienhoehen dieser Liga aus der API (unterscheiden sich je Wettbewerb),
  // dazu die eigenen erreichten Erfolge fuer den Pruefstein.
  function fetchRewards(client, leagueId, cpi){
    var rewards = C.defaultRewards(cpi);
    return client.get("/leagues/" + leagueId + "/user/achievements").then(function(list){
      var items = (list && list.it) || [];
      return pool(items, 8, function(a){
        return client.get("/leagues/" + leagueId + "/user/achievements/" + a.t)
          .then(function(d){ if (d && d.er != null) rewards[a.t] = d.er; return {t: a.t, ac: a.ac || 0}; })
          .catch(function(){ return {t: a.t, ac: a.ac || 0}; });
      }).then(function(own){
        var ownTotal = 0;
        own.forEach(function(o){ ownTotal += (rewards[o.t] || 0) * o.ac; });
        return {rewards: rewards, ownTotal: ownTotal, ownKnown: true};
      });
    }).catch(function(){ return {rewards: rewards, ownTotal: null, ownKnown: false}; });
  }

  // Hauptfunktion. ctx: { client, league (aus /leagues/selection), overview, managers
  // [{id,name}], myUserId, myBudget, onProgress }
  function estimateAll(ctx){
    var lid = ctx.league.i, cpi = ctx.league.cpi || ctx.overview.cpi || 1;
    var progress = ctx.onProgress || function(){};
    var now = Date.now();
    var created = ctx.overview.dt ? Date.parse(ctx.overview.dt) : now;
    var login = C.loginDefaults(cpi);

    progress("Lade Feed und Prämien …");
    return Promise.all([
      fetchFeed(ctx.client, lid).catch(function(){ return []; }),
      fetchRewards(ctx.client, lid, cpi)
    ]).then(function(r){
      var feed = r[0], rewardInfo = r[1];

      // MVP-Auto-Verkaeufe (Typ 32) mit Betrag, nach Spieler-ID
      var feedSales = {};
      feed.forEach(function(it){ if (it.t === 32 && it.data && it.data.pi) feedSales[String(it.data.pi)] = it.data.trp || 0; });

      // Staffel der Auflaufpraemie aus den eigenen Buchungen ablesen, falls vorhanden
      var maxBn = 0;
      feed.forEach(function(it){ if (it.t === 22 && it.data && it.data.bn > maxBn) maxBn = it.data.bn; });
      if (maxBn > login.cap) login = {step: maxBn / 10, cap: maxBn};

      progress("Lade Transfers und Kader …");
      return pool(ctx.managers, 3, function(m){
        return Promise.all([
          fetchTransfers(ctx.client, lid, m.id),
          ctx.client.get("/leagues/" + lid + "/managers/" + m.id + "/squad").catch(function(){ return {it: []}; }),
          ctx.client.get("/leagues/" + lid + "/managers/" + m.id + "/dashboard").catch(function(){ return {}; })
        ]).then(function(x){ return {m: m, transfers: x[0], squad: (x[1] && x[1].it) || [], dash: x[2] || {}}; });
      }).then(function(raw){
        progress("Lade Spieltage …");
        return fetchMatchdays(ctx.client, lid, cpi, ctx.myUserId, progress).catch(function(){ return {byDay: {}, dates: {}}; }).then(function(mds){
          return finish(raw, mds, feedSales, rewardInfo);
        });
      });
    });

    function finish(raw, mds, feedSales, rewardInfo){
      var loginHigh = C.loginStreakTotal(C.calendarDaysInclusive(created, now), login.step, login.cap);
      var out = {}, me = null;

      raw.forEach(function(r){
        var uid = String(r.m.id);
        var ledger = C.transferLedger(r.transfers);
        var squadIds = r.squad.map(function(p){ return p.pi || p.i; });
        var autoSales = C.detectAutoSales(ledger, squadIds, feedSales);
        var teamValue = r.dash.tv != null ? r.dash.tv : r.squad.reduce(function(s, p){ return s + (p.mv || 0); }, 0);

        var mdp = [], mpp = [], byDay = {};
        Object.keys(mds.byDay).forEach(function(day){
          var u = mds.byDay[day][uid];
          if (u){ mdp.push(u.mdp); mpp.push(u.mpp); byDay[day] = u.mdp; }
        });
        // Buchgewinn: Marktwert minus Kaufpreis der Spieler, die noch im Kader stehen
        var openGain = r.squad.reduce(function(s, p){ return s + (p.prc != null ? (p.mv || 0) - p.prc : 0); }, 0);
        var lastTransfer = r.transfers.reduce(function(m, t){ return Math.max(m, Date.parse(t.dt) || 0); }, 0);

        var counts = C.achievementCounts({
          wins: r.dash.mdw || 0, matchdayPoints: mdp, maxPlayerPoints: mpp,
          seasonPoints: r.dash.tp || 0, transferCount: ledger.count + autoSales.length,
          profits: ledger.profits, managerCount: ctx.overview.mgc || ctx.managers.length,
          teamValue: teamValue, mvpCount: autoSales.length
        });

        // Untergrenze Auflaufpraemie: nur Tage mit belegter Aktivitaet (Transfers)
        var activeDays = r.transfers.map(function(t){ return C.berlinDayIndex(Date.parse(t.dt)); });

        out[uid] = {
          id: uid, name: r.m.name, teamValue: teamValue, squadSize: r.squad.length,
          seasonPoints: r.dash.tp || 0, wins: r.dash.mdw || 0,
          ledger: ledger, autoSales: autoSales, counts: counts, transfers: r.transfers,
          matchdayPoints: byDay, openGain: openGain, lastTransfer: lastTransfer,
          achievements: C.achievementTotal(counts, rewardInfo.rewards),
          loginLow: C.loginTotalForDays(activeDays, login.step, login.cap),
          loginHigh: loginHigh
        };
        if (uid === String(ctx.myUserId)) me = out[uid];
      });

      // Punktepraemie (Euro je Saisonpunkt): 2. Liga gemessen 1.000 EUR. Fuer andere
      // Wettbewerbe aus dem eigenen, echten Kontostand ableiten.
      var pointValue = 1000, calibrated = false;
      if (me && me.seasonPoints > 200 && ctx.myBudget != null){
        var ownAch = rewardInfo.ownKnown ? rewardInfo.ownTotal : me.achievements;
        var autoSum = me.autoSales.reduce(function(s, a){ return s + a.trp; }, 0);
        var rest = ctx.myBudget - ((ctx.overview.b || 0) + me.ledger.net + autoSum + ownAch + me.loginHigh);
        var pv = Math.round(rest / me.seasonPoints / 250) * 250;
        if (String(cpi) !== "2" && pv >= 250 && pv <= 5000){ pointValue = pv; calibrated = true; }
      }

      Object.keys(out).forEach(function(uid){
        var o = out[uid];
        o.estimate = C.estimateBudget({
          startBudget: ctx.overview.b || 0, ledger: o.ledger, autoSales: o.autoSales,
          seasonPoints: o.seasonPoints, pointValue: pointValue, achievements: o.achievements,
          loginLow: o.loginLow, loginHigh: o.loginHigh
        });
        o.freeSlots = ctx.overview.mppu != null ? Math.max(0, ctx.overview.mppu - o.squadSize) : null;
        o.history = C.balanceHistory({
          start: ctx.overview.b || 0, created: created, now: now, pointValue: pointValue, transfers: o.transfers,
          target: o === me && ctx.myBudget != null ? ctx.myBudget : o.estimate.mid,
          matchdays: Object.keys(o.matchdayPoints).map(function(d){ return {at: mds.dates[d], points: o.matchdayPoints[d]}; })
        });
        delete o.transfers;
      });

      var check = null;
      if (me && ctx.myBudget != null){
        check = { real: ctx.myBudget, estimate: me.estimate.mid, diff: me.estimate.mid - ctx.myBudget };
      }
      var days = Object.keys(mds.byDay).map(Number).sort(function(a, b){ return a - b; });
      return { byUser: out, days: days, pointValue: pointValue, pointValueCalibrated: calibrated, login: login, check: check, rewardsFromApi: rewardInfo.ownKnown };
    }
  }

  // Form und Einsatzquote fuer eine Liste von Spieler-IDs. Nimmt pro Spieler den
  // Eintrag der neuesten Saison (bei mehreren Wettbewerben den mit den meisten
  // Spieltagen). Der letzte gespielte Spieltag ergibt sich aus allen Spielern.
  function fetchForms(client, cpi, ids){
    return pool(ids, 6, function(id){
      return client.get("/competitions/" + cpi + "/players/" + id + "/performance").then(function(d){
        var seasons = (d && d.it) || [], cur = latestSeason(seasons);
        var prev = cur && seasons.filter(function(s){ return s.ti === prevSeason(cur.ti); })[0];
        // Konstanz: Startelf-Einsaetze dieser Saison (Gewicht 1) und der letzten (0,5)
        var starts = [];
        if (cur) (cur.ph || []).forEach(function(h){ if (h.st === 5 && h.p != null) starts.push({p: h.p, w: 1}); });
        if (prev) (prev.ph || []).forEach(function(h){ if (h.st === 5 && h.p != null) starts.push({p: h.p, w: 0.5}); });
        return {id: id, ph: (cur && cur.ph) || [], cons: C.playerConsistency(starts)};
      }).catch(function(){ return {id: id, ph: null}; });
    }).then(function(list){
      var lastDay = 0;
      list.forEach(function(x){
        (x.ph || []).forEach(function(h){ if (h.day > lastDay && (h.p != null || h.mp)) lastDay = h.day; });
      });
      var out = {};
      list.forEach(function(x){
        if (!x.ph) return;
        out[x.id] = C.formFromPerformance(x.ph, lastDay);
        out[x.id].cons = x.cons;
      });
      return out;
    });
  }

  function latestSeason(seasons){
    var cur = null;
    (seasons || []).forEach(function(s){
      if (!cur || String(s.ti) > String(cur.ti) || (s.ti === cur.ti && (s.ph || []).length > (cur.ph || []).length)) cur = s;
    });
    return cur;
  }

  // Spieler-Detail: Marktwertverlauf (3 Monate), Punkte je Spieltag dieser Saison und
  // Transfers des Spielers in der Liga. Jeder Teil darf fehlen (null), wenn der
  // Abruf scheitert.
  function fetchPlayerDetail(client, leagueId, cpi, pid){
    var base = "/leagues/" + leagueId + "/players/" + pid;
    var none = function(){ return null; };
    return Promise.all([
      client.get(base + "/marketvalue/92").catch(function(){ return client.get(base + "/marketValue/92"); }).catch(none),
      client.get("/competitions/" + cpi + "/players/" + pid + "/performance").catch(none),
      client.get(base + "/transferHistory?start=0").catch(none)
    ]).then(function(r){
      var mv = r[0] ? C.mvSeries(r[0].it) : null;
      var season = r[1] ? latestSeason(r[1].it) : null;
      var transfers = r[2] ? ((r[2].it) || []).map(function(t){
        var at = Date.parse(t.dt);
        return {at: at, user: t.unm || null, price: t.trp || 0, mvThen: mv ? C.mvAt(mv, at) : null};
      }).sort(function(a, b){ return b.at - a.at; }) : null;
      return {mv: mv, season: season ? season.ti : null, points: season ? C.matchdayPoints(season.ph) : null, transfers: transfers};
    });
  }

  function prevSeason(ti){
    var m = /^(\d{4})\/(\d{4})$/.exec(ti || '');
    return m ? (+m[1] - 1) + '/' + m[1] : null;
  }

  // ---------- Gegnermodell ----------
  // Alle Spieler der Liga (Kickbase, Startelf-Einsaetze dieser und der letzten Saison)
  // fuer "Gegner laesst Punkte zu", Ergebnisse fuer die Teamstaerke von OpenLigaDB
  // (Ersatz: Ergebnisse aus den Kickbase-Spielerdaten). Zwischengespeichert, damit
  // die gut 400 Abrufe nur etwa zweimal am Tag noetig sind.
  var LEAGUE_TTL = 12 * 3600000;

  function fetchLeagueHistory(client, cpi, teams){
    var key = 'kp_lg_' + cpi, cached = cacheGet(key), now = Date.now();
    // nach jedem Anpfiff (plus Spieldauer) neu laden, sonst hoechstens alle 12 Stunden
    if (cached && cached.v === 1 && now - cached.at < LEAGUE_TTL && !(cached.nextKick && now > cached.nextKick + 2.5 * 3600000)) return Promise.resolve(cached);
    var opt = function(p){ return p.catch(function(){ return null; }); };
    return pool(teams, 4, function(t){ return opt(client.get("/competitions/" + cpi + "/teams/" + t.tid + "/teamprofile")); }).then(function(profiles){
      var players = [];
      profiles.forEach(function(pr, k){
        ((pr && pr.it) || []).forEach(function(p){ if (p.ap > 0) players.push({id: String(p.i), pos: p.pos, tid: String(teams[k].tid)}); });
      });
      var matches = {}, nextByTeam = {}, curTi = null, nextKick = null;
      return pool(players, 6, function(pl){
        return opt(client.get("/competitions/" + cpi + "/players/" + pl.id + "/performance")).then(function(d){
          var seasons = ((d && d.it) || []).filter(function(s){ return /^\d{4}\/\d{4}$/.test(s.ti); });
          seasons.sort(function(a, b){ return a.ti < b.ti ? -1 : 1; });
          var cur = seasons[seasons.length - 1];
          if (!cur) return;
          if (!curTi || cur.ti > curTi) curTi = cur.ti;
          pl.ti = cur.ti;
          var prev = seasons.filter(function(s){ return s.ti === prevSeason(cur.ti); })[0];
          pl.g = [];
          [[cur, 0], [prev, 1]].forEach(function(x){
            if (!x[0]) return;
            (x[0].ph || []).forEach(function(h){
              var t = Date.parse(h.md);
              if (h.t1g != null && h.t2g != null && h.mi) matches[h.mi] = [String(h.t1), String(h.t2), h.t1g, h.t2g, x[1], t];
              if (h.st === 5 && h.p != null && h.pt){
                var home = String(h.pt) === String(h.t1);
                pl.g.push([h.p, String(home ? h.t2 : h.t1), home ? 1 : 0, x[1]]);
              }
              // kommende Spiele des Vereins (noch ohne Ergebnis)
              if (x[1] === 0 && h.t1g == null && t > now){
                var list = nextByTeam[pl.tid] = nextByTeam[pl.tid] || {};
                var home2 = String(h.t1) === pl.tid;
                list[h.mi || t] = [String(home2 ? h.t2 : h.t1), home2 ? 1 : 0, t];
                if (!nextKick || t < nextKick) nextKick = t;
              }
            });
          });
        });
      }).then(function(){
        var next = {};
        Object.keys(nextByTeam).forEach(function(tid){
          next[tid] = Object.keys(nextByTeam[tid]).map(function(k){ return nextByTeam[tid][k]; }).sort(function(a, b){ return a[2] - b[2]; }).slice(0, 4);
        });
        var data = {v: 1, at: now, ti: curTi, nextKick: nextKick, next: next,
          players: players.filter(function(p){ return p.g && p.ti === curTi; }).map(function(p){ return [p.id, p.pos, p.tid, p.g]; }),
          matches: Object.keys(matches).map(function(k){ return matches[k]; })};
        if (data.players.length) cacheSet(key, data);
        return data;
      });
    });
  }

  // OpenLigaDB: oeffentliche Ergebnisse, ohne Login oder Cookies. Laufende Saison
  // 6 Stunden zwischengespeichert, abgeschlossene Saisons dauerhaft.
  var OPENLIGA = "https://api.openligadb.de";
  function fetchOpenLiga(shortcut, year, current){
    var key = 'kp_ol_' + shortcut + '_' + year, cached = cacheGet(key);
    if (cached && (!current || Date.now() - cached.at < 6 * 3600000)) return Promise.resolve(cached);
    return fetch(OPENLIGA + "/getmatchdata/" + shortcut + "/" + year).then(function(r){ return r.ok ? r.json() : []; }).then(function(list){
      var teams = {}, matches = [];
      (list || []).forEach(function(m){
        if (!m.team1 || !m.team2) return;
        [m.team1, m.team2].forEach(function(t){ teams[t.teamId] = [t.teamName, t.shortName]; });
        var end = (m.matchResults || []).filter(function(r){ return r.resultTypeID === 2; })[0];
        matches.push([String(m.team1.teamId), String(m.team2.teamId), m.matchIsFinished && end ? end.pointsTeam1 : null, m.matchIsFinished && end ? end.pointsTeam2 : null, Date.parse(m.matchDateTimeUTC)]);
      });
      var data = {at: Date.now(), teams: teams, matches: matches};
      if (matches.length) cacheSet(key, data);
      return data;
    }).catch(function(){ return null; });
  }

  // Vereinsnamen von OpenLigaDB auf Kickbase-IDs abbilden ("Hertha BSC" = "Hertha",
  // "SpVgg Greuther Fürth" = "Fürth"). Nicht zuordenbare Vereine behalten eine eigene Kennung.
  function normName(s){
    return String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function(w){ return w && !/^(fc|sv|vfl|vfb|sc|spvgg|dsc|bsc|tsg|fsv|ssv|sg|1|04|05|96|98|1846|1860|1899|1900|1907|1909)$/.test(w); }).join(' ');
  }
  function mapTeams(olTeams, kbTeams){
    var map = {}, used = {};
    var kb = kbTeams.map(function(t){ return {tid: String(t.tid), n: normName(t.tn)}; });
    Object.keys(olTeams).forEach(function(id){
      var full = normName(olTeams[id][0]), short = normName(olTeams[id][1]);
      var hit = kb.filter(function(t){ return !used[t.tid] && (t.n === short || t.n === full); })[0] ||
        kb.filter(function(t){ return !used[t.tid] && t.n && (full.indexOf(t.n) >= 0 || t.n.indexOf(short) >= 0); })[0];
      if (hit){ map[id] = hit.tid; used[hit.tid] = true; } else map[id] = 'ol' + id;
    });
    return map;
  }

  // Setzt alles zusammen: Teamstaerke, Gegnerwerte je Position, Steigung je Position.
  // kbTeams: Tabelle der Kickbase-Wettbewerbs (tid, tn).
  function fetchOpponentModel(client, cpi, kbTeams){
    return fetchLeagueHistory(client, cpi, kbTeams).then(function(lg){
      var m = /^(\d{4})\//.exec(lg.ti || ''), year = m ? +m[1] : null;
      var shortcut = String(cpi) === '1' ? 'bl1' : (String(cpi) === '2' ? 'bl2' : null);
      var ol = year && shortcut ? Promise.all([
        fetchOpenLiga(shortcut, year, true), fetchOpenLiga('bl1', year - 1, false), fetchOpenLiga('bl2', year - 1, false)
      ]) : Promise.resolve([]);
      return ol.then(function(parts){ return buildOpponentModel(lg, parts, kbTeams); });
    });
  }

  function buildOpponentModel(lg, olParts, kbTeams){
    var P = C.OPP, matches = [], source = 'kickbase';
    // Ergebnisse von OpenLigaDB, wenn die laufende Saison zuordenbar ist
    var cur = olParts && olParts[0];
    if (cur && cur.matches.length){
      var all = [];
      olParts.forEach(function(part, i){
        if (!part) return;
        var map = mapTeams(part.teams, kbTeams);
        part.matches.forEach(function(x){ if (x[2] != null) all.push({home: map[x[0]], away: map[x[1]], hg: x[2], ag: x[3], w: i === 0 ? 1 : P.prevSeason, cur: i === 0}); });
      });
      var mapped = all.filter(function(x){ return x.cur && x.home.indexOf('ol') !== 0 && x.away.indexOf('ol') !== 0; }).length;
      if (mapped >= 9){ matches = all; source = 'openligadb'; }
    }
    if (!matches.length) matches = lg.matches.map(function(x){ return {home: x[0], away: x[1], hg: x[2], ag: x[3], w: x[4] ? P.prevSeason : 1}; });
    var ratings = C.teamRatings(matches);

    var players = lg.players.map(function(x){
      return {id: x[0], pos: x[1], tid: x[2], games: x[3].map(function(g){ return {p: g[0], opp: g[1], home: !!g[2], prev: !!g[3]}; })};
    });
    var allow = C.opponentAllowance(players);
    var slopes = {};
    [1, 2, 3, 4].forEach(function(pos){
      var entries = players.filter(function(pl){ return pl.pos === pos; }).map(function(pl){
        var W = 0, S = 0;
        var games = pl.games.map(function(g){ var w = g.prev ? 0.5 : 1; W += w; S += w * g.p; return {p: g.p, w: w, x: C.matchEdge(ratings, g.opp, g.home)}; });
        return {quality: W ? S / W : null, games: games};
      });
      slopes[pos] = C.positionSlope(entries, P.slope[pos]);
    });
    return {ratings: ratings, allow: allow, slopes: slopes, next: lg.next, source: source, at: lg.at, players: players.length};
  }

  // Gegner und Faktor der naechsten Spiele fuer einen Spieler (pos 1-4, tid Verein).
  function fixturesFor(model, pos, tid, horizon){
    var list = ((model && model.next[String(tid)]) || []).filter(function(x){ return x[2] > Date.now() - 2 * 3600000; }).slice(0, 3);
    var games = list.map(function(x){
      var edge = C.matchEdge(model.ratings, x[0], !!x[1]);
      return {opp: x[0], home: !!x[1], at: x[2], f: C.matchFactor(model.allow[x[0] + '|' + pos], model.slopes[pos], edge)};
    });
    return {games: games, factor: C.horizonFactor(games.map(function(g){ return g.f; }), horizon)};
  }

  root.KBData = { createClient: createClient, pool: pool, estimateAll: estimateAll, fetchTransfers: fetchTransfers, fetchForms: fetchForms, fetchPlayerDetail: fetchPlayerDetail,
    fetchOpponentModel: fetchOpponentModel, buildOpponentModel: buildOpponentModel, fixturesFor: fixturesFor, mapTeams: mapTeams, normName: normName };
})(typeof self !== 'undefined' ? self : this);
