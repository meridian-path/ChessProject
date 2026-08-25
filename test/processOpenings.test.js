'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scoreFor,
  scoreForWithCI,
  MISTAKE_THRESHOLDS,
  findCommonMistakes,
  buildOpeningModel,
  rankOpeningsByScore,
  aggregateMistakesAcrossOpenings,
  scoreRangeAcrossBands,
} = require('../src/processOpenings');

test('scoreFor: win + draw/2, as a percentage', () => {
  // 100 white wins, 50 draws, 50 black wins out of 200 -> white score = (100+25)/200 = 62.5
  const totals = { white: 100, draws: 50, black: 50 };
  assert.equal(scoreFor(totals, 'white'), 62.5);
  assert.equal(scoreFor(totals, 'black'), 37.5);
});

test('scoreFor returns null when there is no data', () => {
  assert.equal(scoreFor({ white: 0, draws: 0, black: 0 }, 'white'), null);
  assert.equal(scoreFor(null, 'white'), null);
});

test('findCommonMistakes: rebuilt WS-3.3 rule -- all four conditions (frequency, balanced n>=300, CI significance, transposition) must pass', () => {
  // Parent position's balanced (rating gap <=50) totals: score for Black =
  // (400 + 25) / 1000 = 42.5%, CI low ~= 39.5pp (hand-verified below).
  const parentBalanced = { white: 550, draws: 50, black: 400 };
  const parentCI = scoreForWithCI(parentBalanced, 'black');
  assert.ok(Math.abs(parentCI.low - 39.5) < 0.5, `sanity-check the fixture's own parent CI, got ${parentCI.low}`);

  const response = {
    white: 590 + 4 + 400,
    draws: 20 + 1 + 150,
    black: 390 + 1 + 450,
    balanced: parentBalanced,
    moves: [
      // Frequent (~50% of games), and on the rating-diff-controlled
      // (balanced) subset it scores badly enough for Black that its CI
      // upper bound sits below the parent's CI lower bound (condition 3),
      // AND the resulting position's own balanced score is also below the
      // parent's CI lower bound (condition 4) -- should be flagged.
      {
        uci: 'g8f6', san: 'Nf6', white: 590, draws: 20, black: 390, averageRating: 1500,
        balanced: { white: 220, draws: 10, black: 80 }, // n=310 >= 300; score ~27.4%
        resultingBalanced: { white: 250, draws: 10, black: 100 }, // score ~29.2%
      },
      // Played rarely -- excluded by condition 1 (frequency) before its
      // balanced numbers (absent here) would even matter.
      { uci: 'a7a6', san: 'a6', white: 4, draws: 1, black: 1, averageRating: 1480 },
      // Frequent, and has real balanced data (n=400 >= 300, condition 2
      // passes) -- but its balanced score (52.5%) is NOT significantly
      // below the parent's -- excluded by condition 3.
      {
        uci: 'd7d5', san: 'd5', white: 400, draws: 150, black: 450, averageRating: 1550,
        balanced: { white: 150, draws: 80, black: 170 }, // n=400; score 52.5%
      },
    ],
  };

  const mistakes = findCommonMistakes(response, 'black');
  assert.equal(mistakes.length, 1);
  assert.equal(mistakes[0].san, 'Nf6');
  assert.ok(mistakes[0].score < parentCI.low, `expected a balanced-subset score under the parent's CI lower bound (${parentCI.low}), got ${mistakes[0].score}`);
});

test('findCommonMistakes: with no balanced/parent data at all (today\'s live-Explorer-API fallback), flags nothing -- never falls back to an uncontrolled rule', () => {
  const response = {
    white: 590 + 4 + 400, draws: 20 + 1 + 150, black: 390 + 1 + 450,
    moves: [
      { uci: 'g8f6', san: 'Nf6', white: 590, draws: 20, black: 390, averageRating: 1500 },
    ],
  };
  assert.deepEqual(findCommonMistakes(response, 'black'), []);
});

test('findCommonMistakes: a move with balanced data below the n>=300 floor is excluded by condition 2, even if its raw score looks bad', () => {
  const response = {
    white: 1000, draws: 0, black: 1000,
    balanced: { white: 550, draws: 50, black: 400 },
    moves: [
      { uci: 'g8f6', san: 'Nf6', white: 590, draws: 20, black: 390, averageRating: 1500, balanced: { white: 100, draws: 5, black: 20 } }, // n=125 < 300
    ],
  };
  assert.deepEqual(findCommonMistakes(response, 'black'), []);
});

test('MISTAKE_THRESHOLDS exposes the live threshold values (for /methodology to render, per spec)', () => {
  assert.equal(MISTAKE_THRESHOLDS.minPlayedPct, 2);
  assert.equal(MISTAKE_THRESHOLDS.minBalancedN, 300);
  assert.equal(MISTAKE_THRESHOLDS.limit, 2);
});

test('buildOpeningModel shapes bands correctly and tolerates a band with zero games', () => {
  const openingConfig = {
    slug: 'italian-game',
    name: 'Italian Game',
    ecoHint: 'C50',
    side: 'white',
    line: [
      { uci: 'e2e4', san: 'e4' },
      { uci: 'e7e5', san: 'e5' },
      { uci: 'g1f3', san: 'Nf3' },
      { uci: 'b8c6', san: 'Nc6' },
      { uci: 'f1c4', san: 'Bc4' },
    ],
  };
  const bandResponses = {
    '1400-1600': { white: 5200, draws: 1300, black: 3500, opening: { eco: 'C50', name: 'Italian Game' }, moves: [] },
    '1600-1800': {
      white: 26000,
      draws: 2000,
      black: 23000,
      opening: { eco: 'C50', name: 'Italian Game' },
      moves: [
        { uci: 'g8f6', san: 'Nf6', white: 6000, draws: 500, black: 5500, averageRating: 1700, opening: { eco: 'C50', name: 'Italian Game: Two Knights' } },
      ],
      recentGames: [{ uci: 'g8f6', id: 'abc12345', winner: 'white', speed: 'blitz', white: { name: 'A', rating: 1700 }, black: { name: 'B', rating: 1690 }, year: 2026, month: '2026-07' }],
    },
    '1800-2000': { white: 0, draws: 0, black: 0, opening: null, moves: [] },
    '2000+': { white: 900, draws: 100, black: 700, opening: null, moves: [] },
  };
  const mastersResponse = {
    opening: { eco: 'C50', name: 'Italian Game' },
    topGames: [{ uci: 'g8f6', id: 'xyz98765', winner: 'black', white: { name: 'Caruana, Fabiano', rating: 2835 }, black: { name: 'Carlsen, Magnus', rating: 2863 }, year: 2020, month: '2020-06' }],
  };

  const model = buildOpeningModel({ openingConfig, bandResponses, mastersResponse, minGamesForPct: 1000 });

  assert.equal(model.eco, 'C50');
  assert.equal(model.name, 'Italian Game');
  assert.equal(model.side, 'white');
  assert.equal(model.opponentColor, 'black');
  assert.equal(model.bands.length, 4);

  const zeroBand = model.bands.find((b) => b.band === '1800-2000');
  assert.equal(zeroBand.games, 0);
  assert.equal(zeroBand.enoughData, false);
  assert.equal(zeroBand.whitePct, null);

  const mainBand = model.bands.find((b) => b.band === '1600-1800');
  assert.equal(mainBand.games, 51000);
  assert.equal(mainBand.enoughData, true);
  assert.ok(typeof mainBand.scoreForSide === 'number');

  assert.equal(model.topReplies.length, 1);
  assert.equal(model.topReplies[0].san, 'Nf6');
  assert.equal(model.topReplies[0].opening.name, 'Italian Game: Two Knights');

  assert.equal(model.masterGames.length, 1);
  assert.equal(model.masterGames[0].white.name, 'Caruana, Fabiano');
  assert.equal(model.recentGames.length, 1);
});

test('buildOpeningModel attaches a punishing reply to the worst mistake when a follow-up response is supplied', () => {
  const openingConfig = {
    slug: 'sicilian-defense', name: 'Sicilian Defense', ecoHint: 'B20', side: 'black',
    line: [{ uci: 'e2e4', san: 'e4' }, { uci: 'c7c5', san: 'c5' }],
  };
  const bandResponses = {
    '1600-1800': {
      white: 5900000 + 400000,
      draws: 200000,
      black: 5000000,
      opening: { eco: 'B20', name: 'Sicilian Defense' },
      moves: [
        { uci: 'g1f3', san: 'Nf3', white: 5900000, draws: 200000, black: 4000000, averageRating: 1700 },
        { uci: 'b1c3', san: 'Nc3', white: 400000, draws: 5000, black: 1000000, averageRating: 1690 },
      ],
    },
  };
  const mistakeFollowUpResponse = {
    white: 0, draws: 0, black: 0,
    moves: [{ uci: 'd7d6', san: 'd6', white: 3000, draws: 200, black: 1800, averageRating: 1700 }],
  };
  const model = buildOpeningModel({ openingConfig, bandResponses, mistakeFollowUpResponse, minGamesForPct: 1000 });
  if (model.mistakes.length > 0) {
    assert.ok('punishingReply' in model.mistakes[0]);
  }
});

test('buildOpeningModel: mistakesByBand runs findCommonMistakes() against every already-fetched band, not just defaultBand -- the fix for candidate 5 (opening mistakes at other rating bands)', () => {
  const openingConfig = {
    slug: 'italian-game', name: 'Italian Game', ecoHint: 'C50', side: 'white',
    line: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }],
  };
  // Same shape findCommonMistakes' own dedicated test uses (parent balanced +
  // one move whose balanced-subset score sits below the parent's CI lower
  // bound, plus its resultingBalanced also below it) -- but filed under
  // '1400-1600', a NON-default band, to prove this isn't default-band-only.
  const parentBalanced = { white: 550, draws: 50, black: 400 };
  const nonDefaultResponse = {
    white: 590 + 4 + 400, draws: 20 + 1 + 150, black: 390 + 1 + 450,
    balanced: parentBalanced,
    moves: [
      {
        uci: 'g8f6', san: 'Nf6', white: 590, draws: 20, black: 390, averageRating: 1500,
        balanced: { white: 220, draws: 10, black: 80 },
        resultingBalanced: { white: 250, draws: 10, black: 100 },
      },
      { uci: 'a7a6', san: 'a6', white: 4, draws: 1, black: 1, averageRating: 1480 },
      { uci: 'g1f3', san: 'Nf3', white: 400, draws: 150, black: 450, averageRating: 1690, balanced: { white: 150, draws: 80, black: 170 } },
    ],
  };
  const bandResponses = {
    '1600-1800': { white: 0, draws: 0, black: 0, moves: [] }, // defaultBand: deliberately empty, no mistakes here
    '1400-1600': nonDefaultResponse,
  };
  const model = buildOpeningModel({ openingConfig, bandResponses, minGamesForPct: 1000 });

  assert.deepEqual(Object.keys(model.mistakesByBand).sort(), ['1400-1600', '1600-1800']);
  assert.equal(model.mistakesByBand['1600-1800'].length, 0); // defaultBand's own response had no data
  assert.equal(model.mistakes.length, 0); // unchanged existing field, still defaultBand-only
  assert.equal(model.mistakesByBand['1400-1600'].length, 1);
  assert.equal(model.mistakesByBand['1400-1600'][0].san, 'Nf6');
});

test('buildOpeningModel: mistakesByBand[defaultBand] is always the same array as the existing mistakes field', () => {
  const openingConfig = {
    slug: 'sicilian-defense', name: 'Sicilian Defense', ecoHint: 'B20', side: 'black',
    line: [{ uci: 'e2e4', san: 'e4' }, { uci: 'c7c5', san: 'c5' }],
  };
  const bandResponses = {
    '1600-1800': {
      white: 5900000 + 400000, draws: 200000, black: 5000000,
      moves: [{ uci: 'g1f3', san: 'Nf3', white: 5900000, draws: 200000, black: 4000000, averageRating: 1700 }],
    },
  };
  const model = buildOpeningModel({ openingConfig, bandResponses, minGamesForPct: 1000 });
  assert.equal(model.mistakesByBand['1600-1800'], model.mistakes);
});

function fakeEntry({ slug, name, side, band, games, scoreForSide, scoreForSideCI = 0, scoreForSideBalanced = null, scoreForSideBalancedCI = 0, mistakes = [], mistakesByBand = null }) {
  return {
    openingConfig: { slug, name, side },
    model: {
      name,
      side,
      opponentColor: side === 'white' ? 'black' : 'white',
      defaultBand: band,
      bands: [{ band, games, scoreForSide, scoreForSideCI, scoreForSideBalanced, scoreForSideBalancedCI, enoughData: games >= 1000 }],
      mistakes,
      mistakesByBand: mistakesByBand || { [band]: mistakes },
    },
  };
}

test('rankOpeningsByScore: with no balanced data anywhere (today\'s fallback), sorts by all-games score descending, usedBalanced false', () => {
  const entries = [
    fakeEntry({ slug: 'a', name: 'Opening A', side: 'white', band: '1600-1800', games: 5000, scoreForSide: 48 }),
    fakeEntry({ slug: 'b', name: 'Opening B', side: 'white', band: '1600-1800', games: 6000, scoreForSide: 55 }),
    fakeEntry({ slug: 'c', name: 'Opening C', side: 'white', band: '1600-1800', games: 50, scoreForSide: 90 }), // not enough games -- excluded
  ];
  const ranked = rankOpeningsByScore(entries, '1600-1800');
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].slug, 'b');
  assert.equal(ranked[1].slug, 'a');
  assert.equal(ranked[0].usedBalanced, false);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
});

test('rankOpeningsByScore: ranks on the balanced-subset score when every ranked entry has one, shows the all-games score alongside', () => {
  const entries = [
    fakeEntry({ slug: 'a', name: 'Opening A', side: 'white', band: '1600-1800', games: 5000, scoreForSide: 60, scoreForSideBalanced: 48, scoreForSideBalancedCI: 1 }),
    fakeEntry({ slug: 'b', name: 'Opening B', side: 'white', band: '1600-1800', games: 6000, scoreForSide: 50, scoreForSideBalanced: 55, scoreForSideBalancedCI: 1 }),
  ];
  const ranked = rankOpeningsByScore(entries, '1600-1800');
  assert.equal(ranked[0].slug, 'b'); // 55 > 48 on the BALANCED score, even though 'a' had the higher all-games score
  assert.equal(ranked[0].usedBalanced, true);
  assert.equal(ranked[0].scoreForSide, 50); // all-games score still present alongside
});

test('rankOpeningsByScore: falls back to all-games ranking (not a mixed ranking) when even one entry lacks balanced data', () => {
  const entries = [
    fakeEntry({ slug: 'a', name: 'Opening A', side: 'white', band: '1600-1800', games: 5000, scoreForSide: 60, scoreForSideBalanced: 48 }),
    fakeEntry({ slug: 'b', name: 'Opening B', side: 'white', band: '1600-1800', games: 6000, scoreForSide: 50, scoreForSideBalanced: null }),
  ];
  const ranked = rankOpeningsByScore(entries, '1600-1800');
  assert.equal(ranked[0].usedBalanced, false);
  assert.equal(ranked[0].slug, 'a'); // ranked on all-games score (60 > 50), not the partial balanced data
});

test('rankOpeningsByScore: adjacent rows within their combined CI half-width tie (share a rank number)', () => {
  const entries = [
    fakeEntry({ slug: 'a', name: 'Opening A', side: 'white', band: '1600-1800', games: 5000, scoreForSide: 51, scoreForSideCI: 1 }),
    fakeEntry({ slug: 'b', name: 'Opening B', side: 'white', band: '1600-1800', games: 6000, scoreForSide: 50, scoreForSideCI: 1 }),
    fakeEntry({ slug: 'c', name: 'Opening C', side: 'white', band: '1600-1800', games: 6000, scoreForSide: 30, scoreForSideCI: 1 }),
  ];
  const ranked = rankOpeningsByScore(entries, '1600-1800');
  // a (51) vs b (50): gap 1 < half+half (1+1=2) -> tie, same rank.
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1);
  // c (30) is nowhere near b (50) -- a real, supported gap -> rank 3 (competition-style, not 2).
  assert.equal(ranked[2].rank, 3);
});

test('rankOpeningsByScore: a chain of small adjacent gaps does not transitively tie rows whose own CIs never overlap (regression for the 2026-08-16 all-rank-1 bug)', () => {
  // 9 rows, evenly spaced scores from 54.6 down to 48.9 with shrinking CI
  // half-widths from 2.5 down to 1.3 -- the exact production numbers that
  // showed rank 1 for all 9 rows despite row 0's CI (52.1-57.1) and row 8's
  // CI (47.6-50.2) not overlapping at all.
  const N = 9;
  const entries = [];
  for (let i = 0; i < N; i += 1) {
    const score = 54.6 - ((54.6 - 48.9) * i) / (N - 1);
    const ci = 2.5 - ((2.5 - 1.3) * i) / (N - 1);
    entries.push(fakeEntry({
      slug: `o${i}`, name: `Opening ${i}`, side: 'white', band: '1600-1800',
      games: 5000, scoreForSide: score, scoreForSideCI: ci,
    }));
  }
  const ranked = rankOpeningsByScore(entries, '1600-1800');
  // The extreme rows' CIs are disjoint (52.1 > 50.2) so they must not share a rank.
  assert.notEqual(ranked[0].rank, ranked[N - 1].rank);
  // Not every row collapses to rank 1 -- at least one later, distinct group exists.
  assert.ok(ranked.some((r) => r.rank !== 1), 'expected at least one row ranked below 1');
  // Ranks are non-decreasing down the sorted (best-first) list.
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i].rank >= ranked[i - 1].rank);
  }
});

test('aggregateMistakesAcrossOpenings flattens and sorts every opening\'s mistakes worst-score-first', () => {
  const entries = [
    fakeEntry({
      slug: 'a', name: 'Opening A', side: 'white', band: '1600-1800', games: 5000, scoreForSide: 48,
      mistakes: [{ san: 'Nf6', playedPct: 5, score: 41 }],
    }),
    fakeEntry({
      slug: 'b', name: 'Opening B', side: 'black', band: '1600-1800', games: 5000, scoreForSide: 52,
      mistakes: [{ san: 'd5', playedPct: 8, score: 35 }],
    }),
  ];
  const all = aggregateMistakesAcrossOpenings(entries);
  assert.equal(all.length, 2);
  assert.equal(all[0].san, 'd5'); // worst score (35) first
  assert.equal(all[0].name, 'Opening B');
  assert.equal(all[1].san, 'Nf6');
});

test('aggregateMistakesAcrossOpenings: an explicit band reads from mistakesByBand instead of the default-band mistakes field, and stamps that band onto each row', () => {
  const entries = [
    fakeEntry({
      slug: 'a', name: 'Opening A', side: 'white', band: '1600-1800', games: 5000, scoreForSide: 48,
      mistakes: [{ san: 'Nf6', playedPct: 5, score: 41 }], // defaultBand's own mistake -- must be ignored when a different band is requested
      mistakesByBand: {
        '1600-1800': [{ san: 'Nf6', playedPct: 5, score: 41 }],
        '1400-1600': [{ san: 'e5', playedPct: 12, score: 30 }],
      },
    }),
    fakeEntry({
      slug: 'b', name: 'Opening B', side: 'black', band: '1600-1800', games: 5000, scoreForSide: 52,
      mistakes: [{ san: 'd5', playedPct: 8, score: 35 }],
      mistakesByBand: { '1600-1800': [{ san: 'd5', playedPct: 8, score: 35 }] }, // no 1400-1600 entry at all
    }),
  ];
  const all = aggregateMistakesAcrossOpenings(entries, '1400-1600');
  assert.equal(all.length, 1); // opening 'b' contributes nothing -- missing band, not a crash
  assert.equal(all[0].slug, 'a');
  assert.equal(all[0].san, 'e5');
  assert.equal(all[0].band, '1400-1600');
});

test('aggregateMistakesAcrossOpenings: omitting band still reads today\'s default-band mistakes field unchanged', () => {
  const entries = [
    fakeEntry({
      slug: 'a', name: 'Opening A', side: 'white', band: '1600-1800', games: 5000, scoreForSide: 48,
      mistakes: [{ san: 'Nf6', playedPct: 5, score: 41 }],
      mistakesByBand: { '1600-1800': [{ san: 'Nf6', playedPct: 5, score: 41 }], '1400-1600': [{ san: 'e5', playedPct: 12, score: 30 }] },
    }),
  ];
  const all = aggregateMistakesAcrossOpenings(entries);
  assert.equal(all.length, 1);
  assert.equal(all[0].san, 'Nf6'); // the 1400-1600 entry must NOT leak in when no band is requested
  assert.equal(all[0].band, '1600-1800');
});

test('scoreRangeAcrossBands finds the min/max scoring bands and returns null with fewer than 2 usable bands', () => {
  const model = {
    bands: [
      { band: '1400-1600', games: 5000, scoreForSide: 50, enoughData: true },
      { band: '1600-1800', games: 6000, scoreForSide: 55, enoughData: true },
      { band: '1800-2000', games: 20, scoreForSide: 90, enoughData: false },
    ],
  };
  const range = scoreRangeAcrossBands(model);
  assert.equal(range.minBand, '1400-1600');
  assert.equal(range.maxBand, '1600-1800');
  assert.equal(range.range, 5);

  const singleBandModel = { bands: [{ band: '1400-1600', games: 5000, scoreForSide: 50, enoughData: true }] };
  assert.equal(scoreRangeAcrossBands(singleBandModel), null);
});
