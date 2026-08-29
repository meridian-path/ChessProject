'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FAMILY_STRATEGY, VOLUME_STRATEGY, assertFamilyStrategyComplete } = require('../src/ecoFamilyStrategy');
const { buildEcoDataset } = require('../src/ecoData');
const { buildFamilyIndex, t1Families } = require('../src/ecoFamilies');
const { VOLUME_LABELS } = require('../src/renderEcoPages');

test('assertFamilyStrategyComplete: passes against the REAL 64 T1 families and the real 5 ECO volumes', () => {
  const { lines } = buildEcoDataset();
  const t1 = t1Families(buildFamilyIndex(lines));
  assert.doesNotThrow(() => assertFamilyStrategyComplete(t1.map((f) => f.slug), Object.keys(VOLUME_LABELS)));
});

test('assertFamilyStrategyComplete: throws if the real T1 family count has drifted from this file\'s own 64-family baseline', () => {
  assert.throws(() => assertFamilyStrategyComplete(['a', 'b'], Object.keys(VOLUME_LABELS)), /expected exactly 64 T1 families/);
});

test('assertFamilyStrategyComplete: throws when a family slug has no entry at all', () => {
  const slugs = Array(64).fill('sicilian-defense');
  slugs[0] = 'not-a-real-family';
  assert.throws(() => assertFamilyStrategyComplete(slugs, Object.keys(VOLUME_LABELS)), /"not-a-real-family" is missing real strategy commentary/);
});

test('assertFamilyStrategyComplete: throws when a family entry is suspiciously short (a placeholder, not real commentary)', () => {
  const original = FAMILY_STRATEGY['bird-opening'];
  FAMILY_STRATEGY['bird-opening'] = 'too short';
  try {
    const slugs = Array(64).fill('sicilian-defense');
    slugs[0] = 'bird-opening';
    assert.throws(() => assertFamilyStrategyComplete(slugs, Object.keys(VOLUME_LABELS)), /"bird-opening" is missing real strategy commentary/);
  } finally {
    FAMILY_STRATEGY['bird-opening'] = original;
  }
});

test('assertFamilyStrategyComplete: throws when a volume has no entry at all', () => {
  const t1Slugs = Array(64).fill('sicilian-defense');
  assert.throws(() => assertFamilyStrategyComplete(t1Slugs, ['A', 'Z']), /ECO volume "Z" is missing real strategy commentary/);
});

test('every FAMILY_STRATEGY entry is genuinely differentiated -- no two families share the exact same paragraph', () => {
  const texts = Object.values(FAMILY_STRATEGY);
  const unique = new Set(texts);
  assert.equal(unique.size, texts.length, 'two families have byte-identical strategy text -- likely a copy-paste, not real per-family commentary');
});

test('every VOLUME_STRATEGY entry is genuinely differentiated -- no two volumes share the exact same paragraph', () => {
  const texts = Object.values(VOLUME_STRATEGY);
  const unique = new Set(texts);
  assert.equal(unique.size, texts.length);
});
