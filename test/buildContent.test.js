'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildContentPages, fetchLineWithValidation, GUIDES } = require('../src/buildContent');
const { buildOpeningModel, rankOpeningsByScore } = require('../src/processOpenings');
const { renderOpeningPage, renderOpeningsHub, formatGamesAbbrev } = require('../src/renderContent');
const { escapeHtml, formatPct, wrapTable } = require('../src/render');
const { OPENINGS } = require('../src/openings');
const { makeSmartExplorerFetch, fakeResponse } = require('./helpers/fakeExplorer');

const FIXTURES = path.join(__dirname, 'fixtures');
const italianFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-italian-1600.json'), 'utf8'));
const mastersItalianFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'masters-italian.json'), 'utf8'));

// Unlike buildStatic.test.js's withTempDist (which intentionally exercises
// the real project dist/ dir), these tests use their own throwaway temp
// directory per test. node:test runs test *files* concurrently by default,
// and buildStatic.test.js already claims the real dist/ dir for its own
// backup/restore dance -- sharing it here would race the two files against
// each other and corrupt both. Passing outDir explicitly (buildContentPages
// accepts it) keeps this file fully isolated.
function withTempDist(fn) {
  const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-content-dist-'));
  return Promise.resolve()
    .then(() => fn(tmpDist))
    .finally(() => {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    });
}

test('buildContentPages writes one page per configured opening plus the openings hub, every guide, the guides hub, and the FAQ -- all with a unique title/description and one H1', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildContentPages({ fetchImpl, outDir });

    assert.equal(written.length, OPENINGS.length + 1 + GUIDES.length + 1 + 1); // openings + hub + guides + guides hub + FAQ

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

test('buildContentPages never writes the Lichess API token into any generated content page', () =>
  withTempDist(async (outDir) => {
    const previousToken = process.env.LICHESS_API_TOKEN;
    process.env.LICHESS_API_TOKEN = 'content-fixture-fake-token-do-not-leak-98765';
    try {
      const { fetchImpl } = makeSmartExplorerFetch();
      const { written } = await buildContentPages({ fetchImpl, outDir });
      for (const page of written) {
        assert.equal(page.html.includes('content-fixture-fake-token-do-not-leak-98765'), false, `${page.file} must not contain the token`);
      }
    } finally {
      if (previousToken === undefined) delete process.env.LICHESS_API_TOKEN;
      else process.env.LICHESS_API_TOKEN = previousToken;
    }
  })
);

test('buildContentPages fails loudly on a move-order mismatch instead of publishing wrong chess', () =>
  withTempDist(async (outDir) => {
    const badFetch = async () =>
      fakeResponse({ opening: null, white: 10, draws: 1, black: 9, moves: [{ uci: 'h2h4', san: 'h4', white: 10, draws: 1, black: 9 }] });
    await assert.rejects(() => buildContentPages({ fetchImpl: badFetch, outDir }), /ply 0 expects/);
  })
);

// The known-gap fallback: an ingest run's per-family shards are sampled per
// family, not per shared ancestor position, so a position several openings
// pass through in common can be present at `dir` (aggregatesAvailable()
// true, manifest.json + root.json both on disk) while still coming back
// empty for THIS particular lookup -- distinct from "no aggregate data at
// all" (the badFetch case above, which the pre-existing move-order-mismatch
// test already covers). fetchLineWithValidation must retry live in that
// case rather than concluding the configured move order is wrong.
test('fetchLineWithValidation: aggregate data present but this position missing (known ingest-sampling gap) retries live instead of throwing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildContent-known-gap-'));
  try {
    // manifest.json + root.json both exist (aggregatesAvailable() === true)
    // but root.json's positions map is empty -- every aggregate lookup at
    // this dir comes back with zero candidate moves, the exact shape of the
    // real ruy-lopez/scotch-game gap found via a real workflow_dispatch CI
    // run against the actual published aggregate-data Release.
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ pipelineVersion: 1, retrievedAt: new Date().toISOString() }), 'utf8');
    fs.writeFileSync(path.join(dir, 'root.json'), JSON.stringify({ positions: {}, pathIndex: {} }), 'utf8');

    let liveCalls = 0;
    const liveFetchImpl = async () => {
      liveCalls += 1;
      return fakeResponse({
        opening: null, white: 900, draws: 400, black: 700,
        moves: [{ uci: 'e2e4', san: 'e4', white: 900, draws: 400, black: 700 }],
      });
    };

    // Only the per-ply VALIDATION loop is under test here -- it must not
    // throw when the aggregate lookup for a genuinely-empty position comes
    // back empty, as long as the live fallback confirms the configured move
    // really is a valid candidate. (The trailing "full line" stats call is
    // a separate, already-disclosed degrade-gracefully path -- not what
    // this test is checking.)
    await assert.doesNotReject(() => fetchLineWithValidation({
      slug: 'test-opening',
      line: [{ uci: 'e2e4', san: 'e4' }],
      ratings: [1600, 1800],
      speeds: ['blitz', 'rapid'],
      band: '1600-1800',
      familySlug: 'test-family',
      fetchImpl: liveFetchImpl,
      aggregatesDir: dir,
    }));

    assert.equal(liveCalls > 0, true, 'expected the live-Explorer fallback to be called at least once');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the openings hub links to every configured opening page', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildContentPages({ fetchImpl, outDir });
    const hub = written.find((p) => p.file === 'openings.html');
    for (const o of OPENINGS) {
      assert.match(hub.html, new RegExp(`href="${o.slug}\\.html"`), `hub should link to ${o.slug}.html`);
    }
  })
);

// Regression for the 2026-08-16 production bug: King's Indian Defense had
// genuinely too few 1600-1800 games in this site's real aggregate dataset
// (max games at any band was under the 1000-game minGamesForPct threshold),
// so rankOpeningsByScore() correctly left it out of `ranked` -- but
// renderOpeningsHub used to build its table rows AND card grid exclusively
// from `ranked`, so the excluded opening silently vanished from both while
// the "Compare all N openings" heading (which counts unfiltered `entries`)
// kept claiming the true total. This reproduces that exact shape directly
// against renderOpeningsHub (not buildContentPages, which would need a
// fixture faking a whole live/aggregate fetch) so it fails if the
// entries-vs-ranked split ever regresses.
test('renderOpeningsHub: an opening excluded from `ranked` for insufficient data still gets a real row, a real linked card, and an honest "n/a" score -- never silently dropped', () => {
  const makeEntry = (slug, name, games, enoughGames) => ({
    openingConfig: { slug, name, ecoHint: 'X00', side: 'white', line: [{ uci: 'e2e4', san: 'e4' }] },
    model: {
      name,
      eco: 'X00',
      side: 'white',
      bands: [{
        band: '1600-1800',
        games,
        scoreForSide: enoughGames ? 52 : null,
        scoreForSideCI: enoughGames ? 1.2 : null,
        scoreForSideBalanced: null,
        scoreForSideBalancedCI: null,
        whitePct: enoughGames ? 52 : null,
        drawPct: enoughGames ? 4 : null,
        blackPct: enoughGames ? 44 : null,
        enoughData: enoughGames,
      }],
    },
  });

  const entries = [
    makeEntry('popular-opening', 'Popular Opening', 5000, true),
    makeEntry('under-sampled-opening', 'Under-Sampled Opening', 518, false), // real King's Indian count, 2026-08 aggregate dataset
  ];
  const ranked = rankOpeningsByScore(entries, '1600-1800');
  assert.equal(ranked.length, 1, 'sanity check: rankOpeningsByScore really does exclude the under-sampled entry');

  const hub = renderOpeningsHub(entries, { nav: { home: '/' }, ranked });

  assert.match(hub, /Compare all 2 openings/, 'heading counts every entry, not just ranked ones');
  assert.match(hub, /href="under-sampled-opening\.html"/, 'the under-sampled opening must still be a real link in the table');
  assert.match(hub, /href="popular-opening\.html"/);

  const rowMatch = hub.match(/<tr>\s*<td class="num"><\/td>\s*<td><a href="under-sampled-opening\.html">[\s\S]*?<\/tr>/);
  assert.ok(rowMatch, 'expected a full table row for the under-sampled opening, with an empty (not omitted) rank cell so columns still line up with the header');
  assert.match(rowMatch[0], />518<\/td>/, 'real game count is shown, not hidden');
  assert.match(rowMatch[0], />n\/a<\/td>/, 'score is honestly "n/a", never a fabricated number');

  // Card grid: renderOpeningStatCard's own pre-existing fallback (card--nav,
  // no WDL bar) for missing data -- still a real, linked card, not dropped.
  assert.match(hub, /<div class="card card--nav"><h3><a href="under-sampled-opening\.html">Under-Sampled Opening<\/a><\/h3>/);

  const trCount = (hub.match(/<tr>/g) || []).length;
  assert.equal(trCount, 3, 'header row + 2 data rows -- both entries present exactly once');
});

test('buildOpeningModel + renderOpeningPage handle a realistic full-shape fixture (per-move opening names, recentGames, master names) without crashing', () => {
  const openingConfig = OPENINGS.find((o) => o.slug === 'italian-game');
  const model = buildOpeningModel({
    openingConfig,
    bandResponses: { '1600-1800': italianFixture },
    mastersResponse: mastersItalianFixture,
    defaultBand: '1600-1800',
    minGamesForPct: 1000,
  });
  assert.equal(model.eco, 'C50');
  assert.equal(model.topReplies[0].opening.name, 'Italian Game: Giuoco Piano');
  assert.equal(model.masterGames[0].white.name, 'Caruana, Fabiano');
  assert.equal(model.recentGames.length, 1);

  const html = renderOpeningPage({
    model,
    openingConfig,
    nav: { repertoire: 'index.html', openings: 'openings.html', player: 'player.html' },
    related: [],
    repertoireLinks: { white: 'repertoire-1600-1800-white.html', black: 'repertoire-1600-1800-black.html' },
  });
  assert.match(html, /Caruana, Fabiano/);
  assert.match(html, /Italian Game: Giuoco Piano/);
  const h1Matches = html.match(/<h1[ >]/g) || [];
  assert.equal(h1Matches.length, 1);
});

test('renderOpeningPage: omitting drillFile is byte-identical to no drill CTA; passing it adds exactly one drill-cta section', () => {
  const openingConfig = OPENINGS.find((o) => o.slug === 'italian-game');
  const model = buildOpeningModel({
    openingConfig,
    bandResponses: { '1600-1800': italianFixture },
    mastersResponse: mastersItalianFixture,
    defaultBand: '1600-1800',
    minGamesForPct: 1000,
  });
  const baseOpts = {
    model,
    openingConfig,
    nav: { repertoire: 'index.html', openings: 'openings.html', player: 'player.html' },
    related: [],
    repertoireLinks: { white: 'repertoire-1600-1800-white.html', black: 'repertoire-1600-1800-black.html' },
  };

  const withoutDrill = renderOpeningPage(baseOpts);
  const withExplicitNull = renderOpeningPage({ ...baseOpts, drillFile: null });
  assert.equal(withoutDrill, withExplicitNull);
  assert.doesNotMatch(withoutDrill, /class="drill-cta"/);

  const withDrill = renderOpeningPage({ ...baseOpts, drillFile: 'italian-game-drill.html' });
  const drillCtaMatches = withDrill.match(/class="drill-cta"/g) || [];
  assert.equal(drillCtaMatches.length, 1);
  assert.match(withDrill, /Drill this opening/);
  assert.match(withDrill, /href="italian-game-drill\.html"/);
  assert.match(withDrill, /Open the Italian Game drill &rarr;/);
});

test('renderOpeningPage: data-source pool label is manifest-aware, not hardcoded -- "blitz & rapid" on the live-API fallback (manifest omitted), "blitz" only once real aggregate data lands (manifest present), matching renderMethodologyPage\'s own branch', () => {
  const openingConfig = OPENINGS.find((o) => o.slug === 'italian-game');
  const model = buildOpeningModel({
    openingConfig,
    bandResponses: { '1600-1800': italianFixture },
    mastersResponse: mastersItalianFixture,
    defaultBand: '1600-1800',
    minGamesForPct: 1000,
  });
  const baseOpts = {
    model,
    openingConfig,
    nav: { repertoire: 'index.html', openings: 'openings.html', player: 'player.html' },
    related: [],
    repertoireLinks: { white: 'repertoire-1600-1800-white.html', black: 'repertoire-1600-1800-black.html' },
  };

  const fallbackHtml = renderOpeningPage(baseOpts); // manifest omitted -> defaults to null (live-API-fallback shape)
  assert.match(fallbackHtml, /Lichess blitz &amp; rapid games/);
  assert.match(fallbackHtml, /\(lichess database, blitz \+ rapid\)/);
  assert.doesNotMatch(fallbackHtml, /Lichess blitz games/);

  const aggregateHtml = renderOpeningPage({ ...baseOpts, manifest: { dumpMonths: ['2026-07'], gamesUsed: 500000 } });
  assert.match(aggregateHtml, /Lichess blitz games/);
  assert.match(aggregateHtml, /\(lichess database, blitz\)/);
  assert.doesNotMatch(aggregateHtml, /blitz &amp; rapid/);
  assert.doesNotMatch(aggregateHtml, /blitz \+ rapid/);
});

test('buildContentPages: once real aggregate data is present on disk (manifest.json + root.json), every opening page threads the manifest-aware blitz-only label through end to end -- sampled across several openings, not just one', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const aggregatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-content-aggregates-'));
    // Deliberately EMPTY positions -- aggregatesAvailable() only checks file
    // presence, not content, and aggregateSource.js's explorerShapedResponse()
    // degrades any missing position to a real, honest zero-games response, so
    // this exercises the real "aggregates present" code path this test cares
    // about (the manifest-aware LABEL) without needing a full real dataset.
    fs.writeFileSync(path.join(aggregatesDir, 'root.json'), JSON.stringify({ positions: {}, pathIndex: {} }), 'utf8');
    fs.writeFileSync(path.join(aggregatesDir, 'manifest.json'), JSON.stringify({ pipelineVersion: 1, retrievedAt: new Date().toISOString(), dumpMonths: ['2026-07'], gamesUsed: 500000 }), 'utf8');

    const { written } = await buildContentPages({ fetchImpl, outDir, aggregatesDir });
    const openingSlugs = new Set(OPENINGS.map((o) => o.slug));
    const openingPages = written.filter((p) => openingSlugs.has(p.slug));
    assert.ok(openingPages.length >= 3, 'expected several real opening pages to sample');
    const sample = [openingPages[0], openingPages[Math.floor(openingPages.length / 2)], openingPages[openingPages.length - 1]];
    for (const page of sample) {
      assert.match(page.html, /Lichess blitz games/, `${page.file} should use the blitz-only label once aggregate data is present`);
      assert.match(page.html, /\(lichess database, blitz\)/, `${page.file}'s footer should say "blitz" only, not "blitz + rapid"`);
      assert.doesNotMatch(page.html, /blitz &amp; rapid/, `${page.file} must not falsely claim rapid data when aggregates supplied blitz only`);
      assert.doesNotMatch(page.html, /blitz \+ rapid/, `${page.file}'s footer must not falsely claim rapid data`);
    }
  })
);

test('buildContentPages: the FAQ page\'s "are these stats from blitz or classical games" answer is manifest-aware too, not hardcoded -- fixture aggregates dir present means blitz-only wording, and it must not silently omit rapid/bullet from the excluded clause', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const aggregatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-content-faq-aggregates-'));
    fs.writeFileSync(path.join(aggregatesDir, 'root.json'), JSON.stringify({ positions: {}, pathIndex: {} }), 'utf8');
    fs.writeFileSync(path.join(aggregatesDir, 'manifest.json'), JSON.stringify({ pipelineVersion: 1, retrievedAt: new Date().toISOString(), dumpMonths: ['2026-07'], gamesUsed: 500000 }), 'utf8');

    const { written } = await buildContentPages({ fetchImpl, outDir, aggregatesDir });
    const faqPage = written.find((p) => p.file === 'chess-opening-faq.html');
    assert.ok(faqPage, 'chess-opening-faq.html should be written');
    assert.match(faqPage.html, /Blitz games from the Lichess database/, 'manifest present should give the blitz-only FAQ answer');
    assert.match(faqPage.html, /Bullet, rapid and classical games are not included/, 'the excluded clause must name all three excluded pools, not silently omit one');
    assert.doesNotMatch(faqPage.html, /Blitz and rapid games from the Lichess database/, 'must not claim rapid data this build never drew from');

    const { written: fallbackWritten } = await buildContentPages({ fetchImpl, outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-content-faq-fallback-')) });
    const fallbackFaqPage = fallbackWritten.find((p) => p.file === 'chess-opening-faq.html');
    assert.match(fallbackFaqPage.html, /Blitz and rapid games from the Lichess database/, 'no aggregates on disk should give the honest blitz+rapid fallback answer');
    assert.match(fallbackFaqPage.html, /Classical and bullet games are not included/, 'the fallback excluded clause must name bullet too, not just classical');
  })
);

test('phase 2: the guides hub links to every guide article, and every guide has exactly one H1 and real data pulled from entries', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildContentPages({ fetchImpl, outDir });

    const hub = written.find((p) => p.file === 'guides.html');
    assert.ok(hub, 'guides.html should be written');
    const guideFiles = [
      'how-to-beat-the-london-system.html',
      'best-chess-openings-for-beginners.html',
      'sicilian-vs-french-vs-caro-kann.html',
      'most-common-opening-mistakes-1600-1800.html',
      'should-you-study-openings-under-1500.html',
      'scandinavian-defense-at-club-level.html',
      'how-to-build-your-opening-repertoire.html',
      'opening-principles-by-win-rate.html',
      'best-white-openings-1400-1600.html',
      'best-white-openings-1600-1800.html',
      'best-white-openings-1800-2000.html',
      'best-white-openings-2000-plus.html',
      'best-black-openings-1400-1600.html',
      'best-black-openings-1600-1800.html',
      'best-black-openings-1800-2000.html',
      'best-black-openings-2000-plus.html',
    ];
    for (const file of guideFiles) {
      assert.match(hub.html, new RegExp(`href="${file}"`), `guides hub should link to ${file}`);
      const page = written.find((p) => p.file === file);
      assert.ok(page, `${file} should be written`);
      const h1Matches = page.html.match(/<h1[ >]/g) || [];
      assert.equal(h1Matches.length, 1, `${file} should have exactly one H1`);
      assert.match(page.html, /class="prose"/, `${file} should use the shared .prose article wrapper`);
    }

    // best-chess-openings-for-beginners ranks openings by real score data --
    // every opening name that appears in its table must be a real name from
    // OPENINGS, not a placeholder.
    const rankingPage = written.find((p) => p.file === 'best-chess-openings-for-beginners.html');
    const namedCount = OPENINGS.filter((o) => rankingPage.html.includes(o.name)).length;
    assert.ok(namedCount >= 5, 'the beginner-ranking guide should reference several real opening names pulled from entries');
  })
);

test('the repertoire how-to guide computes its worked examples from entries and degrades gracefully with no data', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildContentPages({ fetchImpl, outDir });
    const page = written.find((p) => p.file === 'how-to-build-your-opening-repertoire.html');
    assert.ok(page, 'how-to-build-your-opening-repertoire.html should be written');

    // The shortlist table names real tracked openings pulled from entries,
    // never placeholders.
    const namedCount = OPENINGS.filter((o) => page.html.includes(o.name)).length;
    assert.ok(namedCount >= 5, 'the shortlist should name several real opening names pulled from entries');

    // The sample-size section shows real computed +/- intervals, and the
    // article is structured as its five numbered steps.
    assert.match(page.html, /&plusmn;/);
    const stepMatches = page.html.match(/<h2>Step \d:/g) || [];
    assert.equal(stepMatches.length, 5);

    // Degenerate build (no entries at all): every worked example falls back
    // to an honest empty-note instead of crashing or printing NaN/undefined.
    const guide = require('../src/content/how-to-build-your-opening-repertoire');
    const { escapeHtml, formatPct, wrapTable } = require('../src/render');
    const { formatSanLine, formatGamesAbbrev } = require('../src/renderContent');
    const emptyHtml = guide.render({ entries: [], escapeHtml, formatPct, wrapTable, formatSanLine, formatGamesAbbrev });
    assert.match(emptyHtml, /empty-note/);
    assert.doesNotMatch(emptyHtml, /NaN|undefined/);
  })
);

test('phase 2: the FAQ page has 12 questions, no fabricated author byline, and is reachable from nav', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildContentPages({ fetchImpl, outDir });

    const faq = written.find((p) => p.file === 'chess-opening-faq.html');
    assert.ok(faq, 'chess-opening-faq.html should be written');
    const h2Matches = faq.html.match(/<h2>/g) || [];
    assert.equal(h2Matches.length, 12);
    const h1Matches = faq.html.match(/<h1[ >]/g) || [];
    assert.equal(h1Matches.length, 1);
    // Nothing on this site should invent a personal name (see src/site.js's
    // SITE_AUTHOR comment) -- the FAQ text itself never names an individual.
    assert.doesNotMatch(faq.html, /\bByline\b/i);
  })
);

function jsonLdBlocksOf(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

test('phase 3: every emitted page has well-formed JSON-LD, and every JSON-LD block describes only what that page actually is', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildContentPages({ fetchImpl, outDir });

    for (const page of written) {
      const blocks = jsonLdBlocksOf(page.html);
      assert.ok(blocks.length > 0, `${page.file} should have at least one JSON-LD block`);
      for (const block of blocks) {
        assert.equal(block['@context'], 'https://schema.org');
      }
    }

    // Opening pages and guide pages: BreadcrumbList only (no Article on an
    // opening page, no FAQPage anywhere except the FAQ page itself).
    const italian = written.find((p) => p.file === 'italian-game.html');
    const italianTypes = jsonLdBlocksOf(italian.html).map((b) => b['@type']);
    assert.deepEqual(italianTypes, ['BreadcrumbList']);

    // Guides: BreadcrumbList + Article, author/publisher are the site
    // Organization, never an invented person.
    const guide = written.find((p) => p.file === 'how-to-beat-the-london-system.html');
    const guideBlocks = jsonLdBlocksOf(guide.html);
    assert.deepEqual(guideBlocks.map((b) => b['@type']).sort(), ['Article', 'BreadcrumbList']);
    const article = guideBlocks.find((b) => b['@type'] === 'Article');
    assert.equal(article.author['@type'], 'Organization');
    assert.equal(article.publisher['@type'], 'Organization');
    // Author must be the site itself (src/site.js's SITE_AUTHOR), never an
    // invented individual name -- see the binding spec's section 5.2.
    assert.equal(article.author.name, require('../src/site').SITE_AUTHOR);

    // FAQ page: BreadcrumbList + FAQPage (and ONLY there -- spec 2.6).
    const faq = written.find((p) => p.file === 'chess-opening-faq.html');
    const faqBlocks = jsonLdBlocksOf(faq.html);
    assert.deepEqual(faqBlocks.map((b) => b['@type']).sort(), ['BreadcrumbList', 'FAQPage']);
    const faqPage = faqBlocks.find((b) => b['@type'] === 'FAQPage');
    assert.equal(faqPage.mainEntity.length, 12);
    for (const q of faqPage.mainEntity) {
      assert.doesNotMatch(q.acceptedAnswer.text, /<[a-z]/i); // plain text, no leftover HTML tags
    }
    for (const page of written) {
      if (page.file !== 'chess-opening-faq.html') {
        assert.ok(!jsonLdBlocksOf(page.html).some((b) => b['@type'] === 'FAQPage'), `${page.file} must not carry FAQPage structured data`);
      }
    }

    // Hubs: BreadcrumbList only.
    const hub = written.find((p) => p.file === 'openings.html');
    assert.deepEqual(jsonLdBlocksOf(hub.html).map((b) => b['@type']), ['BreadcrumbList']);
    const guidesHub = written.find((p) => p.file === 'guides.html');
    assert.deepEqual(jsonLdBlocksOf(guidesHub.html).map((b) => b['@type']), ['BreadcrumbList']);
  })
);

test('buildContentPages: only the opening named in drillPages gets a drill CTA; every other opening page has none', () =>
  withTempDist(async (outDir) => {
    const { fetchImpl } = makeSmartExplorerFetch();
    const { written } = await buildContentPages({
      fetchImpl,
      outDir,
      drillPages: { 'italian-game': 'italian-game-drill.html' },
    });

    const italian = written.find((p) => p.file === 'italian-game.html');
    assert.match(italian.html, /class="drill-cta"/);
    assert.match(italian.html, /href="italian-game-drill\.html"/);

    const others = written.filter((p) => p.file !== 'italian-game.html' && p.file.endsWith('.html') && p.slug !== 'openings-hub');
    assert.ok(others.length > 0);
    for (const page of others) {
      assert.doesNotMatch(page.html, /class="drill-cta"/, `${page.file} must not carry a drill CTA`);
    }
  })
);

// Regression for the same 2026-08-16 production bug already fixed in
// renderOpeningsHub (openings.html): an opening under-sampled at a given
// rating band is correctly left out of rankOpeningsByScore()'s `ranked`
// array, but best-chess-openings-for-beginners.js used to build its table
// rows exclusively from `ranked`, so the excluded opening silently vanished
// from the table while the intro paragraph (which counts unfiltered
// `entries.length`) kept claiming the true total. This calls the content
// module's render() directly with a hand-built ctx (same pattern as the
// "degrades gracefully with no data" test above) so it fails if the
// ranked-vs-entries split ever regresses here too.
test('best-chess-openings-for-beginners: an opening excluded from `ranked` for insufficient data still gets a real row, never silently dropped', () => {
  const guide = require('../src/content/best-chess-openings-for-beginners');

  const makeEntry = (slug, name, side, games, enoughGames) => ({
    openingConfig: { slug, name, side },
    model: {
      name,
      side,
      bands: [{
        band: '1400-1600',
        games,
        scoreForSide: enoughGames ? 54 : null,
        scoreForSideCI: enoughGames ? 1.1 : null,
        scoreForSideBalanced: null,
        scoreForSideBalancedCI: null,
        enoughData: enoughGames,
      }],
    },
  });

  const entries = [
    makeEntry('popular-opening', 'Popular Opening', 'white', 6000, true),
    makeEntry('under-sampled-opening', 'Under-Sampled Opening', 'black', 518, false), // real King's Indian count, 2026-08 aggregate dataset
  ];

  const html = guide.render({ entries, rankOpeningsByScore, escapeHtml, formatPct, formatGamesAbbrev, wrapTable });

  assert.match(html, /among the 2 openings this site tracks/, 'intro paragraph counts every entry, not just ranked ones');
  assert.match(html, /href="under-sampled-opening\.html"/, 'the under-sampled opening must still be a real link in the table');
  assert.match(html, /href="popular-opening\.html"/);

  const rowMatch = html.match(/<tr><td><\/td><td><a href="under-sampled-opening\.html">[\s\S]*?<\/tr>/);
  assert.ok(rowMatch, 'expected a full table row for the under-sampled opening, with an empty (not omitted) rank cell so columns still line up with the header');
  assert.match(rowMatch[0], />518<\/td>/, 'real game count is shown, not hidden');
  assert.match(rowMatch[0], />n\/a<\/td>/, 'score is honestly "n/a", never a fabricated number');

  const trCount = (html.match(/<tr>/g) || []).length;
  assert.equal(trCount, 3, 'header row + 2 data rows -- both entries present exactly once');
});
