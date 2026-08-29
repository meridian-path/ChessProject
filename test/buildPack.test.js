'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  RULE_VERSION,
  MIN_N,
  statsForCandidate,
  candidatesFor,
  includedOpponentReplies,
  buildPackTree,
  countPositions,
  flattenPositions,
  collectLeafPaths,
  pruneToTopLines,
  ownFirstMoveSan,
  pgnFromTree,
  packJsonFromResult,
  readmeText,
  fenAfter,
  applyExplorerUci,
} = require('../src/buildPack');
const { parsePgnSafe } = require('../src/pgnWrapper');
const { Chess } = require('chess.js');

function fakeResponse(json) {
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => json };
}

// buildPackTree() defaults aggregatesDir to the real data/aggregates/ (see
// src/explorerSource.js's fetchMoves()) -- if a developer/agent has run
// `npm run fetch-local-aggregates` and cached real shard data there, these
// fixture-driven tests would silently stop exercising fetchImpl at all and
// assert against real numbers instead. Always empty, never written to, so
// aggregatesAvailable() is guaranteed false for every call below.
const EMPTY_AGGREGATES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buildPack-empty-aggregates-'));

// ---------------------------------------------------------------------
// Pure-helper unit tests
// ---------------------------------------------------------------------

test('statsForCandidate computes score = (w + 0.5d) / n relative to moverColor', () => {
  const s = statsForCandidate({ uci: 'e2e4', san: 'e4', white: 600, draws: 200, black: 200, averageRating: 1500 }, 'white', 1000);
  assert.equal(s.n, 1000);
  assert.equal(s.w, 600);
  assert.equal(s.l, 200);
  assert.equal(s.freq, 1);
  assert.ok(Math.abs(s.score - 0.7) < 1e-9); // (600 + 100) / 1000
  assert.ok(s.low < s.score && s.score < s.high);

  // Black mover: wins/losses flip.
  const sBlack = statsForCandidate({ uci: 'e2e4', san: 'e4', white: 600, draws: 200, black: 200 }, 'black', 1000);
  assert.equal(sBlack.w, 200);
  assert.equal(sBlack.l, 600);
  assert.ok(Math.abs(sBlack.score - 0.3) < 1e-9);
});

test('candidatesFor sorts by games descending and computes freq relative to node total', () => {
  const response = {
    white: 6000, draws: 2000, black: 2000,
    moves: [
      { uci: 'a', san: 'a', white: 1000, draws: 500, black: 500 }, // n=2000
      { uci: 'b', san: 'b', white: 4000, draws: 1000, black: 1000 }, // n=6000
      { uci: 'c', san: 'c', white: 1000, draws: 500, black: 500 }, // n=2000
    ],
  };
  const candidates = candidatesFor(response, 'white');
  assert.equal(candidates[0].uci, 'b');
  assert.ok(Math.abs(candidates[0].freq - 0.6) < 1e-9);
});

test('includedOpponentReplies applies the 90%-cumulative, 1.5%-floor, n>=300 rule', () => {
  const candidates = [
    { uci: 'a', n: 4000, freq: 0.40 },
    { uci: 'b', n: 2500, freq: 0.25 },
    { uci: 'c', n: 2000, freq: 0.20 },
    { uci: 'd', n: 1000, freq: 0.10 },
    { uci: 'e', n: 300, freq: 0.03 },
    { uci: 'f', n: 100, freq: 0.01 }, // below n=300 AND below 1.5% -- would never reach anyway
  ];
  const included = includedOpponentReplies(candidates, 0.015);
  // cum after a,b,c = 85% (<90, keep going); after d = 95% (>=90 -> this
  // is the move that crosses the target, so it's included; loop then
  // stops before considering e/f).
  assert.deepEqual(included.map((c) => c.uci), ['a', 'b', 'c', 'd']);
});

test('includedOpponentReplies drops a reply below the frequency floor even mid-cumulative', () => {
  const candidates = [
    { uci: 'a', n: 5000, freq: 0.50 },
    { uci: 'b', n: 3000, freq: 0.30 },
    { uci: 'c', n: 100, freq: 0.01 }, // below 1.5% floor -- excluded even though cum (80%) < 90%
  ];
  const included = includedOpponentReplies(candidates, 0.015);
  assert.deepEqual(included.map((c) => c.uci), ['a', 'b']);
});

test('includedOpponentReplies drops a reply below MIN_N even above the frequency floor', () => {
  const candidates = [
    { uci: 'a', n: 5000, freq: 0.90 },
    { uci: 'b', n: MIN_N - 1, freq: 0.10 }, // below n=300 despite 10% share
  ];
  const included = includedOpponentReplies(candidates, 0.015);
  assert.deepEqual(included.map((c) => c.uci), ['a']);
});

test('fenAfter replays a UCI move list and throws on an illegal move', () => {
  // No en-passant target recorded: chess.js only sets it when a legal en
  // passant capture actually exists, and no black pawn can reach e3 yet.
  assert.equal(fenAfter(['e2e4']), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  assert.throws(() => fenAfter(['e2e5']), /illegal move/);
});

test('applyExplorerUci translates Lichess Explorer\'s "king captures own rook" castling encoding', () => {
  // Real bug, found by running buildPacks.js against live data (not a
  // hypothetical): the Explorer API sent "e1h1" for kingside castling,
  // which chess.js's object-form .move() does not understand on a
  // non-Chess960 instance -- see applyExplorerUci's doc comment.
  const setup = ['g1f3', 'b8c6', 'g2g3', 'g8f6', 'f1g2', 'e7e5'];
  const chessKingside = new Chess();
  for (const uci of setup) applyExplorerUci(chessKingside, uci);
  const result = applyExplorerUci(chessKingside, 'e1h1'); // castle kingside, Lichess encoding
  assert.equal(result.san, 'O-O');
  assert.equal(chessKingside.get('g1').type, 'k');
  assert.equal(chessKingside.get('f1').type, 'r');
  assert.equal(chessKingside.get('h1'), undefined);

  // Queenside, black to move: same encoding, e8a8.
  const queensideSetup = ['d2d4', 'd7d5', 'b1c3', 'b8c6', 'c1f4', 'c8f5', 'd1d2', 'd8d7', 'a2a3'];
  const chessQueenside = new Chess();
  for (const uci of queensideSetup) applyExplorerUci(chessQueenside, uci);
  const resultQ = applyExplorerUci(chessQueenside, 'e8a8');
  assert.equal(resultQ.san, 'O-O-O');
  assert.equal(chessQueenside.get('c8').type, 'k');
  assert.equal(chessQueenside.get('d8').type, 'r');

  // An ordinary king move to a square that just happens to be empty is untouched.
  const chessOrdinary = new Chess();
  applyExplorerUci(chessOrdinary, 'e2e4');
  applyExplorerUci(chessOrdinary, 'e7e5');
  const ordinaryResult = applyExplorerUci(chessOrdinary, 'e1e2');
  assert.equal(ordinaryResult.san, 'Ke2');
});

// ---------------------------------------------------------------------
// buildPackTree -- main scenario (opponent branching + a clean, non-tied
// our-move choice), against a small hand-built fixture. No live network
// calls anywhere in this file.
// ---------------------------------------------------------------------

function mainScenarioFetch() {
  const byPlay = {
    // Black to move after 1.e4 -- four replies cross the 90% cumulative
    // target (c5 40%, e5 25%, e6 20%, c6 10% -> cum 95% after c6).
    'e2e4': fakeResponse({
      white: 40000, draws: 40000, black: 20000, // arbitrary at node-level; only per-move counts matter here
      moves: [
        { uci: 'c7c5', san: 'c5', white: 18000, draws: 4000, black: 18000 }, // n=40000 (40%)
        { uci: 'e7e5', san: 'e5', white: 11000, draws: 3000, black: 11000 }, // n=25000 (25%)
        { uci: 'e7e6', san: 'e6', white: 9000, draws: 2000, black: 9000 },   // n=20000 (20%)
        { uci: 'c7c6', san: 'c6', white: 4500, draws: 1000, black: 4500 },   // n=10000 (10%)
        { uci: 'd7d6', san: 'd6', white: 1400, draws: 200, black: 1400 },    // n=3000 (3%) -- never reached, cum already >=90
      ],
    }),
    // Our (white) move after 1.e4 c5 -- c2c3 clearly wins on score lower bound.
    'e2e4,c7c5': fakeResponse({
      white: 40500, draws: 12000, black: 32500, // = sum of the three candidates below
      moves: [
        { uci: 'g1f3', san: 'Nf3', white: 24000, draws: 5000, black: 21000 }, // n=50000, score=0.53
        { uci: 'b1c3', san: 'Nc3', white: 9000, draws: 4000, black: 7000 },   // n=20000, score=0.55
        { uci: 'c2c3', san: 'c3', white: 7500, draws: 3000, black: 4500 },    // n=15000, score=0.6
      ],
    }),
    // Terminates: too few games to expand further.
    'e2e4,c7c5,c2c3': fakeResponse({ white: 100, draws: 50, black: 50, moves: [{ uci: 'd7d5', san: 'd5', white: 100, draws: 50, black: 50 }] }),
    'e2e4,e7e5': fakeResponse({ white: 40, draws: 20, black: 40, moves: [{ uci: 'g1f3', san: 'Nf3', white: 40, draws: 20, black: 40 }] }),
    'e2e4,e7e6': fakeResponse({ white: 40, draws: 20, black: 40, moves: [{ uci: 'd2d4', san: 'd4', white: 40, draws: 20, black: 40 }] }),
    'e2e4,c7c6': fakeResponse({ white: 40, draws: 20, black: 40, moves: [{ uci: 'd2d4', san: 'd4', white: 40, draws: 20, black: 40 }] }),
  };
  let callCount = 0;
  const fetchImpl = async (url) => {
    callCount += 1;
    const play = new URL(url).searchParams.get('play') || '';
    const fixture = byPlay[play];
    if (!fixture) throw new Error(`mainScenarioFetch: no fixture for play="${play}"`);
    return fixture;
  };
  return { fetchImpl, getCallCount: () => callCount };
}

test('buildPackTree walks opponent branches by cumulative frequency and picks our move by score lower bound', async () => {
  const { fetchImpl } = mainScenarioFetch();
  const result = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'e2e4', fetchImpl, aggregatesDir: EMPTY_AGGREGATES_DIR });

  assert.equal(result.tree.san, 'e4');
  assert.equal(result.tree.side, 'white');
  assert.equal(result.tree.reach, 1);

  // Four opponent replies included (c5/e5/e6/c6), d6 excluded (cum already >=90 before it).
  const replies = result.tree.children.map((n) => n.san);
  assert.deepEqual(replies, ['c5', 'e5', 'e6', 'c6']);
  // Each opponent reply's own reach reflects ITS OWN frequency (40/25/20/10%),
  // not a shared parent value -- reach models "how often does a buyer
  // following this repertoire actually face this branch," which depends
  // on the opponent's own move frequency (module doc on expand()).
  const [c5Node, e5Node, e6Node, c6Node] = result.tree.children;
  assert.equal(c5Node.reach, 0.4);
  assert.equal(e5Node.reach, 0.25);
  assert.equal(e6Node.reach, 0.2);
  assert.equal(c6Node.reach, 0.1);

  assert.equal(c5Node.isOurMove, false);
  assert.equal(c5Node.children.length, 1);
  const ourMove = c5Node.children[0];
  assert.equal(ourMove.san, 'c3');
  assert.equal(ourMove.isOurMove, true);
  assert.ok(ourMove.wilson[0] < ourMove.score && ourMove.score < ourMove.wilson[1]);
  // Our move's reach equals the reach of the position it was chosen at
  // (c5's own reach) -- unchanged, since we play it with certainty.
  assert.equal(ourMove.reach, c5Node.reach);

  // Terminates: 'e2e4,c7c5,c2c3' fixture has only 200 games (< MIN_N).
  assert.deepEqual(ourMove.children, []);
});

// -- site-audit item (2026-08-29): the pack's own first move was never
// stated on its sales page. ownFirstMoveSan() has to handle White and
// Black packs differently -- root itself IS the White pack's own first
// move (isOurMove true there), but for a Black pack root is the fixed
// OPPONENT move and the owner's real first move is root's own single
// child instead.
test('ownFirstMoveSan: a White pack returns root.san directly (root is our own forced first move)', async () => {
  const { fetchImpl } = mainScenarioFetch();
  const result = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'e2e4', fetchImpl, aggregatesDir: EMPTY_AGGREGATES_DIR });
  assert.equal(result.tree.isOurMove, true);
  assert.equal(ownFirstMoveSan(result.tree), 'e4');
});

test('ownFirstMoveSan: a Black pack returns root.children[0].san (root is the fixed opponent move)', async () => {
  const { fetchImpl } = mainScenarioFetch();
  const result = await buildPackTree({ ratingBand: '1400-1600', color: 'black', firstMoveUci: 'e2e4', fetchImpl, aggregatesDir: EMPTY_AGGREGATES_DIR });
  assert.equal(result.tree.isOurMove, false);
  assert.equal(result.tree.children.length, 1, 'a real repertoire has exactly one chosen reply at every one of the owner\'s own decision points');
  assert.equal(ownFirstMoveSan(result.tree), result.tree.children[0].san);
});

test('ownFirstMoveSan: returns null for an empty/missing tree rather than throwing', () => {
  assert.equal(ownFirstMoveSan(null), null);
  assert.equal(ownFirstMoveSan({ isOurMove: false, children: [] }), null);
  assert.equal(ownFirstMoveSan({ isOurMove: false, children: null }), null);
});

test('buildPackTree result is deterministic (byte-identical) for byte-identical input', async () => {
  const { fetchImpl: fetch1 } = mainScenarioFetch();
  const { fetchImpl: fetch2 } = mainScenarioFetch();
  const result1 = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'e2e4', fetchImpl: fetch1 });
  const result2 = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'e2e4', fetchImpl: fetch2 });
  assert.equal(JSON.stringify(result1.tree), JSON.stringify(result2.tree));
});

test('buildPackTree throws on an unknown rating band or bad color', async () => {
  await assert.rejects(buildPackTree({ ratingBand: 'nope', color: 'white', firstMoveUci: 'e2e4' }), /unknown rating band/);
  await assert.rejects(buildPackTree({ ratingBand: '1400-1600', color: 'purple', firstMoveUci: 'e2e4' }), /color must be/);
});

// ---------------------------------------------------------------------
// buildPackTree -- tie-break scenario (spec 1.3: within 0.5pp, prefer the
// move producing fewer opponent replies above threshold at the resulting
// position).
// ---------------------------------------------------------------------

function tieBreakScenarioFetch() {
  const byPlay = {
    'd2d4': fakeResponse({ white: 40000, draws: 30000, black: 30000, moves: [{ uci: 'd7d5', san: 'd5', white: 40000, draws: 30000, black: 30000 }] }),
    // Two of our candidates with IDENTICAL w/d/l -> guaranteed tie on score/low.
    'd2d4,d7d5': fakeResponse({
      white: 10000, draws: 4000, black: 6000, // = sum of the two candidates below
      moves: [
        { uci: 'c2c4', san: 'c4', white: 5000, draws: 2000, black: 3000 },
        { uci: 'g1f3', san: 'Nf3', white: 5000, draws: 2000, black: 3000 },
      ],
    }),
    // c2c4's resulting position has 3 opponent replies above threshold.
    'd2d4,d7d5,c2c4': fakeResponse({
      white: 65000, draws: 15000, black: 15000,
      moves: [
        { uci: 'e7e6', san: 'e6', white: 30000, draws: 5000, black: 5000 },
        { uci: 'c7c6', san: 'c6', white: 20000, draws: 5000, black: 5000 },
        { uci: 'g8f6', san: 'Nf6', white: 15000, draws: 5000, black: 5000 },
      ],
    }),
    // g1f3's resulting position has only 1 opponent reply above threshold.
    'd2d4,d7d5,g1f3': fakeResponse({
      white: 30000, draws: 5000, black: 5000,
      moves: [{ uci: 'g8f6', san: 'Nf6', white: 30000, draws: 5000, black: 5000 }],
    }),
    'd2d4,d7d5,g1f3,g8f6': fakeResponse({ white: 50, draws: 20, black: 30, moves: [] }), // terminates: n < 300
  };
  const fetchImpl = async (url) => {
    const play = new URL(url).searchParams.get('play') || '';
    const fixture = byPlay[play];
    if (!fixture) throw new Error(`tieBreakScenarioFetch: no fixture for play="${play}"`);
    return fixture;
  };
  return { fetchImpl };
}

test('buildPackTree tie-break prefers the move with fewer opponent branches at the resulting position', async () => {
  const { fetchImpl } = tieBreakScenarioFetch();
  const result = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'd2d4', fetchImpl, aggregatesDir: EMPTY_AGGREGATES_DIR });

  const d5Node = result.tree.children[0]; // black's reply, 1...d5
  assert.equal(d5Node.san, 'd5');
  const ourMove = d5Node.children[0]; // white to move after 1.d4 d5
  assert.equal(ourMove.isOurMove, true);
  assert.equal(ourMove.san, 'Nf3'); // NOT c4 -- fewer branches at the resulting position
});

// ---------------------------------------------------------------------
// Tree utilities: countPositions, flattenPositions, collectLeafPaths,
// pruneToTopLines.
// ---------------------------------------------------------------------

test('countPositions / flattenPositions / collectLeafPaths / pruneToTopLines agree on a small tree', async () => {
  const { fetchImpl } = mainScenarioFetch();
  const result = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'e2e4', fetchImpl, aggregatesDir: EMPTY_AGGREGATES_DIR });

  // root + 4 opponent replies + 1 our-move (under c5) = 6.
  assert.equal(countPositions(result.tree), 6);

  const flat = flattenPositions(result.tree);
  assert.equal(flat.length, 6);
  assert.equal(flat[0].san, 'e4'); // pre-order: root first

  const leaves = collectLeafPaths(result.tree);
  // 4 leaves: e5/e6/c6 (each a childless opponent reply) + the our-move
  // node under c5 (which itself has no children -- fixture terminates it).
  assert.equal(leaves.length, 4);

  const pruned = pruneToTopLines(result.tree, 1);
  // Highest-reach leaf: reach is equal (1) for all four opponent-node
  // leaves and the our-move leaf's reach also equals 1 (unchanged from
  // its parent) -- pruneToTopLines is stable-sorted, so with an exact tie
  // the FIRST leaf in tree order (c5's line) wins.
  assert.equal(pruned.children.length, 1);
  assert.equal(pruned.children[0].san, 'c5');
});

// ---------------------------------------------------------------------
// PGN serialization + chess.js round-trip.
// ---------------------------------------------------------------------

test('pgnFromTree renders variations and round-trips through chess.js with zero illegal moves', async () => {
  const { fetchImpl } = mainScenarioFetch();
  const result = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'e2e4', fetchImpl, aggregatesDir: EMPTY_AGGREGATES_DIR });
  const pgn = pgnFromTree(result.tree, { Event: 'Test Pack', Site: 'test', Date: '2026.08.15', White: 'White 1400-1600', Black: '?', Result: '*' });

  assert.match(pgn, /^\[Event "Test Pack"\]/);
  assert.match(pgn, /1\. e4 c5/); // main line
  assert.match(pgn, /\(1\.\.\. e5\)/); // variation, black move needs the ellipsis
  assert.match(pgn, /\{n=15000 score=60\.0% CI/); // our-move annotation

  const parsed = parsePgnSafe(pgn);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.message);
  // The MAIN line chess.js parses out is the deepest/first variation path:
  // 1.e4 c5 2.c3 (whichever chess.js treats as mainline for a PGN whose
  // very first move has trailing variations attached to IT, not deeper) --
  // assert every move it did parse is legal (round-trip succeeded at all,
  // which is what matters: chess.js only returns ok:true for a fully
  // legal, fully parseable game+variations).
  assert.ok(parsed.moves.length >= 1);
});

test('pgnFromTree on the tie-break tree also round-trips cleanly', async () => {
  const { fetchImpl } = tieBreakScenarioFetch();
  const result = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'd2d4', fetchImpl });
  const pgn = pgnFromTree(result.tree, { Event: 'Test', Site: 'test', Date: '2026.08.15', White: 'W', Black: 'B', Result: '*' });
  const parsed = parsePgnSafe(pgn);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.message);
});

// ---------------------------------------------------------------------
// pack.json + README.txt serialization.
// ---------------------------------------------------------------------

test('packJsonFromResult builds a schema-shaped, deterministic manifest', async () => {
  const { fetchImpl } = mainScenarioFetch();
  const result = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'e2e4', fetchImpl, aggregatesDir: EMPTY_AGGREGATES_DIR });
  const packJson = packJsonFromResult(result, { id: 'white-1400-1600', title: 'White at 1400-1600', speeds: ['blitz', 'rapid'], retrieved: '2026-08-15' });

  assert.equal(packJson.format, 'repertoire-pack/1');
  assert.equal(packJson.rule_version, RULE_VERSION);
  assert.equal(packJson.color, 'white');
  assert.equal(packJson.band, '1400-1600');
  assert.equal(packJson.line_count, 4);
  assert.equal(packJson.position_count, 6);
  assert.equal(packJson.positions.length, 6);

  // Determinism: same input -> byte-identical JSON.
  const { fetchImpl: fetch2 } = mainScenarioFetch();
  const result2 = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'e2e4', fetchImpl: fetch2, aggregatesDir: EMPTY_AGGREGATES_DIR });
  const packJson2 = packJsonFromResult(result2, { id: 'white-1400-1600', title: 'White at 1400-1600', speeds: ['blitz', 'rapid'], retrieved: '2026-08-15' });
  assert.equal(JSON.stringify(packJson), JSON.stringify(packJson2));
});

test('readmeText never contains a hardcoded line count -- always interpolated from packJson', async () => {
  const { fetchImpl } = mainScenarioFetch();
  const result = await buildPackTree({ ratingBand: '1400-1600', color: 'white', firstMoveUci: 'e2e4', fetchImpl });
  const packJson = packJsonFromResult(result, { id: 'white-1400-1600', title: 'White at 1400-1600', speeds: ['blitz', 'rapid'], retrieved: '2026-08-15' });
  const readme = readmeText(packJson, { siteUrl: 'https://example.test' });

  assert.match(readme, new RegExp(`${packJson.line_count} lines`));
  assert.match(readme, /DISCLOSED LIMITATIONS/);
  assert.match(readme, /CC0/);
  // No refresh-policy paragraph unless explicitly verified.
  assert.doesNotMatch(readme, /REFRESH POLICY/);

  const readmeWithRefresh = readmeText(packJson, { siteUrl: 'https://example.test', refreshPromiseVerified: true });
  assert.match(readmeWithRefresh, /REFRESH POLICY/);
});
