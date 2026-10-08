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

  function cacheGet(key){
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch(e){ return null; }
  }
  function cacheSet(key, value){
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
  function fetchMatchdays(client, leagueId, cpi, myUid, onProgress){
    return client.get("/leagues/" + leagueId + "/managers/" + myUid + "/performance").then(function(perf){
      var season = ((perf && perf.it) || [])[0] || {};
      var now = Date.now();
      var days = (season.it || []).filter(function(d){
        return d.md && Date.parse(d.md) + 3 * 86400000 < now && d.mdp != null;
      }).map(function(d){ return d.day; });

      var result = {}, missing = [];
      days.forEach(function(day){
        var c = cacheGet("kp_md_" + leagueId + "_" + day);
        if (c) result[day] = c; else missing.push(day);
      });
      if (!missing.length) return result;

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
          return result;
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
        return fetchMatchdays(ctx.client, lid, cpi, ctx.myUserId, progress).catch(function(){ return {}; }).then(function(mds){
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

        var mdp = [], mpp = [];
        Object.keys(mds).forEach(function(day){
          var u = mds[day][uid];
          if (u){ mdp.push(u.mdp); mpp.push(u.mpp); }
        });

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
          ledger: ledger, autoSales: autoSales, counts: counts,
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
      });

      var check = null;
      if (me && ctx.myBudget != null){
        check = { real: ctx.myBudget, estimate: me.estimate.mid, diff: me.estimate.mid - ctx.myBudget };
      }
      return { byUser: out, pointValue: pointValue, pointValueCalibrated: calibrated, login: login, check: check, rewardsFromApi: rewardInfo.ownKnown };
    }
  }

  // Form und Einsatzquote fuer eine Liste von Spieler-IDs. Nimmt pro Spieler den
  // Eintrag der neuesten Saison (bei mehreren Wettbewerben den mit den meisten
  // Spieltagen). Der letzte gespielte Spieltag ergibt sich aus allen Spielern.
  function fetchForms(client, cpi, ids){
    return pool(ids, 6, function(id){
      return client.get("/competitions/" + cpi + "/players/" + id + "/performance").then(function(d){
        var seasons = (d && d.it) || [], cur = null;
        seasons.forEach(function(s){
          if (!cur || String(s.ti) > String(cur.ti) || (s.ti === cur.ti && (s.ph || []).length > (cur.ph || []).length)) cur = s;
        });
        return {id: id, ph: (cur && cur.ph) || []};
      }).catch(function(){ return {id: id, ph: null}; });
    }).then(function(list){
      var lastDay = 0;
      list.forEach(function(x){
        (x.ph || []).forEach(function(h){ if (h.day > lastDay && (h.p != null || h.mp)) lastDay = h.day; });
      });
      var out = {};
      list.forEach(function(x){ if (x.ph) out[x.id] = C.formFromPerformance(x.ph, lastDay); });
      return out;
    });
  }

  root.KBData = { createClient: createClient, pool: pool, estimateAll: estimateAll, fetchTransfers: fetchTransfers, fetchForms: fetchForms };
})(typeof self !== 'undefined' ? self : this);
