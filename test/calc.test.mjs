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
