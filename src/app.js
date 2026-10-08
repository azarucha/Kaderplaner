(function(){
  "use strict";

  var API = "https://api.kickbase.com/v4";
  var IMG_BASE = "https://kickbase.b-cdn.net/";
  var POS_MAP = {1:"TW", 2:"ABW", 3:"MF", 4:"ANG"};
  var POS_ORDER = ["TW","ABW","MF","ANG"];
  var POS_LABEL = {TW:"Torwart", ABW:"Abwehr", MF:"Mittelfeld", ANG:"Angriff"};

  var els = {
    setup: document.getElementById('screen-setup'),
    leagues: document.getElementById('screen-leagues'),
    squad: document.getElementById('screen-squad'),
    tokenInput: document.getElementById('tokenInput'),
    connectBtn: document.getElementById('connectBtn'),
    setupStatus: document.getElementById('setupStatus'),
    tokenName: document.getElementById('tokenName'),
    leaguesList: document.getElementById('leaguesList'),
    logoutBtn: document.getElementById('logoutBtn'),
    backBtn: document.getElementById('backBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    squadLeagueName: document.getElementById('squadLeagueName'),
    squadMeta: document.getElementById('squadMeta'),
    squadBody: document.getElementById('squadBody'),
    sumBudget: document.getElementById('sumBudget'),
    sumErlos: document.getElementById('sumErlos'),
    sumNeu: document.getElementById('sumNeu'),
    sumLimit: document.getElementById('sumLimit'),
    sumConstraints: document.getElementById('sumConstraints'),
    tabKader: document.getElementById('tabKader'),
    tabMarkt: document.getElementById('tabMarkt'),
    tabGegner: document.getElementById('tabGegner'),
  };

  var currency = new Intl.NumberFormat('de-DE', {style:'currency', currency:'EUR', maximumFractionDigits:0});
  function fmtMoney(n){ return currency.format(n || 0); }
  function fmtDelta(n){
    n = n || 0;
    var s = currency.format(Math.abs(n));
    return (n >= 0 ? "+" : "−") + s;
  }

  var C = window.KBCalc;
  var client = KBData.createClient(function(){ return state.token; });

  function initialState(){
    return {
      token:null, tokenName:"", myUserId:null, leagues:[], currentLeague:null,
      players:[], budget:0, actions:{},
      market:[], buyActions:{},
      opponents:[], opponentDetails:{}, openOpponent:null,
      estimates:null, estimatesLoading:false, estimatesError:false, estimatesProgress:"",
      matchday:0,
      squadLimit:null, clubLimit:null, clubNames:{}, leagueOverview:null,
      activeTab:'kader'
    };
  }
  var state = initialState();

  function show(screen){
    els.setup.hidden = screen !== 'setup';
    els.leagues.hidden = screen !== 'leagues';
    els.squad.hidden = screen !== 'squad';
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
    try {
      return JSON.parse(b64urlDecode(parts[1]));
    } catch(e){ return null; }
  }

  function cleanToken(raw){
    var t = (raw || "").trim();
    t = t.replace(/^["']|["']$/g, "");
    if (t.indexOf("Bearer ") === 0) t = t.slice(7).trim();
    return t;
  }

  function headers(){
    return {
      "Authorization": "Bearer " + state.token,
      "Accept": "application/json"
    };
  }

  function setStatus(el, msg, kind){
    if (!msg){ el.innerHTML = ""; return; }
    el.innerHTML = '<div class="status-msg ' + (kind || 'error') + '">' + msg + '</div>';
  }

  function playerImg(path){
    return path ? (IMG_BASE + path) : "";
  }

  // ---------- Setup flow ----------
  function tryStoredToken(){
    var stored = null;
    try { stored = localStorage.getItem('kb_token'); } catch(e){}
    if (!stored) { show('setup'); return; }
    var ok = applyToken(stored, true);
    if (!ok) show('setup'); else loadLeagues();
  }

  function applyToken(raw, silent){
    var token = cleanToken(raw);
    var payload = decodeToken(token);
    if (!payload){
      if (!silent) setStatus(els.setupStatus, "Der Token sieht nicht gültig aus — bitte den Wert aus <code>kb.t</code> komplett neu kopieren.", "error");
      return false;
    }
    if (payload.exp && Date.now()/1000 > payload.exp){
      if (!silent) setStatus(els.setupStatus, "Dieser Token ist abgelaufen. Bitte frisch bei play.kickbase.com/freibier einloggen und neu einfügen.", "error");
      return false;
    }
    state.token = token;
    state.tokenName = payload["kb.name"] || "";
    state.myUserId = payload["kb.uid"] || null;
    try { localStorage.setItem('kb_token', token); } catch(e){}
    return true;
  }

  els.connectBtn.addEventListener('click', function(){
    setStatus(els.setupStatus, "");
    var raw = els.tokenInput.value;
    if (!raw.trim()){
      setStatus(els.setupStatus, "Bitte zuerst den Token einfügen.", "error");
      return;
    }
    els.connectBtn.disabled = true;
    els.connectBtn.textContent = "Verbinde …";
    var ok = applyToken(raw, false);
    if (!ok){
      els.connectBtn.disabled = false;
      els.connectBtn.textContent = "Verbinden";
      return;
    }
    loadLeagues();
  });

  els.logoutBtn.addEventListener('click', function(){
    try { localStorage.removeItem('kb_token'); } catch(e){}
    state = initialState();
    els.tokenInput.value = "";
    els.connectBtn.disabled = false;
    els.connectBtn.textContent = "Verbinden";
    setStatus(els.setupStatus, "");
    show('setup');
  });

  // ---------- Leagues ----------
  function loadLeagues(){
    show('leagues');
    els.tokenName.textContent = state.tokenName ? ("Angemeldet als " + state.tokenName) : "";
    els.leaguesList.innerHTML = '<div class="spinner"></div>';

    fetch(API + "/leagues/selection", {headers: headers()})
      .then(handleResponse)
      .then(function(data){
        state.leagues = data.it || [];
        renderLeagues();
      })
      .catch(function(err){ showFetchError(els.leaguesList, err, loadLeagues); });
  }

  function renderLeagues(){
    if (!state.leagues.length){
      els.leaguesList.innerHTML = '<div class="empty-state">Keine Ligen gefunden.</div>';
      return;
    }
    els.leaguesList.innerHTML = "";
    state.leagues.forEach(function(l){
      var card = document.createElement('button');
      card.className = 'league-card';
      var img = l.lim ? playerImg(l.lim) : "";
      card.innerHTML =
        (img ? '<img class="league-avatar" src="' + img + '" alt="">' : '<div class="league-avatar"></div>') +
        '<div class="league-info">' +
          '<div class="name">' + escapeHtml(l.n || "Liga") + '</div>' +
          '<div class="meta">' + (l.un != null ? l.un + " Manager" : "") + '</div>' +
        '</div>' +
        '<span class="chev">›</span>';
      card.addEventListener('click', function(){ openLeague(l); });
      els.leaguesList.appendChild(card);
    });
  }

  els.backBtn.addEventListener('click', function(){ show('leagues'); });

  // ---------- Squad ----------
  function openLeague(l){
    state.currentLeague = l;
    state.actions = {};
    state.buyActions = {};
    state.opponents = [];
    state.opponentDetails = {};
    state.openOpponent = null;
    state.estimates = null;
    state.estimatesLoading = false;
    state.estimatesError = false;
    state.squadLimit = null;
    state.clubLimit = null;
    state.clubNames = {};
    state.leagueOverview = null;
    state.activeTab = 'kader';
    setActiveTab('kader');
    els.squadLeagueName.textContent = l.n || "Liga";
    els.squadMeta.textContent = "Lade Kader …";
    show('squad');
    els.squadBody.innerHTML = '<div class="spinner"></div>';
    loadSquad();
  }

  els.refreshBtn.addEventListener('click', loadSquad);
  els.tabKader.addEventListener('click', function(){ setActiveTab('kader'); renderActiveTab(); });
  els.tabMarkt.addEventListener('click', function(){ setActiveTab('markt'); renderActiveTab(); });
  els.tabGegner.addEventListener('click', function(){ setActiveTab('gegner'); renderActiveTab(); });

  function setActiveTab(tab){
    state.activeTab = tab;
    els.tabKader.className = tab === 'kader' ? 'active' : '';
    els.tabMarkt.className = tab === 'markt' ? 'active' : '';
    els.tabGegner.className = tab === 'gegner' ? 'active' : '';
  }

  function renderActiveTab(){
    if (state.activeTab === 'kader') renderSquad();
    else if (state.activeTab === 'markt') renderMarket();
    else renderGegner();
  }

  function loadSquad(){
    if (!state.currentLeague) return;
    var id = state.currentLeague.i;
    els.squadMeta.textContent = "Lade Daten …";
    els.squadBody.innerHTML = '<div class="spinner"></div>';

    var cpi = state.currentLeague.cpi || 1;

    Promise.all([
      fetch(API + "/leagues/" + id + "/me", {headers: headers()}).then(handleResponse),
      fetch(API + "/leagues/" + id + "/squad", {headers: headers()}).then(handleResponse),
      fetch(API + "/leagues/" + id + "/market", {headers: headers()}).then(handleResponse),
      fetch(API + "/leagues/" + id + "/ranking", {headers: headers()}).then(handleResponse),
      fetch(API + "/leagues/" + id + "/overview", {headers: headers()}).then(handleResponse).catch(function(){ return null; }),
      fetch(API + "/competitions/" + cpi + "/table", {headers: headers()}).then(handleResponse).catch(function(){ return null; })
    ]).then(function(results){
      var me = results[0], squad = results[1], market = results[2], ranking = results[3], overview = results[4], table = results[5];

      state.budget = me.b || 0;

      if (overview){
        state.leagueOverview = overview;
        state.squadLimit = overview.mppu || null;
        state.clubLimit = overview.mpst || null;
      }
      if (table && table.it){
        var names = {};
        table.it.forEach(function(t){ if (t.tid) names[t.tid] = t.tn || ("Verein " + t.tid); });
        state.clubNames = names;
      }

      var raw = squad.it || (Array.isArray(squad) ? squad : []);
      state.players = raw.map(function(p){
        return {
          id: p.i,
          name: p.n || "Unbekannt",
          pos: POS_MAP[p.pos] || "UNK",
          mv: p.mv || 0,
          delta: p.mvgl || 0,
          tid: p.tid || null,
          img: playerImg(p.pim)
        };
      });

      state.matchday = market.day || 0;

      state.market = (market.it || []).map(function(p){
        return {
          id: p.i,
          name: ((p.fn ? p.fn.charAt(0) + ". " : "") + (p.n || "Unbekannt")),
          pos: POS_MAP[p.pos] || "UNK",
          price: (p.prc != null ? p.prc : p.mv) || 0,
          mv: p.mv || 0,
          // Managerangebote (p.u vorhanden) haben laut Kickbase-API kein exs-Feld -
          // keine Frist, kein "läuft ab". null statt 0, sonst wirkt es faelschlich dringend.
          expiresIn: (p.exs != null ? p.exs : null),
          status: p.st || 0,
          offerBy: p.u ? (p.u.n || "Manager") : null,
          tid: p.tid || null,
          img: playerImg(p.pim)
        };
      });

      state.opponents = (ranking.us || []).map(function(u){
        return {
          id: u.i,
          name: u.n || "Manager",
          isMe: state.myUserId && String(u.i) === String(state.myUserId),
          // Achtung: tv im Ranking ist nur der Wert der aufgestellten Elf. Der echte
          // Kaderwert kommt aus /managers/{uid}/dashboard (siehe KBData.estimateAll).
          lineupValue: u.tv || 0,
          points: u.sp || 0,
          lineup: u.lp || [],
          img: playerImg(u.uim)
        };
      });

      els.squadMeta.textContent = state.players.length + " Spieler · " + state.market.length + " im Transfermarkt";
      renderActiveTab();
    }).catch(function(err){ showFetchError(els.squadBody, err, loadSquad); });
  }

  function renderSquad(){
    var byPos = {};
    POS_ORDER.forEach(function(p){ byPos[p] = []; });
    var extra = [];
    state.players.forEach(function(p){
      if (byPos[p.pos]) byPos[p.pos].push(p); else extra.push(p);
    });

    var html = "";
    POS_ORDER.forEach(function(pos){
      var list = byPos[pos];
      if (!list.length) return;
      html += '<div class="pos-header">' + POS_LABEL[pos] + '<span class="count">' + list.length + '</span></div>';
      html += '<div class="players">';
      list.forEach(function(p){ html += playerCardHtml(p); });
      html += '</div>';
    });
    if (extra.length){
      html += '<div class="pos-header">Weitere<span class="count">' + extra.length + '</span></div><div class="players">';
      extra.forEach(function(p){ html += playerCardHtml(p); });
      html += '</div>';
    }
    els.squadBody.innerHTML = html || '<div class="empty-state">Keine Spieler im Kader.</div>';

    // wire toggles
    state.players.forEach(function(p){
      var holdBtn = document.getElementById('hold-' + p.id);
      var sellBtn = document.getElementById('sell-' + p.id);
      if (holdBtn) holdBtn.addEventListener('click', function(){ setAction(p.id, 'hold'); });
      if (sellBtn) sellBtn.addEventListener('click', function(){ setAction(p.id, 'sell'); });
    });

    updateSummary();
  }

  function playerCardHtml(p){
    var isSell = state.actions[p.id] === 'sell';
    var deltaClass = p.delta >= 0 ? 'pos' : 'neg';
    return (
      '<div class="player-card">' +
        (p.img ? '<img class="player-photo" src="' + p.img + '" alt="">' : '<div class="player-photo"></div>') +
        '<div class="player-main">' +
          '<div class="player-name">' + escapeHtml(p.name) + '</div>' +
          '<div class="player-sub">' +
            '<span class="player-mv mono">' + fmtMoney(p.mv) + '</span>' +
            '<span class="player-delta ' + deltaClass + '">' + fmtDelta(p.delta) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="toggle">' +
          '<button id="hold-' + p.id + '" class="' + (isSell ? '' : 'active-hold') + '">Halten</button>' +
          '<button id="sell-' + p.id + '" class="' + (isSell ? 'active-sell' : '') + '">Verkaufen</button>' +
        '</div>' +
      '</div>'
    );
  }

  function setAction(id, action){
    if (action === 'hold') delete state.actions[id];
    else state.actions[id] = 'sell';

    var holdBtn = document.getElementById('hold-' + id);
    var sellBtn = document.getElementById('sell-' + id);
    if (holdBtn) holdBtn.className = action === 'hold' ? 'active-hold' : '';
    if (sellBtn) sellBtn.className = action === 'sell' ? 'active-sell' : '';
    updateSummary();
  }

  function updateSummary(){
    var erlos = 0;
    state.players.forEach(function(p){
      if (state.actions[p.id] === 'sell') erlos += p.mv;
    });
    var ausgaben = 0;
    state.market.forEach(function(p){
      if (state.buyActions[p.id]) ausgaben += p.price;
    });
    var netto = erlos - ausgaben;
    var neu = state.budget + netto;
    els.sumBudget.textContent = fmtMoney(state.budget);
    els.sumBudget.className = "val mono " + (state.budget < 0 ? "neg" : "");
    els.sumErlos.textContent = (netto > 0 ? "+" : (netto < 0 ? "" : "")) + fmtMoney(netto);
    els.sumErlos.className = "val mono " + (netto < 0 ? "neg" : (netto > 0 ? "pos" : ""));
    els.sumNeu.textContent = fmtMoney(neu);
    els.sumNeu.className = "val mono " + (neu < 0 ? "neg" : "pos");

    // Verkaeufe an Kickbase sind sofort gebucht (Konto +MW, Teamwert -MW);
    // vorgemerkte Kaeufe zaehlen wie offene Gebote.
    var teamValue = 0;
    state.players.forEach(function(p){
      if (state.actions[p.id] !== 'sell') teamValue += p.mv;
    });
    var room = C.bidRoom(teamValue, state.budget + erlos, ausgaben);
    if (room.headroom >= 0){
      els.sumLimit.className = "limit-line ok";
      els.sumLimit.textContent = "33%-Regel: noch " + fmtMoney(room.headroom) + " Spielraum bis zum Minus-Limit (" + fmtMoney(room.maxNegative) + ")";
    } else {
      els.sumLimit.className = "limit-line warn";
      els.sumLimit.textContent = "33%-Regel: über dem Minus-Limit von " + fmtMoney(room.maxNegative) + " um " + fmtMoney(Math.abs(room.headroom));
    }

    updateConstraintWarnings();
  }

  // Prueft Kaderlimit (max. Kadergroesse) und Vereinslimit (max. Spieler je Klub)
  // gegen die aktuell simulierten Halten/Verkaufen/Kaufen-Entscheidungen. Die
  // 33%-Regel allein reicht nicht - Kickbase lehnt einen Kauf auch ab, wenn er
  // diese beiden Grenzen sprengt, selbst bei ausreichendem Kontostand.
  function updateConstraintWarnings(){
    var kept = state.players.filter(function(p){ return state.actions[p.id] !== 'sell'; });
    var bought = state.market.filter(function(p){ return !!state.buyActions[p.id]; });
    var warnings = [];

    if (state.squadLimit != null){
      var size = kept.length + bought.length;
      if (size > state.squadLimit){
        warnings.push("Kaderlimit " + state.squadLimit + " überschritten (" + size + " Spieler nach dieser Auswahl)");
      }
    }

    if (state.clubLimit != null){
      var byClub = {};
      kept.concat(bought).forEach(function(p){
        if (!p.tid) return;
        byClub[p.tid] = (byClub[p.tid] || 0) + 1;
      });
      Object.keys(byClub).forEach(function(tid){
        if (byClub[tid] > state.clubLimit){
          var name = state.clubNames[tid] || ("Verein " + tid);
          warnings.push("Vereinslimit " + state.clubLimit + " überschritten: " + name + " (" + byClub[tid] + " Spieler)");
        }
      });
    }

    if (warnings.length){
      els.sumConstraints.hidden = false;
      els.sumConstraints.textContent = warnings.join(" · ");
    } else {
      els.sumConstraints.hidden = true;
      els.sumConstraints.textContent = "";
    }
  }

  // ---------- Transfermarkt ----------
  function renderMarket(){
    if (!state.market.length){
      els.squadBody.innerHTML = '<div class="empty-state">Aktuell keine Spieler im Transfermarkt.</div>';
      return;
    }
    // Freie Marktspieler (kein Angebot eines Managers) zuerst, sortiert nach
    // Ablaufzeit; Spieler, die von einem Manager angeboten werden, danach —
    // ebenfalls nach Ablaufzeit sortiert.
    var free = [], offers = [];
    state.market.forEach(function(p){ (p.offerBy ? offers : free).push(p); });
    var byExpiry = function(a, b){ return (a.expiresIn || 0) - (b.expiresIn || 0); };
    free.sort(byExpiry);
    offers.sort(byExpiry);

    var html = '<div class="pos-header">Läuft bald ab zuerst<span class="count">' + free.length + '</span></div>';
    html += '<div class="players">';
    free.forEach(function(p){ html += marketCardHtml(p); });
    html += '</div>';
    if (offers.length){
      html += '<div class="pos-header">Manager-Angebote<span class="count">' + offers.length + '</span></div>';
      html += '<div class="players">';
      offers.forEach(function(p){ html += marketCardHtml(p); });
      html += '</div>';
    }
    els.squadBody.innerHTML = html;

    state.market.forEach(function(p){
      var buyBtn = document.getElementById('buy-' + p.id);
      if (buyBtn) buyBtn.addEventListener('click', function(){ toggleBuy(p.id); });
    });
  }

  function fmtExpiry(sec){
    if (sec == null) return "kein Zeitlimit";
    if (sec <= 0) return "läuft ab";
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + " Std " + m + " Min";
    return m + " Min";
  }

  function marketCardHtml(p){
    var isBuy = !!state.buyActions[p.id];
    var urgent = p.expiresIn != null && p.expiresIn > 0 && p.expiresIn < 1800;
    return (
      '<div class="player-card">' +
        (p.img ? '<img class="player-photo" src="' + p.img + '" alt="">' : '<div class="player-photo"></div>') +
        '<div class="player-main">' +
          '<div class="player-name"><span class="pos-pill" style="margin-right:6px;">' + p.pos + '</span>' + escapeHtml(p.name) + (p.status ? ' <span class="status-dot" title="Status beachten"></span>' : '') + '</div>' +
          '<div class="player-sub">' +
            '<span class="player-mv mono">' + fmtMoney(p.price) + '</span>' +
            '<span class="expiry" style="' + (urgent ? 'color:var(--sell); font-weight:700;' : '') + '">' + fmtExpiry(p.expiresIn) + '</span>' +
          '</div>' +
          (p.offerBy ? '<div class="expiry">Angebot von ' + escapeHtml(p.offerBy) + ' — Forderung, kein Festpreis, oft verhandelbar</div>' : '') +
        '</div>' +
        '<button id="buy-' + p.id + '" class="buy-btn ' + (isBuy ? 'active-buy' : '') + '">' + (isBuy ? 'Vorgemerkt' : 'Kaufen') + '</button>' +
      '</div>'
    );
  }

  function toggleBuy(id){
    if (state.buyActions[id]) delete state.buyActions[id];
    else state.buyActions[id] = true;
    var btn = document.getElementById('buy-' + id);
    var isBuy = !!state.buyActions[id];
    if (btn){
      btn.className = 'buy-btn ' + (isBuy ? 'active-buy' : '');
      btn.textContent = isBuy ? 'Vorgemerkt' : 'Kaufen';
    }
    updateSummary();
  }

  // ---------- Gegner ----------
  function renderGegner(){
    if (!state.opponents.length){
      els.squadBody.innerHTML = '<div class="empty-state">Keine Manager gefunden.</div>';
      return;
    }
    if (!state.estimates && !state.estimatesLoading && !state.estimatesError){
      loadEstimates();
    }

    var html = '';
    var est = state.estimates;
    var check = '';
    if (est && est.check){
      var off = Math.abs(est.check.diff);
      check = ' Prüfstein: Für dich selbst ergibt dieselbe Rechnung ' + fmtMoney(est.check.estimate) +
        ', dein echter Kontostand ist ' + fmtMoney(est.check.real) + ' (Abweichung ' + fmtMoney(off) + ').' +
        (off > 1000000 ? ' Die Abweichung ist groß — die Gegnerwerte sind mit Vorsicht zu lesen.' : '');
    }
    html += '<div class="bonus-box">' +
      '<div class="bonus-box-title">Geschätzter Kontostand — so wird gerechnet</div>' +
      '<div class="expiry">Startbudget + alle Käufe und Verkäufe seit Ligastart + MVP-Auto-Verkäufe + Punkteprämie (' +
        fmtMoney(est ? est.pointValue : 1000) + ' je Saisonpunkt' + (est && est.pointValueCalibrated ? ', an deinem Konto geeicht' : '') +
        ') + Erfolgsprämien (Spieltagssiege, Punkteschwellen, Spielerpunkte, Transfers, Gewinne) + tägliche Auflaufprämie. ' +
        'Die Spanne kommt von der Auflaufprämie: oben bei täglichem Login, unten nur an Tagen mit Transfers.' + check + '</div>' +
    '</div>';

    var list = state.opponents.slice();
    if (est){
      list.sort(function(a, b){ return bidPower(b) - bidPower(a); });
    }
    html += '<div class="players" style="padding-top:10px;">';
    list.forEach(function(o){ html += opponentCardHtml(o); });
    html += '</div>';
    html += '<p class="footer-note">' + (
      state.estimatesLoading ? escapeHtml(state.estimatesProgress || 'Berechne Kontostände …')
      : state.estimatesError ? 'Kontostände konnten nicht berechnet werden. <button class="link-btn" id="retryEst">Erneut versuchen</button>'
      : 'Sortiert nach Bietkraft: geschätzter Kontostand + Spielraum bis zur 33%-Grenze. Wer keinen freien Kaderplatz hat, kann nicht mitbieten.'
    ) + '</p>';
    els.squadBody.innerHTML = html;

    var retry = document.getElementById('retryEst');
    if (retry) retry.addEventListener('click', function(){ state.estimatesError = false; renderGegner(); });
    state.opponents.forEach(function(o){
      var head = document.getElementById('opphead-' + o.id);
      if (head) head.addEventListener('click', function(){ toggleOpponent(o.id); });
    });
  }

  function loadEstimates(){
    if (!state.currentLeague) return;
    state.estimatesLoading = true;
    var league = state.currentLeague;
    var overviewPromise = state.leagueOverview
      ? Promise.resolve(state.leagueOverview)
      : client.get("/leagues/" + league.i + "/overview");
    overviewPromise.then(function(ov){
      state.leagueOverview = ov;
      return KBData.estimateAll({
        client: client, league: league, overview: ov,
        managers: state.opponents.map(function(o){ return {id: o.id, name: o.name}; }),
        myUserId: state.myUserId, myBudget: state.budget,
        onProgress: function(msg){
          state.estimatesProgress = msg;
          if (state.activeTab === 'gegner' && state.currentLeague === league) renderGegner();
        }
      });
    }).then(function(res){
      if (state.currentLeague !== league) return;
      state.estimates = res;
      state.estimatesLoading = false;
      if (state.activeTab === 'gegner') renderGegner();
    }).catch(function(err){
      if (state.currentLeague !== league) return;
      state.estimatesLoading = false;
      state.estimatesError = true;
      if (err && err.auth){ showFetchError(els.squadBody, err, null); return; }
      if (state.activeTab === 'gegner') renderGegner();
    });
  }

  function estimateFor(o){
    return state.estimates && state.estimates.byUser[String(o.id)] || null;
  }

  // Bietkraft = Kontostand + Spielraum bis zur 33%-Grenze; ohne freien Platz 0.
  function bidPower(o){
    var e = estimateFor(o);
    if (!e) return -Infinity;
    if (e.freeSlots === 0) return 0;
    var budget = o.isMe ? state.budget : e.estimate.mid;
    return Math.max(0, C.bidRoom(e.teamValue, budget).headroom);
  }

  function opponentCardHtml(o){
    var isOpen = state.openOpponent === o.id;
    var body = "";
    if (isOpen){
      var detail = state.opponentDetails[o.id];
      if (!detail){
        body = '<div class="spinner" style="margin:16px auto;"></div>';
        loadOpponentDetail(o);
      } else if (detail.error){
        body = '<div class="opp-lineup"><span class="expiry">Kader konnte nicht geladen werden.</span></div>';
      } else {
        body = '<div class="opp-lineup"><div class="opp-lineup-title">Aktueller Kader (' + detail.length + ')</div>';
        detail.forEach(function(pl){
          var trendClass = pl.trend >= 0 ? 'pos' : 'neg';
          body +=
            '<div class="opp-player">' +
              '<div class="row-top">' +
                '<span class="pos-pill">' + pl.pos + '</span>' +
                '<span class="name">' + escapeHtml(pl.name) + (pl.status ? ' <span class="status-dot" title="Status beachten"></span>' : '') + '</span>' +
              '</div>' +
              '<div class="row-bottom">' +
                '<span class="mv mono">' + fmtMoney(pl.mv) + '</span>' +
                '<span class="trend ' + trendClass + '">' + fmtDelta(pl.trend) + '</span>' +
                '<span class="pts">' + (pl.avgPoints != null ? pl.avgPoints : '–') + ' ⌀P</span>' +
              '</div>' +
              (pl.purchasePrice != null ? '<div class="row-bottom"><span class="expiry">Kaufpreis: ' + fmtMoney(pl.purchasePrice) + ' · ' + fmtDelta(pl.mv - pl.purchasePrice) + ' seit Kauf</span></div>' : '') +
            '</div>';
        });
        body += '</div>';
      }
    }

    var e = estimateFor(o);
    var lines = "";
    if (e){
      var teamLine = fmtMoney(e.teamValue) + ' Kaderwert · ' + e.squadSize + ' Spieler' +
        (e.freeSlots != null ? ' · ' + (e.freeSlots === 0 ? 'kein Platz frei' : e.freeSlots + ' frei') : '');
      var budget = o.isMe ? state.budget : e.estimate.mid;
      var room = C.bidRoom(e.teamValue, budget);
      var budgetText = o.isMe
        ? fmtMoney(state.budget) + ' Kontostand (echt)'
        : '≈ ' + fmtMoney(e.estimate.low) + ' bis ' + fmtMoney(e.estimate.high) + ' Kontostand';
      var below = !o.isMe && e.estimate.high < C.minReachableBudget(e.teamValue);
      lines =
        '<div class="opp-meta">' + teamLine + '</div>' +
        '<div class="opp-meta" id="oppbudget-' + o.id + '">' + budgetText + '</div>' +
        '<div class="opp-meta">' + (e.freeSlots === 0
          ? 'Bietkraft: 0 (Kader voll)'
          : 'Bietkraft: ' + (o.isMe ? '' : '≈ ') + fmtMoney(Math.max(0, room.headroom)) + ' bis zur 33%-Grenze') + '</div>' +
        (below ? '<div class="opp-meta" style="color:var(--sell)">Unplausibel tief — vermutlich fehlen Daten</div>' : '');
    } else if (state.estimatesLoading){
      lines = '<div class="opp-meta" id="oppbudget-' + o.id + '">Kontostand wird berechnet …</div>';
    }

    return (
      '<div class="opp-card' + (isOpen ? ' open' : '') + '">' +
        '<button class="opp-head" id="opphead-' + o.id + '">' +
          (o.img ? '<img class="opp-avatar" src="' + o.img + '" alt="">' : '<div class="opp-avatar"></div>') +
          '<div class="opp-info">' +
            '<div class="opp-name">' + escapeHtml(o.name) + (o.isMe ? '<span class="you">Du</span>' : '') + '</div>' +
            '<div class="opp-meta">' + o.points + ' Punkte' + (e && e.wins ? ' · ' + e.wins + '× Spieltagssieger' : '') + '</div>' +
            lines +
          '</div>' +
          '<span class="opp-chev">›</span>' +
        '</button>' +
        body +
      '</div>'
    );
  }

  function toggleOpponent(id){
    state.openOpponent = (state.openOpponent === id) ? null : id;
    renderGegner();
  }

  // Kompletter aktueller Kader eines beliebigen Managers (nicht nur die letzte
  // Aufstellung) inkl. Kaufpreis pro Spieler, wo bekannt — ein einziger Aufruf.
  function loadOpponentDetail(o){
    if (!state.currentLeague){
      state.opponentDetails[o.id] = [];
      renderGegner();
      return;
    }
    var id = state.currentLeague.i;
    fetch(API + "/leagues/" + id + "/managers/" + o.id + "/squad", {headers: headers()})
      .then(handleResponse)
      .then(function(sq){
        var it = sq.it || [];
        var list = it.map(function(p){
          return {
            name: p.pn || "Unbekannt",
            pos: POS_MAP[p.pos] || "UNK",
            mv: p.mv || 0,
            trend: p.mvgl || 0,
            purchasePrice: p.prc != null ? p.prc : null,
            avgPoints: p.ap != null ? p.ap : null,
            status: p.st || 0
          };
        });
        var posOrder = {"TW":1, "ABW":2, "MF":3, "ANG":4};
        list.sort(function(a,b){ return (posOrder[a.pos]||5) - (posOrder[b.pos]||5); });
        state.opponentDetails[o.id] = list;
        if (state.openOpponent === o.id) renderGegner();
      }).catch(function(){
        state.opponentDetails[o.id] = {error:true};
        if (state.openOpponent === o.id) renderGegner();
      });
  }

  // ---------- helpers ----------
  function handleResponse(res){
    if (res.status === 401 || res.status === 403){
      var e = new Error("auth");
      e.auth = true;
      throw e;
    }
    if (!res.ok){
      var e2 = new Error("http-" + res.status);
      throw e2;
    }
    return res.json();
  }

  function showFetchError(container, err, retryFn){
    if (err && err.auth){
      container.innerHTML =
        '<div class="empty-state">Dein Token wurde von Kickbase abgelehnt — vermutlich ist er abgelaufen.<br><br>' +
        '<button class="link-btn" id="reAuthBtn">Neuen Token eingeben</button></div>';
      var btn = document.getElementById('reAuthBtn');
      if (btn) btn.addEventListener('click', function(){
        try { localStorage.removeItem('kb_token'); } catch(e){}
        show('setup');
      });
      return;
    }
    container.innerHTML =
      '<div class="empty-state">Verbindung zu Kickbase hat nicht geklappt.<br>Prüfe dein Netz und versuch es nochmal.<br><br>' +
      '<button class="link-btn" id="retryBtn">Erneut versuchen</button></div>';
    var rb = document.getElementById('retryBtn');
    if (rb && retryFn) rb.addEventListener('click', retryFn);
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  tryStoredToken();
})();
