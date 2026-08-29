'use strict';

// Site-audit fix (2026-08-29): the "Wide interval,
// small sample" caution rendered TWICE per row on the opening-page "How it
// scores at your rating" table (once under the W/D/L bar, once under the
// score), and its 1.0pp threshold fired on rows the site's own homepage
// shows with no caveat at all (e.g. n=7,493, +/-1.1pp) -- see
// renderContent.js's own WIDE_INTERVAL_THRESHOLD_PP comment for the full
// reasoning. These tests exist because neither defect had any prior direct
// coverage: both wdlBar's own inline note and renderBandsTable's second,
// duplicate call were only ever exercised indirectly through a full
// renderOpeningPage() build, which never asserted an occurrence COUNT.

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderBandsTable, renderTopRepliesTable, wideIntervalNote } = require('../src/renderContent');

function countNotes(html) {
  return (html.match(/wide-interval-note/g) || []).length;
}

function bandRow(overrides = {}) {
  return {
    band: '1600-1800',
    games: 7493,
    enoughData: true,
    whitePct: 51, drawPct: 25, blackPct: 24,
    whiteCI: 1.1, drawCI: 1.0, blackCI: 1.0,
    scoreForSide: 63.5, scoreForSideCI: 1.1,
    ...overrides,
  };
}

test('wideIntervalNote: returns "" below the 3.0pp threshold, real markup at/above it', () => {
  assert.equal(wideIntervalNote(2.9), '');
  assert.equal(wideIntervalNote(null), '');
  assert.ok(wideIntervalNote(3.0).includes('wide-interval-note'));
  assert.ok(wideIntervalNote(7.0).includes('wide-interval-note'));
});

test('renderBandsTable: a real large-sample row (n=7,493, +/-1.1pp on every figure) gets zero notes', () => {
  // The exact numbers from the live-site defect this task was filed against
  // (repertoire-builder.com/caro-kann-defense.html, 1600-1800 band).
  const model = { side: 'Black', bands: [bandRow()] };
  const html = renderBandsTable(model);
  assert.equal(countNotes(html), 0, 'a +/-1.1pp interval at n=7,493 is not "wide" by the site\'s own standard');
});

test('renderBandsTable: a row with a wide scoreForSide CI (bar-side narrow) gets exactly ONE note, not two', () => {
  const model = { side: 'Black', bands: [bandRow({ scoreForSideCI: 4.0 })] };
  const html = renderBandsTable(model);
  assert.equal(countNotes(html), 1, 'must fold the bar\'s own win/draw/loss check and the score check into one combined note per row');
});

test('renderBandsTable: a row with wide win/draw/loss CI (score-side narrow) gets exactly ONE note, not two', () => {
  const model = { side: 'Black', bands: [bandRow({ whiteCI: 4.0, drawCI: 4.0, blackCI: 4.0 })] };
  const html = renderBandsTable(model);
  assert.equal(countNotes(html), 1);
});

test('renderBandsTable: a genuinely small/wide row (n=192, +/-7.0pp) still gets its real caution', () => {
  const model = { side: 'Black', bands: [bandRow({ games: 192, whiteCI: 7.0, drawCI: 6.5, blackCI: 6.8, scoreForSideCI: 7.0 })] };
  const html = renderBandsTable(model);
  assert.equal(countNotes(html), 1, 'a real low-n row must still be flagged -- this is the row the note exists to protect');
});

test('renderBandsTable: an all-narrow multi-band model gets zero notes across every row (not per-model, per-row)', () => {
  const model = {
    side: 'White',
    bands: [bandRow({ band: '1000-1200' }), bandRow({ band: '1600-1800' }), bandRow({ band: '2000+' })],
  };
  const html = renderBandsTable(model);
  assert.equal(countNotes(html), 0);
});

function replyRow(overrides = {}) {
  return {
    san: 'e5', games: 3271, playedPct: 40,
    winPct: 34, drawPct: 32, lossPct: 34,
    winCI: 1.7, drawCI: 1.6, lossCI: 1.7,
    winLow: 32.3, winHigh: 35.7, drawLow: 30.4, drawHigh: 33.6, lossLow: 32.3, lossHigh: 35.7,
    ...overrides,
  };
}

test('renderTopRepliesTable: a real large-sample reply (n=3,271, ~+/-1.7pp) gets zero notes', () => {
  const model = { defaultBand: '1600-1800', topReplies: [replyRow()] };
  const html = renderTopRepliesTable(model);
  assert.equal(countNotes(html), 0);
});

test('renderTopRepliesTable: a genuinely small-sample reply (n=192, +/-7.0pp) still gets exactly one note', () => {
  const model = {
    defaultBand: '1600-1800',
    topReplies: [replyRow({ san: 'd3', games: 192, winCI: 7.0, drawCI: 6.9, lossCI: 7.1 })],
  };
  const html = renderTopRepliesTable(model);
  assert.equal(countNotes(html), 1);
});

test('renderTopRepliesTable: no note when there is no interval data at all (undefined CI fields)', () => {
  const model = {
    defaultBand: '1600-1800',
    topReplies: [{ san: 'c5', games: 40000, playedPct: 62, winPct: 45, drawPct: 16, lossPct: 39 }],
  };
  const html = renderTopRepliesTable(model);
  assert.equal(countNotes(html), 0);
});
