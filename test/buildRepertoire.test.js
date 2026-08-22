'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildRepertoireTree } = require('../src/buildRepertoire');

const FIXTURES = path.join(__dirname, 'fixtures');
const rootFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-response.json'), 'utf8'));
const afterE4Fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-after-e4.json'), 'utf8'));
const afterD4Fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-after-d4.json'), 'utf8'));

// buildRepertoireTree() defaults aggregatesDir to the real data/aggregates/
// (see src/explorerSource.js's fetchMoves()) -- if a developer/agent has run
// `npm run fetch-local-aggregates` and cached real shard data there, this
// fixture-driven test would silently stop exercising fetchImpl at all and
// assert against real numbers instead. Always empty, never written to, so
// aggregatesAvailable() is guaranteed false below.
const EMPTY_AGGREGATES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buildRepertoire-empty-aggregates-'));

// All tests below use a hand-built fake fetch keyed off the `play` query
// param, standing in for a small 3-position slice of the live Opening
// Explorer tree. No live network calls are made anywhere in this file.
function fakeExplorerFetch() {
  let callCount = 0;
  const fetchImpl = async (url) => {
    callCount += 1;
    const play = new URL(url).searchParams.get('play');
    let json;
    if (!play) {
      json = rootFixture;
    } else if (play === 'e2e4') {
      json = afterE4Fixture;
    } else if (play === 'd2d4') {
      json = afterD4Fixture;
    } else {
      throw new Error(`fakeExplorerFetch: no fixture wired for play="${play}"`);
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => json,
    };
  };
  return { fetchImpl, getCallCount: () => callCount };
}

test('buildRepertoireTree branches on the user color and follows a single opponent reply', async () => {
  const { fetchImpl, getCallCount } = fakeExplorerFetch();
  const result = await buildRepertoireTree({
    ratingBand: '1600-1800',
    color: 'white',
    breadth: 2,
    maxUserPlies: 1,
    fetchImpl,
    aggregatesDir: EMPTY_AGGREGATES_DIR,
  });

  assert.equal(result.ratingBand, '1600-1800');
  assert.deepEqual(result.ratings, [1600]);
  assert.equal(result.color, 'white');
  assert.deepEqual(result.totals, { white: 50000, draws: 15000, black: 35000 });

  // Root branches into the top 2 (breadth) moves for white, sorted by games.
  assert.equal(result.tree.length, 2);
  assert.equal(result.tree[0].san, 'e4');
  assert.equal(result.tree[0].mover, 'white');
  assert.equal(result.tree[0].ply, 0);
  assert.equal(result.tree[1].san, 'd4');

  // Each white move is followed by exactly one black reply (top-played only).
  assert.equal(result.tree[0].children.length, 1);
  assert.equal(result.tree[0].children[0].san, 'c5');
  assert.equal(result.tree[0].children[0].mover, 'black');
  assert.equal(result.tree[0].children[0].ply, 1);
  // maxUserPlies of 1 was fully consumed by the root ply, so the tree stops here.
  assert.equal(result.tree[0].children[0].children, null);

  assert.equal(result.tree[1].children.length, 1);
  assert.equal(result.tree[1].children[0].san, 'd5');
  assert.equal(result.tree[1].children[0].children, null);

  // 1 root fetch + 1 fetch per branch to find the opponent's top reply = 3.
  assert.equal(getCallCount(), 3);
});

test('buildRepertoireTree throws on an unknown rating band', async () => {
  const { fetchImpl } = fakeExplorerFetch();
  await assert.rejects(
    () => buildRepertoireTree({ ratingBand: 'not-a-band', color: 'white', fetchImpl }),
    /Unknown rating band/
  );
});

test('buildRepertoireTree throws on an invalid color', async () => {
  const { fetchImpl } = fakeExplorerFetch();
  await assert.rejects(
    () => buildRepertoireTree({ ratingBand: '1600-1800', color: 'green', fetchImpl }),
    /color must be/
  );
});
