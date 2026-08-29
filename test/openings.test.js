'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OPENINGS,
  getOpening,
  slugToFilename,
  assertOpeningsWellFormed,
} = require('../src/openings');

test('there are at least the original 10 spec openings, and the count grows only by deliberate, hand-vetted additions (see openings.js header comment)', () => {
  assert.ok(OPENINGS.length >= 10);
});

test('every opening has a unique, URL-safe slug', () => {
  const slugs = OPENINGS.map((o) => o.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) {
    assert.match(slug, /^[a-z0-9-]+$/);
  }
});

test('every opening has a valid side and a non-empty line with matching san/uci pairs', () => {
  for (const o of OPENINGS) {
    assert.ok(o.side === 'white' || o.side === 'black', `${o.slug}: invalid side`);
    assert.ok(Array.isArray(o.line) && o.line.length > 0, `${o.slug}: empty line`);
    for (const ply of o.line) {
      assert.ok(typeof ply.uci === 'string' && ply.uci.length >= 4, `${o.slug}: bad uci`);
      assert.ok(typeof ply.san === 'string' && ply.san.length > 0, `${o.slug}: bad san`);
    }
  }
});

test('no opening slug collides with a reserved static filename', () => {
  for (const o of OPENINGS) {
    const file = slugToFilename(o.slug);
    assert.notEqual(file, 'index.html');
    assert.notEqual(file, 'player.html');
    assert.notEqual(file, 'openings.html');
  }
});

test('getOpening finds a known slug and returns null for an unknown one', () => {
  assert.equal(getOpening('italian-game').name, 'Italian Game');
  assert.equal(getOpening('not-a-real-opening'), null);
});

test('assertOpeningsWellFormed passes for the real config', () => {
  assert.equal(assertOpeningsWellFormed(), true);
});

// AdSense low-value-content fix, part 1: every
// opening page must carry real, opening-specific strategy commentary, not
// just data tables -- these are floor/regression checks, not a substitute
// for a human judging the writing is actually good.
test('every opening has real strategy commentary, not a placeholder or an empty string', () => {
  for (const o of OPENINGS) {
    assert.ok(typeof o.strategy === 'string' && o.strategy.trim().length >= 120, `${o.slug}: missing or too-short strategy commentary`);
  }
});

test('no two openings share the exact same strategy text (each is genuinely opening-specific, not a copy-pasted template)', () => {
  const texts = OPENINGS.map((o) => o.strategy);
  assert.equal(new Set(texts).size, texts.length);
});

test('assertOpeningsWellFormed rejects an entry with missing/too-short strategy commentary', () => {
  const { assertOpeningsWellFormed: freshAssert } = require('../src/openings');
  const original = OPENINGS[0].strategy;
  OPENINGS[0].strategy = 'Too short.';
  try {
    assert.throws(() => freshAssert(), /missing real strategy commentary/);
  } finally {
    OPENINGS[0].strategy = original;
  }
});
