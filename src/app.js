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
      openManager:null, managerSquads:{}, tab:null, loading:false
    };
  }
  var state = initialState();
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

      state.players = ((squad && squad.it) || []).map(function(p){
        return {
          id: String(p.i || p.pi), name: p.n || p.pn || "Unbekannt", pos: POS_MAP[p.pos] || "–",
          mv: p.mv || 0, gain: p.mvgl, day: p.tfhmvt, ap: p.ap, status: p.st || 0,
          offers: p.ofc || 0, tid: p.tid
        };
      });

      state.market = ((market && market.it) || []).map(function(p){
        return {
          id: String(p.i), name: (p.fn ? p.fn.charAt(0) + ". " : "") + (p.n || "Unbekannt"),
          pos: POS_MAP[p.pos] || "–", mv: p.mv || 0, price: p.prc != null ? p.prc : (p.mv || 0),
          expires: p.exs != null ? p.exs : null, loadedAt: Date.now(), status: p.st || 0,
          bids: p.ofc || 0, by: p.u ? (p.u.n || "Manager") : null, tid: p.tid, ap: p.ap
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
      if (state.matchday) sub.push('Spieltag ' + state.matchday);
      if (state.nextKickoff) sub.push('Anpfiff ' + dateFmt.format(new Date(state.nextKickoff)));
      els.pageSub.textContent = sub.filter(Boolean).join(' · ');

      state.loading = false;
      els.refreshBtn.classList.remove('spin');
      render();
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
    else if (t === 'gegner') html = managersPanel(false);
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
  function squadRow(p, compact){
    var sold = !!state.sell[p.id];
    var sub = [];
    if (p.gain != null) sub.push('<span class="' + negCls(p.gain).trim() + '">' + delta(p.gain) + ' seit Kauf</span>');
    if (p.ap != null) sub.push('Ø ' + p.ap);
    if (p.offers) sub.push(p.offers + ' Angebot' + (p.offers > 1 ? 'e' : ''));
    return '<div class="row' + (sold ? ' on sold' : '') + '">' +
      (compact ? '<span class="pos">' + p.pos + '</span>' : '') +
      '<div class="main"><div class="name">' + escapeHtml(p.name) + (p.status ? '<span class="dot" title="Status beachten"></span>' : '') + '</div>' +
        '<div class="sub num">' + sub.join(' · ') + '</div></div>' +
      '<div class="fig num"><div class="v">' + short(p.mv) + '</div>' + (p.day != null ? '<div class="d' + negCls(p.day) + '">' + delta(p.day) + '</div>' : '') + '</div>' +
      '<button type="button" class="btn' + (sold ? ' on' : '') + '" data-sell="' + p.id + '">' + (sold ? 'Verkauft' : 'Verkaufen') + '</button>' +
    '</div>';
  }

  function squadPanel(compact){
    var total = state.players.reduce(function(s, p){ return s + p.mv; }, 0);
    var html = '<section class="panel"><div class="panel-head"><h2>Kader</h2><span class="num">' +
      (compact ? short(total) : (state.nextKickoff ? 'Anpfiff ' + dateFmt.format(new Date(state.nextKickoff)) : short(total))) + '</span></div>';
    if (!state.players.length) return html + '<div class="empty">Keine Spieler im Kader.</div></section>';
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
    if (!compact && state.clubNames[p.tid]) sub.push(escapeHtml(state.clubNames[p.tid]));
    var html = '<div class="row' + (marked ? ' on' : '') + '">' +
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
    return html + '</section>';
  }

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
        '<span class="v num">' + short(p.mv) + (g != null ? '<small class="' + negCls(g).trim() + '">' + delta(g) + '</small>' : '') + '</span></div>';
    }).join('') + '</div>';
  }

  // ---------- Ereignisse im Inhaltsbereich ----------
  function bindBody(){
    each('#body [data-sell]', function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-sell');
        if (state.sell[id]) delete state.sell[id]; else state.sell[id] = true;
        render();
      });
    });
    each('#body [data-buy]', function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-buy');
        var p = state.market.filter(function(x){ return x.id === id; })[0];
        if (state.bids[id] != null) delete state.bids[id]; else state.bids[id] = p.price;
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
  function closeSheet(){ els.sheet.hidden = true; els.sheetBackdrop.hidden = true; }
  els.sheetBackdrop.addEventListener('click', closeSheet);

  els.leagueBtn.addEventListener('click', function(){
    openSheet('<h3>Liga wählen</h3>' + state.leagues.map(function(l, i){
      var on = state.league && String(state.league.i) === String(l.i);
      return '<button type="button" class="item' + (on ? ' on' : '') + '" data-pick="' + i + '">' + escapeHtml(l.n || 'Liga') + '<span>' + cpiLabel(l.cpi) + (l.un != null ? ' · ' + l.un + ' Manager' : '') + '</span></button>';
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
