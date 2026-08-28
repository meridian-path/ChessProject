'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildEcoPages, findT0CrossLink, findDrillCrossLink, pickRelatedFamilies, buildVolumeCodeRows } = require('../src/buildEcoPages');
const { buildEcoDataset } = require('../src/ecoData');
const { buildFamilyIndex, t1Families, familyHubFilename } = require('../src/ecoFamilies');
const { ecoVolumeFilename, ecoIndexPageFilename, VOLUME_LABELS } = require('../src/renderEcoPages');
const { OPENINGS } = require('../src/openings');
const { makeSmartExplorerFetch } = require('./helpers/fakeExplorer');

const NAV = { repertoire: '/', openings: 'openings.html', eco: 'eco-openings.html', player: 'player.html' };

// Same isolated-temp-dir pattern as test/buildContent.test.js -- own
// throwaway dist dir per test, since node:test runs files concurrently and
// buildStatic.test.js already claims the real project dist/ dir for its own
// backup/restore dance.
function withTempDist(fn) {
  const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-eco-dist-'));
  return Promise.resolve()
    .then(() => fn(tmpDist))
    .finally(() => {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    });
}

// buildEcoPages() defaults aggregatesDir to the real data/aggregates/ (see
// src/explorerSource.js's fetchMoves()) -- if a developer/agent has run
// `npm run fetch-local-aggregates` and cached real shard data there, a call
// asserting the exact fetchImpl call count would silently stop exercising
// fetchImpl at all. Always empty, never written to, so aggregatesAvailable()
// is guaranteed false below.
const EMPTY_AGGREGATES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buildEcoPages-empty-aggregates-'));

test('buildEcoPages: writes exactly 64 T1 hub pages, 5 T2 volume pages, and 2 paginated browse-index pages, all with a unique title/description and one H1', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written, t1, familyIndex, stats } = await buildEcoPages({ fetchImpl, outDir, nav: NAV });

    assert.equal(t1.length, 64);
    assert.equal(familyIndex.length, 149);
    assert.equal(stats.t1Count, 64);
    assert.equal(written.length, 64 + 5 + 2);

    const titles = new Set();
    const descriptions = new Set();
    for (const page of written) {
      assert.ok(fs.existsSync(path.join(outDir, page.file)), `${page.file} should exist on disk`);
      const h1Matches = page.html.match(/<h1[ >]/g) || [];
      assert.equal(h1Matches.length, 1, `${page.file} should have exactly one H1`);
      assert.ok(page.title, `${page.file} should have a <title>`);
      assert.ok(!titles.has(page.title), `${page.file}'s title "${page.title}" must be unique`);
      titles.add(page.title);
      if (page.description) {
        assert.ok(page.description.length <= 160, `${page.file}'s meta description must be <=160 chars`);
        assert.ok(!descriptions.has(page.description), `${page.file}'s description must be unique`);
        descriptions.add(page.description);
      }
      assert.match(page.html, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\//);
    }
  })
);

test('buildEcoPages: every T1 hub filename matches ecoFamilies.familyHubFilename and none collide with a T0 filename', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written, t1 } = await buildEcoPages({ fetchImpl, outDir, nav: NAV });
    const t1Files = new Set(written.map((w) => w.file).filter((f) => f.endsWith('-variations.html')));
    assert.equal(t1Files.size, 64);
    for (const f of t1) {
      assert.ok(t1Files.has(familyHubFilename(f.slug)));
    }
    const t0Filenames = new Set(OPENINGS.map((o) => `${o.slug}.html`));
    for (const file of t1Files) {
      assert.ok(!t0Filenames.has(file));
    }
  })
);

test('buildEcoPages: issues exactly 4 Explorer requests per T1 family (main line, one per rating band), never more', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl, getCallCount } = makeSmartExplorerFetch();
    const { t1 } = await buildEcoPages({ fetchImpl, outDir, nav: NAV, aggregatesDir: EMPTY_AGGREGATES_DIR });
    assert.equal(getCallCount(), t1.length * 4);
  })
);

test('buildEcoPages: a T1 family hub whose family name matches a T0 opening links to that T0 page', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildEcoPages({ fetchImpl, outDir, nav: NAV });
    const sicilianHub = written.find((w) => w.file === 'sicilian-defense-variations.html');
    assert.ok(sicilianHub);
    assert.match(sicilianHub.html, /href="sicilian-defense\.html"/);
  })
);

test('buildEcoPages: with healthy Explorer game counts, no T1 hub is noindexed', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildEcoPages({ fetchImpl, outDir, nav: NAV });
    const t1Hubs = written.filter((w) => w.file.endsWith('-variations.html'));
    assert.equal(t1Hubs.length, 64);
    for (const hub of t1Hubs) {
      assert.equal(hub.noindex, false, `${hub.file} should not be noindexed`);
      assert.doesNotMatch(hub.html, /name="robots"/);
    }
  })
);

test('buildEcoPages: a T1 family whose main line has too few games at every rating band is noindexed, its html carries the robots meta tag, and its sibling T2 pages are unaffected', () =>
  withTempDist(async (outDir) => {
    // Alekhine's Defense (1.e4 Nf6...) shares no line with any of the 12
    // curated openings.js T0 openings (findT0CrossLink returns null for it,
    // asserted above) -- its band requests always fall through to
    // makeSmartExplorerFetch's fallbackJson branch, so this low count is
    // guaranteed to apply to it specifically, not routed around it.
    const { fetchImpl } = makeSmartExplorerFetch({ fallbackJson: { white: 10, draws: 5, black: 5 } });
    const { written } = await buildEcoPages({ fetchImpl, outDir, nav: NAV });
    const alekhineHub = written.find((w) => w.file === 'alekhine-defense-variations.html');
    assert.ok(alekhineHub);
    assert.equal(alekhineHub.noindex, true);
    assert.match(alekhineHub.html, /<meta name="robots" content="noindex">/);

    const volumePages = written.filter((w) => w.slug.startsWith('eco-volume-'));
    assert.equal(volumePages.length, 5);
    for (const page of volumePages) {
      assert.doesNotMatch(page.html, /name="robots"/);
    }
  })
);

// ---------------------------------------------------------------------------
// findT0CrossLink / resolveMainLineSide (via findT0CrossLink's own side data)
// ---------------------------------------------------------------------------

test('findT0CrossLink: returns the matching T0 opening for an exact family-name match, null otherwise', () => {
  const { lines } = buildEcoDataset();
  const familyIndex = buildFamilyIndex(lines);
  const sicilian = familyIndex.find((f) => f.family === 'Sicilian Defense');
  const link = findT0CrossLink(sicilian);
  assert.deepEqual(link, { label: 'Sicilian Defense', href: 'sicilian-defense.html' });

  const alekhine = familyIndex.find((f) => f.family === 'Alekhine Defense');
  assert.equal(findT0CrossLink(alekhine), null);
});

// ---------------------------------------------------------------------------
// findDrillCrossLink (site-audit item 5, 2026-08-26)
// ---------------------------------------------------------------------------

test('findDrillCrossLink: returns the matching drill only for the one family DRILL_PAGES actually maps, null for every other T0-matching family', () => {
  const { lines } = buildEcoDataset();
  const familyIndex = buildFamilyIndex(lines);
  const drillPages = { 'italian-game': 'drill.html' };

  const italian = familyIndex.find((f) => f.family === 'Italian Game');
  assert.deepEqual(findDrillCrossLink(italian, drillPages), {
    label: 'Italian Game drill',
    href: 'drill.html',
    note: 'Pick the move, see instantly whether it is the move players at your rating actually make, and what that move scores.',
  });

  // Sicilian Defense has a real T0 cross-link but no drill -- must not
  // fabricate one just because a T0 match exists.
  const sicilian = familyIndex.find((f) => f.family === 'Sicilian Defense');
  assert.equal(findDrillCrossLink(sicilian, drillPages), null);
});

test('findDrillCrossLink: returns null with an empty drillPages map, never throws', () => {
  const { lines } = buildEcoDataset();
  const familyIndex = buildFamilyIndex(lines);
  const italian = familyIndex.find((f) => f.family === 'Italian Game');
  assert.equal(findDrillCrossLink(italian, {}), null);
});

// ---------------------------------------------------------------------------
// pickRelatedFamilies
// ---------------------------------------------------------------------------

test('pickRelatedFamilies: prefers same-ECO-volume siblings, never includes the family itself, caps at 3', () => {
  const { lines } = buildEcoDataset();
  const t1 = t1Families(buildFamilyIndex(lines));
  const sicilian = t1.find((f) => f.family === 'Sicilian Defense'); // volume B
  const related = pickRelatedFamilies(sicilian, t1);
  assert.ok(related.length <= 3);
  assert.ok(!related.some((r) => r.href === familyHubFilename(sicilian.slug)));
  // Sicilian has plenty of volume-B siblings (Caro-Kann, Scandinavian, ...),
  // so every related pick here should be a same-volume family.
  const volumeBFamilies = new Set(t1.filter((f) => f.mainLine.eco[0] === 'B').map((f) => f.slug));
  for (const r of related) {
    const slug = r.href.replace('-variations.html', '');
    assert.ok(volumeBFamilies.has(slug), `${slug} should be a volume-B sibling`);
  }
});

// ---------------------------------------------------------------------------
// buildVolumeCodeRows
// ---------------------------------------------------------------------------

test('buildVolumeCodeRows: groups a volume\'s lines by exact ECO code, one row per code, only that volume\'s codes', () => {
  const { lines } = buildEcoDataset();
  const familyIndex = buildFamilyIndex(lines);
  const rows = buildVolumeCodeRows(lines, 'A', familyIndex);
  assert.equal(rows.length, 100); // measured: exactly 100 distinct codes per volume
  assert.ok(rows.every((r) => r.eco.startsWith('A')));
  assert.deepEqual(rows.map((r) => r.eco), [...rows.map((r) => r.eco)].sort());
  const a00 = rows.find((r) => r.eco === 'A00');
  assert.equal(a00.lineCount, 144);
  assert.equal(a00.names.length, 21); // measured: 21 distinct families under A00
});

test('buildVolumeCodeRows: a code\'s family name links to its T1 hub only when that family actually has >= 8 lines', () => {
  const { lines } = buildEcoDataset();
  const familyIndex = buildFamilyIndex(lines);
  const rows = buildVolumeCodeRows(lines, 'B', familyIndex);
  const b20 = rows.find((r) => r.eco === 'B20');
  const sicilianEntry = b20.names.find((n) => n.name === 'Sicilian Defense');
  assert.ok(sicilianEntry);
  assert.equal(sicilianEntry.href, 'sicilian-defense-variations.html');
});
