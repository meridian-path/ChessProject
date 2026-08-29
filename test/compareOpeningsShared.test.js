'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, formatPct, renderComparisonTable, bandRowFor } = require('../src/compareOpeningsShared');

function fakeOpening({ slug, name, side, bands }) {
  return { slug, name, side, bands };
}

const BAND_1600 = { band: '1600-1800', games: 12000, enoughData: true, scoreForSide: 54.8, scoreForSideCI: 0.9, scoreForSideBalanced: 52.1, scoreForSideBalancedCI: 1.2 };
const BAND_1400 = { band: '1400-1600', games: 40, enoughData: false, scoreForSide: null, scoreForSideCI: null, scoreForSideBalanced: null, scoreForSideBalancedCI: null };

test('escapeHtml escapes the 5 standard XML/HTML-sensitive characters', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('formatPct: one decimal place, "-" for a non-number (matches render.js\'s own formatPct)', () => {
  assert.equal(formatPct(54.8), '54.8');
  assert.equal(formatPct(null), '-');
  assert.equal(formatPct(undefined), '-');
});

test('bandRowFor: finds the matching band row, null when absent', () => {
  const opening = fakeOpening({ slug: 'italian-game', name: 'Italian Game', side: 'white', bands: [BAND_1400, BAND_1600] });
  assert.equal(bandRowFor(opening, '1600-1800'), BAND_1600);
  assert.equal(bandRowFor(opening, '2000+'), null);
});

test('renderComparisonTable: renders real games/score/CI for both openings at the requested band', () => {
  const openingA = fakeOpening({ slug: 'italian-game', name: 'Italian Game', side: 'white', bands: [BAND_1600] });
  const openingB = fakeOpening({ slug: 'sicilian-defense', name: 'Sicilian Defense', side: 'black', bands: [BAND_1600] });
  const html = renderComparisonTable(openingA, openingB, '1600-1800');

  assert.match(html, /<a href="italian-game\.html">Italian Game<\/a>/);
  assert.match(html, /<a href="sicilian-defense\.html">Sicilian Defense<\/a>/);
  assert.match(html, /12,000/); // games, toLocaleString()
  assert.match(html, /54\.8%/); // score for side
  assert.match(html, /&plusmn;0\.9/); // CI half-width
  assert.match(html, /52\.1% balanced/); // balanced score shown when available
  assert.match(html, /caption class="sr-only">Italian Game versus Sicilian Defense at 1600-1800/);
});

test('renderComparisonTable: an under-sampled band renders "n/a" and the real games count, never a fabricated percentage', () => {
  const openingA = fakeOpening({ slug: 'italian-game', name: 'Italian Game', side: 'white', bands: [BAND_1400] });
  const openingB = fakeOpening({ slug: 'sicilian-defense', name: 'Sicilian Defense', side: 'black', bands: [BAND_1400] });
  const html = renderComparisonTable(openingA, openingB, '1400-1600');
  assert.match(html, />n\/a</);
  assert.match(html, />40</); // real games count still shown even though score is suppressed
});

test('renderComparisonTable: a band with zero rows for an opening (never fetched/out of range) shows 0 games and n/a, never throws', () => {
  const openingA = fakeOpening({ slug: 'italian-game', name: 'Italian Game', side: 'white', bands: [BAND_1600] });
  const openingB = fakeOpening({ slug: 'sicilian-defense', name: 'Sicilian Defense', side: 'black', bands: [BAND_1600] });
  const html = renderComparisonTable(openingA, openingB, '2000+'); // neither opening has a 2000+ row in this fixture
  assert.match(html, />0<\/td><td class="num">0</);
});

test('renderComparisonTable: returns "" (never throws) when either opening is missing', () => {
  const openingA = fakeOpening({ slug: 'italian-game', name: 'Italian Game', side: 'white', bands: [BAND_1600] });
  assert.equal(renderComparisonTable(openingA, null, '1600-1800'), '');
  assert.equal(renderComparisonTable(null, openingA, '1600-1800'), '');
});

test('renderComparisonTable: no wide-interval note under the 3.0pp threshold, present at/above it', () => {
  // Site-audit fix (2026-08-29): threshold moved 1.0pp -> 3.0pp (see
  // renderContent.js's own WIDE_INTERVAL_THRESHOLD_PP comment) -- 1.0pp was
  // firing on rows the site's own homepage shows with no caveat at all.
  const narrow = fakeOpening({ slug: 'a', name: 'A', side: 'white', bands: [{ ...BAND_1600, scoreForSideCI: 2.0 }] });
  const wide = fakeOpening({ slug: 'b', name: 'B', side: 'black', bands: [{ ...BAND_1600, scoreForSideCI: 3.5 }] });
  const html = renderComparisonTable(narrow, wide, '1600-1800');
  const wideNoteCount = (html.match(/wide-interval-note/g) || []).length;
  assert.equal(wideNoteCount, 1);
});
