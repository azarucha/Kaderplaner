import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
globalThis.KBCalc = require('../src/calc.js');
require('../src/data.js');
const D = globalThis.KBData;

test('OpenLigaDB-Vereine werden den Kickbase-Vereinen zugeordnet', () => {
  const kb = [['20', 'Hertha BSC'], ['19', 'Fürth'], ['39', 'St. Pauli'], ['21', 'Braunschweig'], ['22', 'Bielefeld'], ['30', 'Kaiserslautern']]
    .map(([tid, tn]) => ({ tid, tn }));
  const ol = { 54: ['Hertha BSC', 'Hertha'], 115: ['SpVgg Greuther Fürth', 'Fürth'], 98: ['FC St. Pauli', 'St. Pauli'],
    74: ['Eintracht Braunschweig', 'Braunschweig'], 83: ['DSC Arminia Bielefeld', 'Bielefeld'], 76: ['1. FC Kaiserslautern', 'Kaiserslautern'],
    40: ['FC Bayern München', 'Bayern'] };
  const map = D.mapTeams(ol, kb);
  assert.deepEqual(map, { 54: '20', 115: '19', 98: '39', 74: '21', 83: '22', 76: '30', 40: 'ol40' });
});

test('Gegnermodell: naechste Spiele, Faktor je Position und Zeitraum', () => {
  const now = Date.now();
  // Liga mit drei Teams: "a" gewinnt immer, Stuermer punkten gegen "c" stark
  const matches = [];
  for (let i = 0; i < 6; i++) matches.push(['a', 'b', 3, 0, 0], ['b', 'c', 1, 0, 0], ['c', 'a', 0, 3, 0]);
  const games = [[100, 'c', 1, 0], [100, 'c', 0, 0], [60, 'a', 1, 0], [60, 'a', 0, 0], [80, 'b', 1, 0]];
  const lg = { at: now, ti: '2026/2027', next: { b: [['a', 0, now + 864e5], ['c', 1, now + 8 * 864e5]] },
    players: [['p1', 4, 'b', games], ['p2', 4, 'b', games], ['p3', 4, 'b', games]], matches };
  const m = D.buildOpponentModel(lg, [], [{ tid: 'a', tn: 'A' }, { tid: 'b', tn: 'B' }, { tid: 'c', tn: 'C' }]);
  assert.equal(m.source, 'kickbase');
  const one = D.fixturesFor(m, 4, 'b', 1), three = D.fixturesFor(m, 4, 'b', 3);
  assert.equal(one.games.length, 2);
  assert.equal(one.games[0].opp, 'a');
  // naechstes Spiel auswaerts beim staerksten Team: schwer; danach daheim gegen c: leichter
  assert.ok(one.factor < 1, String(one.factor));
  assert.ok(three.factor > one.factor);
  // unbekannter Verein: neutral
  assert.equal(D.fixturesFor(m, 4, 'x', 3).factor, 1);
});
