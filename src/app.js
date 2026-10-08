(function(){
  "use strict";

  var IMG_BASE = "https://kickbase.b-cdn.net/";
  var POS_MAP = {1:"TW", 2:"ABW", 3:"MF", 4:"ANG"};
  var POS_ORDER = ["TW","ABW","MF","ANG"];
  var POS_LABEL = {TW:"Torwart", ABW:"Abwehr", MF:"Mittelfeld", ANG:"Angriff"};
  var URGENT_SEC = 1800;

  var C = window.KBCalc;
  var $ = function(id){ return document.getElementById(id); };
  var els = {
    setup: $('screen-setup'), main: $('screen-main'),
    tokenInput: $('tokenInput'), connectBtn: $('connectBtn'), setupStatus: $('setupStatus'),
    leagueBtn: $('leagueBtn'), leagueName: $('leagueName'), refreshBtn: $('refreshBtn'), menuBtn: $('menuBtn'),
    hero: $('hero'), heroBudget: $('heroBudget'), heroAfter: $('heroAfter'), heroRoom: $('heroRoom'),
    heroSquad: $('heroSquad'), heroSub: $('heroSub'), alerts: $('alerts'), body: $('body'), nav: $('nav'),
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
  function cls(n){ return (n || 0) >= 0 ? 'up' : 'dn'; }
  function escapeHtml(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function img(path){ return path ? IMG_BASE + path : ""; }
  function countdown(sec){
    if (sec == null) return "kein Zeitlimit";
    if (sec <= 0) return "läuft ab";
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
    return h ? h + " Std " + m + " Min" : m + " Min";
  }
  var dateFmt = new Intl.DateTimeFormat('de-DE', {weekday:'short', hour:'2-digit', minute:'2-digit'});

  // ---------- Token: Keychain (Scriptable) oder localStorage ----------
  var bridge = !!window.__KP_SCRIPTABLE;
  function readToken(){
    if (window.__KP_TOKEN) return window.__KP_TOKEN;
    try { return localStorage.getItem('kb_token'); } catch(e){ return null; }
  }
  function persistToken(t){
    try { localStorage.setItem('kb_token', t); } catch(e){}
    if (bridge) location.href = 'kaderplaner://token/' + encodeURIComponent(t);
  }
  function forgetToken(){
    try { localStorage.removeItem('kb_token'); } catch(e){}
    window.__KP_TOKEN = null;
    if (bridge) location.href = 'kaderplaner://logout';
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
      token:null, tokenName:"", myUserId:null, myImg:"", leagues:[], league:null,
      budget:0, players:[], sell:{}, market:[], bids:{},
      managers:[], overview:null, clubNames:{}, nextKickoff:null,
      estimates:null, estLoading:false, estError:false, estProgress:"",
      openManager:null, managerSquads:{}, tab:'kader', loading:false
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
    var fail = function(msg){ if (!silent) els.setupStatus.innerHTML = '<div class="status-msg">' + msg + '</div>'; return false; };
    if (!payload) return fail("Der Token sieht nicht gültig aus. Bitte den Wert aus <code>kb.t</code> komplett neu kopieren.");
    if (payload.exp && Date.now() / 1000 > payload.exp) return fail("Dieser Token ist abgelaufen. Bitte neu bei play.kickbase.com einloggen und den frischen Token einfügen.");
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

  els.connectBtn.addEventListener('click', function(){
    els.setupStatus.innerHTML = "";
    if (!els.tokenInput.value.trim()){
      els.setupStatus.innerHTML = '<div class="status-msg">Bitte zuerst den Token einfügen.</div>';
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

  // ---------- Fehler ----------
  function showError(err, retry){
    if (err && err.auth){
      els.body.innerHTML = '<div class="empty">Kickbase hat den Token abgelehnt, vermutlich ist er abgelaufen.<br><button class="link-btn" id="reAuth">Neuen Token eingeben</button></div>';
      $('reAuth').addEventListener('click', logout);
      return;
    }
    els.body.innerHTML = '<div class="empty">Verbindung zu Kickbase hat nicht geklappt.<br><button class="link-btn" id="retry">Erneut versuchen</button></div>';
    $('retry').addEventListener('click', retry);
  }

  // ---------- Ligen ----------
  function loadLeagues(){
    show('main');
    els.body.innerHTML = '<div class="spinner"></div>';
    client.get("/leagues/selection").then(function(d){
      state.leagues = (d && d.it) || [];
      if (!state.leagues.length){ els.body.innerHTML = '<div class="empty">Keine Ligen gefunden.</div>'; return; }
      var last = null;
      try { last = localStorage.getItem('kp_league'); } catch(e){}
      var l = state.leagues.filter(function(x){ return String(x.i) === last; })[0] || state.leagues[0];
      openLeague(l);
    }).catch(function(err){ showError(err, loadLeagues); });
  }

  function openLeague(l){
    var keepTab = state.tab;
    var keep = {token: state.token, tokenName: state.tokenName, myUserId: state.myUserId, leagues: state.leagues};
    state = initialState();
    Object.keys(keep).forEach(function(k){ state[k] = keep[k]; });
    state.league = l;
    state.tab = keepTab;
    try { localStorage.setItem('kp_league', String(l.i)); } catch(e){}
    els.leagueName.textContent = l.n || "Liga";
    setTab(state.tab, true);
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
      var names = {};
      ((table && table.it) || []).forEach(function(t){ if (t.tid) names[t.tid] = t.tn; });
      state.clubNames = names;

      state.players = ((squad && squad.it) || []).map(function(p){
        return {
          id: String(p.i || p.pi), name: p.n || p.pn || "Unbekannt", pos: POS_MAP[p.pos] || "–",
          mv: p.mv || 0, gain: p.mvgl, day: p.tfhmvt, ap: p.ap, status: p.st || 0,
          offers: p.ofc || 0, tid: p.tid, img: img(p.pim)
        };
      });

      state.market = ((market && market.it) || []).map(function(p){
        return {
          id: String(p.i), name: (p.fn ? p.fn.charAt(0) + ". " : "") + (p.n || "Unbekannt"),
          pos: POS_MAP[p.pos] || "–", mv: p.mv || 0, price: p.prc != null ? p.prc : (p.mv || 0),
          expires: p.exs != null ? p.exs : null, loadedAt: Date.now(), status: p.st || 0,
          bids: p.ofc || 0, by: p.u ? (p.u.n || "Manager") : null, byId: p.u ? String(p.u.i) : null,
          tid: p.tid, ap: p.ap, img: img(p.pim)
        };
      });

      state.managers = ((ranking && ranking.us) || []).map(function(u){
        var isMe = state.myUserId && String(u.i) === state.myUserId;
        if (isMe) state.myImg = img(u.uim);
        return { id: String(u.i), name: u.n || "Manager", isMe: isMe, points: u.sp || 0, img: img(u.uim) };
      });
      els.menuBtn.style.backgroundImage = state.myImg ? 'url("' + state.myImg + '")' : '';

      state.nextKickoff = null;
      var season = perf && perf.it && perf.it[0];
      ((season && season.it) || []).forEach(function(d){
        var t = d.md ? Date.parse(d.md) : null;
        if (t && t > Date.now() && (state.nextKickoff == null || t < state.nextKickoff)) state.nextKickoff = t;
      });

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

  // ---------- Tabs ----------
  function setTab(tab, silent){
    state.tab = tab;
    Array.prototype.forEach.call(els.nav.querySelectorAll('button'), function(b){
      b.className = b.getAttribute('data-tab') === tab ? 'on' : '';
    });
    if (!silent){ render(); window.scrollTo(0, 0); }
  }
  els.nav.addEventListener('click', function(e){
    var t = e.target.getAttribute && e.target.getAttribute('data-tab');
    if (t) setTab(t);
  });

  function render(){
    if (!state.league || state.loading && !state.players.length) return;
    renderHero();
    if (state.tab === 'kader') renderSquad();
    else if (state.tab === 'markt') renderMarket();
    else renderManagers();
  }

  // ---------- Planung (Kopfbereich) ----------
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

  function renderHero(){
    var p = plan(), limit = state.overview && state.overview.mppu;
    els.heroBudget.textContent = fmtMoney(state.budget);
    els.heroAfter.textContent = short(p.after);
    els.heroRoom.textContent = short(p.room.headroom);
    els.heroSquad.textContent = p.squadSize + (limit ? "/" + limit : "");
    els.hero.className = 'hero' + (p.room.headroom < 0 ? ' neg' : '');
    var sub = [];
    if (p.sold || p.bids) sub.push((p.sold ? 'Verkauf +' + short(p.sold) : '') + (p.sold && p.bids ? ' · ' : '') + (p.bids ? 'Gebote ' + short(p.bids) : ''));
    sub.push('Minus-Grenze ' + short(p.room.maxNegative));
    if (state.nextKickoff) sub.push('Anpfiff ' + dateFmt.format(new Date(state.nextKickoff)));
    els.heroSub.textContent = sub.join(' · ');

    var alerts = [];
    if (p.room.headroom < 0) alerts.push(['', 'Über der 33%-Grenze um ' + short(-p.room.headroom) + '. Kickbase lehnt weitere Gebote ab.']);
    if (p.after < 0) alerts.push(['warn', 'Kontostand nach Plan im Minus. Steht er bei Anpfiff unter null, gibt es 0 Punkte für den Spieltag.']);
    if (limit && p.squadSize > limit) alerts.push(['', 'Kaderlimit ' + limit + ' überschritten (' + p.squadSize + ' Spieler).']);
    if (p.squadSize < 11) alerts.push(['warn', 'Nur ' + p.squadSize + ' Spieler. Jeder leere Aufstellungsplatz kostet 100 Punkte.']);
    var clubLimit = state.overview && state.overview.mpst;
    if (clubLimit){
      var byClub = {};
      p.kept.concat(p.bought).forEach(function(x){ if (x.tid) byClub[x.tid] = (byClub[x.tid] || 0) + 1; });
      Object.keys(byClub).forEach(function(tid){
        if (byClub[tid] > clubLimit) alerts.push(['', (state.clubNames[tid] || 'Verein ' + tid) + ': ' + byClub[tid] + ' Spieler, erlaubt sind ' + clubLimit + '.']);
      });
    }
    els.alerts.innerHTML = alerts.map(function(a){ return '<div class="alert ' + a[0] + '">' + escapeHtml(a[1]) + '</div>'; }).join('');
  }

  function photo(p){
    return '<div class="ph"' + (p.img ? ' style="background-image:url(\'' + p.img + '\')"' : '') + '><i>' + p.pos + '</i></div>';
  }

  // ---------- Kader ----------
  function renderSquad(){
    if (!state.players.length){ els.body.innerHTML = '<div class="empty">Keine Spieler im Kader.</div>'; return; }
    var html = "";
    POS_ORDER.concat(["–"]).forEach(function(pos){
      var list = state.players.filter(function(p){ return p.pos === pos; });
      if (!list.length) return;
      list.sort(function(a, b){ return b.mv - a.mv; });
      var value = list.reduce(function(s, p){ return s + p.mv; }, 0);
      html += '<div class="ttl"><b>' + (POS_LABEL[pos] || 'Weitere') + '</b><span>' + list.length + ' Spieler · ' + short(value) + '</span></div>';
      list.forEach(function(p){
        var sold = !!state.sell[p.id];
        var meta = [];
        if (p.gain != null) meta.push('<span class="' + cls(p.gain) + '">' + delta(p.gain) + ' seit Kauf</span>');
        if (p.ap != null) meta.push('<span>Ø ' + p.ap + ' P</span>');
        if (p.offers) meta.push('<span class="tag hot">' + p.offers + ' Angebot' + (p.offers > 1 ? 'e' : '') + '</span>');
        html += '<div class="card' + (sold ? ' sold' : '') + '">' + photo(p) +
          '<div class="mid"><div class="n">' + escapeHtml(p.name) + (p.status ? ' <span class="dot" title="Status beachten"></span>' : '') + '</div><div class="m">' + meta.join('') + '</div></div>' +
          '<div class="rt"><b class="mono">' + short(p.mv) + '</b>' + (p.day != null ? '<small class="mono ' + cls(p.day) + '">' + delta(p.day) + '</small>' : '') + '</div>' +
          '<button class="act' + (sold ? ' sell' : '') + '" data-sell="' + p.id + '">' + (sold ? 'Verkauft' : 'Verkaufen') + '</button></div>';
      });
    });
    els.body.innerHTML = html;
    Array.prototype.forEach.call(els.body.querySelectorAll('[data-sell]'), function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-sell');
        if (state.sell[id]) delete state.sell[id]; else state.sell[id] = true;
        render();
      });
    });
  }

  // ---------- Markt ----------
  function remaining(p){
    return p.expires == null ? null : p.expires - Math.round((Date.now() - p.loadedAt) / 1000);
  }

  function renderMarket(){
    if (!state.market.length){ els.body.innerHTML = '<div class="empty">Gerade steht niemand auf dem Transfermarkt.</div>'; return; }
    var free = state.market.filter(function(p){ return !p.by; });
    var offers = state.market.filter(function(p){ return p.by; });
    free.sort(function(a, b){ return (a.expires || 0) - (b.expires || 0); });
    offers.sort(function(a, b){ return (a.price / a.mv) - (b.price / b.mv); });
    var html = '';
    if (free.length){
      html += '<div class="ttl"><b>Transfermarkt</b><span>läuft zuerst ab</span></div>';
      free.forEach(function(p){ html += marketCard(p); });
    }
    if (offers.length){
      html += '<div class="ttl"><b>Von Managern</b><span>Forderung, oft verhandelbar</span></div>';
      offers.forEach(function(p){ html += marketCard(p); });
    }
    els.body.innerHTML = html;
    Array.prototype.forEach.call(els.body.querySelectorAll('[data-buy]'), function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-buy');
        var p = state.market.filter(function(x){ return x.id === id; })[0];
        if (state.bids[id] != null) delete state.bids[id]; else state.bids[id] = p.price;
        render();
      });
    });
    Array.prototype.forEach.call(els.body.querySelectorAll('[data-bid]'), function(inp){
      inp.addEventListener('change', function(){
        var v = parseInt(inp.value.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(v)) state.bids[inp.getAttribute('data-bid')] = v;
        renderHero();
        inp.value = (state.bids[inp.getAttribute('data-bid')] || 0).toLocaleString('de-DE');
      });
    });
  }

  function marketCard(p){
    var marked = state.bids[p.id] != null;
    var left = remaining(p);
    var meta = [];
    if (p.by){
      var pct = p.mv ? Math.round((p.price / p.mv - 1) * 100) : 0;
      meta.push('<span>' + escapeHtml(p.by) + '</span>');
      meta.push('<span class="tag' + (pct > 10 ? ' bad' : '') + '">' + (pct >= 0 ? '+' : '') + pct + ' % zum MW</span>');
    } else {
      meta.push('<span class="tag' + (left != null && left < URGENT_SEC ? ' hot' : '') + '">' + countdown(left) + '</span>');
      if (state.nextKickoff && left != null && Date.now() + left * 1000 > state.nextKickoff) meta.push('<span class="tag bad">nach Anpfiff</span>');
    }
    if (p.bids) meta.push('<span class="tag">' + p.bids + ' Gebot' + (p.bids > 1 ? 'e' : '') + '</span>');
    if (p.ap != null) meta.push('<span>Ø ' + p.ap + ' P</span>');
    var club = state.clubNames[p.tid];
    var html = '<div class="card' + (marked ? ' bought' : '') + '"' + (marked ? ' style="border-radius:16px 16px 0 0;margin-bottom:0"' : '') + '>' + photo(p) +
      '<div class="mid"><div class="n">' + escapeHtml(p.name) + (p.status ? ' <span class="dot" title="Status beachten"></span>' : '') + '</div><div class="m">' + meta.join('') + '</div></div>' +
      '<div class="rt"><b class="mono">' + short(p.price) + '</b>' + (club ? '<small style="color:var(--mut)">' + escapeHtml(club) + '</small>' : '') + '</div>' +
      '<button class="act' + (marked ? ' buy' : '') + '" data-buy="' + p.id + '">' + (marked ? 'Vorgemerkt' : 'Bieten') + '</button></div>';
    if (marked){
      html += '<div class="bid">Gebot <input data-bid="' + p.id + '" inputmode="numeric" value="' + state.bids[p.id].toLocaleString('de-DE') + '"> €</div>';
    }
    return html;
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
      if (state.tab === 'gegner') render();
    }).catch(function(err){
      if (state.league !== l) return;
      state.estLoading = false; state.estError = true;
      if (err && err.auth) return showError(err, loadEstimates);
      if (state.tab === 'gegner') render();
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

  function renderManagers(){
    if (!state.estimates && !state.estLoading && !state.estError) loadEstimates();
    var est = state.estimates;
    var html = '<details class="info"><summary>So wird gerechnet</summary>' +
      '<p>Kickbase verrät die Kontostände der anderen nicht. Die App rechnet sie nach: Startbudget, alle Käufe und Verkäufe seit Ligastart, MVP-Auto-Verkäufe, ' +
      fmtMoney(est ? est.pointValue : 1000) + ' je Saisonpunkt, Erfolgsprämien (Spieltagssiege, Punkteschwellen, starke Spieler, Transfers, Gewinne) und die tägliche Auflaufprämie.</p>' +
      '<p>Unsicher ist vor allem die Auflaufprämie. Daher die Spanne: oben bei täglichem Login, unten nur an Tagen mit Transfers.</p>' +
      '<p><b>Bietkraft</b> = Kontostand plus Spielraum bis zur 33%-Grenze. Wer keinen Kaderplatz frei hat, kann nicht mitbieten.</p>';
    if (est && est.check){
      var off = Math.abs(est.check.diff);
      html += '<p class="check' + (off > 1e6 ? ' bad' : '') + '">Gegenprobe an deinem Konto: gerechnet ' + fmtMoney(est.check.estimate) + ', echt ' + fmtMoney(est.check.real) + ' (Abweichung ' + short(off) + ').</p>';
    }
    html += '</details>';

    if (!est){
      html += state.estError
        ? '<div class="empty">Die Kontostände konnten nicht berechnet werden.<br><button class="link-btn" id="estRetry">Erneut versuchen</button></div>'
        : '<div class="spinner"></div><div class="progress" id="estProgress">' + escapeHtml(state.estProgress || 'Lade Transfers und Spieltage …') + '</div>';
      els.body.innerHTML = html;
      var r = $('estRetry');
      if (r) r.addEventListener('click', function(){ state.estError = false; render(); });
      return;
    }

    var rows = managerRows().filter(function(r){ return r.e; });
    rows.sort(function(a, b){ return b.power - a.power || b.mid - a.mid; });
    var max = Math.max.apply(null, rows.map(function(r){ return r.powerHi; }).concat([1]));
    html += '<div class="ttl"><b>Wer kann mitbieten?</b><span>Bietkraft</span></div>';
    rows.forEach(function(r){
      var e = r.e, open = state.openManager === r.m.id;
      var konto = r.m.isMe ? short(r.mid) + ' (echt)' : short(r.lo) + ' bis ' + short(r.hi);
      var odd = !r.m.isMe && r.hi < C.minReachableBudget(e.teamValue);
      html += '<button class="rank' + (r.full ? ' dim' : '') + '" data-mgr="' + r.m.id + '">' +
        '<div class="h"><div class="n"><span>' + escapeHtml(r.m.name) + '</span>' + (r.m.isMe ? '<em class="you">DU</em>' : '') + '</div>' +
        '<div class="p mono">' + (r.full ? 'Kader voll' : (r.m.isMe ? '' : '≈ ') + short(r.power)) + '</div></div>' +
        '<div class="bar"><i style="width:' + (r.powerHi / max * 100).toFixed(1) + '%"></i>' +
          (r.powerHi > r.powerLo ? '<s style="left:' + (r.powerLo / max * 100).toFixed(1) + '%;width:' + ((r.powerHi - r.powerLo) / max * 100).toFixed(1) + '%"></s>' : '') + '</div>' +
        '<div class="m"><span>Konto ' + konto + '</span><span>' + (e.freeSlots == null ? '' : e.freeSlots + ' frei') + '</span>' +
          '<span>Kader ' + short(e.teamValue) + '</span><span>' + r.m.points + ' P' + (e.wins ? ' · ' + e.wins + '× Sieg' : '') + '</span></div>' +
        (odd ? '<div class="m dn">Unplausibel tief, vermutlich fehlen Daten.</div>' : '') +
        (open ? squadHtml(r.m.id) : '') +
      '</button>';
    });
    els.body.innerHTML = html;
    Array.prototype.forEach.call(els.body.querySelectorAll('[data-mgr]'), function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-mgr');
        state.openManager = state.openManager === id ? null : id;
        if (state.openManager && !state.managerSquads[id]) loadManagerSquad(id);
        render();
      });
    });
  }

  function loadManagerSquad(uid){
    state.managerSquads[uid] = {loading: true};
    client.get("/leagues/" + state.league.i + "/managers/" + uid + "/squad").then(function(sq){
      var order = {TW:1, ABW:2, MF:3, ANG:4};
      var list = ((sq && sq.it) || []).map(function(p){
        return { name: p.pn || p.n || "Unbekannt", pos: POS_MAP[p.pos] || "–", mv: p.mv || 0, prc: p.prc, ap: p.ap, status: p.st || 0 };
      });
      list.sort(function(a, b){ return (order[a.pos] || 5) - (order[b.pos] || 5) || b.mv - a.mv; });
      state.managerSquads[uid] = {list: list};
    }).catch(function(){ state.managerSquads[uid] = {error: true}; })
      .then(function(){ if (state.tab === 'gegner' && state.openManager === uid) render(); });
  }

  function squadHtml(uid){
    var s = state.managerSquads[uid];
    if (!s || s.loading) return '<div class="opp-squad"><div class="spinner" style="margin:14px auto"></div></div>';
    if (s.error) return '<div class="opp-squad m">Kader konnte nicht geladen werden.</div>';
    return '<div class="opp-squad">' + s.list.map(function(p){
      var g = p.prc != null ? p.mv - p.prc : null;
      return '<div class="opp-row"><span class="pos">' + p.pos + '</span><span class="nm">' + escapeHtml(p.name) + (p.status ? ' <span class="dot"></span>' : '') + '</span>' +
        '<span class="v mono">' + short(p.mv) + (g != null ? '<small class="' + cls(g) + '">' + delta(g) + '</small>' : '') + '</span></div>';
    }).join('') + '</div>';
  }

  // ---------- Sheet: Ligawahl und Menue ----------
  function openSheet(html){
    els.sheet.innerHTML = '<div class="grab"></div>' + html;
    els.sheet.hidden = false; els.sheetBackdrop.hidden = false;
  }
  function closeSheet(){ els.sheet.hidden = true; els.sheetBackdrop.hidden = true; }
  els.sheetBackdrop.addEventListener('click', closeSheet);

  els.leagueBtn.addEventListener('click', function(){
    var html = '<h3>Liga wählen</h3>' + state.leagues.map(function(l, i){
      var on = state.league && String(state.league.i) === String(l.i);
      return '<button class="item' + (on ? ' on' : '') + '" data-league="' + i + '">' +
        (l.lim ? '<img src="' + img(l.lim) + '" alt="">' : '<div class="ph"></div>') +
        '<div><b>' + escapeHtml(l.n || 'Liga') + '</b><span>' + (l.un != null ? l.un + ' Manager' : '') + '</span></div></button>';
    }).join('');
    openSheet(html);
    Array.prototype.forEach.call(els.sheet.querySelectorAll('[data-league]'), function(b){
      b.addEventListener('click', function(){ closeSheet(); openLeague(state.leagues[+b.getAttribute('data-league')]); });
    });
  });

  els.menuBtn.addEventListener('click', function(){
    openSheet('<h3>' + escapeHtml(state.tokenName || 'Konto') + '</h3>' +
      '<button class="item danger" id="logoutBtn"><div class="ph"></div><div><b>Token ändern</b><span>Abmelden und neuen Token einfügen</span></div></button>');
    $('logoutBtn').addEventListener('click', logout);
  });

  start();
})();
