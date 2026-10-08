// Kaderplaner - kleine SVG-Grafiken ohne Bibliothek. Farben kommen nur ueber
// CSS-Klassen aus styles.css (Tokens --ink, --faint, --line, --neg), damit hell und
// dunkel automatisch passen. Liefert HTML-Strings; bind* haengt Zeigen/Tippen an.
(function (root) {
  "use strict";

  var PLOT_TOP = 8, AXIS_H = 20, LABEL_W = 52;

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  function r1(n){ return Math.round(n * 10) / 10; }

  // Runde Teilung fuer 3-4 Rasterlinien (1, 2, 2,5, 5 je Zehnerpotenz)
  function niceStep(span, count){
    var raw = span / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * mag >= raw) return steps[i] * mag;
    return 10 * mag;
  }
  function ticks(lo, hi, count){
    var step = niceStep(hi - lo, count), out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(v);
    return out;
  }

  function dateLabel(t){ var d = new Date(t); return d.getDate() + '.' + (d.getMonth() + 1) + '.'; }

  // ---------- Linie: Marktwertverlauf ----------
  function lineGeom(series, opts){
    var w = opts.width, h = opts.height || 132, plotH = h - PLOT_TOP - AXIS_H, plotW = w - LABEL_W;
    var vals = series.map(function(p){ return p.mv; });
    (opts.others || []).forEach(function(o){ o.forEach(function(p){ vals.push(p.mv); }); });
    if (opts.ref != null) vals.push(opts.ref);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.08 || hi * 0.05 || 1;
    lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad; hi = hi + pad;
    var t0 = series[0].t, t1 = series[series.length - 1].t;
    return {
      w: w, h: h, plotW: plotW, plotH: plotH, lo: lo, hi: hi,
      x: function(t){ return t1 === t0 ? plotW / 2 : (t - t0) / (t1 - t0) * plotW; },
      y: function(v){ return PLOT_TOP + (1 - (v - lo) / (hi - lo)) * plotH; }
    };
  }

  function line(series, opts){
    if (!series || series.length < 2) return '';
    var g = lineGeom(series, opts), fmt = opts.fmt || String, out = [];
    out.push('<svg class="ch" width="' + g.w + '" height="' + g.h + '" viewBox="0 0 ' + g.w + ' ' + g.h + '" role="img" aria-label="' + esc(opts.label || '') + '">');
    ticks(g.lo, g.hi, 4).forEach(function(v){
      var y = r1(g.y(v));
      out.push('<line class="ch-grid" x1="0" x2="' + g.plotW + '" y1="' + y + '" y2="' + y + '"/>');
      out.push('<text x="' + (g.plotW + 8) + '" y="' + (y + 4) + '">' + esc(fmt(v)) + '</text>');
    });
    var base = PLOT_TOP + g.plotH;
    out.push('<text x="0" y="' + (base + 16) + '">' + dateLabel(series[0].t) + '</text>');
    out.push('<text x="' + g.plotW + '" y="' + (base + 16) + '" text-anchor="end">' + dateLabel(series[series.length - 1].t) + '</text>');
    if (opts.ref != null){
      var ry = r1(g.y(opts.ref));
      out.push('<line class="ch-ref" x1="0" x2="' + g.plotW + '" y1="' + ry + '" y2="' + ry + '"/>');
      if (opts.refLabel) out.push('<text class="ch-reflabel" x="4" y="' + (ry - 5) + '">' + esc(opts.refLabel) + '</text>');
    }
    var path = function(s){ return s.map(function(p, i){ return (i ? 'L' : 'M') + r1(g.x(p.t)) + ' ' + r1(g.y(p.mv)); }).join(''); };
    // Vergleichslinien (andere Manager) zuerst und zurueckgenommen, die eigene obenauf
    (opts.others || []).forEach(function(o){ if (o.length > 1) out.push('<path class="ch-line other" d="' + path(o) + '"/>'); });
    if (g.lo < 0 && g.hi > 0) out.push('<line class="ch-zero" x1="0" x2="' + g.plotW + '" y1="' + r1(g.y(0)) + '" y2="' + r1(g.y(0)) + '"/>');
    out.push('<path class="ch-line" d="' + path(series) + '"/>');
    out.push('<line class="ch-cross" data-cross x1="0" x2="0" y1="' + PLOT_TOP + '" y2="' + base + '" hidden/>');
    var last = series[series.length - 1];
    out.push('<circle class="ch-dot" data-dot r="4" cx="' + r1(g.x(last.t)) + '" cy="' + r1(g.y(last.mv)) + '"/>');
    out.push('<rect class="ch-hit" x="0" y="0" width="' + g.plotW + '" height="' + g.h + '"/>');
    return out.join('') + '</svg>';
  }

  // Zeigen oder Tippen: Fadenkreuz auf den naechsten Tag, Wert in readout.
  // Ohne Zeiger zeigt readout wieder den letzten Wert.
  function bindLine(svg, series, opts, readout, text){
    if (!svg || !series || series.length < 2) return;
    var g = lineGeom(series, opts), cross = svg.querySelector('[data-cross]'), dot = svg.querySelector('[data-dot]');
    function showAt(i){
      var p = series[i], x = r1(g.x(p.t));
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.removeAttribute('hidden');
      dot.setAttribute('cx', x); dot.setAttribute('cy', r1(g.y(p.mv)));
      if (readout) readout.innerHTML = text(p, i);
    }
    function reset(){
      var i = series.length - 1;
      cross.setAttribute('hidden', '');
      dot.setAttribute('cx', r1(g.x(series[i].t))); dot.setAttribute('cy', r1(g.y(series[i].mv)));
      if (readout) readout.innerHTML = text(series[i], i);
    }
    function move(e){
      var box = svg.getBoundingClientRect(), x = (e.clientX - box.left) * (g.w / box.width);
      var best = 0, dist = Infinity;
      series.forEach(function(p, i){ var dd = Math.abs(g.x(p.t) - x); if (dd < dist){ dist = dd; best = i; } });
      showAt(best);
    }
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', reset);
    reset();
  }

  // ---------- Saeulen: Punkte je Spieltag ----------
  // points: [{day, p, kind: 'start'|'sub'|'out'}]. Saeulen hoechstens 24px breit,
  // 4px runde Kante am Datenende, eckig an der Nulllinie.
  function barGeom(points, opts){
    var w = opts.width, h = opts.height || 112, plotH = h - PLOT_TOP - AXIS_H;
    var hi = Math.max(10, Math.max.apply(null, points.map(function(p){ return p.p; })));
    var lo = Math.min(0, Math.min.apply(null, points.map(function(p){ return p.p; })));
    var n = Math.max(points.length, opts.minSlots || 0), slot = w / n;
    return {
      w: w, h: h, slot: slot, bw: Math.max(3, Math.min(24, slot - 2)), lo: lo, hi: hi,
      y: function(v){ return PLOT_TOP + (1 - (v - lo) / (hi - lo)) * plotH; }
    };
  }

  function barPath(x, y0, y1, w){
    var top = Math.min(y0, y1), bot = Math.max(y0, y1), r = Math.min(4, w / 2, bot - top);
    if (y1 <= y0){   // nach oben: oben rund
      return 'M' + x + ' ' + bot + 'V' + (top + r) + 'Q' + x + ' ' + top + ' ' + (x + r) + ' ' + top +
        'H' + (x + w - r) + 'Q' + (x + w) + ' ' + top + ' ' + (x + w) + ' ' + (top + r) + 'V' + bot + 'Z';
    }
    return 'M' + x + ' ' + top + 'V' + (bot - r) + 'Q' + x + ' ' + bot + ' ' + (x + r) + ' ' + bot +
      'H' + (x + w - r) + 'Q' + (x + w) + ' ' + bot + ' ' + (x + w) + ' ' + (bot - r) + 'V' + top + 'Z';
  }

  function bars(points, opts){
    if (!points || !points.length) return '';
    var g = barGeom(points, opts), out = [], y0 = r1(g.y(0)), maxI = 0;
    points.forEach(function(p, i){ if (p.p > points[maxI].p) maxI = i; });
    out.push('<svg class="ch" width="' + g.w + '" height="' + g.h + '" viewBox="0 0 ' + g.w + ' ' + g.h + '" role="img" aria-label="' + esc(opts.label || '') + '">');
    out.push('<line class="ch-grid" x1="0" x2="' + g.w + '" y1="' + y0 + '" y2="' + y0 + '"/>');
    points.forEach(function(p, i){
      var x = r1(i * g.slot + (g.slot - g.bw) / 2), cls = p.kind === 'out' ? 'out' : (p.p < 0 ? 'neg' : p.kind);
      if (p.kind === 'out') out.push('<rect class="ch-bar out" data-bar="' + i + '" x="' + x + '" y="' + (y0 - 2) + '" width="' + r1(g.bw) + '" height="2" rx="1"/>');
      else if (p.p !== 0) out.push('<path class="ch-bar ' + cls + '" data-bar="' + i + '" d="' + barPath(x, y0, r1(g.y(p.p)), r1(g.bw)) + '"/>');
      else out.push('<rect class="ch-bar ' + cls + '" data-bar="' + i + '" x="' + x + '" y="' + (y0 - 2) + '" width="' + r1(g.bw) + '" height="2" rx="1"/>');
      // Spieltag unter der Saeule: erster, letzter und jeder fuenfte
      if (i === 0 || i === points.length - 1 || p.day % 5 === 0)
        out.push('<text x="' + r1(i * g.slot + g.slot / 2) + '" y="' + (g.h - 4) + '" text-anchor="middle">' + p.day + '</text>');
    });
    // Nur der beste Spieltag bekommt seinen Wert, der Rest steht im Tooltip
    var mp = points[maxI];
    if (mp.p > 0) out.push('<text class="ch-max" x="' + r1(maxI * g.slot + g.slot / 2) + '" y="' + r1(g.y(mp.p) - 5) + '" text-anchor="middle">' + mp.p + '</text>');
    points.forEach(function(p, i){
      out.push('<rect class="ch-hit" data-hit="' + i + '" x="' + r1(i * g.slot) + '" y="0" width="' + r1(g.slot) + '" height="' + g.h + '"/>');
    });
    return out.join('') + '</svg>';
  }

  function bindBars(svg, points, readout, text, idle){
    if (!svg || !points || !points.length) return;
    var active = null;
    function set(i){
      if (active === i) return;
      active = i;
      svg.classList.toggle('picking', i != null);
      Array.prototype.forEach.call(svg.querySelectorAll('[data-bar]'), function(b){ b.classList.toggle('on', +b.getAttribute('data-bar') === i); });
      if (readout) readout.innerHTML = i == null ? idle : text(points[i]);
    }
    Array.prototype.forEach.call(svg.querySelectorAll('[data-hit]'), function(r){
      var i = +r.getAttribute('data-hit');
      r.addEventListener('pointerenter', function(){ set(i); });
      r.addEventListener('pointerdown', function(){ set(i); });
    });
    svg.addEventListener('pointerleave', function(e){ if (e.pointerType === 'mouse') set(null); });
    if (readout) readout.innerHTML = idle;
  }

  root.KBCharts = { line: line, bindLine: bindLine, bars: bars, bindBars: bindBars, ticks: ticks };
})(typeof self !== 'undefined' ? self : this);
