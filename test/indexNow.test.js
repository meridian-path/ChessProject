'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { INDEXNOW_KEY, indexNowKeyFileName, indexNowKeyFileContent, indexNowHost } = require('../src/indexNow');

test('INDEXNOW_KEY is a hex string in the 8-128 char range IndexNow requires', () => {
  assert.match(INDEXNOW_KEY, /^[a-f0-9]+$/);
  assert.ok(INDEXNOW_KEY.length >= 8 && INDEXNOW_KEY.length <= 128);
});

test('indexNowKeyFileName is the literal key plus .txt, matching what IndexNow expects to fetch at the site root', () => {
  assert.equal(indexNowKeyFileName(), `${INDEXNOW_KEY}.txt`);
});

test('indexNowKeyFileContent is just the key, nothing else', () => {
  assert.equal(indexNowKeyFileContent().trim(), INDEXNOW_KEY);
});

test('indexNowHost strips the scheme from SITE_ORIGIN, no trailing slash', () => {
  assert.equal(indexNowHost(), 'repertoire-builder.com');
});
