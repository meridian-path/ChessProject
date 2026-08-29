'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  buildPackPages,
  buildOnePackBundle,
  readFileSizesIfPresent,
  formatBytes,
  PACK_CATALOGUE,
} = require('../src/buildPackPages');
const { packDetailFilename, packsIndexFilename, packSampleFilename } = require('../src/renderPackPages');

function fakeResponse(json) {
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => json };
}

// Small, hand-built fixtures for both launch-catalogue packs -- same style
// as test/buildPack.test.js's mainScenarioFetch(), just routed by the
// aggregate-cache URL's `play` query param regardless of which pack def
// (white or black) is asking, since both currently share firstMoveUci
// 'e2e4' (see src/buildPackPages.js's own PACK_CATALOGUE).
function fixtureFetch() {
  const byPlay = {
    'e2e4': fakeResponse({
      white: 65000, draws: 7000, black: 58000,
      moves: [
        { uci: 'c7c5', san: 'c5', white: 18000, draws: 4000, black: 18000 }, // n=40000
        { uci: 'e7e5', san: 'e5', white: 11000, draws: 3000, black: 11000 }, // n=25000
      ],
    }),
    'e2e4,c7c5': fakeResponse({
      white: 15000, draws: 3000, black: 4500,
      moves: [{ uci: 'c2c3', san: 'c3', white: 7500, draws: 3000, black: 4500 }],
    }),
    'e2e4,e7e5': fakeResponse({ white: 40, draws: 20, black: 40, moves: [{ uci: 'g1f3', san: 'Nf3', white: 40, draws: 20, black: 40 }] }),
    'e2e4,c7c5,c2c3': fakeResponse({ white: 100, draws: 50, black: 50, moves: [{ uci: 'd7d5', san: 'd5', white: 100, draws: 50, black: 50 }] }),
  };
  return async (url) => {
    const play = new URL(url).searchParams.get('play') || '';
    const fixture = byPlay[play];
    if (!fixture) throw new Error(`fixtureFetch: no fixture for play="${play}"`);
    return fixture;
  };
}

test('PACK_CATALOGUE matches the launch catalogue (exactly two packs, spec 1.1)', () => {
  assert.equal(PACK_CATALOGUE.length, 2);
  assert.deepEqual(PACK_CATALOGUE.map((p) => p.id).sort(), ['black-vs-e4-1400-1600', 'white-1400-1600']);
});

test('formatBytes renders a human-readable size', () => {
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(236520), '231 KB');
});

test('readFileSizesIfPresent returns null for a pack with no local packs/<id>/ directory', () => {
  // 'nonexistent-pack-id-xyz' is guaranteed not to exist under packs/ --
  // this exercises the graceful-degradation path (see this file's own
  // header comment: the sales page must still build correctly, e.g. in CI,
  // where packs/ was never generated locally).
  assert.equal(readFileSizesIfPresent('nonexistent-pack-id-xyz'), null);
});

test('buildOnePackBundle produces a bundle whose line/position counts match packJsonFromResult, and a real free sample', async () => {
  const def = { id: 'white-1400-1600', title: 'White at 1400-1600', color: 'white', band: '1400-1600', firstMoveUci: 'e2e4' };
  const bundle = await buildOnePackBundle(def, { fetchImpl: fixtureFetch(), retrieved: '2026-08-15' });

  assert.equal(bundle.firstMoveSan, 'e4');
  assert.equal(bundle.tree.san, 'e4');
  assert.ok(bundle.lineCount > 0);
  assert.equal(bundle.positionCount, require('../src/buildPack').countPositions(bundle.tree));
  assert.ok(bundle.samplePgn.includes('(free sample)'));
  assert.ok(bundle.samplePgn.includes('1. e4'));
  // STORE.packs['white-1400-1600'] now carries a real, non-placeholder
  // Gumroad url -- see src/render.js's STORE constant -- so this bundle
  // must self-report indexable, not noindex.
  assert.equal(bundle.noindex, false);
});

test('buildPackPages writes the index + one detail page + one sample.pgn per catalogue pack, all under repertoire-packs/', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-pack-pages-test-'));
  try {
    // Route BOTH catalogue defs through the same small fixture -- both
    // currently share firstMoveUci 'e2e4' (PACK_CATALOGUE), so one fixture
    // set covers both without duplicating it.
    const { written, packs } = await buildPackPages({
      fetchImpl: fixtureFetch(),
      outDir: tmpDir,
      nav: { home: '/', repertoire: 'repertoire.html', packs: packsIndexFilename() },
    });

    assert.equal(packs.length, 2);
    assert.equal(written.length, 3); // index + 2 detail pages

    const indexPath = path.join(tmpDir, packsIndexFilename());
    assert.ok(fs.existsSync(indexPath), 'packs index page should be written');

    for (const def of PACK_CATALOGUE) {
      const detailPath = path.join(tmpDir, packDetailFilename(def.id));
      assert.ok(fs.existsSync(detailPath), `${def.id} detail page should be written`);
      const samplePath = path.join(tmpDir, packSampleFilename(def.id));
      assert.ok(fs.existsSync(samplePath), `${def.id} sample.pgn should be written`);
      const sampleContent = fs.readFileSync(samplePath, 'utf8');
      assert.ok(sampleContent.includes('(free sample)'));
    }

    // STORE now carries real Gumroad urls, so every written .html file is
    // indexable (not noindex), and none renders the literal sentinel string.
    for (const w of written) {
      assert.equal(w.noindex, false);
      assert.ok(!w.html.includes('PLACEHOLDER'));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
