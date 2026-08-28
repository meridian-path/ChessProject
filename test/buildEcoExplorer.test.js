'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildEcoExplorerPage, ECO_EXPLORER_FILE, REVERSE_LOOKUP_FILE, LINE_INDEX_FILE } = require('../src/buildEcoExplorer');
const { buildEcoDataset } = require('../src/ecoData');
const { buildFamilyIndex } = require('../src/ecoFamilies');

const NAV = { repertoire: '/', openings: 'openings.html', eco: 'eco-openings.html', player: 'player.html' };

function withTempDist(fn) {
  const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-eco-explorer-dist-'));
  return Promise.resolve()
    .then(() => fn(tmpDist))
    .finally(() => {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    });
}

// Real vendored dataset -- cheap (~2s, no network, see src/ecoData.js), and
// this module's job is specifically to shape+write the REAL data, so a
// fixture would hide the exact thing worth testing (real counts, real
// reverse-lookup size).
const dataset = buildEcoDataset();
const familyIndex = buildFamilyIndex(dataset.lines);

test('buildEcoExplorerPage writes eco-explorer.html and the reverse-lookup JSON asset, both readable from disk', () =>
  withTempDist(async (outDir) => {
    const result = buildEcoExplorerPage({ dataset, familyIndex, nav: NAV, outDir });
    assert.equal(result.file, ECO_EXPLORER_FILE);
    assert.ok(fs.existsSync(path.join(outDir, ECO_EXPLORER_FILE)));
    assert.ok(fs.existsSync(path.join(outDir, REVERSE_LOOKUP_FILE)));

    const writtenHtml = fs.readFileSync(path.join(outDir, ECO_EXPLORER_FILE), 'utf8');
    assert.equal(writtenHtml, result.html);

    const writtenJson = fs.readFileSync(path.join(outDir, REVERSE_LOOKUP_FILE), 'utf8');
    assert.equal(writtenJson, result.reverseLookupJson);
    const parsed = JSON.parse(writtenJson);
    assert.equal(parsed.length, result.reverseLookupCount);
    assert.ok(result.reverseLookupCount > 10000, 'the real Source B reverse lookup should have well over 10,000 entries');
  })
);

test('buildEcoExplorerPage (craft-audit item 5, first half) writes the search line-index as its own external JSON asset, exactly one row per dataset line (all 3,810), and does NOT bake it into the HTML', () =>
  withTempDist(async (outDir) => {
    const result = buildEcoExplorerPage({ dataset, familyIndex, nav: NAV, outDir });
    assert.equal(result.lineIndexFile, LINE_INDEX_FILE);
    assert.ok(fs.existsSync(path.join(outDir, LINE_INDEX_FILE)));

    const writtenJson = fs.readFileSync(path.join(outDir, LINE_INDEX_FILE), 'utf8');
    assert.equal(writtenJson, result.lineIndexJson);
    const lineIndex = JSON.parse(writtenJson);
    assert.equal(lineIndex.length, 3810);
    assert.equal(lineIndex.length, result.lineIndexCount);

    assert.doesNotMatch(result.html, /id="explorer-line-index"/, 'the line index must not be baked into the page HTML');
    assert.match(result.html, new RegExp(`"lineIndexUrl":"${LINE_INDEX_FILE}"`), 'the page must carry the fetch URL in its baked config block');
  })
);

test('buildEcoExplorerPage has a unique title/description and one H1', () =>
  withTempDist(async (outDir) => {
    const result = buildEcoExplorerPage({ dataset, familyIndex, nav: NAV, outDir });
    assert.ok(result.title);
    assert.ok(result.description);
    assert.ok(result.description.length <= 160);
    const h1Matches = result.html.match(/<h1[ >]/g) || [];
    assert.equal(h1Matches.length, 1);
  })
);

test('buildEcoExplorerPage never leaks the full raw Source B payload -- reverse-lookup rows are exactly [fen, eco, name]', () =>
  withTempDist(async (outDir) => {
    const result = buildEcoExplorerPage({ dataset, familyIndex, nav: NAV, outDir });
    const parsed = JSON.parse(result.reverseLookupJson);
    for (const row of parsed.slice(0, 50)) {
      assert.equal(row.length, 3);
      assert.equal(typeof row[0], 'string');
      assert.equal(typeof row[1], 'string');
      assert.equal(typeof row[2], 'string');
    }
  })
);

test('buildEcoExplorerPage accepts an injected readFileImpl/dataDir (no real disk read required)', () => {
  const fakeLines = [
    { eco: 'A00', name: 'Uncommon Openings', family: 'Uncommon Openings', plies: [{ san: 'a3' }] },
  ];
  const fakeFamilyIndex = [{ family: 'Uncommon Openings', slug: 'uncommon-openings', lineCount: 1, ecoCodes: ['A00'] }];
  const fakeSourceBFile = JSON.stringify({
    'rnbqkbnr/pppppppp/8/8/P7/8/1PPPPPPP/RNBQKBNR b KQkq a3 0 1': { eco: 'A00', name: 'Uncommon Openings' },
  });
  const readFileImpl = (p) => (String(p).endsWith('.json') ? fakeSourceBFile : '');
  const result = buildEcoExplorerPage({
    dataset: { lines: fakeLines, stats: { totalLines: 1 } },
    familyIndex: fakeFamilyIndex,
    nav: NAV,
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-eco-explorer-fake-')),
    readFileImpl,
    dataDir: '/fake',
  });
  assert.equal(result.reverseLookupCount, 1);
});
