'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FORMAT, MAX_LEAKS, buildLeakReport, parse } = require('../src/leakModel');
const { RATING_BANDS } = require('../src/processRepertoire');

function validMoveStat(overrides = {}) {
  return { uci: 'g1f3', san: 'Nf3', bandGames: 5000, score: 0.55, scoreLo: 0.53, scoreHi: 0.57, ...overrides };
}

function validLeak(overrides = {}) {
  return {
    id: 'leak-1',
    rank: 1,
    color: 'white',
    play: ['e2e4', 'e7e5'],
    posKey: 'a'.repeat(24),
    ply: 2,
    yourMove: validMoveStat({ uci: 'f2f4', san: 'f4', yourCount: 12 }),
    bandMove: validMoveStat(),
    costPer100: 2.4,
    opening: { name: "King's Gambit", eco: 'C30', slug: 'kings-gambit' },
    links: { opening: 'kings-gambit.html', drill: 'drill.html', builder: 'repertoire-builder.html' },
    ...overrides,
  };
}

function validReport(overrides = {}) {
  return buildLeakReport({
    band: '1600-1800',
    pool: 'blitz',
    username: 'clubplayer1',
    gamesFetched: 300,
    gamesUsable: 280,
    gamesInCoverage: 240,
    leaks: [validLeak()],
    generated: '2026-08-15T00:00:00.000Z',
    ...overrides,
  });
}

test('this module\'s band enum stays in sync with processRepertoire.js\'s RATING_BANDS keys', () => {
  const { VALID_BANDS } = require('../src/leakModel');
  assert.deepEqual([...VALID_BANDS].sort(), Object.keys(RATING_BANDS).sort());
});

test('buildLeakReport + parse: round-trips a well-formed report through JSON', () => {
  const report = validReport();
  assert.equal(report.format, FORMAT);
  const result = parse(JSON.stringify(report));
  assert.equal(result.ok, true);
  assert.equal(result.report.username, 'clubplayer1');
  assert.equal(result.report.leaks.length, 1);
});

test('parse: accepts an already-parsed object (not just a JSON string) -- the pre-serialization shape a builder assembles', () => {
  const result = parse(validReport());
  assert.equal(result.ok, true);
});

test('parse: refuses (never coerces) an unrecognized format string', () => {
  const report = validReport();
  report.format = 'leak-report/2';
  const result = parse(report);
  assert.equal(result.ok, false);
  assert.match(result.error, /unrecognized format/);
});

test('parse: refuses malformed JSON, not a throw', () => {
  const result = parse('{not json');
  assert.equal(result.ok, false);
  assert.match(result.error, /not valid JSON/);
});

test('parse: refuses a non-string, non-object input', () => {
  assert.equal(parse(42).ok, false);
  assert.equal(parse(null).ok, false);
  assert.equal(parse(undefined).ok, false);
});

test('parse: enforces the leaks array length cap', () => {
  const leaks = Array.from({ length: MAX_LEAKS + 1 }, (_, i) => validLeak({ id: `leak-${i}`, rank: i }));
  const result = parse(validReport({ leaks }));
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(`at most ${MAX_LEAKS}`));
});

test('parse: every play entry must be a real UCI move before it is ever handed to a chess engine', () => {
  const result = parse(validReport({ leaks: [validLeak({ play: ['e2e4', 'DROP TABLE'] })] }));
  assert.equal(result.ok, false);
  assert.match(result.error, /play contains a non-UCI entry/);
});

test('parse: posKey must be a 24-char lowercase hex string', () => {
  const result = parse(validReport({ leaks: [validLeak({ posKey: 'not-a-real-poskey' })] }));
  assert.equal(result.ok, false);
  assert.match(result.error, /posKey/);
});

test('parse: rejects a leak with an out-of-range score (moveStat scores must be finite numbers in [0,1])', () => {
  const result = parse(validReport({ leaks: [validLeak({ bandMove: validMoveStat({ score: 1.4 }) })] }));
  assert.equal(result.ok, false);
  assert.match(result.error, /score must be a finite number/);
});

test('parse: rejects a leak whose color is not "white"/"black"', () => {
  const result = parse(validReport({ leaks: [validLeak({ color: 'purple' })] }));
  assert.equal(result.ok, false);
  assert.match(result.error, /color must be/);
});

test('parse: rejects an unrecognized band or pool', () => {
  assert.equal(parse(validReport({ band: '900-1000' })).ok, false);
  assert.equal(parse(validReport({ pool: 'daily' })).ok, false);
});

test('parse: rejects a document over the size cap without ever calling JSON.parse on it', () => {
  const huge = 'x'.repeat(200001);
  const result = parse(huge);
  assert.equal(result.ok, false);
  assert.match(result.error, /too large/);
});

test('parse: rejects a username outside the Lichess-shaped 2-30 char pattern', () => {
  assert.equal(parse(validReport({ username: 'a' })).ok, false);
  assert.equal(parse(validReport({ username: '<script>' })).ok, false);
});

// -- platform (site-audit item 3, 2026-08-26) --------------------------------

test('buildLeakReport: defaults platform to "lichess" when not given', () => {
  const report = validReport();
  assert.equal(report.platform, 'lichess');
});

test('buildLeakReport + parse: a real "chesscom" platform round-trips through JSON', () => {
  const report = validReport({ platform: 'chesscom' });
  assert.equal(report.platform, 'chesscom');
  const result = parse(JSON.stringify(report));
  assert.equal(result.ok, true);
  assert.equal(result.report.platform, 'chesscom');
});

test('parse: a report with no platform field at all (pre-dates this field, e.g. old localStorage) defaults to "lichess", not rejected', () => {
  const report = validReport();
  delete report.platform;
  const result = parse(JSON.stringify(report));
  assert.equal(result.ok, true);
  assert.equal(result.report.platform, 'lichess');
});

test('parse: rejects an unrecognized platform', () => {
  const result = parse(validReport({ platform: 'stockfish-arena' }));
  assert.equal(result.ok, false);
  assert.match(result.error, /platform/);
});
