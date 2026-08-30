'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createBestOpeningsByRatingBandPages } = require('../src/content/bestOpeningsByRatingBand');
const { createOpeningMistakesByBandPages } = require('../src/content/mostCommonOpeningMistakesByBand');
const { formatPct } = require('../src/render');

// Site-audit fix ("index reads templated"): both factories' describeResult()
// give the guides index a real, data-driven sentence instead of the
// identical band/side-swapped template every one of these pages used to
// carry. Unit-tested directly (rather than only through the shared smart
// explorer fixture in test/buildContent.test.js) so the rich-vs-fallback
// branch is deterministic and doesn't depend on that fixture happening to
// produce a qualifying result.

function rankOpeningsByScoreStub(entries) {
  // Real shape rankOpeningsByScore returns, sorted by scoreForSide desc.
  return [...entries]
    .map((e, i) => ({ slug: e.openingConfig.slug, name: e.model.name, rank: i + 1, scoreForSide: e.model.bands[0].scoreForSide, scoreForSideBalanced: null, games: e.model.bands[0].games, usedBalanced: false }))
    .sort((a, b) => b.scoreForSide - a.scoreForSide)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function makeEntry(slug, name, side, scoreForSide, games = 5000) {
  return {
    openingConfig: { slug, side },
    model: { name, bands: [{ band: '1600-1800', scoreForSide, games, enoughData: true }] },
  };
}

test('bestOpeningsByRatingBand describeResult: names the real top-scoring opening and its score, not the fixed template', () => {
  const pages = createBestOpeningsByRatingBandPages();
  const page = pages.find((p) => p.meta.slug === 'best-white-openings-1600-1800');
  const entries = [makeEntry('italian-game', 'Italian Game', 'white', 62.3), makeEntry('scotch-game', 'Scotch Game', 'white', 58.1), makeEntry('sicilian-defense', 'Sicilian Defense', 'black', 38.0)];
  const description = page.describeResult({ entries, rankOpeningsByScore: rankOpeningsByScoreStub, formatPct });
  assert.equal(description, `Italian Game leads White's tracked openings at 1600-1800, scoring ${formatPct(62.3)}% - full ranking and sample size for every number shown.`);
  assert.notEqual(description, page.meta.description);
});

test('bestOpeningsByRatingBand describeResult: falls back to the generic template when the band has no ranked entries', () => {
  const pages = createBestOpeningsByRatingBandPages();
  const page = pages.find((p) => p.meta.slug === 'best-white-openings-1600-1800');
  const description = page.describeResult({ entries: [], rankOpeningsByScore: rankOpeningsByScoreStub, formatPct });
  assert.equal(description, page.meta.description);
});

test('mostCommonOpeningMistakesByBand describeResult: names the real worst-scoring mistake, not the fixed template', () => {
  const pages = createOpeningMistakesByBandPages();
  const page = pages.find((p) => p.meta.slug === 'most-common-opening-mistakes-1400-1600');
  const worstMistake = { san: 'Nc6', name: 'Italian Game', playedPct: 40.2, score: 33.5 };
  const description = page.describeResult({
    entries: [],
    aggregateMistakesAcrossOpenings: () => [worstMistake],
    formatPct,
  });
  assert.equal(
    description,
    `At 1400-1600, Nc6 in the Italian Game is played ${formatPct(40.2)}% of the time but scores only ${formatPct(33.5)}% - the single worst-scoring common move this build tracks at this band.`
  );
  assert.notEqual(description, page.meta.description);
});

test('mostCommonOpeningMistakesByBand describeResult: falls back to the generic template when no mistake qualifies at this band', () => {
  const pages = createOpeningMistakesByBandPages();
  const page = pages.find((p) => p.meta.slug === 'most-common-opening-mistakes-1400-1600');
  const description = page.describeResult({ entries: [], aggregateMistakesAcrossOpenings: () => [], formatPct });
  assert.equal(description, page.meta.description);
});
