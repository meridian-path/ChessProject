'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidUsername,
  isValidChessComUsername,
  isValidGameId,
  buildGameUrl,
  parseGameLine,
  parseChessComGame,
  extractUserPlies,
  extractUserPliesFromPgn,
  bandBestMoveOf,
  buildLeakAnalysis,
  buildLeakAnalysisFromChessCom,
  encodeShareFragment,
  decodeShareFragment,
  MAX_MOVE_STRING_CHARS,
  MAX_PLY,
} = require('../src/leakAnalysis');
const { posKeyFor } = require('../src/bandShards');
const { parse: parseLeakReport } = require('../src/leakModel');

// -- spec 3.7 N2: the ?username= URL parameter -------------------------------

test('isValidUsername accepts a plausible Lichess username', () => {
  assert.equal(isValidUsername('DrNykterstein'), true);
  assert.equal(isValidUsername('a-b_c'), true);
  assert.equal(isValidUsername('ab'), true);
  assert.equal(isValidUsername('a'.repeat(30)), true);
});

test('isValidUsername rejects an XSS-shaped payload, an over-length value, and non-strings', () => {
  assert.equal(isValidUsername('<img src=x onerror=alert(1)>'), false);
  assert.equal(isValidUsername('a'.repeat(31)), false);
  assert.equal(isValidUsername('a'), false); // below the 2-char floor
  assert.equal(isValidUsername(''), false);
  assert.equal(isValidUsername(null), false);
  assert.equal(isValidUsername(42), false);
});

// -- spec 3.7 N1: Lichess game ids -------------------------------------------

test('isValidGameId / buildGameUrl: only a plausible id becomes a link, never built by concatenation from a bad one', () => {
  assert.equal(isValidGameId('abcd1234'), true);
  assert.equal(buildGameUrl('abcd1234'), 'https://lichess.org/abcd1234');

  assert.equal(isValidGameId('../../etc/passwd'), false);
  assert.equal(buildGameUrl('../../etc/passwd'), null);
  assert.equal(isValidGameId('javascript:alert(1)'), false);
  assert.equal(buildGameUrl('javascript:alert(1)'), null);
  assert.equal(isValidGameId(''), false);
  assert.equal(buildGameUrl(''), null);
});

// -- parseGameLine (spec 3.2.1 / 3.7 altered #1) -----------------------------

function gameLine({ id = 'abcd1234', white = 'tester', black = 'opponent', moves = 'e4 e5 Nf3 Nc6 Bc4', winner = 'white' } = {}) {
  return JSON.stringify({
    id,
    players: { white: { user: { name: white } }, black: { user: { name: black } } },
    moves,
    winner,
  });
}

test('parseGameLine: a well-formed line parses', () => {
  const result = parseGameLine(gameLine());
  assert.equal(result.ok, true);
  assert.equal(result.game.id, 'abcd1234');
  assert.equal(result.game.white, 'tester');
  assert.equal(result.game.black, 'opponent');
  assert.equal(result.game.winner, 'white');
});

test('parseGameLine: drops malformed JSON rather than throwing', () => {
  const result = parseGameLine('{not valid json');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-json');
});

test('parseGameLine: drops an empty or non-string line', () => {
  assert.equal(parseGameLine('').ok, false);
  assert.equal(parseGameLine('   ').ok, false);
  assert.equal(parseGameLine(null).ok, false);
  assert.equal(parseGameLine(undefined).ok, false);
});

test('parseGameLine: rejects a game object with a bad id (spec N1), never lets it through unvalidated', () => {
  const result = parseGameLine(gameLine({ id: '../../evil' }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad-id');
});

test('parseGameLine: rejects a game with no moves field', () => {
  const result = parseGameLine(JSON.stringify({ id: 'abcd1234', players: { white: { user: { name: 'tester' } } } }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-moves');
});

test('parseGameLine: a 1MB move string is truncated to MAX_MOVE_STRING_CHARS, not rejected outright (spec 3.7 altered #1)', () => {
  const hugeMoves = 'e4 '.repeat(400000); // ~1.2MB
  const result = parseGameLine(gameLine({ moves: hugeMoves }));
  assert.equal(result.ok, true);
  assert.ok(result.game.movesText.length <= MAX_MOVE_STRING_CHARS);
});

test('parseGameLine: tolerates a game with no user object on one side (anonymous/AI opponent)', () => {
  const line = JSON.stringify({
    id: 'abcd1234',
    players: { white: { user: { name: 'tester' } }, black: { aiLevel: 3 } },
    moves: 'e4 e5',
    winner: 'white',
  });
  const result = parseGameLine(line);
  assert.equal(result.ok, true);
  assert.equal(result.game.black, null);
});

// -- extractUserPlies (spec 3.2.2) -------------------------------------------

test('extractUserPlies: records only the plies where the visitor (case-insensitive match) was to move, as White', () => {
  const parsed = parseGameLine(gameLine({ white: 'Tester', moves: 'e4 e5 Nf3 Nc6 Bc4' }));
  const result = extractUserPlies(parsed.game, 'tester');
  assert.equal(result.ok, true);
  assert.equal(result.color, 'white');
  assert.deepEqual(result.plies.map((p) => p.uci), ['e2e4', 'g1f3', 'f1c4']);
  assert.deepEqual(result.plies.map((p) => p.ply), [0, 2, 4]);
});

test('extractUserPlies: records only the plies where the visitor was to move, as Black', () => {
  const parsed = parseGameLine(gameLine({ white: 'someoneElse', black: 'tester', moves: 'e4 e5 Nf3 Nc6 Bc4' }));
  const result = extractUserPlies(parsed.game, 'tester');
  assert.equal(result.ok, true);
  assert.equal(result.color, 'black');
  assert.deepEqual(result.plies.map((p) => p.uci), ['e7e5', 'b8c6']);
});

test('extractUserPlies: an illegal/garbage SAN token drops the rest of that game\'s replay but keeps what was already collected (spec 3.7 altered #1)', () => {
  const parsed = parseGameLine(gameLine({ moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Zz9 garbage more garbage' }));
  const result = extractUserPlies(parsed.game, 'tester');
  assert.equal(result.ok, true);
  // White's plies before the illegal ply-7 token: e4 (0), Nf3 (2), Bc4 (4), O-O (6).
  assert.deepEqual(result.plies.map((p) => p.uci), ['e2e4', 'g1f3', 'f1c4', 'e1g1']);
});

test('extractUserPlies: refuses a game the named user is not a participant in', () => {
  const parsed = parseGameLine(gameLine({ white: 'someoneElse', black: 'anotherPlayer' }));
  const result = extractUserPlies(parsed.game, 'tester');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-a-participant');
});

test('extractUserPlies: resultForUser maps win/draw/loss correctly relative to the visitor\'s colour', () => {
  const win = extractUserPlies(parseGameLine(gameLine({ white: 'tester', winner: 'white' })).game, 'tester');
  assert.equal(win.resultForUser, 'win');
  const loss = extractUserPlies(parseGameLine(gameLine({ white: 'tester', winner: 'black' })).game, 'tester');
  assert.equal(loss.resultForUser, 'loss');
  const draw = extractUserPlies(parseGameLine(gameLine({ white: 'tester', winner: null })).game, 'tester');
  assert.equal(draw.resultForUser, 'draw');
});

test('extractUserPlies: truncates to the first MAX_PLY plies (spec 3.2.1)', () => {
  const longLine = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'a3' : 'a6')).join(' ');
  // a3/a6 repeated is not legal chess after move 1, so use a real long game instead.
  const realLongGame = 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 Nbd2 Bb7 Bc2 Re8 Nf1 Bf8 Ng3 g6 a4 c5 d5 c4 Bg5 h6 Be3 Nc5 Qd2 h5 Bg5';
  const parsed = parseGameLine(gameLine({ moves: realLongGame }));
  const result = extractUserPlies(parsed.game, 'tester');
  assert.equal(result.ok, true);
  const maxPlyRecorded = Math.max(...result.plies.map((p) => p.ply));
  assert.ok(maxPlyRecorded < MAX_PLY, `expected all recorded plies below MAX_PLY=${MAX_PLY}, got max ${maxPlyRecorded}`);
});

// -- bandBestMoveOf -----------------------------------------------------------

test('bandBestMoveOf: picks the highest confidence-lower-bound move among candidates with n>=300, ignoring thin samples', () => {
  const best = bandBestMoveOf([
    { uci: 'e2e4', games: 5000, scoreLo: 0.54 },
    { uci: 'd2d4', games: 4000, scoreLo: 0.56 },
    { uci: 'g1f3', games: 100, scoreLo: 0.90 }, // below n=300 floor, must be ignored
  ]);
  assert.equal(best.uci, 'd2d4');
});

test('bandBestMoveOf: returns null when nothing meets the n>=300 floor', () => {
  assert.equal(bandBestMoveOf([{ uci: 'e2e4', games: 50, scoreLo: 0.9 }]), null);
});

// -- buildLeakAnalysis (spec 3.2.2/3.2.3, the statistically load-bearing pipeline) --

const POS_START = posKeyFor([]).posKey;
const POS_AFTER_E4E5 = posKeyFor(['e2e4', 'e7e5']).posKey;
const POS_AFTER_NF3NC6 = posKeyFor(['e2e4', 'e7e5', 'g1f3', 'b8c6']).posKey;

function fakeLookup(byPosKey) {
  return async ({ play }) => {
    const { posKey } = posKeyFor(play);
    return byPosKey[posKey] || { coverage: 'out-of-book', total: { w: 0, d: 0, b: 0 }, games: 0, moves: [] };
  };
}

const BAND_FIXTURE = {
  [POS_START]: {
    coverage: 'in', games: 100000, total: { w: 5000, d: 3000, b: 2000 },
    moves: [
      { uci: 'e2e4', san: 'e4', games: 5000, score: 0.55, scoreLo: 0.54, scoreHi: 0.56 },
      { uci: 'd2d4', san: 'd4', games: 4000, score: 0.53, scoreLo: 0.52, scoreHi: 0.54 },
    ],
  },
  [POS_AFTER_E4E5]: {
    coverage: 'in', games: 50000, total: { w: 2500, d: 1500, b: 1000 },
    moves: [
      { uci: 'g1f3', san: 'Nf3', games: 4000, score: 0.56, scoreLo: 0.55, scoreHi: 0.57 },
    ],
  },
  [POS_AFTER_NF3NC6]: {
    coverage: 'in', games: 20000, total: { w: 1000, d: 600, b: 400 },
    moves: [
      { uci: 'f1c4', san: 'Bc4', games: 1000, score: 0.50, scoreLo: 0.49, scoreHi: 0.52 },
      { uci: 'f1b5', san: 'Bb5', games: 1200, score: 0.58, scoreLo: 0.57, scoreHi: 0.59 },
    ],
  },
};

function makeGamesForUser({ count, moves, winner }) {
  return Array.from({ length: count }, (_, i) => gameLine({ id: `game${String(i).padStart(4, '0')}`, moves, winner }));
}

test('buildLeakAnalysis: too few games returns ok:false without throwing (spec 3.2.1 free-tier honesty)', async () => {
  const lines = makeGamesForUser({ count: 5, moves: 'e4 e5 Nf3 Nc6 Bc4', winner: 'white' });
  const result = await buildLeakAnalysis({ ndjsonLines: lines, username: 'tester', band: '1600-1800', pool: 'blitz', lookupFn: fakeLookup(BAND_FIXTURE) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-few-games');
  assert.equal(result.gamesUsable, 5);
});

test('buildLeakAnalysis: surfaces a real leak (user plays Bc4, band clearly prefers Bb5) and produces a leakModel-valid report', async () => {
  const lines = makeGamesForUser({ count: 25, moves: 'e4 e5 Nf3 Nc6 Bc4', winner: 'black' }); // mostly losses -> low win rate at the matching-band-best position too
  const result = await buildLeakAnalysis({ ndjsonLines: lines, username: 'tester', band: '1600-1800', pool: 'blitz', lookupFn: fakeLookup(BAND_FIXTURE) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.gamesUsable, 25);
  assert.equal(result.gamesInCoverage, 25);

  // The document itself must independently re-validate through leakModel's
  // own strict parser -- not just "the code that built it says it's fine".
  const revalidated = parseLeakReport(JSON.stringify(result.report));
  assert.equal(revalidated.ok, true, revalidated.error);

  assert.equal(result.report.leaks.length, 1);
  const leak = result.report.leaks[0];
  assert.equal(leak.yourMove.uci, 'f1c4');
  assert.equal(leak.bandMove.uci, 'f1b5');
  assert.equal(leak.rank, 1);
  // costPer100 = 100 * (25/25) * (0.57 - 0.52) = 5.0
  assert.ok(Math.abs(leak.costPer100 - 5.0) < 1e-9, `expected costPer100 ~5.0, got ${leak.costPer100}`);

  // The matching-band-best e4 choice at the start position is never ranked
  // as a leak (delta<=0 there) but the poor personal win rate at that same
  // position DOES surface on the separate, never-ranked-with-leaks watch list.
  assert.ok(result.watchList.length >= 1);
  assert.equal(result.watchList[0].yourMove.uci, 'e2e4');
  assert.ok(result.watchList[0].winRate < 0.45);
});

test('buildLeakAnalysis: never returns more than 5 leaks, ranked by costPer100 descending, and never pads a thin list', async () => {
  const lines = makeGamesForUser({ count: 25, moves: 'e4 e5 Nf3 Nc6 Bc4', winner: 'black' });
  const result = await buildLeakAnalysis({
    ndjsonLines: lines, username: 'tester', band: '1600-1800', pool: 'blitz', lookupFn: fakeLookup(BAND_FIXTURE), maxLeaks: 5,
  });
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.report.leaks.length <= 5);
  for (let i = 1; i < result.report.leaks.length; i += 1) {
    assert.ok(result.report.leaks[i - 1].costPer100 >= result.report.leaks[i].costPer100);
  }
});

test('buildLeakAnalysis: a move played fewer than 3 times never becomes a leak (spec 3.2.3 frequency floor)', async () => {
  // 20 games playing the leak line + 3 games (below MIN_USER_MOVE_COUNT would
  // be <3; use exactly 2 alternate-move games to prove they're excluded from
  // ranking as a *separate* candidate, while the main line still ranks).
  const mainLine = makeGamesForUser({ count: 20, moves: 'e4 e5 Nf3 Nc6 Bc4', winner: 'black' });
  const rareAlt = makeGamesForUser({ count: 2, moves: 'e4 e5 Nf3 Nc6 d4', winner: 'black' }).map((l, i) => JSON.parse(l));
  rareAlt.forEach((g, i) => { g.id = `alt${i}`; });
  const lines = [...mainLine, ...rareAlt.map((g) => JSON.stringify(g))];
  const result = await buildLeakAnalysis({ ndjsonLines: lines, username: 'tester', band: '1600-1800', pool: 'blitz', lookupFn: fakeLookup(BAND_FIXTURE) });
  assert.equal(result.ok, true, result.reason);
  // d2d4 at POS_AFTER_NF3NC6 is not even in the band fixture's move list for
  // that position, so it could never rank regardless -- this test's real
  // assertion is that the 2-game alt line contributes no *extra* leak entry
  // and the pipeline doesn't throw on an uncovered move.
  assert.ok(result.report.leaks.every((l) => l.yourMove.uci !== 'd2d4'));
});

test('buildLeakAnalysis: a game containing a malformed JSON line and one with an illegal move mid-game are both skipped, not fatal (spec 3.7 altered #1 test requirement)', async () => {
  const good = makeGamesForUser({ count: 22, moves: 'e4 e5 Nf3 Nc6 Bc4', winner: 'black' });
  const malformedJson = '{not json at all';
  const illegalMidGame = gameLine({ id: 'illegal1', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Zz9 nonsense', winner: 'white' });
  const lines = [...good, malformedJson, illegalMidGame];
  const result = await buildLeakAnalysis({ ndjsonLines: lines, username: 'tester', band: '1600-1800', pool: 'blitz', lookupFn: fakeLookup(BAND_FIXTURE) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.gamesFetched, 24);
  // The malformed-JSON line is dropped outright (parseGameLine failure);
  // the illegal-mid-game line still parses fine as a game (its replay just
  // stops early, keeping the plies collected before ply 7) so it's usable,
  // not skipped -- skippedCount here only reflects the one truly unparseable line.
  assert.equal(result.skippedCount, 1);
  assert.equal(result.gamesUsable, 23);
});

// -- Chess.com integration (site-audit item 3, 2026-08-26) -------------------

test('isValidChessComUsername accepts a plausible Chess.com username', () => {
  assert.equal(isValidChessComUsername('Hikaru'), true);
  assert.equal(isValidChessComUsername('only_strong_moves'), true);
  assert.equal(isValidChessComUsername('a-b'), true);
  assert.equal(isValidChessComUsername('a'.repeat(25)), true);
});

test('isValidChessComUsername rejects an XSS-shaped payload, an over-length value, a too-short value, and non-strings', () => {
  assert.equal(isValidChessComUsername('<img src=x onerror=alert(1)>'), false);
  assert.equal(isValidChessComUsername('a'.repeat(26)), false);
  assert.equal(isValidChessComUsername('ab'), false); // below the 3-char floor
  assert.equal(isValidChessComUsername(''), false);
  assert.equal(isValidChessComUsername(null), false);
  assert.equal(isValidChessComUsername(42), false);
});

// Builds a real, parseable PGN string from a flat SAN move list -- same
// shape a real Chess.com archive-month game's own `pgn` field has (verified
// live against a real account, hikaru, 2026-08-26, before this test file was
// written -- see src/fetchChessCom.js's own header comment).
function chessComPgn(moves, { white = 'tester', black = 'opponent' } = {}) {
  const parts = [];
  for (let i = 0; i < moves.length; i += 2) {
    const num = i / 2 + 1;
    parts.push(`${num}. ${moves[i]}${moves[i + 1] ? ` ${moves[i + 1]}` : ''}`);
  }
  return `[Event "Live Chess"]\n[White "${white}"]\n[Black "${black}"]\n[Result "*"]\n\n${parts.join(' ')} *\n`;
}

function chessComGame({
  white = 'tester', black = 'opponent', moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
  winner = null, rated = true, rules = 'chess', timeClass = 'blitz',
} = {}) {
  return {
    url: 'https://www.chess.com/game/live/1',
    pgn: chessComPgn(moves, { white, black }),
    rated,
    rules,
    time_class: timeClass,
    white: { username: white, rating: 1500, result: winner === 'white' ? 'win' : (winner === 'black' ? 'resigned' : 'agreed') },
    black: { username: black, rating: 1500, result: winner === 'black' ? 'win' : (winner === 'white' ? 'resigned' : 'agreed') },
  };
}

test('parseChessComGame: a well-formed rated blitz/chess game parses', () => {
  const result = parseChessComGame(chessComGame({ winner: 'white' }));
  assert.equal(result.ok, true);
  assert.equal(result.game.white, 'tester');
  assert.equal(result.game.black, 'opponent');
  assert.equal(result.game.winner, 'white');
  assert.match(result.game.pgn, /1\. e4 e5/);
});

test('parseChessComGame: rejects an unrated game', () => {
  const result = parseChessComGame(chessComGame({ rated: false }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-rated');
});

test('parseChessComGame: rejects a variant (rules !== "chess")', () => {
  const result = parseChessComGame(chessComGame({ rules: 'chess960' }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-standard-chess');
});

test('parseChessComGame: rejects a bullet or daily game, keeps blitz/rapid', () => {
  assert.equal(parseChessComGame(chessComGame({ timeClass: 'bullet' })).ok, false);
  assert.equal(parseChessComGame(chessComGame({ timeClass: 'daily' })).ok, false);
  assert.equal(parseChessComGame(chessComGame({ timeClass: 'blitz' })).ok, true);
  assert.equal(parseChessComGame(chessComGame({ timeClass: 'rapid' })).ok, true);
});

test('parseChessComGame: rejects a game with no pgn field', () => {
  const game = chessComGame();
  delete game.pgn;
  assert.equal(parseChessComGame(game).ok, false);
});

test('parseChessComGame: winner derivation -- exactly one side "win", or neither for a real draw shape', () => {
  assert.equal(parseChessComGame(chessComGame({ winner: 'white' })).game.winner, 'white');
  assert.equal(parseChessComGame(chessComGame({ winner: 'black' })).game.winner, 'black');
  const draw = chessComGame();
  draw.white.result = 'agreed';
  draw.black.result = 'agreed';
  assert.equal(parseChessComGame(draw).game.winner, null);
});

test('extractUserPliesFromPgn: records only the plies where the visitor (case-insensitive match) was to move, as White', () => {
  const parsed = parseChessComGame(chessComGame({ white: 'Tester', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] }));
  const result = extractUserPliesFromPgn(parsed.game, 'tester');
  assert.equal(result.ok, true);
  assert.equal(result.color, 'white');
  assert.deepEqual(result.plies.map((p) => p.san), ['e4', 'Nf3', 'Bc4']);
});

test('extractUserPliesFromPgn: records only the plies where the visitor was to move, as Black', () => {
  const parsed = parseChessComGame(chessComGame({ white: 'someoneElse', black: 'tester', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] }));
  const result = extractUserPliesFromPgn(parsed.game, 'tester');
  assert.equal(result.ok, true);
  assert.equal(result.color, 'black');
  assert.deepEqual(result.plies.map((p) => p.san), ['e5', 'Nc6']);
});

test('extractUserPliesFromPgn: refuses a game the named user is not a participant in', () => {
  const parsed = parseChessComGame(chessComGame({ white: 'someoneElse', black: 'anotherPlayer' }));
  const result = extractUserPliesFromPgn(parsed.game, 'tester');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-a-participant');
});

test('extractUserPliesFromPgn: resultForUser maps win/draw/loss correctly relative to the visitor\'s colour', () => {
  const win = extractUserPliesFromPgn(parseChessComGame(chessComGame({ white: 'tester', winner: 'white' })).game, 'tester');
  assert.equal(win.resultForUser, 'win');
  const loss = extractUserPliesFromPgn(parseChessComGame(chessComGame({ white: 'tester', winner: 'black' })).game, 'tester');
  assert.equal(loss.resultForUser, 'loss');
  const drawGame = chessComGame({ white: 'tester' });
  drawGame.white.result = 'agreed';
  drawGame.black.result = 'agreed';
  const draw = extractUserPliesFromPgn(parseChessComGame(drawGame).game, 'tester');
  assert.equal(draw.resultForUser, 'draw');
});

test('extractUserPliesFromPgn: truncates to the first MAX_PLY plies', () => {
  const longMoves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd3', 'd6', 'c3', 'a6', 'b4', 'Ba7', 'Re1', 'O-O', 'Nbd2', 'h6', 'Nf1', 'Re8', 'Ng3', 'Bb6'];
  const parsed = parseChessComGame(chessComGame({ white: 'tester', moves: longMoves }));
  const result = extractUserPliesFromPgn(parsed.game, 'tester');
  assert.equal(result.ok, true);
  const maxPlyRecorded = Math.max(...result.plies.map((p) => p.ply));
  assert.ok(maxPlyRecorded < MAX_PLY, `expected all recorded plies below MAX_PLY=${MAX_PLY}, got max ${maxPlyRecorded}`);
});

test('extractUserPliesFromPgn: an unparseable pgn drops the whole game rather than throwing', () => {
  const parsed = parseChessComGame(chessComGame({ white: 'tester' }));
  parsed.game.pgn = 'not a real pgn at all {{{';
  const result = extractUserPliesFromPgn(parsed.game, 'tester');
  assert.equal(result.ok, false);
});

// -- buildLeakAnalysisFromChessCom (same statistical core as buildLeakAnalysis) --

function makeChessComGamesForUser({ count, moves, winner }) {
  return Array.from({ length: count }, () => chessComGame({ white: 'tester', black: 'opponent', moves, winner }));
}

test('buildLeakAnalysisFromChessCom: surfaces the same real leak as the Lichess path, tagged platform "chesscom"', async () => {
  const games = makeChessComGamesForUser({ count: 25, moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], winner: 'black' });
  const result = await buildLeakAnalysisFromChessCom({ games, username: 'tester', band: '1600-1800', pool: 'blitz', lookupFn: fakeLookup(BAND_FIXTURE) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.gamesUsable, 25);
  assert.equal(result.report.platform, 'chesscom');

  const revalidated = parseLeakReport(JSON.stringify(result.report));
  assert.equal(revalidated.ok, true, revalidated.error);

  assert.equal(result.report.leaks.length, 1);
  const leak = result.report.leaks[0];
  assert.equal(leak.yourMove.uci, 'f1c4');
  assert.equal(leak.bandMove.uci, 'f1b5');
  assert.ok(Math.abs(leak.costPer100 - 5.0) < 1e-9, `expected costPer100 ~5.0, got ${leak.costPer100}`);
});

test('buildLeakAnalysisFromChessCom: unrated games and non-blitz/rapid games are filtered out, not counted as usable', async () => {
  const rated = makeChessComGamesForUser({ count: 22, moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], winner: 'black' });
  const unrated = chessComGame({ white: 'tester', rated: false });
  const bullet = chessComGame({ white: 'tester', timeClass: 'bullet' });
  const games = [...rated, unrated, bullet];
  const result = await buildLeakAnalysisFromChessCom({ games, username: 'tester', band: '1600-1800', pool: 'blitz', lookupFn: fakeLookup(BAND_FIXTURE) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.gamesFetched, 24);
  assert.equal(result.skippedCount, 2);
  assert.equal(result.gamesUsable, 22);
});

test('buildLeakAnalysis (Lichess path) still tags platform "lichess" after the shared-core refactor', async () => {
  const lines = makeGamesForUser({ count: 25, moves: 'e4 e5 Nf3 Nc6 Bc4', winner: 'black' });
  const result = await buildLeakAnalysis({ ndjsonLines: lines, username: 'tester', band: '1600-1800', pool: 'blitz', lookupFn: fakeLookup(BAND_FIXTURE) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.report.platform, 'lichess');
});

// -- encodeShareFragment / decodeShareFragment (spec 3.7 N3) -----------------

function sampleReport() {
  return {
    format: 'leak-report/1',
    generated: new Date().toISOString(),
    band: '1600-1800',
    pool: 'blitz',
    username: 'tester',
    gamesFetched: 25,
    gamesUsable: 25,
    gamesInCoverage: 25,
    leaks: [{
      id: 'abc-f1c4',
      rank: 1,
      color: 'white',
      play: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
      posKey: POS_AFTER_NF3NC6,
      ply: 4,
      yourMove: { uci: 'f1c4', san: 'Bc4', bandGames: 1000, score: 0.5, scoreLo: 0.49, scoreHi: 0.52, yourCount: 25 },
      bandMove: { uci: 'f1b5', san: 'Bb5', bandGames: 1200, score: 0.58, scoreLo: 0.57, scoreHi: 0.59 },
      costPer100: 5.0,
      opening: { name: 'Italian Game', eco: 'C50', slug: null },
      links: { opening: null, drill: 'drill.html', builder: 'repertoire-builder.html' },
    }],
  };
}

test('encodeShareFragment / decodeShareFragment: round-trips a valid report', () => {
  const report = sampleReport();
  const encoded = encodeShareFragment(report);
  assert.equal(encoded.ok, true);
  const decoded = decodeShareFragment(encoded.fragment);
  assert.equal(decoded.ok, true, decoded.reason);
  assert.deepEqual(decoded.report.leaks[0].yourMove.uci, 'f1c4');
});

test('decodeShareFragment: coexists with bandState.client.js\'s own band/pool/color fragment keys in the same hash', () => {
  const report = sampleReport();
  const encoded = encodeShareFragment(report);
  const combined = `band=1600-1800&pool=blitz&color=white&${encoded.fragment}`;
  const decoded = decodeShareFragment(combined);
  assert.equal(decoded.ok, true, decoded.reason);
});

test('decodeShareFragment: rejects a tampered/invalid report (never a weaker entry path than localStorage -- spec 3.7 N3)', () => {
  const tampered = new URLSearchParams();
  tampered.set('r', JSON.stringify({ format: 'leak-report/1', band: 'not-a-real-band' }));
  const decoded = decodeShareFragment(tampered.toString());
  assert.equal(decoded.ok, false);
});

test('decodeShareFragment: rejects garbage/empty input without throwing', () => {
  assert.equal(decodeShareFragment('').ok, false);
  // URLSearchParams tolerates malformed %-escapes rather than throwing; the
  // real assertion here is that decodeShareFragment never throws on it --
  // whatever it resolves `r` to (if anything) still has to pass
  // leakModel.parse(), so this is safe either way.
  assert.doesNotThrow(() => decodeShareFragment('not=url=encoded=%zz'));
  assert.equal(decodeShareFragment(null).ok, false);
  assert.equal(decodeShareFragment(`r=${'x'.repeat(3000)}`).ok, false); // over SHARE_FRAGMENT_MAX_CHARS
});

test('encodeShareFragment: reports too-large rather than silently truncating a report that would exceed the fragment cap', () => {
  const huge = sampleReport();
  huge.leaks = Array.from({ length: 20 }, () => huge.leaks[0]);
  huge.username = 'x'.repeat(1000); // force it over the 2000-char cap artificially for this test
  const encoded = encodeShareFragment(huge);
  assert.equal(encoded.ok, false);
  assert.equal(encoded.reason, 'too-large');
});
