import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const C = require('../src/calc.js');
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/liga2-2026-10-08.json', import.meta.url)));

function statsFor(m){
  return {
    wins: m.mdw, matchdayPoints: m.mdp, maxPlayerPoints: m.mpp, seasonPoints: m.tp,
    transferCount: m.dashboardT, profits: m.profits, managerCount: fx.managerCount,
    teamValue: m.tv, mvpCount: m.autoSales.length
  };
}

function estimate(m){
  const rewards = C.defaultRewards(fx.cpi);
  const { step, cap } = C.loginDefaults(fx.cpi);
  const days = C.calendarDaysInclusive(Date.parse(fx.created), Date.parse(fx.now));
  const ledger = { net: m.sells - m.buys };
  return C.estimateBudget({
    startBudget: fx.startBudget, ledger, autoSales: m.autoSales,
    seasonPoints: m.tp, pointValue: 1000,
    achievements: C.achievementTotal(C.achievementCounts(statsFor(m)), rewards),
    loginHigh: C.loginStreakTotal(days, step, cap),
    loginLow: C.loginStreakTotal(Math.min(m.activeDays, days), step, cap)
  });
}

test('33%-Regel: Beispiel aus der Kickbase-Hilfe', () => {
  // 100 Mio Teamwert, -10 Mio Konto -> Grenze 33% von 90 Mio
  const r = C.bidRoom(100e6, -10e6);
  assert.equal(Math.round(r.maxNegative), -29.7e6);
  assert.equal(Math.round(r.headroom), 19.7e6);
  // positives Konto zaehlt mit
  assert.equal(Math.round(C.bidRoom(100e6, 20e6).headroom), 59.6e6);
  // offene Gebote verringern den Spielraum
  assert.equal(Math.round(C.bidRoom(100e6, 20e6, 50e6).headroom), 9.6e6);
  // am tiefsten erreichbaren Kontostand ist kein Spielraum mehr
  const b = C.minReachableBudget(100e6);
  assert.ok(Math.abs(C.bidRoom(100e6, b).headroom) < 1);
});

test('Auflaufpraemie: Staffel mit Deckel', () => {
  assert.equal(C.loginStreakTotal(1, 5000, 50000), 5000);
  assert.equal(C.loginStreakTotal(10, 5000, 50000), 275000);
  assert.equal(C.loginStreakTotal(12, 10000, 100000), 750000);
  // Luecke startet die Serie neu
  assert.equal(C.loginTotalForDays([1, 2, 3, 5], 5000, 50000), 5000 + 10000 + 15000 + 5000);
});

test('Kalendertage in Berliner Zeit', () => {
  assert.equal(C.calendarDaysInclusive(Date.parse(fx.created), Date.parse(fx.now)), 67);
  // 23:30 Berlin am 1.8. und 00:30 Berlin am 2.8. sind zwei Tage
  assert.equal(C.calendarDaysInclusive(Date.parse('2026-08-01T21:30:00Z'), Date.parse('2026-08-01T22:30:00Z')), 2);
});

test('Transferbuch: Saldo, Gewinne pro Spieler, offene Kaeufe', () => {
  const l = C.transferLedger([
    { pi: 1, pn: 'X', tty: 1, trp: 5e6, dt: '2026-08-04T10:00:00Z' },
    { pi: 2, pn: 'Y', tty: 1, trp: 3e6, dt: '2026-08-05T10:00:00Z' },
    { pi: 1, pn: 'X', tty: 2, trp: 9e6, dt: '2026-08-10T10:00:00Z' },
    { pi: 3, pn: 'Z', tty: 1, trp: 2e6, dt: '2026-08-11T10:00:00Z' }
  ]);
  assert.equal(l.net, 9e6 - 10e6);
  assert.deepEqual(l.profits, [4e6]);
  assert.deepEqual(Object.keys(l.open).sort(), ['2', '3']);
  const auto = C.detectAutoSales(l, [3], { 2: 3.5e6 });
  assert.deepEqual(auto, [{ pi: '2', pn: 'Y', trp: 3.5e6, estimated: false }]);
  assert.equal(C.detectAutoSales(l, [3], {})[0].estimated, true);
});

test('Erfolge: Manager A ergibt exakt die echten 2,55 Mio', () => {
  const a = fx.managers[0];
  const counts = C.achievementCounts(statsFor(a));
  assert.deepEqual(counts, { 100: 1, 200: 1, 300: 2, 301: 2, 302: 1, 500: 1, 501: 1, 600: 1, 700: 1, 701: 1, 5001: 1 });
  assert.equal(C.achievementTotal(counts, C.defaultRewards('2')), fx.realAchievementsA);
});

// Kader nach dem Muster einer echten 2.-Liga-Mannschaft (Namen erfunden)
const SQUAD = [
  { id: 'tw1', pos: 'TW', mv: 6.7e6, ap: 119 }, { id: 'tw2', pos: 'TW', mv: 0.9e6, ap: 40 },
  { id: 'a1', pos: 'ABW', mv: 13.8e6, ap: 127 }, { id: 'a2', pos: 'ABW', mv: 12.2e6, ap: 119 },
  { id: 'a3', pos: 'ABW', mv: 9.6e6, ap: 104 }, { id: 'a4', pos: 'ABW', mv: 6.6e6, ap: 78 },
  { id: 'a5', pos: 'ABW', mv: 4.1e6, ap: 70 }, { id: 'a6', pos: 'ABW', mv: 2.0e6, ap: 50 },
  { id: 'a7', pos: 'ABW', mv: 1.5e6, ap: 30 },
  { id: 'm1', pos: 'MF', mv: 12.5e6, ap: 159 }, { id: 'm2', pos: 'MF', mv: 12.6e6, ap: 127 },
  { id: 'm3', pos: 'MF', mv: 2.9e6, ap: 44 }, { id: 'm4', pos: 'MF', mv: 0.25e6, ap: 20 },
  { id: 's1', pos: 'ANG', mv: 9.6e6, ap: 104 }, { id: 's2', pos: 'ANG', mv: 12.6e6, ap: 100, status: 1 },
  { id: 's3', pos: 'ANG', mv: 3.0e6, ap: 60 }
];

test('Beste Elf: Formation und Punkte, verletzte Spieler zaehlen nicht', () => {
  const r = C.bestEleven(SQUAD);
  // 5-3-2 nutzt die Abwehrtiefe; der verletzte Stuermer s2 zaehlt nur 40 % (40 P),
  // deshalb spielt s3 (60 P) und nicht der vierte Mittelfeldspieler (20 P)
  assert.equal(r.formation, '5-3-2');
  assert.equal(r.points, 119 + (127 + 119 + 104 + 78 + 70) + (159 + 127 + 44) + (104 + 60));
  // fehlende Spieler kosten je 100 Punkte
  assert.equal(C.bestEleven([{ pos: 'TW', ap: 100 }]).points, 100 - 1000);
});

test('Verkaufsempfehlung: erst Bank und Verletzte, Betrag reicht, Ergebnis optimal', () => {
  const need = 14e6;
  const r = C.recommendSales(SQUAD, need);
  assert.ok(r.possible);
  assert.ok(r.points.money >= need);
  // Der verletzte Stuermer (12,6 Mio, nicht in der besten Elf) ist der offensichtliche Verkauf
  assert.ok(r.points.ids.includes('s2'));
  // Gegenprobe per Brute Force: keine Kombination verliert weniger Punkte
  const ids = SQUAD.map(p => p.id);
  let bestLoss = Infinity;
  for (let mask = 1; mask < 1 << ids.length; mask++){
    const sold = SQUAD.filter((p, i) => (mask >> i) & 1);
    if (sold.reduce((s, p) => s + p.mv, 0) < need) continue;
    const left = SQUAD.filter((p, i) => !((mask >> i) & 1));
    bestLoss = Math.min(bestLoss, r.base.points - C.bestEleven(left).points);
  }
  // Punkte werden auf ganze Punkte gerundet verglichen (Marktwerttrend als Gleichstandsregel)
  assert.ok(r.points.loss - bestLoss < 1, `${r.points.loss} vs ${bestLoss}`);
  // "fewest" verkauft hoechstens so viele Spieler wie "points"
  if (r.fewest) assert.ok(r.fewest.count <= r.points.count);
});

test('Verkaufsempfehlung: vorgemerkte Kaeufe fuellen die Elf, sind aber nicht verkaufbar', () => {
  const buy = { id: 'neu', pos: 'ANG', mv: 20e6, ap: 150 };
  const r = C.recommendSales(SQUAD, 14e6, { fixed: [buy] });
  assert.ok(!r.points.ids.includes('neu'));
  // Mit dem neuen Stuermer wird der bisherige Stuermer s1 entbehrlicher
  const without = C.recommendSales(SQUAD, 14e6);
  assert.ok(r.points.loss <= without.points.loss);
});

test('Form: Einsaetze, Startelf und Punkte der letzten 5 Spieltage', () => {
  const ph = [
    { day: 1, p: 120, mp: "90'", st: 5 }, { day: 2, p: 80, mp: "90'", st: 5 },
    { day: 3, p: 0, mp: "0'" },                     // nicht gespielt
    { day: 4, p: 40, mp: "20'", st: 3 },            // eingewechselt
    { day: 5, p: 150, mp: "90'", st: 5 },
    { day: 6, p: 130, mp: "88'", st: 5 }
    // Spieltag 7 fehlt ganz: nicht im Kader
  ];
  const f = C.formFromPerformance(ph, 7);
  assert.equal(f.apps, 5);
  assert.equal(f.starts, 4);
  assert.equal(f.recentDays, 5);          // Spieltage 3 bis 7
  assert.equal(f.recentApps, 3);
  assert.equal(f.recentStarts, 2);
  assert.equal(f.recentPoints, 320);
  assert.deepEqual(f.last, [null, 40, 150, 130, null]);
});

test('Erwartete Punkte: Joker zaehlt weniger als Stammspieler mit gleichem Schnitt', () => {
  const stamm = { ap: 120, form: { teamDays: 10, apps: 10, recentDays: 5, recentApps: 5, recentPoints: 600 } };
  const joker = { ap: 120, form: { teamDays: 10, apps: 5, recentDays: 5, recentApps: 2, recentPoints: 240 } };
  assert.equal(Math.round(C.expectedPoints(stamm)), 120);
  // Einsatzchance 0.6 * 2/5 + 0.4 * 5/10 = 0.44
  assert.equal(Math.round(C.expectedPoints(joker)), Math.round(120 * 0.44));
  // Formtief: zuletzt nur 60 P pro Einsatz -> Qualitaet (120 + 60) / 2 = 90
  const tief = { ap: 120, form: { teamDays: 10, apps: 10, recentDays: 5, recentApps: 5, recentPoints: 300 } };
  assert.equal(Math.round(C.expectedPoints(tief)), 90);
  // ohne Leistungsdaten: Schnitt x Verfuegbarkeit
  assert.equal(C.expectedPoints({ ap: 100, status: 2 }), 90);
});

test('Verkaufsempfehlung: bei gleichen Punkten lieber fallende Marktwerte verkaufen', () => {
  const squad = SQUAD.concat([
    { id: 'b1', pos: 'MF', mv: 5e6, ap: 0, trend: 80000 },    // steigt
    { id: 'b2', pos: 'MF', mv: 5e6, ap: 0, trend: -80000 }    // faellt
  ]);
  const r = C.recommendSales(squad, 4.5e6);
  assert.ok(r.points.ids.includes('b2') && !r.points.ids.includes('b1'), r.points.ids.join());
});

test('Verkaufsempfehlung: unmoeglich, wenn der ganze Kader nicht reicht', () => {
  const r = C.recommendSales(SQUAD.slice(0, 2), 50e6);
  assert.equal(r.possible, false);
});

test('Pruefstein: Schaetzung fuer Manager A trifft den echten Kontostand', () => {
  const est = estimate(fx.managers[0]);
  assert.ok(Math.abs(est.mid - fx.realBudgetA) <= 60000, `Abweichung ${est.mid - fx.realBudgetA}`);
});

test('Gegner: Schaetzungen liegen ueber dem 33%-Minimum', () => {
  for (const m of fx.managers.slice(1)){
    const est = estimate(m);
    assert.ok(est.mid >= C.minReachableBudget(m.tv), `${m.id}: ${est.mid} < ${C.minReachableBudget(m.tv)}`);
    assert.ok(est.low <= est.mid && est.mid <= est.high);
  }
});

// ---------- Gegnerstaerke und Konstanz ----------
test('Teamstaerke: Reihenfolge aus Ergebnissen, Heimvorteil positiv', () => {
  const m = [];
  // A schlaegt alle, C verliert alles; Heimteams treffen jeweils ein Tor mehr
  for (let r = 0; r < 6; r++){
    m.push({ home: 'A', away: 'B', hg: 3, ag: 1 }, { home: 'B', away: 'A', hg: 1, ag: 1 });
    m.push({ home: 'A', away: 'C', hg: 4, ag: 0 }, { home: 'C', away: 'A', hg: 0, ag: 2 });
    m.push({ home: 'B', away: 'C', hg: 2, ag: 0 }, { home: 'C', away: 'B', hg: 1, ag: 1 });
  }
  const R = C.teamRatings(m, { lambda: 1 });
  assert.ok(R.r.A > R.r.B && R.r.B > R.r.C, JSON.stringify(R.r));
  assert.ok(R.home > 0.3, String(R.home));
  // Spiel gegen A ist schwerer als gegen C, daheim leichter als auswaerts
  assert.ok(C.matchEdge(R, 'A', true) < C.matchEdge(R, 'C', true));
  assert.ok(C.matchEdge(R, 'B', true) > C.matchEdge(R, 'B', false));
  // ohne Daten bleibt alles beim Mittel
  assert.equal(C.matchEdge(R, 'X', true), null);
});

test('Gegnerwerte: wer viele Punkte zulaesst, liegt ueber 0, Mittel je Position 0', () => {
  // vier Stuermer mit Schnitt 100; gegen "weich" doppelt so viele Punkte, gegen "hart" die Haelfte
  const players = [1, 2, 3, 4].map(() => ({ pos: 4, games: [
    { p: 100, opp: 'x' }, { p: 100, opp: 'y' }, { p: 200, opp: 'weich' }, { p: 50, opp: 'hart' }, { p: 100, opp: 'z' }
  ] }));
  const a = C.opponentAllowance(players, { k: 2 });
  assert.ok(a['weich|4'] > 0.2 && a['hart|4'] < -0.2, JSON.stringify(a));
  const vals = Object.keys(a).map(k => a[k]);
  assert.ok(Math.abs(vals.reduce((s, v) => s + v, 0) / vals.length) < 1e-9);
});

test('Gegnerfaktor: begrenzt auf 0,6 bis 1,4, naechste 3 Spiele 50/30/20', () => {
  assert.equal(C.matchFactor(0, 0.4, 0), 1);
  assert.equal(C.matchFactor(5, 1, 3), 1.4);
  assert.equal(C.matchFactor(-5, 1, -3), 0.6);
  assert.ok(Math.abs(C.horizonFactor([1.2, 1.0, 0.8], 3) - (0.6 + 0.3 + 0.16)) < 1e-9);
  assert.equal(C.horizonFactor([1.2, 1.0, 0.8], 1), 1.2);
  // nur zwei Spiele bekannt: 50/30 neu normiert
  assert.ok(Math.abs(C.horizonFactor([1.2, 0.8], 3) - (0.5 * 1.2 + 0.3 * 0.8) / 0.8) < 1e-9);
  assert.equal(C.horizonFactor([], 3), 1);
  // Der Faktor wirkt auf die Qualitaet, nicht auf die Einsatzchance
  assert.equal(C.expectedPoints({ ap: 100, fixture: 0.8 }), 80);
});

test('Konstanz: konstant, schwankend und zu wenige Spiele', () => {
  const k = C.playerConsistency([100, 90, 110, 95, 105, 100].map(p => ({ p })));
  assert.equal(k.label, 'konstant');
  const s = C.playerConsistency([300, 10, 20, 250, 15, 5].map(p => ({ p })));
  assert.equal(s.label, 'schwankend');
  assert.equal(C.playerConsistency([100, 100].map(p => ({ p }))).label, null);
});

test('Verkaufsempfehlung: schwerer Gegner und Konstanz entscheiden bei sonst gleichen Spielern', () => {
  const base = [
    { id: 'tw', pos: 'TW', mv: 1e6, ap: 100 },
    { id: 'a1', pos: 'ABW', mv: 1e6, ap: 100 }, { id: 'a2', pos: 'ABW', mv: 1e6, ap: 100 },
    { id: 'a3', pos: 'ABW', mv: 1e6, ap: 100 },
    { id: 'm1', pos: 'MF', mv: 1e6, ap: 100 }, { id: 'm2', pos: 'MF', mv: 1e6, ap: 100 },
    { id: 'm3', pos: 'MF', mv: 1e6, ap: 100 }, { id: 'm4', pos: 'MF', mv: 1e6, ap: 100 },
    { id: 's1', pos: 'ANG', mv: 1e6, ap: 100 }, { id: 's2', pos: 'ANG', mv: 1e6, ap: 100 },
    { id: 's3', pos: 'ANG', mv: 1e6, ap: 100 }
  ];
  const extra = [{ id: 'leicht', pos: 'ANG', mv: 5e6, ap: 100, fixture: 1.2 }, { id: 'schwer', pos: 'ANG', mv: 5e6, ap: 100, fixture: 0.8 }];
  const r = C.recommendSales(base.concat(extra), 4e6);
  assert.deepEqual(r.points.ids, ['schwer']);
  const cons = [{ id: 'fest', pos: 'ANG', mv: 5e6, ap: 50, cons: 0.9 }, { id: 'wackel', pos: 'ANG', mv: 5e6, ap: 50, cons: 0.3 }];
  assert.deepEqual(C.recommendSales(base.concat(cons), 4e6).points.ids, ['wackel']);
});

// ---------- Kaufempfehlung ----------
function elf(){
  return [
    { id: 'tw', pos: 'TW', mv: 2e6, ap: 100 },
    { id: 'a1', pos: 'ABW', mv: 2e6, ap: 100 }, { id: 'a2', pos: 'ABW', mv: 2e6, ap: 100 }, { id: 'a3', pos: 'ABW', mv: 2e6, ap: 100 },
    { id: 'a4', pos: 'ABW', mv: 2e6, ap: 40 },
    { id: 'm1', pos: 'MF', mv: 2e6, ap: 100 }, { id: 'm2', pos: 'MF', mv: 2e6, ap: 100 }, { id: 'm3', pos: 'MF', mv: 2e6, ap: 100 },
    { id: 'm4', pos: 'MF', mv: 2e6, ap: 100 },
    { id: 's1', pos: 'ANG', mv: 2e6, ap: 100 }, { id: 's2', pos: 'ANG', mv: 2e6, ap: 30 }
  ];
}

test('Kaufempfehlung: wer einen schwachen Stammspieler verdraengt, bringt die Differenz', () => {
  const squad = elf();
  const r = C.recommendBuys(squad, [], [
    { id: 'gut', pos: 'ANG', price: 3e6, ap: 110 },     // ersetzt s2 (30): +80
    { id: 'bank', pos: 'TW', price: 1e6, ap: 60 }       // schlechter als der Torwart: kein Gewinn
  ], { after: 10e6, teamValue: 22e6 });
  assert.equal(r.gains.gut, 80);
  assert.equal(r.gains.bank, 0);
  assert.deepEqual(r.list.map(x => x.id), ['gut']);
  assert.deepEqual(r.list[0].sells, []);
  assert.equal(r.list[0].after, 7e6);
  assert.ok(r.list[0].ok);
});

test('Kaufempfehlung: ohne Geld wird der danach ueberfluessige Spieler verkauft', () => {
  const squad = elf().concat([{ id: 'teuer', pos: 'MF', mv: 6e6, ap: 20 }]);   // Bank, viel wert
  const r = C.recommendBuys(squad, [], [{ id: 'gut', pos: 'ANG', price: 5e6, ap: 110 }], { after: 0, teamValue: 28e6 });
  assert.equal(r.list.length, 1);
  assert.deepEqual(r.list[0].sells, ['teuer']);
  assert.equal(r.list[0].net, 80);
  assert.ok(r.list[0].after >= 0);
});

test('Kaufempfehlung: Vereinslimit schliesst aus, Sortierung nach Punkten und Preis', () => {
  const squad = elf().map(p => ({ ...p, tid: 'x' }));
  const market = [
    { id: 'billig', pos: 'ANG', price: 1e6, ap: 110 },
    { id: 'teuer', pos: 'ANG', price: 8e6, ap: 110 },
    { id: 'gleicherVerein', pos: 'ANG', price: 1e6, ap: 200, tid: 'x' }
  ];
  const r = C.recommendBuys(squad, [], market, { after: 20e6, teamValue: 22e6, clubLimit: 3, clubCounts: { x: 11 } });
  assert.deepEqual(r.list.map(x => x.id), ['billig', 'teuer']);
});

test('Marktwertverlauf: Tagesindex, ms und ISO werden zu Zeitstempeln, sortiert', () => {
  const s = C.mvSeries([{ dt: 20370, mv: 2e6 }, { dt: 20368, mv: 1.8e6 }, { dt: '2025-09-01T00:00:00Z', mv: 1.5e6 }, { dt: 20369 }]);
  assert.deepEqual(s.map(x => x.mv), [1.5e6, 1.8e6, 2e6]);
  assert.equal(s[1].t, 20368 * 86400000);
  assert.equal(C.mvAt(s, 20368 * 86400000 + 3600000), 1.8e6);
  assert.equal(C.mvAt(s, 0), null);
});

test('Punkte je Spieltag: Startelf, eingewechselt, ohne Einsatz, kommende Spiele fehlen', () => {
  const r = C.matchdayPoints([
    { day: 2, st: 3, p: 40, mp: "25'" }, { day: 1, st: 5, p: 120, mp: "90'" },
    { day: 3, st: 4, p: 0, mp: "0'" }, { day: 4, st: 5, p: -20, mp: "90'" }, { day: 5, st: 0 }
  ]);
  assert.deepEqual(r, [
    { day: 1, p: 120, kind: 'start' }, { day: 2, p: 40, kind: 'sub' },
    { day: 3, p: 0, kind: 'out' }, { day: 4, p: -20, kind: 'start' }
  ]);
});

test('Kontostand im Verlauf: Transfers und Spieltage mit Datum, Rest verteilt, Ende = Ziel', () => {
  const D = 86400000, c = Date.parse('2026-08-01T00:00:00Z');
  const h = C.balanceHistory({
    start: 75e6, created: c, now: c + 4 * D, target: 70e6, pointValue: 1000,
    transfers: [{ dt: new Date(c + D / 2).toISOString(), tty: 1, trp: 10e6 }, { dt: new Date(c + 3 * D).toISOString(), tty: 2, trp: 4e6 }],
    matchdays: [{ at: c + 2 * D, points: 1000 }]
  });
  assert.equal(h.length, 5);
  assert.equal(h[0].v, 75e6);
  assert.equal(h[h.length - 1].v, 70e6);
  // Kauf an Tag 1 sichtbar, Rest (70 - 75 + 10 - 4 - 1 = 0) ohne Verteilung
  assert.equal(h[1].v, 65e6);
  assert.equal(h[2].v, 66e6);
  assert.equal(h[3].v, 70e6);
});

test('Gebotshilfe: Median und 75%-Quantil der Aufschlaege, Vorschlag aufgerundet', () => {
  const st = C.markupStats([
    { price: 1.0e6, mv: 1e6 }, { price: 1.1e6, mv: 1e6 }, { price: 1.2e6, mv: 1e6 },
    { price: 0.9e6, mv: 1e6 }, { price: 1e6, mv: 0 }
  ]);
  assert.equal(st.n, 4);
  assert.ok(Math.abs(st.median - 0.05) < 1e-9);
  assert.ok(Math.abs(st.p75 - 0.125) < 1e-9);
  assert.equal(C.suggestBid(2e6, st), 2250000);
  assert.equal(C.suggestBid(2e6, null), null);
  assert.equal(C.markupStats([]), null);
});
