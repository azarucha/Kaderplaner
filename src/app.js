(function(){
  "use strict";

  var POS_MAP = {1:"TW", 2:"ABW", 3:"MF", 4:"ANG"};
  var POS_ORDER = ["TW","ABW","MF","ANG"];
  var POS_LABEL = {TW:"Torwart", ABW:"Abwehr", MF:"Mittelfeld", ANG:"Angriff"};
  var URGENT_SEC = 1800;
  var DESKTOP = window.matchMedia ? window.matchMedia('(min-width: 1000px)') : { matches: false };

  var C = window.KBCalc;
  var $ = function(id){ return document.getElementById(id); };
  var els = {
    setup: $('screen-setup'), main: $('screen-main'),
    tokenInput: $('tokenInput'), connectBtn: $('connectBtn'), setupStatus: $('setupStatus'),
    leagueBtn: $('leagueBtn'), leagueName: $('leagueName'), pageTitle: $('pageTitle'), pageSub: $('pageSub'),
    refreshBtn: $('refreshBtn'), menuBtn: $('menuBtn'),
    sideLeagues: $('sideLeagues'), sideNav: $('sideNav'), sideUser: $('sideUser'), sideLogout: $('sideLogout'),
    sumBudget: $('sumBudget'), sumAfter: $('sumAfter'), sumAfterCap: $('sumAfterCap'),
    sumRoom: $('sumRoom'), sumRoomCap: $('sumRoomCap'), sumSquad: $('sumSquad'), sumSquadCap: $('sumSquadCap'),
    meterLeft: $('meterLeft'), meterRight: $('meterRight'),
    alerts: $('alerts'), body: $('body'), tabbar: $('tabbar'),
    sheet: $('sheet'), sheetBackdrop: $('sheetBackdrop')
  };

  // ---------- Formatierung ----------
  var currency = new Intl.NumberFormat('de-DE', {style:'currency', currency:'EUR', maximumFractionDigits:0});
  function fmtMoney(n){ return currency.format(n || 0).replace('-', '−'); }
  function short(n){
    n = n || 0;
    var a = Math.abs(n), s;
    if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace('.', ',') + ' Mio';
    else if (a >= 1e3) s = Math.round(a / 1e3) + 'k';
    else s = String(Math.round(a));
    return (n < 0 ? '−' : '') + s;
  }
  function delta(n){ n = n || 0; return (n >= 0 ? '+' : '−') + short(Math.abs(n)); }
  function negCls(n){ return (n || 0) < 0 ? ' neg' : ''; }
  // Gewinn/Verlust: Minus rot, Plus gruen, null neutral
  function signCls(n){ n = n || 0; return n < 0 ? 'neg' : (n > 0 ? 'up' : ''); }
  function escapeHtml(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function countdown(sec){
    if (sec == null) return "ohne Frist";
    if (sec <= 0) return "läuft ab";
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
    return h ? h + " Std " + m + " Min" : "noch " + m + " Min";
  }
  var dateFmt = new Intl.DateTimeFormat('de-DE', {weekday:'short', hour:'2-digit', minute:'2-digit'});
  function each(sel, fn){ Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  // ---------- Token und Liga: Keychain (Scriptable) oder localStorage ----------
  // In Scriptable melden kaderplaner://-Links Aenderungen an den Wrapper. Die
  // Navigationen laufen nacheinander, damit keine die vorige abbricht.
  var bridge = !!window.__KP_SCRIPTABLE;
  var demo = !!window.__KP_DEMO;   // Demo-Modus: nichts dauerhaft speichern
  var bridgeQueue = [];
  function bridgeSend(path){
    if (!bridge) return;
    bridgeQueue.push(path);
    if (bridgeQueue.length === 1) bridgeNext();
  }
  function bridgeNext(){
    if (!bridgeQueue.length) return;
    location.href = 'kaderplaner://' + bridgeQueue[0];
    setTimeout(function(){ bridgeQueue.shift(); bridgeNext(); }, 250);
  }
  function readToken(){
    if (window.__KP_TOKEN) return window.__KP_TOKEN;
    try { return localStorage.getItem('kb_token'); } catch(e){ return null; }
  }
  function persistToken(t){
    if (demo) return;
    try { localStorage.setItem('kb_token', t); } catch(e){}
    bridgeSend('token/' + encodeURIComponent(t));
  }
  function forgetToken(){
    window.__KP_TOKEN = null;
    if (demo){ location.href = 'index.html'; return; }
    try { localStorage.removeItem('kb_token'); } catch(e){}
    bridgeSend('logout');
  }
  function readLeague(){
    if (demo) return null;
    try { var v = localStorage.getItem('kp_league'); if (v) return v; } catch(e){}
    return window.__KP_LEAGUE || null;
  }
  function persistLeague(id){
    if (demo || (readLeague() === String(id) && window.__KP_LEAGUE === String(id))) return;
    try { localStorage.setItem('kp_league', String(id)); } catch(e){}
    window.__KP_LEAGUE = String(id);
    bridgeSend('league/' + encodeURIComponent(id));
  }
  function b64urlDecode(seg){
    seg = seg.replace(/-/g,'+').replace(/_/g,'/');
    while (seg.length % 4) seg += '=';
    return decodeURIComponent(atob(seg).split('').map(function(c){
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
  }
  function decodeToken(token){
    var parts = token.split('.');
    if (parts.length !== 3) return null;
    try { return JSON.parse(b64urlDecode(parts[1])); } catch(e){ return null; }
  }
  function cleanToken(raw){
    var t = (raw || "").trim().replace(/^["']|["']$/g, "");
    if (t.indexOf("Bearer ") === 0) t = t.slice(7).trim();
    return t;
  }

  // ---------- State ----------
  function initialState(){
    return {
      token:null, tokenName:"", myUserId:null, leagues:[], league:null,
      budget:0, players:[], sell:{}, market:[], bids:{},
      managers:[], overview:null, clubNames:{}, nextKickoff:null, matchday:null,
      estimates:null, estLoading:false, estError:false, estProgress:"", showCalc:false,
      openManager:null, managerSquads:{}, tab:null, loading:false, lineup:null, forms:null,
      pick:null, lineupNote:null, opp:null, oppLoading:false, kbTeams:[],
      hideInactive: (function(){ try { return !!localStorage.getItem('kp_hide_inactive'); } catch(e){ return false; } })()
    };
  }
  var state = initialState();
  // Nur in der Demo (Screenshots): ?tab=markt oeffnet direkt einen Tab, ?theme=dark erzwingt das Farbschema
  if (demo) try {
    var qs = new URLSearchParams(location.search);
    if (qs.get('tab')) state.tab = qs.get('tab');
    if (qs.get('theme')) document.documentElement.setAttribute('data-theme', qs.get('theme'));
  } catch(e){}
  var client = KBData.createClient(function(){ return state.token; });

  function show(screen){
    els.setup.hidden = screen !== 'setup';
    els.main.hidden = screen !== 'main';
  }

  function applyToken(raw, silent){
    var token = cleanToken(raw);
    var payload = decodeToken(token);
    var fail = function(msg){ if (!silent) els.setupStatus.innerHTML = '<p class="status-msg">' + msg + '</p>'; return false; };
    if (!payload) return fail("Der Token sieht nicht gültig aus. Bitte den Wert aus <code>kb.t</code> komplett neu kopieren.");
    if (payload.exp && Date.now() / 1000 > payload.exp) return fail("Dieser Token ist abgelaufen. Bitte neu anmelden.");
    state.token = token;
    state.tokenName = payload["kb.name"] || "";
    state.myUserId = payload["kb.uid"] != null ? String(payload["kb.uid"]) : null;
    return true;
  }

  function start(){
    var stored = readToken();
    if (stored && applyToken(stored, true)) loadLeagues();
    else show('setup');
  }

  if (bridge) document.documentElement.classList.add('is-scriptable');

  // Login mit E-Mail und Passwort: geht direkt an Kickbase, gespeichert wird nur
  // der zurueckgegebene Token, nie das Passwort.
  $('loginForm').addEventListener('submit', function(e){
    e.preventDefault();
    var email = $('loginEmail').value.trim(), pass = $('loginPass').value;
    var btn = $('loginBtn');
    if (!email || !pass) return;
    els.setupStatus.innerHTML = "";
    btn.disabled = true; btn.textContent = "Melde an …";
    fetch("https://api.kickbase.com/v4/user/login", {
      method: "POST",
      headers: {"Content-Type": "application/json", "Accept": "application/json"},
      body: JSON.stringify({em: email, pass: pass, loy: false, rep: {}})
    }).then(function(res){
      if (res.status === 401 || res.status === 403 || res.status === 400) throw new Error("credentials");
      if (!res.ok) throw new Error("http-" + res.status);
      return res.json();
    }).then(function(d){
      var token = d && (d.tkn || d.token);
      if (!token || !applyToken(token, false)) throw new Error("token");
      $('loginPass').value = "";
      persistToken(state.token);
      loadLeagues();
    }).catch(function(err){
      var msg = err.message === "credentials" ? "E-Mail oder Passwort stimmt nicht."
        : err.message === "token" ? "Kickbase hat keinen gültigen Token geliefert. Versuch es mit dem Token-Weg darunter."
        : "Kickbase ist gerade nicht erreichbar. Prüf dein Netz und versuch es nochmal.";
      if (!els.setupStatus.innerHTML) els.setupStatus.innerHTML = '<p class="status-msg">' + msg + '</p>';
    }).then(function(){ btn.disabled = false; btn.textContent = "Anmelden"; });
  });

  els.connectBtn.addEventListener('click', function(){
    els.setupStatus.innerHTML = "";
    if (!els.tokenInput.value.trim()){
      els.setupStatus.innerHTML = '<p class="status-msg">Bitte zuerst den Token einfügen.</p>';
      return;
    }
    if (applyToken(els.tokenInput.value, false)){
      persistToken(state.token);
      loadLeagues();
    }
  });

  function logout(){
    forgetToken();
    state = initialState();
    els.tokenInput.value = "";
    closeSheet();
    show('setup');
  }
  els.sideLogout.addEventListener('click', logout);

  // ---------- Fehler ----------
  function showError(err, retry){
    if (err && err.auth){
      els.body.innerHTML = '<div class="empty">Kickbase hat die Anmeldung abgelehnt, vermutlich ist sie abgelaufen.<br><button class="text-btn" id="reAuth">Neu anmelden</button></div>';
      $('reAuth').addEventListener('click', logout);
      return;
    }
    els.body.innerHTML = '<div class="empty">Verbindung zu Kickbase hat nicht geklappt.<br><button class="text-btn" id="retry">Erneut versuchen</button></div>';
    $('retry').addEventListener('click', retry);
  }

  // ---------- Ligen ----------
  function loadLeagues(){
    show('main');
    els.body.innerHTML = '<div class="spinner"></div>';
    client.get("/leagues/selection").then(function(d){
      state.leagues = (d && d.it) || [];
      if (!state.leagues.length){ els.body.innerHTML = '<div class="empty">Keine Ligen gefunden.</div>'; return; }
      var last = readLeague();
      var l = state.leagues.filter(function(x){ return String(x.i) === last; })[0] || state.leagues[0];
      openLeague(l);
    }).catch(function(err){ showError(err, loadLeagues); });
  }

  function cpiLabel(cpi){ return ({"1": "1. BL", "2": "2. BL", "3": "La Liga"})[String(cpi)] || ""; }

  function renderSide(){
    els.sideLeagues.innerHTML = state.leagues.map(function(l, i){
      var on = state.league && String(state.league.i) === String(l.i);
      return '<button type="button" class="' + (on ? 'on' : '') + '" data-league="' + i + '">' + escapeHtml(l.n || 'Liga') + '<span>' + cpiLabel(l.cpi) + '</span></button>';
    }).join('');
    each('#sideLeagues [data-league]', function(b){
      b.addEventListener('click', function(){ openLeague(state.leagues[+b.getAttribute('data-league')]); });
    });
    els.sideUser.textContent = state.tokenName ? 'Angemeldet als ' + state.tokenName : '';
  }

  function openLeague(l){
    var keep = {token: state.token, tokenName: state.tokenName, myUserId: state.myUserId, leagues: state.leagues, tab: state.tab};
    state = initialState();
    Object.keys(keep).forEach(function(k){ state[k] = keep[k]; });
    state.league = l;
    persistLeague(l.i);
    els.leagueName.textContent = l.n || "Liga";
    els.pageTitle.textContent = l.n || "Liga";
    els.pageSub.textContent = "";
    renderSide();
    markTabs();
    loadLeague();
  }

  function loadLeague(){
    var l = state.league;
    if (!l) return;
    var id = l.i, cpi = l.cpi || 1;
    state.loading = true;
    els.refreshBtn.classList.add('spin');
    if (!state.players.length) els.body.innerHTML = '<div class="spinner"></div>';
    var opt = function(p){ return p.catch(function(){ return null; }); };
    Promise.all([
      client.get("/leagues/" + id + "/me"),
      client.get("/leagues/" + id + "/squad"),
      client.get("/leagues/" + id + "/market"),
      client.get("/leagues/" + id + "/ranking"),
      opt(client.get("/leagues/" + id + "/overview")),
      opt(client.get("/competitions/" + cpi + "/table")),
      state.myUserId ? opt(client.get("/leagues/" + id + "/managers/" + state.myUserId + "/performance")) : Promise.resolve(null)
    ]).then(function(r){
      if (state.league !== l) return;
      var me = r[0], squad = r[1], market = r[2], ranking = r[3], ov = r[4], table = r[5], perf = r[6];
      state.budget = me.b || 0;
      state.overview = ov || {mppu: me.mppu, mpst: me.mpst, mgc: me.mgc, cpi: cpi};
      state.matchday = ranking && ranking.day || null;
      var names = {};
      ((table && table.it) || []).forEach(function(t){ if (t.tid) names[t.tid] = t.tn; });
      state.clubNames = names;
      state.kbTeams = ((table && table.it) || []).filter(function(t){ return t.tid; }).map(function(t){ return {tid: String(t.tid), tn: t.tn}; });

      state.players = ((squad && squad.it) || []).map(function(p){
        return {
          id: String(p.i || p.pi), name: p.n || p.pn || "Unbekannt", pos: POS_MAP[p.pos] || "–",
          mv: p.mv || 0, gain: p.mvgl, day: p.tfhmvt, ap: p.ap, status: p.st || 0,
          // lo = Platz in der aktuellen Kickbase-Aufstellung, beginnt bei 0 (Torwart); fehlt = Bank
          offers: p.ofc || 0, tid: p.tid, lo: p.lo != null ? p.lo : null
        };
      });
      initLineup();

      state.market = ((market && market.it) || []).map(function(p){
        return {
          id: String(p.i), name: (p.fn ? p.fn.charAt(0) + ". " : "") + (p.n || "Unbekannt"),
          pos: POS_MAP[p.pos] || "–", mv: p.mv || 0, price: p.prc != null ? p.prc : (p.mv || 0),
          expires: p.exs != null ? p.exs : null, loadedAt: Date.now(), status: p.st || 0,
          bids: p.ofc || 0, by: p.u ? (p.u.n || "Manager") : null, tid: p.tid, ap: p.ap,
          mvt: p.mvt === 1 ? 1 : (p.mvt === 2 ? -1 : 0)
        };
      });

      state.managers = ((ranking && ranking.us) || []).map(function(u){
        var isMe = state.myUserId && String(u.i) === state.myUserId;
        return { id: String(u.i), name: u.n || "Manager", isMe: isMe, points: u.sp || 0 };
      });

      state.nextKickoff = null;
      var season = perf && perf.it && perf.it[0];
      ((season && season.it) || []).forEach(function(d){
        var t = d.md ? Date.parse(d.md) : null;
        if (t && t > Date.now() && (state.nextKickoff == null || t < state.nextKickoff)) state.nextKickoff = t;
      });

      var sub = [cpiLabel(cpi).replace('BL', 'Bundesliga')];
      if (state.overview && state.overview.mgc) sub.push(state.overview.mgc + ' Manager');
      if (state.matchday) sub.push('Spieltag ' + state.matchday);
      if (state.nextKickoff) sub.push('Anpfiff ' + dateFmt.format(new Date(state.nextKickoff)));
      els.pageSub.textContent = sub.filter(Boolean).join(' · ');

      state.loading = false;
      els.refreshBtn.classList.remove('spin');
      render();
      loadForms();
      loadOpponents();
    }).catch(function(err){
      state.loading = false;
      els.refreshBtn.classList.remove('spin');
      showError(err, loadLeague);
    });
  }

  els.refreshBtn.addEventListener('click', function(){
    if (state.loading) return;
    state.estimates = null; state.estError = false; state.managerSquads = {};
    loadLeague();
  });

  // ---------- Ansichten ----------
  // Desktop zeigt standardmaessig die Uebersicht (Kader, Markt, Bietkraft
  // nebeneinander), das Handy einzelne Tabs.
  function currentTab(){
    var t = state.tab || (DESKTOP.matches ? 'overview' : 'kader');
    if (t === 'overview' && !DESKTOP.matches) t = 'kader';
    return t;
  }
  function markTabs(){
    var t = currentTab();
    each('[data-tab]', function(b){ b.classList.toggle('on', b.getAttribute('data-tab') === t); });
  }
  function setTab(tab){
    state.tab = tab;
    markTabs();
    render();
    window.scrollTo(0, 0);
  }
  each('[data-tab]', function(b){
    b.addEventListener('click', function(){ setTab(b.getAttribute('data-tab')); });
  });
  if (DESKTOP.addEventListener) DESKTOP.addEventListener('change', function(){ markTabs(); render(); });

  function render(){
    if (!state.league || state.loading && !state.players.length) return;
    renderSummary();
    var t = currentTab();
    if ((t === 'gegner' || t === 'overview') && !state.estimates && !state.estLoading && !state.estError) loadEstimates();
    var html;
    if (t === 'overview') html = '<div class="cols">' + squadPanel(true) + marketPanel(true) + managersPanel(true) + '</div>';
    else if (t === 'markt') html = marketPanel(false);
    else if (t === 'gegner') html = '<div class="cols">' + managersPanel(false) + historyPanel() + '</div>';
    else html = squadPanel(false);
    els.body.innerHTML = html;
    bindBody();
  }

  // ---------- Kennzahlen ----------
  function plan(){
    var sold = 0, keptValue = 0, kept = [];
    state.players.forEach(function(p){
      if (state.sell[p.id]) sold += p.mv; else { keptValue += p.mv; kept.push(p); }
    });
    var bids = 0, bought = [];
    state.market.forEach(function(p){
      if (state.bids[p.id] != null){ bids += state.bids[p.id]; bought.push(p); }
    });
    // Verkaeufe an Kickbase sind sofort gebucht; Gebote zaehlen als offen.
    var room = C.bidRoom(keptValue, state.budget + sold, bids);
    return {
      sold: sold, bids: bids, after: state.budget + sold - bids, room: room,
      squadSize: kept.length + bought.length, kept: kept, bought: bought
    };
  }

  function renderSummary(){
    var p = plan(), limit = state.overview && state.overview.mppu, clubLimit = state.overview && state.overview.mpst;
    els.sumBudget.textContent = fmtMoney(state.budget);
    els.sumBudget.className = 'big' + negCls(state.budget);
    els.sumAfter.textContent = short(p.after);
    els.sumAfter.className = 'val' + negCls(p.after);
    els.sumRoom.textContent = short(p.room.headroom);
    els.sumRoom.className = 'val ' + (p.room.headroom < 0 ? 'neg' : 'acc');
    els.sumSquad.textContent = p.squadSize + (limit ? ' / ' + limit : '');

    var planned = [];
    if (p.sold) planned.push('Verkauf +' + short(p.sold));
    if (p.bids) planned.push('Gebote ' + short(p.bids));
    els.sumAfterCap.textContent = planned.join(' · ') || 'nichts eingeplant';
    els.sumRoomCap.textContent = 'Grenze ' + short(p.room.maxNegative);
    els.sumSquadCap.textContent = clubLimit ? 'max. ' + clubLimit + ' pro Verein' : '';
    els.meterLeft.textContent = planned.length ? planned.join(' · ') + ' eingeplant' : 'Spielraum bis zur Minus-Grenze';
    els.meterRight.textContent = 'Grenze ' + short(p.room.maxNegative);

    // Balken: Anteil des Spielraums an der gesamten Bietkapazitaet
    var capacity = p.room.headroom + p.bids;
    var share = capacity > 0 ? Math.max(0, Math.min(1, p.room.headroom / capacity)) : 0;
    each('.meter-fill', function(f){
      f.style.width = (p.room.headroom < 0 ? 100 : Math.round(share * 100)) + '%';
      f.classList.toggle('neg', p.room.headroom < 0);
    });

    var alerts = [];
    if (p.room.headroom < 0) alerts.push(['', 'Über der 33%-Grenze um ' + short(-p.room.headroom) + '. Kickbase lehnt weitere Gebote ab.']);
    if (p.after < 0) alerts.push(['soft', 'Nach Plan im Minus. Steht der Kontostand bei Anpfiff unter null, gibt es 0 Punkte für den Spieltag.']);
    if (limit && p.squadSize > limit) alerts.push(['', 'Kaderlimit ' + limit + ' überschritten (' + p.squadSize + ' Spieler).']);
    if (p.squadSize < 11) alerts.push(['soft', 'Nur ' + p.squadSize + ' Spieler. Jeder leere Aufstellungsplatz kostet 100 Punkte.']);
    if (clubLimit){
      var byClub = {};
      p.kept.concat(p.bought).forEach(function(x){ if (x.tid) byClub[x.tid] = (byClub[x.tid] || 0) + 1; });
      Object.keys(byClub).forEach(function(tid){
        if (byClub[tid] > clubLimit) alerts.push(['', (state.clubNames[tid] || 'Verein ' + tid) + ': ' + byClub[tid] + ' Spieler, erlaubt sind ' + clubLimit + '.']);
      });
    }
    els.alerts.innerHTML = alerts.map(function(a){ return '<p class="alert ' + a[0] + '">' + escapeHtml(a[1]) + '</p>'; }).join('');
  }

  // ---------- Kader ----------
  function squadRow(p, compact, withPoints){
    if (p.bought){
      // Vorgemerkter Kauf: kommt bei Erfolg dazu, laesst sich nur als Gebot zuruecknehmen
      return '<div class="row' + (compact ? '' : ' np') + '"' + playerAttr(p) + '>' + (compact ? '<span class="pos">' + p.pos + '</span>' : '') +
        '<div class="main"><div class="name">' + escapeHtml(p.name) + '</div><div class="sub num">Gebot ' + short(state.bids[p.id]) + (p.ap != null ? ' · Ø ' + p.ap : '') + '</div></div>' +
        '<div class="fig num"><div class="v">' + short(p.mv) + '</div></div>' +
        '<button type="button" class="btn on" data-buy="' + p.id + '">Gemerkt</button></div>';
    }
    var sold = !!state.sell[p.id];
    var sub = [];
    if (withPoints && (p.ap != null || formOf(p))) sub.push('≈ ' + Math.round(expected(p)) + ' P');
    if (p.gain != null) sub.push('<span class="' + signCls(p.gain) + '">' + delta(p.gain) + ' seit Kauf</span>');
    var c = consOf(p);
    if (p.ap != null) sub.push('Ø ' + p.ap + (c && c.label ? ' ' + c.label : ''));
    var f = formOf(p);
    if (f && f.recentDays) sub.push(f.recentStarts + '/' + f.recentDays + ' Startelf');
    var fxh = fixtureHtml(p);
    if (fxh) sub.push(fxh);
    if (p.offers) sub.push(p.offers + ' Angebot' + (p.offers > 1 ? 'e' : ''));
    if (p.day != null) sub.push('<span class="' + signCls(p.day) + '">24h ' + delta(p.day) + '</span>');
    return '<div class="row' + (sold ? ' on sold' : '') + (compact ? '' : ' np') + '"' + playerAttr(p) + '>' +
      (compact ? '<span class="pos">' + p.pos + '</span>' : '') +
      '<div class="main"><div class="name">' + escapeHtml(p.name) + (p.status ? '<span class="dot" title="Status beachten"></span>' : '') + '</div>' +
        '<div class="sub num">' + sub.join(' · ') + '</div></div>' +
      '<div class="fig num"><div class="v">' + short(p.mv) + '</div></div>' +
      '<button type="button" class="btn' + (sold ? ' on' : '') + '" data-sell="' + p.id + '">' + (sold ? 'Verkauft' : 'Verkaufen') + '</button>' +
    '</div>';
  }

  // ---------- Aufstellung ----------
  // Reine Planung: aendert nichts in Kickbase. Wer nicht auf dem Feld steht, sitzt
  // auf der Bank und kann dort mit einem Tipp zum Verkauf vorgemerkt werden.
  var FORMATIONS = ['3-4-3', '3-5-2', '3-6-1', '4-2-4', '4-3-3', '4-4-2', '4-5-1', '5-2-3', '5-3-2', '5-4-1'];
  var LINE_ORDER = ['ANG', 'MF', 'ABW', 'TW'];   // von oben (Sturm) nach unten (Tor)
  var kaderView = 'pitch';
  try { kaderView = localStorage.getItem('kp_kader_view') || 'pitch'; } catch(e){}

  function formationCounts(f){
    var n = f.split('-').map(Number);
    return {TW: 1, ABW: n[0], MF: n[1], ANG: n[2]};
  }
  // Erwartete Punkte pro Spieltag: Punkteschnitt, Form der letzten 5 Spieltage,
  // Einsatzquote und Verfuegbarkeit (siehe KBCalc.expectedPoints)
  function formOf(p){ return state.forms ? state.forms[p.id] : null; }
  function consOf(p){ var f = formOf(p); return f && f.cons ? f.cons : null; }
  function expected(p){
    var fx = fixtureOf(p);
    return C.expectedPoints({ap: p.ap, status: p.status, form: formOf(p), fixture: fx ? fx.factor : 1});
  }
  function calcEntry(p){
    // trend: Marktwertaenderung der letzten 24 h (eigener Kader), cons: Konstanz - beides fuer Gleichstaende
    var fx = fixtureOf(p), c = consOf(p);
    return {id: p.id, pos: p.pos, mv: p.mv, ap: p.ap, status: p.status, form: formOf(p), trend: p.day || 0,
      fixture: fx ? fx.factor : 1, cons: c && c.n >= 5 ? c.share : null};
  }

  // ---------- Gegner der naechsten Spiele ----------
  // Zeitraum: naechstes Spiel oder naechste 3 (gewichtet 50/30/20)
  var horizon = 3;
  try { horizon = +localStorage.getItem('kp_horizon') === 1 ? 1 : 3; } catch(e){}
  var POS_NUM = {TW: 1, ABW: 2, MF: 3, ANG: 4};
  var fixCache = {};
  function fixtureOf(p){
    var m = state.opp;
    if (!m || !state.league || m.league !== state.league.i || !p.tid || !POS_NUM[p.pos]) return null;
    if (fixCache[p.id] === undefined) fixCache[p.id] = KBData.fixturesFor(m, POS_NUM[p.pos], p.tid, horizon);
    return fixCache[p.id];
  }
  function loadOpponents(){
    var l = state.league;
    if (!state.kbTeams.length) return;
    state.oppLoading = true;
    KBData.fetchOpponentModel(client, l.cpi || 1, state.kbTeams).then(function(m){
      if (state.league !== l) return;
      m.league = l.i;
      state.opp = m; state.oppLoading = false; fixCache = {};
      adviceCache = {key: null, value: null};
      render();
    }).catch(function(){
      if (state.league !== l) return;
      state.oppLoading = false;
      render();
    });
  }
  function clubAbbr(tid){
    var n = state.clubNames[tid] || '';
    return n.replace(/[^A-Za-zÄÖÜäöüß]/g, '').slice(0, 3).toUpperCase() || '?';
  }
  // "vs Kiel (A) · schwer" bzw. "vs KIE, HER, FÜR · leicht"
  function fixtureHtml(p){
    var fx = fixtureOf(p);
    if (!fx || !fx.games.length) return '';
    var g = fx.games[0];
    var txt = horizon === 1
      ? 'vs ' + escapeHtml(state.clubNames[g.opp] || clubAbbr(g.opp)) + ' (' + (g.home ? 'H' : 'A') + ')'
      : 'vs ' + fx.games.map(function(x){ return escapeHtml(clubAbbr(x.opp)); }).join(', ');
    var word = fx.factor >= 1.1 ? 'leicht' : (fx.factor <= 0.9 ? 'schwer' : '');
    return '<span class="' + (word === 'leicht' ? 'up' : (word ? 'neg' : '')) + '">' + txt + (word ? ' · ' + word : '') + '</span>';
  }
  function horizonHtml(){
    if (!state.opp || state.opp.league !== (state.league && state.league.i)){
      return state.oppLoading ? '<p class="horizon-note">Gegner der nächsten Spiele werden geladen (beim ersten Mal etwa eine Minute) …</p>' : '';
    }
    return '<div class="seg sm" role="group" aria-label="Zeitraum für erwartete Punkte">' +
      '<button type="button" data-horizon="1" class="' + (horizon === 1 ? 'on' : '') + '">Nächstes Spiel</button>' +
      '<button type="button" data-horizon="3" class="' + (horizon === 3 ? 'on' : '') + '">Nächste 3 Spiele</button></div>';
  }

  function loadForms(){
    var l = state.league;
    var ids = state.players.map(function(p){ return p.id; }).concat(state.market.map(function(m){ return m.id; }));
    if (!ids.length) return;
    KBData.fetchForms(client, l.cpi || 1, ids).then(function(forms){
      if (state.league !== l) return;
      state.forms = forms;
      // Die "Beste Elf" haengt jetzt von Form und Einsatzquote ab: Empfehlung neu rechnen
      adviceCache = {key: null, value: null};
      render();
    }).catch(function(){});
  }

  // Alle Spieler, die nach Plan im Kader stehen koennen: eigener Kader plus vorgemerkte Kaeufe
  function lineupPool(){
    var bought = state.market.filter(function(m){ return state.bids[m.id] != null; }).map(function(m){
      return {id: m.id, name: m.name, pos: m.pos, mv: m.mv, ap: m.ap, status: m.status, tid: m.tid, bought: true};
    });
    return state.players.concat(bought);
  }
  function playerById(id){ return lineupPool().filter(function(p){ return p.id === id; })[0] || null; }
  function emptySlots(f){
    var c = formationCounts(f), s = {};
    POS_ORDER.forEach(function(pos){ s[pos] = new Array(c[pos]).fill(null); });
    return s;
  }
  function placedIds(){
    var ids = {};
    if (!state.lineup) return ids;
    POS_ORDER.forEach(function(pos){ state.lineup.slots[pos].forEach(function(id){ if (id) ids[id] = true; }); });
    return ids;
  }
  // Spieler in die Plaetze einer Formation verteilen; was nicht passt, geht auf die Bank.
  function buildLineup(f, ids){
    var slots = emptySlots(f), used = {};
    ids.forEach(function(id){
      var p = playerById(id);
      if (!p || used[id] || state.sell[id] || !slots[p.pos]) return;
      var free = slots[p.pos].indexOf(null);
      if (free >= 0){ slots[p.pos][free] = id; used[id] = true; }
    });
    return {formation: f, slots: slots};
  }
  function bestIds(){
    return lineupPool().filter(function(p){ return !state.sell[p.id]; })
      .sort(function(a, b){ return expected(b) - expected(a) || b.mv - a.mv; })
      .map(function(p){ return p.id; });
  }
  // Aktuelle Kickbase-Aufstellung (Feld lo, 0 = Torwart) und ihre Kennung
  function kickbaseLineup(){
    var current = state.players.filter(function(p){ return p.lo != null; }).sort(function(a, b){ return a.lo - b.lo; });
    var c = {TW: 0, ABW: 0, MF: 0, ANG: 0};
    current.forEach(function(p){ if (c[p.pos] != null) c[p.pos]++; });
    var f = c.ABW + '-' + c.MF + '-' + c.ANG;
    var ok = current.length === 11 && c.TW === 1 && FORMATIONS.indexOf(f) >= 0;
    return { ok: ok, formation: f, ids: current.map(function(p){ return p.id; }), sig: current.map(function(p){ return p.id; }).join(',') };
  }
  function saveLineup(){
    if (demo || !state.league || !state.lineup) return;
    var data = {formation: state.lineup.formation, slots: state.lineup.slots, kb: kickbaseLineup().sig};
    try { localStorage.setItem('kp_lineup_' + state.league.i, JSON.stringify(data)); } catch(e){}
  }
  function useKickbaseLineup(){
    var kb = kickbaseLineup();
    state.lineup = kb.ok ? buildLineup(kb.formation, kb.ids) : buildLineup('4-4-2', bestIds());
  }
  function initLineup(){
    var stored = null;
    if (!demo){ try { stored = JSON.parse(localStorage.getItem('kp_lineup_' + state.league.i) || 'null'); } catch(e){} }
    // Eigene Planung gilt nur, solange sich die Aufstellung in Kickbase nicht geaendert hat
    if (stored && FORMATIONS.indexOf(stored.formation) >= 0 && stored.kb === kickbaseLineup().sig){
      var ids = [];
      POS_ORDER.forEach(function(pos){ (stored.slots[pos] || []).forEach(function(id){ if (id) ids.push(id); }); });
      state.lineup = buildLineup(stored.formation, ids);
      // Verkaufsmarken ueberleben keinen Neustart: alte Luecken zuerst mit der
      // Kickbase-Elf, dann mit den besten Bankspielern fuellen
      fillHoles(kickbaseLineup().ids.concat(bestIds()));
      return;
    }
    useKickbaseLineup();
  }
  function fillHoles(ids){
    var placed = placedIds(), filled = [];
    ids.forEach(function(id){
      var p = playerById(id), slots = p && state.lineup.slots[p.pos];
      if (!slots || placed[id] || state.sell[id]) return;
      var free = slots.indexOf(null);
      if (free < 0) return;
      slots[free] = id; placed[id] = true; filled.push(p);
    });
    return filled;
  }
  function setFormation(f){
    var ids = [];
    LINE_ORDER.slice().reverse().forEach(function(pos){ state.lineup.slots[pos].forEach(function(id){ if (id) ids.push(id); }); });
    // Bisherige Elf behalten, neu entstandene Luecken mit den besten Bankspielern fuellen
    state.lineup = buildLineup(f, ids.concat(bestIds()));
    saveLineup();
  }
  function assignSlot(pos, i, id){
    var slots = state.lineup.slots, prev = slots[pos][i];
    // Steht der Spieler schon auf einem anderen Platz, tauschen die beiden
    POS_ORDER.forEach(function(ps){
      slots[ps].forEach(function(x, j){ if (x === id && !(ps === pos && j === i)) slots[ps][j] = prev; });
    });
    slots[pos][i] = id;
    saveLineup();
  }

  function lineupHtml(compact){
    var lu = state.lineup, placed = placedIds();
    var html = '<div class="formations" role="group" aria-label="Formation">' + FORMATIONS.map(function(f){
      return '<button type="button" class="chip' + (f === lu.formation ? ' on' : '') + '" data-formation="' + f + '">' + f + '</button>';
    }).join('') + '</div>';

    if (state.lineupNote) html += '<p class="lineup-note">' + escapeHtml(state.lineupNote) + '</p>';

    var count = 0, points = 0, value = 0, missing = {};
    html += '<div class="pitch">' + LINE_ORDER.map(function(pos){
      return '<div class="line">' + lu.slots[pos].map(function(id, i){
        var p = id && playerById(id), key = pos + ':' + i, picked = state.pick === key ? ' picked' : '';
        if (!p){
          missing[pos] = (missing[pos] || 0) + 1;
          return '<button type="button" class="slot open missing' + picked + '" data-slot="' + key + '" aria-label="' + POS_LABEL[pos] + ' wählen"><span class="av">+</span><span class="sn">fehlt</span><span class="sv">' + pos + '</span></button>';
        }
        var e = expected(p);
        count++; points += e; value += p.mv;
        return '<button type="button" class="slot' + picked + '" data-slot="' + key + '"><span class="av num" title="erwartete Punkte pro Spieltag">' + (p.ap != null || formOf(p) ? Math.round(e) : '–') + '</span>' +
          '<span class="sn">' + escapeHtml(p.name) + '</span><span class="sv num">' + short(p.mv) + '</span></button>';
      }).join('') + '</div>';
    }).join('') + '</div>';

    if (state.pick) html += pickerHtml();

    html += '<div class="pitch-meta num"><span>' + count + ' / 11 · ≈ ' + Math.round(points).toLocaleString('de-DE') + ' P/Spieltag · ' + short(value) + '</span>' +
      '<span class="pitch-actions"><button type="button" class="text-btn" id="lineupKb">Aus Kickbase</button>' +
      '<button type="button" class="text-btn" id="lineupAuto">Beste Elf</button></span></div>';
    if (!state.pick) html += needHtml(missing, placed);

    // Darunter alle Spieler wie in der Liste: erst die Elf (Reihenfolge wie auf dem Feld), dann die Bank
    var field = [];
    POS_ORDER.forEach(function(pos){ lu.slots[pos].forEach(function(id){ var p = id && playerById(id); if (p) field.push(p); }); });
    html += '<div class="bench-head num"><span><b>Aufgestellt</b> · ' + field.length + ' Spieler · ' + short(value) + '</span></div>';
    html += groupedRows(field, compact);

    var bench = lineupPool().filter(function(p){ return !placed[p.id]; }).sort(function(a, b){ return b.mv - a.mv; });
    var own = bench.filter(function(p){ return !p.bought; });
    var benchValue = own.reduce(function(s, p){ return s + p.mv; }, 0);
    var allSold = own.length && own.every(function(p){ return state.sell[p.id]; });
    html += '<div class="bench-head num"><span><b>Bank</b> · ' + bench.length + ' Spieler · ' + short(benchValue) + '</span>' +
      (own.length ? '<button type="button" class="btn' + (allSold ? ' on' : '') + '" id="benchSell">' + (allSold ? 'Alle zurück' : 'Alle verkaufen') + '</button>' : '') + '</div>';
    if (!bench.length) html += '<p class="pitch-hint">Alle Spieler stehen auf dem Feld.</p>';
    html += groupedRows(bench, compact);
    return html;
  }
  function groupedRows(list, compact){
    var html = '';
    POS_ORDER.forEach(function(pos){
      var items = list.filter(function(p){ return p.pos === pos; });
      if (!items.length) return;
      var sum = items.reduce(function(s, p){ return s + p.mv; }, 0);
      html += '<div class="group num"><span>' + POS_LABEL[pos] + '</span><span>' + items.length + ' · ' + short(sum) + '</span></div>';
      items.forEach(function(p){ html += squadRow(p, compact, true); });
    });
    return html;
  }

  // Auswahl direkt unter dem Feld: Platz antippen, dann passenden Spieler waehlen
  function pickerHtml(){
    var s = state.pick.split(':'), pos = s[0], i = +s[1];
    var current = state.lineup.slots[pos][i], placed = placedIds();
    var list = lineupPool().filter(function(p){ return p.pos === pos && !state.sell[p.id] && p.id !== current; })
      .sort(function(a, b){ return expected(b) - expected(a); });
    var cur = current && playerById(current);
    var html = '<div class="picker"><div class="picker-head"><b>' + (cur ? escapeHtml(cur.name) + ' ersetzen' : POS_LABEL[pos] + ' wählen') + '</b>' +
      '<button type="button" class="text-btn" id="pickCancel">Schließen</button></div>';
    list.forEach(function(p){
      var f = formOf(p), info = ['≈ ' + Math.round(expected(p)) + ' P'];
      if (f && f.recentDays) info.push(f.recentStarts + '/' + f.recentDays + ' Startelf');
      var fxh = fixtureHtml(p);
      if (fxh) info.push(fxh);
      info.push(placed[p.id] ? 'auf dem Feld' : (p.bought ? 'Gebot' : 'Bank'));
      html += '<div class="row"><span class="pos">' + p.pos + '</span>' +
        '<div class="main"><div class="name">' + escapeHtml(p.name) + (p.status ? '<span class="dot"></span>' : '') + '</div><div class="sub num">' + info.join(' · ') + '</div></div>' +
        '<div class="fig num"><div class="v">' + short(p.mv) + '</div></div>' +
        '<button type="button" class="btn" data-assign="' + p.id + '">' + (placed[p.id] ? 'Tauschen' : 'Einwechseln') + '</button></div>';
    });
    if (!list.length) html += '<p class="picker-note">Kein weiterer ' + POS_LABEL[pos] + ' im Kader. Unten im Markt findest du passende Spieler.</p>';
    if (current) html += '<div class="picker-foot"><button type="button" class="text-btn" id="slotClear">Platz leeren</button></div>';
    return html + '</div>';
  }

  // Leere Plaetze ohne Ersatz im Kader: was fehlt, und die besten passenden Marktspieler
  function needHtml(missing, placed){
    var positions = POS_ORDER.filter(function(pos){ return missing[pos]; });
    if (!positions.length) return '';
    var label = positions.map(function(pos){ return missing[pos] + ' × ' + POS_LABEL[pos]; }).join(', ');
    var html = '<div class="need"><p class="need-title">Es fehlt: ' + label + '</p>' +
      '<p class="need-sub">Jeder leere Platz kostet 100 Punkte. Tippe auf einen leeren Platz, um jemanden aus deinem Kader einzusetzen.</p>';
    positions.forEach(function(pos){
      var bench = lineupPool().filter(function(p){ return p.pos === pos && !state.sell[p.id] && !placed[p.id]; });
      if (bench.length) return;   // Ersatz ist da, nur noch nicht eingesetzt
      var offers = state.market.filter(function(m){ return m.pos === pos && state.bids[m.id] == null; })
        .sort(function(a, b){ return expected(b) - expected(a) || a.price - b.price; }).slice(0, 3);
      if (!offers.length) return;
      html += '<div class="subhead"><h3>' + POS_LABEL[pos] + ' im Markt</h3><span>nach erwarteten Punkten</span></div>';
      offers.forEach(function(m){ html += marketRow(m, true); });
    });
    return html + '</div>';
  }

  // ---------- Empfehlung: ins Plus kommen ----------
  var adviceCache = {key: null, value: null};
  function salesAdvice(){
    var p = plan();
    if (p.after >= 0) return null;
    var sellable = state.players.filter(function(x){ return !state.sell[x.id]; });
    var key = state.league.i + '|' + p.after + '|' + sellable.map(function(x){ return x.id; }).join(',') + '|' + p.bought.map(function(x){ return x.id; }).join(',') + '|' + !!state.forms + '|' + horizon + '|' + (state.opp ? state.opp.at : 0);
    if (adviceCache.key !== key){
      var entry = calcEntry;
      // Vorgemerkte Kaeufe kommen bei Erfolg in den Kader und zaehlen fuer die Elf mit
      adviceCache = {key: key, value: C.recommendSales(sellable.map(entry), -p.after, {fixed: p.bought.map(entry)})};
    }
    return adviceCache.value;
  }

  function adviceHtml(){
    var a = salesAdvice();
    if (!a) return '';
    var p = plan();
    var html = '<div class="advice"><div class="advice-head"><b>Ins Plus kommen</b><span class="num">es fehlen ' + short(-p.after) + '</span></div>';
    if (!a.possible){
      return html + '<p class="advice-note">Selbst der Verkauf des ganzen Kaders reicht nicht. Gebote zurücknehmen hilft.</p></div>';
    }
    [['points', 'Punkte schonen'], ['fewest', 'Wenige Verkäufe']].forEach(function(o){
      var r = a[o[0]];
      if (!r) return;
      var names = r.ids.map(function(id){ var x = playerById(id); return x ? escapeHtml(x.name) : ''; }).join(', ');
      var loss = Math.round(r.loss);
      html += '<div class="advice-opt"><div class="main">' +
        '<div class="advice-title">' + o[1] + '</div>' +
        '<div class="advice-names">' + names + '</div>' +
        '<div class="advice-meta num">+' + short(r.money) + ' · danach ' + short(p.after + r.money) + ' · ' +
          (loss <= 0 ? '<span class="up">kein Punkteverlust</span>' : '<span class="neg">−' + loss + ' P/Spieltag</span>') +
          ' · ' + r.formation + '</div></div>' +
        '<button type="button" class="btn" data-advice="' + o[0] + '">Übernehmen</button></div>';
    });
    return html + '<p class="advice-note">Erwartete Punkte aus Punkteschnitt, Form und Einsatzquote der letzten 5 Spieltage, angepasst an die Gegner der ' + (horizon === 1 ? 'nächsten Partie' : 'nächsten 3 Spiele') + ' (Teamstärke und wie viele Punkte der Gegner auf der Position zulässt). Bei Gleichstand gehen schwankende Spieler und fallende Marktwerte zuerst. Ausfälle mit Abschlag (angeschlagen 90 %, verletzt 40 %). Verkauf an Kickbase zum Marktwert. Spieler ohne Punkteschnitt (z. B. Neuzugänge) zählen mit 0.</p></div>';
  }

  function applyAdvice(kind){
    var a = salesAdvice(), r = a && a[kind];
    if (!r) return;
    var names = r.ids.map(function(id){ var p = playerById(id); return p ? p.name : ''; }).filter(Boolean);
    r.ids.forEach(function(id){ state.sell[id] = true; });
    state.lineup = buildLineup(r.formation, bestIds());
    state.pick = null;
    var empty = emptyCount(state.lineup);
    state.lineupNote = names.join(', ') + ' zum Verkauf vorgemerkt. Neue Elf: ' + r.formation +
      (empty ? ', ' + empty + ' Platz' + (empty > 1 ? 'e' : '') + ' bleibt leer.' : ', alle Plätze besetzt.');
    saveLineup();
  }

  // ---------- Empfehlung: kaufen ----------
  var buyCache = {key: null, value: null};
  function buyAdvice(){
    if (!state.market.length || !state.league) return null;
    var p = plan(), ov = state.overview || {};
    var free = state.market.filter(function(m){ return state.bids[m.id] == null; });
    var key = state.league.i + '|' + p.after + '|' + p.kept.map(function(x){ return x.id; }).join(',') + '|' + p.bought.map(function(x){ return x.id; }).join(',') + '|' +
      free.map(function(m){ return m.id + ':' + m.price; }).join(',') + '|' + !!state.forms + '|' + horizon + '|' + (state.opp ? state.opp.at : 0);
    if (buyCache.key !== key){
      var clubs = {};
      p.kept.concat(p.bought).forEach(function(x){ if (x.tid != null) clubs[x.tid] = (clubs[x.tid] || 0) + 1; });
      var keptValue = p.kept.reduce(function(s, x){ return s + x.mv; }, 0);
      var cand = free.map(function(m){ var e = calcEntry(m); e.price = m.price; e.tid = m.tid; e.trend = m.mvt || 0; return e; });
      buyCache = {key: key, value: C.recommendBuys(p.kept.map(calcEntry), p.bought.map(calcEntry), cand, {
        after: p.after, teamValue: keptValue, squadLimit: ov.mppu, clubLimit: ov.mpst, clubCounts: clubs
      })};
    }
    return buyCache.value;
  }
  function marketById(id){ return state.market.filter(function(m){ return m.id === id; })[0] || null; }

  function buyHtml(){
    var a = buyAdvice();
    if (!a) return '';
    var html = '<div class="advice"><div class="advice-head"><b>Kaufen lohnt sich</b><span class="num mut">' + (horizon === 1 ? 'nächstes Spiel' : 'nächste 3 Spiele') + '</span></div>';
    if (!a.list.length) return html + '<p class="advice-note">Gerade verbessert kein Marktspieler deine beste Elf genug, auch nicht mit Verkauf.</p></div>';
    a.list.slice(0, 3).forEach(function(r){
      var m = marketById(r.id);
      if (!m) return;
      var meta = ['<span class="up">+' + Math.round(r.net) + ' P/Spieltag</span>', short(r.price)];
      var fx = fixtureHtml(m);
      if (fx) meta.push(fx);
      if (!r.ok) meta.push('<span class="neg">über der 33%-Grenze</span>');
      var sells = r.sells.map(function(id){ var x = playerById(id); return x ? escapeHtml(x.name) : ''; }).filter(Boolean);
      html += '<div class="advice-opt"><div class="main">' +
        '<div class="advice-title">' + POS_LABEL[m.pos] + (m.by ? ' · Angebot von ' + escapeHtml(m.by) : '') + '</div>' +
        '<div class="advice-names">' + escapeHtml(m.name) + '</div>' +
        '<div class="advice-meta num">' + meta.join(' · ') + '</div>' +
        (sells.length ? '<div class="advice-meta num">dafür verkaufen: ' + sells.join(', ') + ' (+' + short(r.money) + (plan().after < 0 ? ', deckt auch das jetzige Minus' : '') + ')</div>' : '') +
        '</div><button type="button" class="btn" data-buyadvice="' + r.id + '">Vormerken</button></div>';
    });
    return html + '<p class="advice-note">Dieselben erwarteten Punkte wie bei den Verkäufen: Form, Einsatzchance, Ausfälle und Gegner. Gerechnet mit dem Angebotspreis; wie hoch du über dem Marktwert bieten musst, hängt von den Mitbietern ab (Bietkraft im Gegner-Tab).</p></div>';
  }

  function applyBuy(id){
    var a = buyAdvice(), r = a && a.list.filter(function(x){ return x.id === id; })[0], m = marketById(id);
    if (!r || !m) return;
    state.bids[id] = m.price;
    r.sells.forEach(function(sid){ state.sell[sid] = true; });
    // Die Empfehlung rechnet mit der besten Elf, also auch so aufstellen
    var pool = lineupPool().filter(function(x){ return !state.sell[x.id]; }).map(calcEntry);
    state.lineup = buildLineup(C.bestEleven(pool).formation || state.lineup.formation, bestIds());
    state.pick = null;
    var sold = r.sells.map(function(sid){ var x = playerById(sid); return x ? x.name : ''; }).filter(Boolean);
    state.lineupNote = m.name + ' vorgemerkt (Gebot ' + short(m.price) + ')' + (sold.length ? ', dafür ' + sold.join(', ') + ' zum Verkauf' : '') +
      '. Neue Elf: ' + state.lineup.formation + '.';
    saveLineup();
  }

  function squadPanel(compact){
    var total = state.players.reduce(function(s, p){ return s + p.mv; }, 0);
    var html = '<section class="panel"><div class="panel-head"><h2>Kader</h2><span class="num">' +
      (compact ? short(total) : (state.nextKickoff ? 'Anpfiff ' + dateFmt.format(new Date(state.nextKickoff)) : short(total))) + '</span></div>';
    if (!state.players.length) return html + '<div class="empty">Keine Spieler im Kader.</div></section>';
    html += '<div class="seg" role="group" aria-label="Ansicht"><button type="button" data-kview="pitch" class="' + (kaderView === 'pitch' ? 'on' : '') + '">Aufstellung</button>' +
      '<button type="button" data-kview="list" class="' + (kaderView === 'list' ? 'on' : '') + '">Liste</button></div>';
    html += horizonHtml();
    html += adviceHtml();
    var best = !compact && buyAdvice(), top = best && best.list[0] && marketById(best.list[0].id);
    if (top) html += '<button type="button" class="buy-hint" data-goto="markt"><span>Kauftipp: <b>' + escapeHtml(top.name) + '</b> · <span class="up">+' + Math.round(best.list[0].net) + ' P/Spieltag</span></span><span aria-hidden="true">›</span></button>';
    if (kaderView === 'pitch' && state.lineup) return html + lineupHtml(compact) + '</section>';
    POS_ORDER.concat(["–"]).forEach(function(pos){
      var list = state.players.filter(function(p){ return p.pos === pos; });
      if (!list.length) return;
      list.sort(function(a, b){ return b.mv - a.mv; });
      if (!compact){
        var value = list.reduce(function(s, p){ return s + p.mv; }, 0);
        html += '<div class="group num"><span>' + (POS_LABEL[pos] || 'Weitere') + '</span><span>' + list.length + ' · ' + short(value) + '</span></div>';
      }
      list.forEach(function(p){ html += squadRow(p, compact); });
    });
    return html + '</section>';
  }

  // ---------- Markt ----------
  function remaining(p){
    return p.expires == null ? null : p.expires - Math.round((Date.now() - p.loadedAt) / 1000);
  }

  function marketRow(p, compact){
    var marked = state.bids[p.id] != null;
    var left = remaining(p), sub = [];
    if (p.by){
      var pct = p.mv ? Math.round((p.price / p.mv - 1) * 100) : 0;
      sub.push(escapeHtml(p.by));
      sub.push('<span class="' + (pct > 10 ? 'neg' : '') + '">' + (pct >= 0 ? '+' : '') + pct + ' % zum MW</span>');
    } else {
      sub.push('<span class="' + (left != null && left < URGENT_SEC ? 'urgent' : '') + '">' + countdown(left) + '</span>');
      if (state.nextKickoff && left != null && Date.now() + left * 1000 > state.nextKickoff) sub.push('nach Anpfiff');
    }
    if (p.bids) sub.push(p.bids + ' Gebot' + (p.bids > 1 ? 'e' : ''));
    var ba = !marked && buyAdvice(), g = ba && ba.gains[p.id];
    if (g >= 0.5) sub.push('<span class="up">+' + Math.round(g) + ' P Elf</span>');
    var fxm = fixtureHtml(p);
    if (fxm) sub.push(fxm);
    if (!compact && state.clubNames[p.tid]) sub.push(escapeHtml(state.clubNames[p.tid]));
    var html = '<div class="row' + (marked ? ' on' : '') + (compact ? '' : ' np') + '"' + playerAttr(p) + '>' +
      (compact ? '<span class="pos">' + p.pos + '</span>' : '') +
      '<div class="main"><div class="name">' + escapeHtml(p.name) + (p.status ? '<span class="dot" title="Status beachten"></span>' : '') + '</div>' +
        '<div class="sub num">' + sub.join(' · ') + '</div></div>' +
      '<div class="fig num"><div class="v">' + short(p.price) + '</div></div>' +
      '<button type="button" class="btn' + (marked ? ' on' : '') + '" data-buy="' + p.id + '">' + (marked ? 'Gemerkt' : 'Bieten') + '</button>' +
    '</div>';
    if (marked){
      var over = p.mv ? Math.round((state.bids[p.id] / p.mv - 1) * 100) : 0;
      html += '<label class="bidrow num">Dein Gebot <input data-bid="' + p.id + '" inputmode="numeric" value="' + state.bids[p.id].toLocaleString('de-DE') + '"> € · ' + (over >= 0 ? '+' : '') + over + ' %</label>';
    }
    return html;
  }

  function marketPanel(compact){
    var html = '<section class="panel"><div class="panel-head"><h2>Markt</h2><span>läuft zuerst ab</span></div>';
    if (!state.market.length) return html + '<div class="empty">Gerade steht niemand auf dem Transfermarkt.</div></section>';
    html += buyHtml();
    var free = state.market.filter(function(p){ return !p.by; });
    var offers = state.market.filter(function(p){ return p.by; });
    free.sort(function(a, b){ return (a.expires || 0) - (b.expires || 0); });
    offers.sort(function(a, b){ return (a.price / a.mv) - (b.price / b.mv); });
    free.forEach(function(p){ html += marketRow(p, compact); });
    if (offers.length){
      html += '<div class="subhead"><h3>Von Managern</h3><span>ohne Frist, oft verhandelbar</span></div>';
      offers.forEach(function(p){ html += marketRow(p, compact); });
    }
    return html + '</section>';
  }

  // ---------- Gegner ----------
  function loadEstimates(){
    var l = state.league;
    state.estLoading = true;
    state.estProgress = "";
    KBData.estimateAll({
      client: client, league: l, overview: state.overview,
      managers: state.managers.map(function(m){ return {id: m.id, name: m.name}; }),
      myUserId: state.myUserId, myBudget: state.budget,
      onProgress: function(msg){
        if (state.league !== l) return;
        state.estProgress = msg;
        var el = $('estProgress');
        if (el) el.textContent = msg;
      }
    }).then(function(res){
      if (state.league !== l) return;
      state.estimates = res; state.estLoading = false;
      render();
    }).catch(function(err){
      if (state.league !== l) return;
      state.estLoading = false; state.estError = true;
      if (err && err.auth) return showError(err, loadEstimates);
      render();
    });
  }

  function managerRows(){
    var est = state.estimates;
    return state.managers.map(function(m){
      var e = est && est.byUser[m.id];
      if (!e) return {m: m};
      var lo = m.isMe ? state.budget : e.estimate.low;
      var hi = m.isMe ? state.budget : e.estimate.high;
      var mid = m.isMe ? state.budget : e.estimate.mid;
      var full = e.freeSlots === 0;
      var power = function(b){ return full ? 0 : Math.max(0, C.bidRoom(e.teamValue, b).headroom); };
      return {m: m, e: e, lo: lo, hi: hi, mid: mid, full: full, power: power(mid), powerLo: power(lo), powerHi: power(hi)};
    });
  }

  function managersPanel(compact){
    var est = state.estimates;
    var html = '<section class="panel"><div class="panel-head"><h2>' + (compact ? 'Bietkraft' : 'Wer kann mitbieten?') + '</h2>' +
      '<span>' + (compact && est && est.check ? 'Gegenprobe: ' + short(Math.abs(est.check.diff)) : '') + '</span></div>';
    if (!compact) html += '<p class="panel-intro">Geschätzter Kontostand plus Spielraum bis zur 33%-Grenze. Ohne freien Kaderplatz kein Gebot.</p>';

    if (!est){
      html += state.estError
        ? '<div class="empty">Die Kontostände konnten nicht berechnet werden.<br><button class="text-btn" id="estRetry">Erneut versuchen</button></div>'
        : '<div class="spinner"></div><div class="progress" id="estProgress">' + escapeHtml(state.estProgress || 'Lade Transfers und Spieltage …') + '</div>';
      return html + '</section>';
    }

    if (!compact && est.check){
      var off = Math.abs(est.check.diff);
      html += '<div class="check' + (off > 1e6 ? ' bad' : '') + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        (off > 1e6 ? '<path d="M12 8v5"></path><path d="M12 16h.01"></path>' : '<path d="M20 6 9 17l-5-5"></path>') + '</svg>' +
        '<span>Gegenprobe an deinem Konto: ' + short(off) + ' Abweichung</span>' +
        '<button type="button" class="text-btn" id="calcBtn">' + (state.showCalc ? 'Weniger' : 'Rechnung') + '</button></div>';
      if (state.showCalc){
        html += '<div class="calc"><p>Kickbase zeigt die Kontostände der anderen nicht. Gerechnet wird: Startbudget, alle Käufe und Verkäufe seit Ligastart, MVP-Auto-Verkäufe, ' +
          fmtMoney(est.pointValue) + ' je Saisonpunkt, Erfolgsprämien (Spieltagssiege, Punkteschwellen, starke Spieler, Transfers, Gewinne) und die tägliche Auflaufprämie.</p>' +
          '<p>Die Spanne kommt von der Auflaufprämie: oben bei täglichem Login, unten nur an Tagen mit Transfers.</p>' +
          '<p>Für dich selbst ergibt dieselbe Rechnung ' + fmtMoney(est.check.estimate) + ', dein echter Kontostand ist ' + fmtMoney(est.check.real) + '.</p></div>';
      }
    }

    var rows = managerRows().filter(function(r){ return r.e; });
    var inactive = rows.filter(function(r){ return isInactive(r.m, r.e); }).length;
    if (state.hideInactive) rows = rows.filter(function(r){ return !isInactive(r.m, r.e); });
    rows.sort(function(a, b){ return b.power - a.power || b.mid - a.mid; });
    var max = Math.max.apply(null, rows.map(function(r){ return r.powerHi; }).concat([1]));
    rows.forEach(function(r, i){
      var e = r.e, open = state.openManager === r.m.id;
      var konto = r.m.isMe ? short(r.mid) : (Math.round(r.lo / 1e5) === Math.round(r.hi / 1e5) ? short(r.mid) : short(r.lo) + ' bis ' + short(r.hi));
      var odd = !r.m.isMe && r.hi < C.minReachableBudget(e.teamValue);
      var meta = ['Konto ' + konto];
      if (e.freeSlots != null) meta.push(e.freeSlots + ' frei');
      meta.push('Kader ' + short(e.teamValue));
      if (!compact) meta.push(r.m.points + ' P' + (e.wins ? ' · ' + e.wins + '× Sieg' : ''));
      if (isInactive(r.m, e)) meta.push('inaktiv?');
      html += '<button type="button" class="rank' + (r.full ? ' full' : '') + (r.m.isMe ? ' me' : '') + '" data-mgr="' + r.m.id + '">' +
        '<div class="rank-head"><span class="rank-no num">' + (i + 1) + '</span>' +
          '<span class="rank-name">' + (r.m.isMe ? 'Du' : escapeHtml(r.m.name)) + '</span>' +
          '<span class="rank-power num">' + (r.full ? 'Kader voll' : (r.m.isMe ? '' : '≈ ') + short(r.power)) + '</span></div>' +
        '<div class="rank-bar"><i style="width:' + (r.powerLo / max * 100).toFixed(1) + '%"></i>' +
          (r.powerHi > r.powerLo ? '<s style="left:' + (r.powerLo / max * 100).toFixed(1) + '%;width:' + ((r.powerHi - r.powerLo) / max * 100).toFixed(1) + '%"></s>' : '') + '</div>' +
        '<div class="rank-meta num">' + meta.join(' · ') + '</div>' +
        (odd ? '<div class="rank-meta neg">Unplausibel tief, vermutlich fehlen Daten.</div>' : '') +
        (open ? managerSquadHtml(r.m.id) : '') +
      '</button>';
    });
    if (!compact && inactive) html += '<div class="inact-row"><span>' + inactive + (inactive > 1 ? ' Manager wirken' : ' Manager wirkt') + ' inaktiv (' + INACTIVE_DAYS + ' Tage ohne Transfer, letzter Spieltag ohne Punkte)</span>' +
      '<button type="button" class="text-btn" id="inactBtn">' + (state.hideInactive ? 'Zeigen' : 'Ausblenden') + '</button></div>';
    return html + '</section>';
  }

  // ---------- Verlauf im Gegner-Tab ----------
  // Kontostand ueber die Saison, Transfergewinne und Punkte je Spieltag. Eine Ansicht
  // zur Zeit; die Grafik wird nach dem Einfuegen in der echten Breite gezeichnet.
  var histView = 'konto', histFocus = null;
  try { histView = localStorage.getItem('kp_hist_view') || 'konto'; } catch(e){}
  var INACTIVE_DAYS = 21;

  function isInactive(m, e){
    if (m.isMe || !e) return false;
    var days = state.estimates.days, last = days[days.length - 1];
    var idle = !e.lastTransfer || Date.now() - e.lastTransfer > INACTIVE_DAYS * 86400000;
    return idle && last != null && !e.matchdayPoints[last];
  }

  function visibleManagers(){
    var est = state.estimates;
    return state.managers.filter(function(m){
      var e = est.byUser[m.id];
      return e && !(state.hideInactive && isInactive(m, e));
    });
  }

  function historyPanel(){
    var est = state.estimates;
    if (!est) return '';
    var html = '<section class="panel"><div class="panel-head"><h2>Verlauf</h2><span id="histRead" class="num"></span></div>' +
      '<div class="seg sm">' + [['konto', 'Kontostand'], ['gewinn', 'Transfers'], ['spieltage', 'Spieltage']].map(function(v){
        return '<button type="button" data-hview="' + v[0] + '" class="' + (histView === v[0] ? 'on' : '') + '">' + v[1] + '</button>';
      }).join('') + '</div><div id="histBody" class="hist"></div>';
    return html + '</section>';
  }

  function managerLabel(m){ return m.isMe ? 'Du' : m.name; }

  function drawHistory(){
    var box = $('histBody');
    if (!box || !state.estimates) return;
    var width = Math.max(260, box.clientWidth), list = visibleManagers(), est = state.estimates, read = $('histRead');
    if (read) read.innerHTML = '';
    if (histView === 'konto'){
      if (!histFocus || !list.some(function(m){ return m.id === histFocus; })){
        var me = list.filter(function(m){ return m.isMe; })[0];
        histFocus = (me || list[0] || {}).id;
      }
      var focus = list.filter(function(m){ return m.id === histFocus; })[0];
      var ser = function(m){ return est.byUser[m.id].history.map(function(x){ return {t: x.t, mv: x.v}; }); };
      if (!focus) { box.innerHTML = ''; return; }
      var main = ser(focus), others = list.filter(function(m){ return m !== focus; }).map(ser);
      var opts = {width: width, height: 168, others: others, fmt: short, label: 'Kontostand im Verlauf'};
      box.innerHTML = '<div class="hist-chart">' + KBCharts.line(main, opts) + '</div>' +
        '<div class="hist-chips">' + list.map(function(m){
          return '<button type="button" class="chip' + (m === focus ? ' on' : '') + '" data-hfocus="' + escapeHtml(m.id) + '">' + escapeHtml(managerLabel(m)) + '</button>';
        }).join('') + '</div>' +
        '<p class="hist-note">Transfers und Punkteprämien mit Datum, Erfolge und Auflaufprämie gleichmäßig verteilt. Grau: die anderen Manager.</p>';
      KBCharts.bindLine(box.querySelector('svg'), main, opts, read, function(x){
        return escapeHtml(managerLabel(focus)) + ' · ' + dateLabel(x.t) + ' · <b>' + short(x.mv) + '</b>';
      });
      each('#histBody [data-hfocus]', function(b){
        b.addEventListener('click', function(){ histFocus = b.getAttribute('data-hfocus'); drawHistory(); });
      });
    } else if (histView === 'gewinn'){
      var rows = list.map(function(m){
        var e = est.byUser[m.id], real = e.ledger.profits.reduce(function(a, b){ return a + b; }, 0);
        return {m: m, real: real, open: e.openGain, sales: e.ledger.profits.length};
      }).sort(function(a, b){ return b.real - a.real; });
      var max = Math.max.apply(null, rows.map(function(r){ return Math.abs(r.real); }).concat([1]));
      var hasNeg = rows.some(function(r){ return r.real < 0; }), zero = hasNeg ? 50 : 0, scale = hasNeg ? 50 : 100;
      box.innerHTML = rows.map(function(r){
        var w = Math.abs(r.real) / max * scale, left = r.real < 0 ? zero - w : zero;
        return '<div class="pl-row' + (r.m.isMe ? ' me' : '') + '"><div class="pl-head"><span class="pl-name">' + escapeHtml(managerLabel(r.m)) + '</span>' +
          '<span class="pl-val num ' + signCls(r.real) + '">' + delta(r.real) + '</span></div>' +
          '<div class="pl-bar">' + (hasNeg ? '<em style="left:50%"></em>' : '') +
            '<i class="' + (r.real < 0 ? 'neg' : 'pos') + '" style="left:' + left.toFixed(1) + '%;width:' + w.toFixed(1) + '%"></i></div>' +
          '<div class="pl-meta num">' + r.sales + ' Verkäufe · im Kader <span class="' + signCls(r.open) + '">' + delta(r.open) + '</span></div></div>';
      }).join('') + '<p class="hist-note">Gewinn = Verkaufspreis minus Kaufpreis aller verkauften Spieler seit Ligastart. „Im Kader“: Marktwert minus Kaufpreis der Spieler, die noch da sind.</p>';
    } else {
      var days = est.days;
      if (!days.length){ box.innerHTML = '<p class="hist-note">Noch kein Spieltag abgeschlossen.</p>'; return; }
      var n = Math.max(1, Math.min(days.length, Math.floor((width - 96 - 52) / 40))), shown = days.slice(-n);
      var tot = function(m){ return days.reduce(function(s, d){ return s + (est.byUser[m.id].matchdayPoints[d] || 0); }, 0); };
      var sorted = list.slice().sort(function(a, b){ return tot(b) - tot(a); });
      var colMax = {}, colMin = {};
      shown.forEach(function(d){
        var v = sorted.map(function(m){ return est.byUser[m.id].matchdayPoints[d] || 0; });
        colMax[d] = Math.max.apply(null, v); colMin[d] = Math.min.apply(null, v);
      });
      var html = '<div class="hm-grid" style="grid-template-columns:minmax(0,1fr) repeat(' + n + ', 36px) 48px"><span></span>' +
        shown.map(function(d){ return '<span class="hm-day num">' + d + '.</span>'; }).join('') + '<span class="hm-day num">Σ</span>';
      sorted.forEach(function(m){
        html += '<span class="hm-name' + (m.isMe ? ' me' : '') + '">' + escapeHtml(managerLabel(m)) + '</span>';
        shown.forEach(function(d){
          var v = est.byUser[m.id].matchdayPoints[d];
          if (v == null){ html += '<span class="hm num">–</span>'; return; }
          var span = colMax[d] - colMin[d] || 1, a = 0.05 + 0.3 * (v - colMin[d]) / span, win = v === colMax[d] && v > 0;
          html += '<span class="hm num' + (win ? ' win' : '') + '" style="--a:' + a.toFixed(2) + '" title="' + d + '. Spieltag: ' + v + ' Punkte">' + v + '</span>';
        });
        html += '<span class="hm-sum num">' + tot(m) + '</span>';
      });
      box.innerHTML = html + '</div><p class="hist-note">Punkte je Spieltag, dunkler = mehr. Schwarz hinterlegt: Spieltagssieg.' +
        (n < days.length ? ' Zu sehen sind die letzten ' + n + ' von ' + days.length + ' Spieltagen, Σ zählt alle.' : '') + '</p>';
    }
  }

  function dateLabel(t){ var d = new Date(t); return d.getDate() + '.' + (d.getMonth() + 1) + '.'; }
  var histResize = null;
  window.addEventListener('resize', function(){ clearTimeout(histResize); histResize = setTimeout(drawHistory, 150); });

  function loadManagerSquad(uid){
    state.managerSquads[uid] = {loading: true};
    client.get("/leagues/" + state.league.i + "/managers/" + uid + "/squad").then(function(sq){
      var order = {TW:1, ABW:2, MF:3, ANG:4};
      var list = ((sq && sq.it) || []).map(function(p){
        return { name: p.pn || p.n || "Unbekannt", pos: POS_MAP[p.pos] || "–", mv: p.mv || 0, prc: p.prc, status: p.st || 0 };
      });
      list.sort(function(a, b){ return (order[a.pos] || 5) - (order[b.pos] || 5) || b.mv - a.mv; });
      state.managerSquads[uid] = {list: list};
    }).catch(function(){ state.managerSquads[uid] = {error: true}; })
      .then(function(){ if (state.openManager === uid) render(); });
  }

  function managerSquadHtml(uid){
    var s = state.managerSquads[uid];
    if (!s || s.loading) return '<div class="opp-squad"><div class="spinner" style="margin:14px auto"></div></div>';
    if (s.error) return '<div class="opp-squad sub">Kader konnte nicht geladen werden.</div>';
    return '<div class="opp-squad">' + s.list.map(function(p){
      var g = p.prc != null ? p.mv - p.prc : null;
      return '<div class="opp-row"><span class="pos">' + p.pos + '</span><span class="nm">' + escapeHtml(p.name) + (p.status ? '<span class="dot"></span>' : '') + '</span>' +
        '<span class="v num">' + short(p.mv) + (g != null ? '<small class="' + signCls(g) + '">' + delta(g) + '</small>' : '') + '</span></div>';
    }).join('') + '</div>';
  }

  // ---------- Ereignisse im Inhaltsbereich ----------
  function emptyCount(lu){
    var n = 0;
    POS_ORDER.forEach(function(pos){ lu.slots[pos].forEach(function(x){ if (!x) n++; }); });
    return n;
  }
  function lineupPoints(lu){
    var s = 0;
    POS_ORDER.forEach(function(pos){ lu.slots[pos].forEach(function(id){ var p = id && playerById(id); if (p) s += expected(p); }); });
    return s;
  }

  // Ein verkaufter Spieler verlaesst das Feld. Ersatz in dieser Reihenfolge:
  // bester Bankspieler derselben Position, sonst eine Formation, in der die Elf
  // wieder voll wird, sonst bleibt der Platz leer (rot) und "Es fehlt" zeigt den Bedarf.
  function removeFromLineup(id){
    if (!state.lineup) return;
    var hole = null, gone = playerById(id);
    POS_ORDER.forEach(function(pos){
      state.lineup.slots[pos].forEach(function(x, j){ if (x === id){ state.lineup.slots[pos][j] = null; hole = {pos: pos, j: j}; } });
    });
    if (!hole) return;
    var name = gone ? gone.name : 'den Spieler';
    var placed = placedIds();
    var sub = lineupPool().filter(function(p){ return p.pos === hole.pos && !state.sell[p.id] && !placed[p.id]; })
      .sort(function(a, b){ return expected(b) - expected(a); })[0];
    if (sub){
      state.lineup.slots[hole.pos][hole.j] = sub.id;
      state.lineupNote = sub.name + ' rückt für ' + name + ' nach.';
    } else {
      var keep = [];
      LINE_ORDER.slice().reverse().forEach(function(pos){ state.lineup.slots[pos].forEach(function(x){ if (x) keep.push(x); }); });
      var ids = keep.concat(bestIds()), best = null;
      FORMATIONS.forEach(function(f){
        var lu = buildLineup(f, ids);
        if (emptyCount(lu)) return;
        var pts = lineupPoints(lu);
        if (!best || pts > best.pts) best = {lu: lu, pts: pts};
      });
      if (best){
        state.lineup = best.lu;
        state.lineupNote = 'Kein ' + POS_LABEL[hole.pos] + ' als Ersatz für ' + name + ': Formation auf ' + best.lu.formation + ' umgestellt.';
      } else {
        state.lineupNote = 'Für ' + name + ' gibt es keinen Ersatz im Kader.';
      }
    }
    saveLineup();
  }

  function bindBody(){
    each('#body [data-hview]', function(b){
      b.addEventListener('click', function(){
        histView = b.getAttribute('data-hview');
        try { localStorage.setItem('kp_hist_view', histView); } catch(e){}
        each('#body [data-hview]', function(x){ x.classList.toggle('on', x === b); });
        drawHistory();
      });
    });
    var inactBtn = $('inactBtn');
    if (inactBtn) inactBtn.addEventListener('click', function(){
      state.hideInactive = !state.hideInactive;
      try { localStorage.setItem('kp_hide_inactive', state.hideInactive ? '1' : ''); } catch(e){}
      render();
    });
    drawHistory();
    each('#body .row[data-player]', function(r){
      r.addEventListener('click', function(e){
        if (e.target.closest('button, input, label, a')) return;
        openPlayer(r.getAttribute('data-player'));
      });
      r.addEventListener('keydown', function(e){
        if (e.target === r && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); openPlayer(r.getAttribute('data-player')); }
      });
    });
    each('#body [data-sell]', function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-sell');
        state.lineupNote = null; state.pick = null;
        if (state.sell[id]){
          delete state.sell[id];
          if (state.lineup && fillHoles([id]).length){ state.lineupNote = playerById(id).name + ' ist wieder auf dem Feld.'; saveLineup(); }
        }
        else { state.sell[id] = true; removeFromLineup(id); }
        render();
      });
    });
    each('#body [data-assign]', function(b){
      b.addEventListener('click', function(){
        var s = state.pick.split(':');
        assignSlot(s[0], +s[1], b.getAttribute('data-assign'));
        state.pick = null; state.lineupNote = null;
        render();
      });
    });
    var pickCancel = $('pickCancel');
    if (pickCancel) pickCancel.addEventListener('click', function(){ state.pick = null; render(); });
    var slotClear = $('slotClear');
    if (slotClear) slotClear.addEventListener('click', function(){
      var s = state.pick.split(':');
      state.lineup.slots[s[0]][+s[1]] = null;
      state.pick = null; saveLineup(); render();
    });
    each('#body [data-horizon]', function(b){
      b.addEventListener('click', function(){
        horizon = +b.getAttribute('data-horizon') === 1 ? 1 : 3;
        try { localStorage.setItem('kp_horizon', String(horizon)); } catch(e){}
        fixCache = {}; adviceCache = {key: null, value: null};
        render();
      });
    });
    each('#body [data-kview]', function(b){
      b.addEventListener('click', function(){
        kaderView = b.getAttribute('data-kview');
        try { localStorage.setItem('kp_kader_view', kaderView); } catch(e){}
        render();
      });
    });
    each('#body [data-formation]', function(b){
      b.addEventListener('click', function(){ state.pick = null; state.lineupNote = null; setFormation(b.getAttribute('data-formation')); render(); });
    });
    each('#body [data-slot]', function(b){
      b.addEventListener('click', function(){
        var key = b.getAttribute('data-slot');
        state.pick = state.pick === key ? null : key;
        state.lineupNote = null;
        render();
        var picker = document.querySelector('#body .picker');
        if (picker && picker.scrollIntoView) picker.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      });
    });
    each('#body [data-buyadvice]', function(b){
      b.addEventListener('click', function(){ applyBuy(b.getAttribute('data-buyadvice')); render(); });
    });
    each('#body [data-goto]', function(b){
      b.addEventListener('click', function(){ setTab(b.getAttribute('data-goto')); });
    });
    each('#body [data-advice]', function(b){
      b.addEventListener('click', function(){ applyAdvice(b.getAttribute('data-advice')); render(); });
    });
    var kbBtn = $('lineupKb');
    if (kbBtn) kbBtn.addEventListener('click', function(){ state.pick = null; state.lineupNote = null; useKickbaseLineup(); saveLineup(); render(); });
    var auto = $('lineupAuto');
    if (auto) auto.addEventListener('click', function(){
      state.pick = null; state.lineupNote = null;
      state.lineup = buildLineup(state.lineup.formation, bestIds());
      saveLineup(); render();
    });
    var benchSell = $('benchSell');
    if (benchSell) benchSell.addEventListener('click', function(){
      var placed = placedIds();
      var bench = state.players.filter(function(p){ return !placed[p.id]; });   // nur eigene Spieler, keine Gebote
      var allSold = bench.every(function(p){ return state.sell[p.id]; });
      bench.forEach(function(p){ if (allSold) delete state.sell[p.id]; else state.sell[p.id] = true; });
      if (allSold){ fillHoles(bench.map(function(p){ return p.id; })); saveLineup(); }
      render();
    });
    each('#body [data-buy]', function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-buy');
        var p = state.market.filter(function(x){ return x.id === id; })[0];
        state.lineupNote = null;
        if (state.bids[id] != null){
          delete state.bids[id];
          if (state.lineup) POS_ORDER.forEach(function(pos){
            state.lineup.slots[pos].forEach(function(x, j){ if (x === id) state.lineup.slots[pos][j] = null; });
          });
        } else {
          state.bids[id] = p.price;
          // Fehlt auf seiner Position jemand, setzt die App den neuen Spieler gleich ein
          var slots = state.lineup && state.lineup.slots[p.pos], free = slots ? slots.indexOf(null) : -1;
          if (free >= 0){ slots[free] = id; state.lineupNote = p.name + ' ist eingeplant (Gebot ' + short(p.price) + ').'; }
        }
        saveLineup();
        render();
      });
    });
    each('#body [data-bid]', function(inp){
      inp.addEventListener('change', function(){
        var v = parseInt(inp.value.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(v)) state.bids[inp.getAttribute('data-bid')] = v;
        render();
      });
    });
    each('#body [data-mgr]', function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-mgr');
        state.openManager = state.openManager === id ? null : id;
        if (state.openManager && !state.managerSquads[id]) loadManagerSquad(id);
        render();
      });
    });
    var calc = $('calcBtn');
    if (calc) calc.addEventListener('click', function(){ state.showCalc = !state.showCalc; render(); });
    var retry = $('estRetry');
    if (retry) retry.addEventListener('click', function(){ state.estError = false; render(); });
  }

  // ---------- Sheet: Ligawahl und Konto (Handy) ----------
  function openSheet(html){
    els.sheet.innerHTML = '<div class="grab"></div>' + html;
    els.sheet.hidden = false; els.sheetBackdrop.hidden = false;
  }
  function closeSheet(){ els.sheet.hidden = true; els.sheetBackdrop.hidden = true; els.sheet.removeAttribute('data-player'); }
  els.sheetBackdrop.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !els.sheet.hidden) closeSheet(); });

  // ---------- Sheet: Spieler-Detail ----------
  // Marktwertverlauf, Punkte je Spieltag und Transfers in der Liga. Die Daten kommen
  // beim Oeffnen, pro Liga und Spieler fuer 30 Minuten im Speicher.
  var detailCache = {}, DETAIL_TTL = 30 * 60000;
  var dateFmt = new Intl.DateTimeFormat('de-DE', {day: 'numeric', month: 'numeric', year: '2-digit'});
  var KIND_LABEL = {start: 'Startelf', sub: 'eingewechselt', out: 'nicht eingesetzt'};

  function playerAttr(p){ return ' data-player="' + escapeHtml(p.id) + '" tabindex="0"'; }

  function openPlayer(id){
    var own = state.players.filter(function(x){ return x.id === id; })[0];
    var p = own || marketById(id);
    if (!p || !state.league) return;
    var sub = [p.pos, state.clubNames[p.tid], 'MW ' + short(p.mv)].filter(Boolean).map(escapeHtml);
    openSheet('<div class="pd-head"><div class="pd-name">' + escapeHtml(p.name) + '</div><div class="pd-sub num">' + sub.join(' · ') + '</div></div>' +
      '<div id="pdBody"><p class="sheet-note">Lädt …</p></div>');
    els.sheet.setAttribute('data-player', id);
    var key = state.league.i + '|' + id, hit = detailCache[key];
    var done = function(d){
      if (els.sheet.hidden || els.sheet.getAttribute('data-player') !== id) return;
      renderPlayer(p, own, d);
    };
    if (hit && Date.now() - hit.at < DETAIL_TTL) return done(hit.d);
    KBData.fetchPlayerDetail(client, state.league.i, state.league.cpi || 1, id).then(function(d){
      detailCache[key] = {at: Date.now(), d: d};
      done(d);
    }).catch(function(){
      var b = $('pdBody');
      if (b && els.sheet.getAttribute('data-player') === id) b.innerHTML = '<p class="sheet-note">Konnte die Spielerdaten nicht laden.</p>';
    });
  }

  function renderPlayer(p, own, d){
    var body = $('pdBody');
    if (!body) return;
    var width = Math.max(240, Math.min(480, els.sheet.clientWidth - 40));
    var buy = own && p.gain != null ? p.mv - p.gain : null;
    var html = '';

    var mv = d.mv && d.mv.length > 1 ? d.mv : null;
    if (mv){
      var first = mv[0].mv, last = mv[mv.length - 1].mv, lo = Infinity, hi = -Infinity;
      mv.forEach(function(x){ lo = Math.min(lo, x.mv); hi = Math.max(hi, x.mv); });
      html += '<section class="pd-sec"><div class="pd-title"><span>Marktwert · 3 Monate</span><span class="pd-read num" id="pdMvRead"></span></div>' +
        '<div class="pd-chart" id="pdMv">' + KBCharts.line(mv, {width: width, ref: buy, refLabel: buy != null ? 'Kauf ' + short(buy) : null, fmt: short, label: 'Marktwertverlauf'}) + '</div>' +
        '<div class="pd-meta num">Tief ' + short(lo) + ' · Hoch ' + short(hi) + ' · <span class="' + signCls(last - first) + '">' + delta(last - first) + '</span> in 3 Monaten</div></section>';
    }

    var pts = d.points && d.points.length ? d.points : null, idle = '';
    if (pts){
      var played = pts.filter(function(x){ return x.kind !== 'out'; }), starts = pts.filter(function(x){ return x.kind === 'start'; }).length;
      var avg = played.length ? Math.round(played.reduce(function(s, x){ return s + x.p; }, 0) / played.length) : 0;
      idle = (played.length ? 'Ø ' + avg + ' · ' : '') + starts + '/' + pts.length + ' Startelf';
      html += '<section class="pd-sec"><div class="pd-title"><span>Punkte je Spieltag</span><span class="pd-read num" id="pdPtsRead"></span></div>' +
        '<div class="pd-chart" id="pdPts">' + KBCharts.bars(pts, {width: width, minSlots: 10, label: 'Punkte je Spieltag'}) + '</div>' +
        '<div class="pd-legend"><span><i class="sw start"></i>Startelf</span><span><i class="sw sub"></i>eingewechselt</span><span><i class="sw out"></i>nicht eingesetzt</span></div></section>';
    }

    if (d.transfers){
      html += '<section class="pd-sec"><div class="pd-title"><span>Transfers in dieser Liga</span></div>';
      if (!d.transfers.length) html += '<p class="pd-meta">Noch keine Transfers in dieser Liga.</p>';
      d.transfers.slice(0, 6).forEach(function(t){
        var pct = t.mvThen ? Math.round((t.price / t.mvThen - 1) * 100) : null;
        html += '<div class="pd-tr num"><span class="pd-tr-date">' + dateFmt.format(new Date(t.at)) + '</span>' +
          '<span class="pd-tr-who">' + escapeHtml(t.user || 'Kickbase') + '</span>' +
          '<span class="pd-tr-price">' + short(t.price) + (pct != null ? '<small>' + (pct >= 0 ? '+' : '−') + Math.abs(pct) + ' % zum MW</small>' : '') + '</span></div>';
      });
      html += '</section>';
    }

    body.innerHTML = html || '<p class="sheet-note">Für diesen Spieler gibt es noch keine Daten.</p>';
    if (mv) KBCharts.bindLine($('pdMv').querySelector('svg'), mv, {width: width, ref: buy}, $('pdMvRead'), function(x){
      return dateFmt.format(new Date(x.t)) + ' · <b>' + short(x.mv) + '</b>';
    });
    if (pts) KBCharts.bindBars($('pdPts').querySelector('svg'), pts, $('pdPtsRead'), function(x){
      return x.day + '. Spieltag · <b>' + x.p + ' P</b> · ' + KIND_LABEL[x.kind];
    }, idle);
  }

  els.leagueBtn.addEventListener('click', function(){
    openSheet('<h3>Liga wählen</h3>' + state.leagues.map(function(l, i){
      var on = state.league && String(state.league.i) === String(l.i);
      return '<button type="button" class="item' + (on ? ' on' : '') + '" data-pick="' + i + '">' + escapeHtml(l.n || 'Liga') + '<span>' + cpiLabel(l.cpi) + '</span></button>';
    }).join(''));
    each('#sheet [data-pick]', function(b){
      b.addEventListener('click', function(){ closeSheet(); openLeague(state.leagues[+b.getAttribute('data-pick')]); });
    });
  });

  els.menuBtn.addEventListener('click', function(){
    openSheet('<h3>' + escapeHtml(state.tokenName || 'Konto') + '</h3>' +
      '<button type="button" class="item danger" id="logoutBtn">Abmelden</button>');
    $('logoutBtn').addEventListener('click', logout);
  });

  start();
})();
