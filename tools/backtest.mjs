// Rueckrechnung des Gegnermodells: Jeder Startelf-Einsatz der letzten und der
// laufenden Saison wird nur mit den Daten vor dem jeweiligen Spieltag vorhergesagt.
// Verglichen wird der Saisonschnitt des Spielers mit Schnitt x Gegnerfaktor.
//
//   node tools/backtest.mjs private/kb-players.json
//
// Die Datei erzeugt tools/collect.html aus einem eingeloggten play.kickbase.com-Tab
// (nur GET). Sie enthaelt echte Ligadaten und liegt deshalb in private/ (nie im Repo).
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../src/calc.js');

const file = process.argv[2] || 'private/kb-players.json';
const dump = JSON.parse(fs.readFileSync(file, 'utf8'));

// ph-Zeilen: [day, p, st, mp, t1, t2, t1g, t2g, pt, md, ap]
const tis = [...new Set(dump.players.flatMap(p => p.seasons.map(s => s.ti)).filter(t => /^\d{4}\/\d{4}$/.test(t)))].sort();
const cur = tis[tis.length - 1], prev = tis[tis.length - 2], prev2 = tis[tis.length - 3];
const order = [prev2, prev, cur].filter(Boolean);
const idx = t => order.indexOf(t);

const matches = new Map();
const players = dump.players.map(pl => {
  const games = [];
  pl.seasons.filter(s => order.includes(s.ti)).forEach(s => s.ph.forEach(([day, p, st, , t1, t2, t1g, t2g, pt, md]) => {
    const t = Date.parse(md);
    if (t1g != null && t2g != null) matches.set(`${t1}-${t2}-${md}`, { ti: s.ti, md: t, home: String(t1), away: String(t2), hg: t1g, ag: t2g });
    if (st === 5 && p != null && pt) {
      const home = String(pt) === String(t1);
      games.push({ ti: s.ti, md: t, p, home, opp: String(home ? t2 : t1) });
    }
  }));
  return { pos: pl.pos, games: games.sort((a, b) => a.md - b.md) };
});
const M = [...matches.values()].sort((a, b) => a.md - b.md);

// Ziele nach Kalendertag gruppieren, damit das Modell je Tag nur einmal gerechnet wird
const groups = new Map();
players.forEach(pl => pl.games.forEach(g => {
  if (g.ti !== cur && g.ti !== prev) return;
  const key = g.ti + '|' + new Date(g.md).toISOString().slice(0, 10);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ pl, g });
}));

let n = 0, se0 = 0, se1 = 0, d = 0, dd = 0;
for (const key of [...groups.keys()].sort()) {
  const [ti, day] = key.split('|'), cutoff = Date.parse(day + 'T00:00:00Z'), si = idx(ti);
  const inWindow = t => idx(t) === si || idx(t) === si - 1;
  const R = C.teamRatings(M.filter(m => m.md < cutoff && inWindow(m.ti)).map(m => ({ ...m, w: idx(m.ti) === si ? 1 : C.OPP.prevSeason })));
  const hist = players.map(pl => ({ pos: pl.pos, games: pl.games.filter(g => g.md < cutoff && inWindow(g.ti)).map(g => ({ ...g, prev: idx(g.ti) !== si })) }));
  const allow = C.opponentAllowance(hist);
  const slopes = {};
  [1, 2, 3, 4].forEach(pos => {
    slopes[pos] = C.positionSlope(hist.filter(h => h.pos === pos).map(h => {
      let W = 0, S = 0;
      const games = h.games.map(g => { const w = g.prev ? 0.5 : 1; W += w; S += w * g.p; return { p: g.p, w, x: C.matchEdge(R, g.opp, g.home) }; });
      return { quality: W ? S / W : null, games };
    }), C.OPP.slope[pos]);
  });
  for (const { pl, g } of groups.get(key)) {
    const before = pl.games.filter(x => x.md < cutoff && inWindow(x.ti));
    if (before.length < 3) continue;
    let W = 0, S = 0;
    before.forEach(x => { const w = idx(x.ti) === si ? 1 : 0.5; W += w; S += w * x.p; });
    const mean = S / W;
    const f = C.matchFactor(allow[g.opp + '|' + pl.pos], slopes[pl.pos], C.matchEdge(R, g.opp, g.home));
    const e0 = (g.p - mean) ** 2, e1 = (g.p - mean * f) ** 2;
    n++; se0 += e0; se1 += e1; d += e1 - e0; dd += (e1 - e0) ** 2;
  }
}
const md = d / n, se = Math.sqrt((dd / n - md * md) / n);
console.log(`Saisons ${order.join(', ')} · ${dump.players.length} Spieler · ${n} vorhergesagte Startelf-Einsaetze`);
console.log(`RMSE Saisonschnitt:          ${Math.sqrt(se0 / n).toFixed(2)} Punkte`);
console.log(`RMSE Schnitt x Gegnerfaktor: ${Math.sqrt(se1 / n).toFixed(2)} Punkte`);
console.log(`Differenz der quadrierten Fehler: ${md.toFixed(1)} ± ${se.toFixed(1)} (negativ = Gegnerfaktor besser)`);
