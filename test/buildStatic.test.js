'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const vm = require('vm');
const {
  buildStatic,
  buildPlayerLookupBundle,
  buildDrillBundle,
  buildRepertoireBundle,
  buildBandHeaderControlBundle,
  buildHomeDemoBundle,
  buildHomeDemoData,
  bundleBrowserEntry,
  indexPage,
  playerLookupPage,
  repertoireFileName,
  repertoireFragmentUrl,
  copyAggregateShardsToDist,
  assertNoTokenLeak,
  assertNoPlaceholderLeak,
  assertFilenamesUnique,
} = require('../src/buildStatic');
const { RATING_BANDS } = require('../src/processRepertoire');
const { REDIRECT_STUBS } = require('../src/sitemap');
const { getOpening, OPENINGS } = require('../src/openings');
const { GUIDES } = require('../src/buildContent');
const { makeSmartExplorerFetch, fakeResponse } = require('./helpers/fakeExplorer');

const FIXTURES = path.join(__dirname, 'fixtures');
const rootFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'explorer-response.json'), 'utf8'));

const ITALIAN_PREFIX_PLAY = getOpening('italian-game').line.map((p) => p.uci).join(',');

/**
 * Executes an esbuild-bundled browser script in a fresh vm context whose
 * global scope deliberately has NO `require`, `module`, or `exports`
 * binding (unlike Node's own global scope) -- a real file:// page has none
 * of those either. If the bundle referenced any of them outside a properly
 * scoped closure, this throws a ReferenceError. This is the functional
 * replacement for the old regex-based "no leftover require()/module.exports"
 * checks: esbuild's own CommonJS-emulation wrapper (__commonJS) legitimately
 * contains the literal text "module.exports" and "require" inside closures
 * that never leak to global scope, so a textual ban on those substrings no
 * longer indicates anything broken -- actually executing the bundle with no
 * such globals available does.
 */
function runBundleInSandbox(bundleText) {
  const sandbox = {
    console,
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
    },
    window: {
      history: { replaceState: () => {} },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    URL,
    URLSearchParams,
  };
  sandbox.window.location = { href: 'file:///dist/test.html', search: '' };
  sandbox.window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  new vm.Script(bundleText, { filename: 'bundle-under-test.js' }).runInContext(sandbox);
  return sandbox;
}

// buildStatic() now also drives buildContentPages() (the 10 opening pages +
// hub), which needs move-order validation to succeed for every configured
// opening line -- a fetch that blindly returns the same fixture for every
// `play` param (as the old repertoire-only fake did) would fail that
// validation. makeSmartExplorerFetch() handles opening-line requests
// correctly and falls back to the original root fixture for everything
// else (the repertoire explorer's own open-ended tree walk), so both
// pipelines get a coherent fake. No live network calls are made anywhere in
// this file.
//
// The drill build (src/buildDrill.js) additionally walks past the end of
// the italian-game line into positions makeSmartExplorerFetch has no
// knowledge of, and unlike the repertoire/content pipelines its data does
// get replayed onto a real board (src/renderDrill.js's server-rendered
// board -- see src/chessPosition.js). The generic rootFixture's moves
// (e2e4/d2d4/g1f3) are not legal replies to "1.e4 e5 2.Nf3 Nc6 3.Bc4" (that
// square is already vacated), so this wrapper serves one extra, real,
// legal pair of black replies (3...Bc5, 3...Nf6) for exactly that one
// position -- the only drill position this test file's board-rendering
// path actually replays -- before falling through to the shared smart fetch
// for everything else (which is never board-simulated).
function fakeExplorerFetch() {
  const smart = makeSmartExplorerFetch({ fallbackJson: rootFixture });
  const fetchImpl = async (url) => {
    const playParam = new URL(url).searchParams.get('play') || '';
    if (playParam === ITALIAN_PREFIX_PLAY) {
      return fakeResponse({
        white: 20000,
        draws: 6000,
        black: 24000,
        moves: [
          { uci: 'f8c5', san: 'Bc5', averageRating: 1700, white: 11000, draws: 3500, black: 13000 },
          { uci: 'g8f6', san: 'Nf6', averageRating: 1705, white: 9000, draws: 2500, black: 11000 },
        ],
        opening: null,
      });
    }
    return smart.fetchImpl(url);
  };
  return { fetchImpl, getCallCount: smart.getCallCount };
}

function withTempDist(fn) {
  // buildStatic() always writes to the real project dist/ dir (matching
  // build.js/buildRepertoire.js's existing convention of writing under
  // <project root>/dist), so tests run against that same directory. Capture
  // its prior contents and restore them afterwards so running the test
  // suite doesn't clobber a dist/ a human may have generated separately.
  const distDir = path.join(__dirname, '..', 'dist');
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-dist-backup-'));
  const hadDist = fs.existsSync(distDir);
  if (hadDist) {
    for (const entry of fs.readdirSync(distDir)) {
      fs.cpSync(path.join(distDir, entry), path.join(backupDir, entry), { recursive: true });
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      fs.rmSync(distDir, { recursive: true, force: true });
      if (hadDist) {
        fs.mkdirSync(distDir, { recursive: true });
        for (const entry of fs.readdirSync(backupDir)) {
          fs.cpSync(path.join(backupDir, entry), path.join(distDir, entry), { recursive: true });
        }
      }
      fs.rmSync(backupDir, { recursive: true, force: true });
    });
}

// useCache: false everywhere in this file, deliberately -- buildStatic()'s
// real (non-test) call path wraps fetchImpl in the on-disk Explorer cache
// (src/explorerCache.js), keyed only by request URL (fen/play/ratings/...),
// not by which fetchImpl produced the answer. Leaving caching on here would
// write this file's FAKE fixture responses into the project's real
// .cache/explorer/ directory, where a later real `npm run build:static`
// could silently read them back instead of hitting the live API.
test('buildStatic writes the collapsed repertoire.html + repertoire.js, all 8 redirect stubs, an index, and the WS-1 placeholder pages', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, repertoireFile, repertoireStubs } = await buildStatic({ fetchImpl, useCache: false });

    assert.equal(repertoireFile, 'repertoire.html');
    assert.ok(fs.existsSync(path.join(outDir, 'repertoire.html')), 'expected repertoire.html to exist on disk');
    assert.ok(fs.existsSync(path.join(outDir, 'repertoire.js')), 'expected repertoire.js to exist on disk');

    assert.equal(repertoireStubs.length, 8);
    const expectedBands = Object.keys(RATING_BANDS);
    for (const band of expectedBands) {
      for (const color of ['white', 'black']) {
        const file = repertoireFileName(band, color);
        assert.ok(
          repertoireStubs.some((l) => l.file === file),
          `expected a redirect stub for ${file}`
        );
        assert.ok(fs.existsSync(path.join(outDir, file)), `expected ${file} to exist on disk`);
      }
    }

    assert.ok(fs.existsSync(path.join(outDir, 'index.html')));
    // player.html and italian-game-drill.html are now redirect stubs (spec
    // WS-1 spec sections 3.2/3.3) -- their real content moved to
    // the new WS-1 placeholder pages below, no player-lookup.js/drill.js
    // bundle is written for them any more.
    assert.ok(fs.existsSync(path.join(outDir, 'player.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'italian-game-drill.html')));
    assert.ok(!fs.existsSync(path.join(outDir, 'player-lookup.js')));
    for (const [page, bundle] of [
      ['repertoire-builder.html', 'repertoire-builder.js'],
      ['opening-report.html', 'opening-report.js'],
      ['drill.html', 'drill-hub.js'],
      ['drill-reference.html', null],
    ]) {
      assert.ok(fs.existsSync(path.join(outDir, page)), `expected ${page} to exist on disk`);
      if (bundle) assert.ok(fs.existsSync(path.join(outDir, bundle)), `expected ${bundle} to exist on disk`);
    }

    // WS-1 spec 3.4 (task W4): one shared bundle, referenced by every page
    // above plus repertoire.html -- see src/render.js's renderHeader().
    assert.ok(fs.existsSync(path.join(outDir, 'band-header.js')), 'expected band-header.js to exist on disk');
    for (const page of ['repertoire-builder.html', 'opening-report.html', 'drill.html', 'drill-reference.html', 'repertoire.html']) {
      const html = fs.readFileSync(path.join(outDir, page), 'utf8');
      assert.match(html, /<script src="band-header\.js" defer><\/script>/, `expected ${page} to load band-header.js`);
      assert.match(html, /data-band-header-control/, `expected ${page} to render the band control`);
    }
    // A page with no band-dependent numbers must NOT carry the dead weight.
    const indexHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.doesNotMatch(indexHtml, /band-header\.js|data-band-header-control/, 'index.html is not a band-dependent page and must not load the control');
  })
);

test('repertoire.html carries a canonical link, a title ending in the site suffix, and a full OpenGraph block; player.html is now a redirect stub to opening-report.html', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    const repertoireHtml = fs.readFileSync(path.join(outDir, 'repertoire.html'), 'utf8');
    assert.match(repertoireHtml, /<title>[^<]+ \| Repertoire Builder<\/title>/);
    assert.match(repertoireHtml, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/repertoire\.html">/);
    assert.match(repertoireHtml, /<meta name="description" content="[^"]+">/);
    assert.match(repertoireHtml, /<meta property="og:title" content="[^"]+">/);
    assert.match(repertoireHtml, /<meta property="og:description" content="[^"]+">/);
    assert.match(repertoireHtml, /<meta property="og:image" content="https:\/\/repertoire-builder\.com\/og-default\.png">/);
    assert.match(repertoireHtml, /<meta name="twitter:card" content="summary_large_image">/);

    const playerHtml = fs.readFileSync(path.join(outDir, 'player.html'), 'utf8');
    assert.match(playerHtml, /<meta http-equiv="refresh" content="0; url=\/opening-report\.html">/);
    assert.match(playerHtml, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/opening-report\.html">/);
    assert.match(playerHtml, /<meta name="robots" content="noindex, follow">/);

    // WS-1 W2 replaced the opening-report.html placeholder with the real
    // Personal Opening Report page (IS_PLACEHOLDER now false) -- title and
    // noindex assertions updated accordingly; see this file's sitemap-count
    // test below for the matching indexed-page-count update.
    const openingReportHtml = fs.readFileSync(path.join(outDir, 'opening-report.html'), 'utf8');
    assert.match(openingReportHtml, /<title>Your Lichess opening leak report \| Repertoire Builder<\/title>/);
    assert.match(openingReportHtml, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/opening-report\.html">/);
    assert.doesNotMatch(openingReportHtml, /<meta name="robots" content="noindex">/, 'opening-report.html is real now, not a placeholder, and must be indexable');
  })
);

test('a repertoire redirect stub carries an instant meta refresh, canonical to repertoire.html, noindex/follow, a visible link, and a location.replace fallback -- and is never indexed', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    const stubHtml = fs.readFileSync(path.join(outDir, 'repertoire-1600-1800-white.html'), 'utf8');
    assert.match(stubHtml, /<meta http-equiv="refresh" content="0; url=\/repertoire\.html#band=1600-1800&amp;color=white">/);
    assert.match(stubHtml, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/repertoire\.html">/);
    assert.match(stubHtml, /<meta name="robots" content="noindex, follow">/);
    assert.match(stubHtml, /<a href="\/repertoire\.html#band=1600-1800&amp;color=white">/);
    assert.match(stubHtml, /location\.replace\(/);
  })
);

test('buildStatic also writes one page per configured opening plus the openings hub, and the home page links to them', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, contentWritten } = await buildStatic({ fetchImpl, useCache: false });

    // openings + openings hub + guides + guides hub + FAQ (phase 2).
    assert.equal(contentWritten.length, OPENINGS.length + 1 + GUIDES.length + 1 + 1);
    for (const { file } of contentWritten) {
      assert.ok(fs.existsSync(path.join(outDir, file)), `expected ${file} to exist on disk`);
    }
    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /href="openings\.html"/);
  })
);

test('buildStatic also writes feed.xml (one <item> per content page) and links it from the home page head', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, contentWritten } = await buildStatic({ fetchImpl, useCache: false });

    const feedPath = path.join(outDir, 'feed.xml');
    assert.ok(fs.existsSync(feedPath), 'expected feed.xml to exist on disk');
    const feedXml = fs.readFileSync(feedPath, 'utf8');
    assert.match(feedXml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(feedXml, /<rss version="2\.0">/);
    const itemMatches = feedXml.match(/<item>/g) || [];
    assert.equal(itemMatches.length, contentWritten.length);
    assert.match(feedXml, /<link>https:\/\/repertoire-builder\.com\/openings\.html<\/link>/);

    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /<link rel="alternate" type="application\/rss\+xml"[^>]*href="https:\/\/repertoire-builder\.com\/feed\.xml">/);
  })
);

test('buildStatic also writes the guides hub, all guide articles, and the FAQ page, all reachable from nav', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    for (const file of [
      'guides.html',
      'chess-opening-faq.html',
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
    ]) {
      assert.ok(fs.existsSync(path.join(outDir, file)), `expected ${file} to exist on disk`);
    }

    // Root-relative (leading slash): src/render.js's siteRelativeHref()
    // normalizes every nav/legalLinks value at render time, so the same
    // header/footer markup works from any page depth, not just root.
    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /href="\/guides\.html"/);
    assert.match(homeHtml, /href="\/chess-opening-faq\.html"/);

    const openingHtml = fs.readFileSync(path.join(outDir, 'italian-game.html'), 'utf8');
    assert.match(openingHtml, /href="\/guides\.html"/);
    assert.match(openingHtml, /href="\/chess-opening-faq\.html"/);
  })
);

test('buildStatic also writes privacy.html, about.html, contact.html, and ads.txt, and the footer links to them', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    for (const file of ['privacy.html', 'about.html', 'contact.html', 'ads.txt']) {
      assert.ok(fs.existsSync(path.join(outDir, file)), `expected ${file} to exist on disk`);
    }

    const adsTxt = fs.readFileSync(path.join(outDir, 'ads.txt'), 'utf8');
    assert.match(adsTxt, /^# ads\.txt for/);

    // Root-relative (leading slash) -- see this file's comment above.
    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /href="\/privacy\.html">Privacy policy<\/a>/);
    assert.match(homeHtml, /href="\/about\.html">About<\/a>/);
    assert.match(homeHtml, /href="\/contact\.html">Contact<\/a>/);
    assert.match(homeHtml, /class="disclosure-note"/);

    const repertoireHtml = fs.readFileSync(path.join(outDir, 'repertoire.html'), 'utf8');
    assert.match(repertoireHtml, /href="\/privacy\.html">Privacy policy<\/a>/);

    const openingHtml = fs.readFileSync(path.join(outDir, 'italian-game.html'), 'utf8');
    assert.match(openingHtml, /href="\/privacy\.html">Privacy policy<\/a>/);
  })
);

test('buildStatic also writes methodology.html (WS-3.3 B4), linked from the footer, with Article+Dataset JSON-LD and no manifest yet (live-Explorer-API fallback)', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    const methodologyPath = path.join(outDir, 'methodology.html');
    assert.ok(fs.existsSync(methodologyPath), 'expected methodology.html to exist on disk');
    const html = fs.readFileSync(methodologyPath, 'utf8');
    assert.match(html, /<h1 class="page-title">How Repertoire Builder computes its numbers<\/h1>/);
    assert.equal((html.match(/<h2[^>]*>/g) || []).length >= 7, true);
    assert.doesNotMatch(html, /"@type":"FAQPage"/);
    assert.match(html, /"@type":"Dataset"/);
    assert.match(html, /"@type":"Article"/);

    // Root-relative (leading slash) -- see this file's comment above.
    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /href="\/methodology\.html">Methodology<\/a>/);
  })
);

test('buildStatic writes a dist/_headers file (Cloudflare Pages header config) with HSTS, nosniff, and a frame-ancestors CSP', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    const headersPath = path.join(outDir, '_headers');
    assert.ok(fs.existsSync(headersPath), 'expected dist/_headers to exist on disk');

    const headers = fs.readFileSync(headersPath, 'utf8');
    assert.match(headers, /^\/\*$/m);
    assert.match(headers, /Strict-Transport-Security: max-age=31536000; includeSubDomains/);
    assert.match(headers, /X-Content-Type-Options: nosniff/);
    assert.match(headers, /frame-ancestors 'none'/);
  })
);

test('indexPage footer never mentions TESTING.md or other internal build artifacts', () => {
  const html = indexPage([]);
  assert.doesNotMatch(html, /TESTING\.md/);
});

test('assertFilenamesUnique throws on a duplicate filename and passes for a unique list', () => {
  assert.throws(() => assertFilenamesUnique(['a.html', 'b.html', 'a.html']), /Duplicate output filename/);
  assert.doesNotThrow(() => assertFilenamesUnique(['a.html', 'b.html', 'c.html']));
});

test('buildStatic never writes the Lichess API token into any generated file', () =>
  withTempDist(async () => {
    const previousToken = process.env.LICHESS_API_TOKEN;
    process.env.LICHESS_API_TOKEN = 'test-fixture-fake-token-do-not-leak-12345';
    try {
      const { fetchImpl } = fakeExplorerFetch();
      const { outDir } = await buildStatic({ fetchImpl, useCache: false });

      for (const file of fs.readdirSync(outDir)) {
        const full = path.join(outDir, file);
        if (fs.statSync(full).isDirectory()) continue;
        const content = fs.readFileSync(full, 'utf8');
        assert.equal(
          content.includes('test-fixture-fake-token-do-not-leak-12345'),
          false,
          `${file} must not contain the Lichess API token`
        );
      }
    } finally {
      if (previousToken === undefined) delete process.env.LICHESS_API_TOKEN;
      else process.env.LICHESS_API_TOKEN = previousToken;
    }
  })
);

test('assertNoTokenLeak throws if a written file contains the token string', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-token-leak-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'oops.html'), '<p>secret-token-abc123</p>', 'utf8');
    assert.throws(() => assertNoTokenLeak(tmpDir, 'secret-token-abc123'), /token leaked/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('assertNoTokenLeak is a no-op when no token was available to leak', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-token-leak-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'fine.html'), '<p>nothing secret here</p>', 'utf8');
    assert.doesNotThrow(() => assertNoTokenLeak(tmpDir, null));
    assert.doesNotThrow(() => assertNoTokenLeak(tmpDir, undefined));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('assertNoPlaceholderLeak throws if a written .html file contains the literal PLACEHOLDER string (monetization-layer spec 1.4)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-placeholder-leak-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'oops.html'), '<a href="https://PLACEHOLDER/l/x">Buy</a>', 'utf8');
    assert.throws(() => assertNoPlaceholderLeak(tmpDir), /PLACEHOLDER/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('assertNoPlaceholderLeak is a no-op when nothing in dist/ carries the sentinel string, and ignores non-html files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-placeholder-leak-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'fine.html'), '<p>nothing to see here</p>', 'utf8');
    // A PLACEHOLDER string in a non-.html file (e.g. a source map or a
    // downloaded .pgn) is out of this check's scope -- it only guards
    // rendered pages, the same "only .html" scope assertNoTokenLeak
    // deliberately does NOT apply (that one checks every file) -- stated
    // explicitly here so a future edit doesn't silently widen or narrow
    // this check without a test catching it.
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'PLACEHOLDER', 'utf8');
    assert.doesNotThrow(() => assertNoPlaceholderLeak(tmpDir));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildPlayerLookupBundle esbuild-bundles fetchLichess.js, process.js, render.js, and the browser controller into one self-contained IIFE that runs with no global require/module/exports (file:// invariant)', () => {
  const bundle = buildPlayerLookupBundle();
  assert.match(bundle, /function fetchRatingHistory/);
  assert.match(bundle, /function summarizeRatingHistory/);
  assert.match(bundle, /function renderRatingTable/);
  // \s* rather than a literal space: bundleBrowserEntry() now runs esbuild
  // with minifyWhitespace (Phase 7e, added when eco-explorer.js became this
  // site's heaviest bundle), which legitimately collapses "= class" to
  // "=class" -- still the exact same class expression, not a renamed or
  // dropped one, so the check stays meaningful without depending on
  // insignificant whitespace esbuild is now allowed to strip.
  assert.match(bundle, /LichessNotFoundError\s*=\s*class/);
  // Real proof, not a text ban: run it in a vm context with no require/
  // module/exports globals (same as an actual file:// page) and confirm it
  // doesn't throw. esbuild's own __commonJS wrapper legitimately contains
  // the literal text "module.exports" inside a properly scoped closure, so
  // banning that substring textually no longer indicates anything broken.
  assert.doesNotThrow(() => runBundleInSandbox(bundle));
});

test('buildDrillBundle esbuild-bundles chessPosition.js, drillLogic.js, and the drill browser controller into one self-contained IIFE that runs with no global require/module/exports (file:// invariant)', () => {
  const bundle = buildDrillBundle();
  assert.match(bundle, /function applyUciMove/);
  assert.match(bundle, /function gradeMove/);
  assert.match(bundle, /function pickReply/);
  assert.match(bundle, /function applyRoundResult/);
  assert.doesNotThrow(() => runBundleInSandbox(bundle));
});

test('buildRepertoireBundle esbuild-bundles bandState.client.js, render.js, and the repertoire browser controller into one self-contained IIFE that runs with no global require/module/exports (file:// invariant)', () => {
  const bundle = buildRepertoireBundle();
  assert.match(bundle, /function readBandState/);
  assert.match(bundle, /function writeBandState/);
  assert.match(bundle, /function renderRepertoireTree/);
  // Real proof: run it against a DOM stub with no #repertoire-data element
  // present (the sandbox's getElementById always returns null) -- the
  // controller must bail out cleanly rather than throw.
  assert.doesNotThrow(() => runBundleInSandbox(bundle));
});

test('buildBandHeaderControlBundle (WS-1 spec 3.4, task W4) esbuild-bundles bandState.client.js and the band-header browser controller into one self-contained IIFE that runs with no global require/module/exports (file:// invariant)', () => {
  const bundle = buildBandHeaderControlBundle();
  assert.match(bundle, /function readBandState/);
  assert.match(bundle, /function writeBandState/);
  assert.match(bundle, /function onBandStateChange/);
  // Real proof: run it against a DOM stub with no [data-band-header-control]
  // element present (the sandbox's querySelector always returns null) --
  // the controller must bail out cleanly rather than throw, same invariant
  // buildRepertoireBundle's sibling test above checks.
  assert.doesNotThrow(() => runBundleInSandbox(bundle));
});

test('buildHomeDemoBundle (the homepage hero demo) esbuild-bundles homeDemo.client.js + boardWidget.js into one self-contained IIFE that runs with no global require/module/exports (file:// invariant), and stays under the 120KB budget with no chess.js', () => {
  const bundle = buildHomeDemoBundle();
  assert.match(bundle, /function mountAllowlistBoard/);
  assert.match(bundle, /function createBoard/);
  // No chess.js in this bundle -- spec section 2.3's named budget fallback
  // (see buildHomeDemoBundle's own doc comment: createBoard + chess.js
  // together measured at ~120.7KB, already over budget before this file's
  // own code). Chess.js's own exported class name is a real, specific
  // enough marker that its absence here is meaningful, not a coincidence.
  assert.doesNotMatch(bundle, /class Chess\b/);
  const bytes = Buffer.byteLength(bundle, 'utf8');
  assert.ok(bytes <= 120000, `home-demo.js must stay <=120000 bytes uncompressed (spec section 2.3); measured ${bytes}`);
  // Real proof: run it against a DOM stub with no #home-demo-board element
  // present (the sandbox's getElementById always returns null) -- the
  // controller must bail out cleanly rather than throw, same invariant
  // buildRepertoireBundle/buildBandHeaderControlBundle's sibling tests above check.
  assert.doesNotThrow(() => runBundleInSandbox(bundle));
});

// Real-shaped fixture matching what a live buildRepertoireCombos() combo
// looks like for '1600-1800|black' -- root is White's most-played move
// (mover:'white'), its children are the top-3 Black replies -- verified
// against a real fetch during this task's own build (see this task's
// this feature's own build-verification notes for the exact numbers this fixture mirrors).
const HOME_DEMO_FIXTURE_COMBOS = {
  '1600-1800|black': {
    tree: [{
      uci: 'e2e4', san: 'e4', playedPct: 62.5, mover: 'white',
      children: [
        { uci: 'e7e5', san: 'e5', playedPct: 42.1, winPct: 44.8, drawPct: 4.1 },
        { uci: 'c7c5', san: 'c5', playedPct: 19.5, winPct: 48.4, drawPct: 4 },
        { uci: 'e7e6', san: 'e6', playedPct: 10.3, winPct: 48.1, drawPct: 4.2 },
      ],
    }],
  },
};

test('buildHomeDemoData extracts band/opening/replies from a real-shaped repertoireCombos fixture, keyed by UCI with the standard win+draw/2 score', () => {
  const heroDemo = buildHomeDemoData(HOME_DEMO_FIXTURE_COMBOS);
  assert.deepEqual(heroDemo, {
    band: '1600-1800',
    openingSan: 'e4',
    openingPlayedPct: 62.5,
    replies: {
      e7e5: { san: 'e5', playedPct: 42.1, score: 46.8 },
      c7c5: { san: 'c5', playedPct: 19.5, score: 50.4 },
      e7e6: { san: 'e6', playedPct: 10.3, score: 50.2 },
    },
  });
});

test('buildHomeDemoData returns null when the combo is missing entirely (e.g. a caller that only fetched a subset of bands)', () => {
  assert.equal(buildHomeDemoData({}), null);
  assert.equal(buildHomeDemoData(undefined), null);
});

test('buildHomeDemoData returns null rather than shipping a mismatched hero when White\'s top move at this band is not 1. e4 (data-drift guard -- see the function\'s own doc comment)', () => {
  const drifted = {
    '1600-1800|black': {
      tree: [{ uci: 'd2d4', san: 'd4', playedPct: 55.0, mover: 'white', children: [{ uci: 'd7d5', san: 'd5', playedPct: 50, winPct: 45, drawPct: 5 }] }],
    },
  };
  assert.equal(buildHomeDemoData(drifted), null);
});

test('indexPage renders the hero demo aside, board mount, baked JSON data, and script tag when a heroDemo is passed, and adds piece attribution to the footer', () => {
  const heroDemo = buildHomeDemoData(HOME_DEMO_FIXTURE_COMBOS);
  const html = indexPage([], null, heroDemo);
  assert.match(html, /<div class="home-hero-layout">/);
  assert.match(html, /<aside class="home-demo" aria-label="Try a real reply to 1\. e4">/);
  assert.match(html, /<div id="home-demo-board" class="home-demo-board-mount"><\/div>/);
  assert.match(html, /<p id="home-demo-caption" class="home-demo-caption" role="status" aria-live="polite">1600-1800 plays 1\. e4 62\.5% of the time\. Your move\.<\/p>/);
  assert.match(html, /<a href="repertoire\.html#band=1600-1800&amp;color=black">See the full 1600-1800 repertoire &rarr;<\/a>/);
  assert.match(html, /<button type="button" id="home-demo-reset" class="home-demo-reset">Reset<\/button>/);
  const dataMatch = html.match(/<script type="application\/json" id="home-demo-data">([\s\S]*?)<\/script>/);
  assert.ok(dataMatch, 'expected a #home-demo-data JSON block');
  const payload = JSON.parse(dataMatch[1]);
  assert.deepEqual(Object.keys(payload.replies).sort(), ['c7c5', 'e7e5', 'e7e6']);
  assert.match(html, /<script src="home-demo\.js" defer><\/script>/);
  assert.match(html, /Board pieces: the Cburnett chess set/, 'footer must credit the piece artwork once a board is actually rendered on this page');
});

// Accessibility-pass regression: this aside sits between <h1> and the
// page's first visible <h2>, and cm-chessboard's Accessibility extension
// injects its own <h3>Move piece</h3> into #home-demo-board at RUNTIME (not
// present in this server-rendered markup at all) -- without a real <h2>
// ancestor already in the static HTML, that client-side h3 broke Lighthouse's
// heading-order audit (h1 -> h3, skipping a level) on every page carrying
// this hero demo. Confirmed live: index.html scored accessibility=98 before
// this h2 was added, 100 after, with heading-order the only failing audit.
test('indexPage: the hero demo aside carries its own sr-only h2, ahead of where cm-chessboard injects an h3 at runtime', () => {
  const heroDemo = buildHomeDemoData(HOME_DEMO_FIXTURE_COMBOS);
  const html = indexPage([], null, heroDemo);
  const asideIndex = html.indexOf('<aside class="home-demo"');
  const h2Index = html.indexOf('<h2 class="sr-only">Try a real reply to 1. e4</h2>');
  const boardMountIndex = html.indexOf('<div id="home-demo-board"');
  assert.ok(asideIndex !== -1, 'expected the home-demo aside to be present');
  assert.ok(h2Index !== -1, 'expected an sr-only <h2> inside the home-demo aside');
  assert.ok(h2Index > asideIndex && h2Index < boardMountIndex, 'the h2 must sit inside the aside, before the board mount cm-chessboard writes its own h3 into');
});

test('indexPage falls back to its earlier single-column header with no hero demo markup, no bundle script, and no piece attribution when heroDemo is null (most existing tests, and the default third argument)', () => {
  const html = indexPage([]);
  // Note: SITE_CSS's .home-hero-layout/.home-demo* rules are always present
  // in the page's <style> block (a static stylesheet, not conditionally
  // emitted per page) -- these assertions check for the actual MARKUP
  // (opening tags, ids, the script src), not the bare CSS class name, which
  // would false-fail against the stylesheet itself.
  assert.doesNotMatch(html, /<div class="home-hero-layout">/);
  assert.doesNotMatch(html, /<aside class="home-demo"/);
  assert.doesNotMatch(html, /id="home-demo-board"/);
  assert.doesNotMatch(html, /id="home-demo-data"/);
  assert.doesNotMatch(html, /src="home-demo\.js"/);
  assert.doesNotMatch(html, /Board pieces: the Cburnett chess set/);
  // The plain earlier header is still there, unwrapped.
  assert.match(html, /<h1 class="page-title">The chess opening meta, by rating band<\/h1>/);
});

test('bundleBrowserEntry throws loudly on a syntax error in the entry point, same failure-loudly guarantee the old string-splice bundler had', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-bundle-test-'));
  try {
    const tmpFile = path.join(tmpDir, 'broken.js');
    fs.writeFileSync(tmpFile, 'function broken( { return 1; }\n', 'utf8');
    assert.throws(() => bundleBrowserEntry(tmpFile, '/* header */'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('indexPage links to opening-report.html and the collapsed repertoire.html (band+color in the fragment), with no server-only routes', () => {
  const html = indexPage([]);
  // The body-content "look up any username" link and the band-picker pills
  // (bandPickerHtml()) stay bare page-relative filenames -- neither call
  // site goes through renderHeader()/renderFooter(), and indexPage() itself
  // always lives at the site root, so a bare filename is correct as-is;
  // this was never part of the broken-nav-link fix. The NAV link for
  // "repertoire" (the "Repertoire explorer" item in the header), by
  // contrast, goes through renderHeader() and is root-relative per
  // src/render.js's siteRelativeHref() -- checked below.
  assert.match(html, /href="opening-report\.html"/);
  assert.match(html, /href="repertoire\.html#band=1400-1600&amp;color=white"/);
  assert.match(html, /href="repertoire\.html#band=1400-1600&amp;color=black"/);
  assert.match(html, /href="\/repertoire\.html">Repertoire explorer<\/a>/, 'the nav link must be the real, root-relative static filename');
  // Must never be the DYNAMIC dev-server route (server.js's SERVER_NAV,
  // '/repertoire' with no extension).
  assert.doesNotMatch(html, /href="\/repertoire"/);
});

test('indexPage carries the meta-framing repositioning: new h1/description/canonical and one pill per band+color combo, all pointing at repertoire.html', () => {
  const html = indexPage([]);
  assert.match(html, /<h1 class="page-title">The chess opening meta, by rating band<\/h1>/);
  assert.match(html, /<title>The Chess Opening Meta by Rating Band \| Repertoire Builder<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{1,160}">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/">/);
  // G1: one role=group pill picker, one pill per band+color combo (4 bands x 2 colors).
  assert.match(html, /<div class="band-picker" role="group" aria-label="Pick your rating band and color">/);
  for (const band of ['1400-1600', '1600-1800', '1800-2000', '2000+']) {
    // The href's band value is percent-encoded (encodeURIComponent, so "+"
    // becomes "%2B" -- avoids the classic "+ means space" ambiguity a
    // fragment parsed with URLSearchParams would otherwise hit); the
    // data-band attribute and visible label are the plain, unencoded band
    // string -- matches bandState.client.js's own encode-on-write /
    // decode-on-read split.
    const encodedBand = encodeURIComponent(band).replace(/\+/g, '\\+');
    const literalBand = band.replace('+', '\\+');
    assert.match(html, new RegExp(`class="band-pill" href="repertoire\\.html#band=${encodedBand}&amp;color=[a-z]+" data-band="${literalBand}" data-color="[a-z]+">${literalBand} `));
  }
  assert.match(html, /as White/);
  assert.match(html, /as Black/);
});

test('playerLookupPage references the bundled script and has no server-only routes', () => {
  const html = playerLookupPage();
  assert.match(html, /<script src="player-lookup\.js"><\/script>/);
  assert.match(html, /id="lookup-form"/);
  assert.match(html, /id="username"/);
  assert.match(html, /id="result"/);
  assert.doesNotMatch(html, /action="\/player"/);
});

test('playerLookupPage opts into the wide layout container (B3: player lookup is a data-dense page type)', () => {
  const html = playerLookupPage();
  assert.match(html, /<div class="page page--wide">/);
});

test('indexPage does NOT opt into the wide layout container (B3: only the three data-dense page types do)', () => {
  const html = indexPage([]);
  assert.match(html, /<div class="page">/);
  assert.doesNotMatch(html, /<div class="page page--wide">/);
});

test('indexPage (G1, R7): the rating-band picker is a single role=group pill control (the primary action); the drill card and opening cards are demoted outline cards, with no link targets added/removed/reordered', () => {
  // No `bands` field -- exercises renderOpeningStatCard's fallback-to-plain-card path (G2).
  const contentEntries = [{ openingConfig: { slug: 'italian-game' }, model: { name: 'Italian Game', eco: 'C50', side: 'white' } }];
  const html = indexPage(contentEntries, 'italian-game-drill.html');

  // Band picker: role=group pill control, not a card.
  assert.match(html, /<div class="band-picker" role="group" aria-label="Pick your rating band and color">/);
  assert.match(html, /<a class="band-pill" href="repertoire\.html#band=1400-1600&amp;color=white" data-band="1400-1600" data-color="white">1400-1600 <span class="band-pill-color">as White<\/span><\/a>/);
  // Drill card: card--outline card--nav (pure navigation, no stat data).
  assert.match(html, /<div class="card card--outline card--nav"><h3><a href="italian-game-drill\.html">Italian Game drill<\/a><\/h3>/);
  // Opening card: card--nav card--outline too, since this fixture's model has no `bands` (G2 fallback).
  assert.match(html, /<div class="card card--nav card--outline"><h3><a href="italian-game\.html">Italian Game<\/a><\/h3>/);
  // Same link targets as before -- nothing added, removed, or reordered.
  assert.match(html, /href="repertoire\.html#band=1400-1600&amp;color=white"/);
  assert.match(html, /href="italian-game-drill\.html"/);
  assert.match(html, /href="italian-game\.html"/);
});

test('indexPage links to repertoire-packs.html from its own body content (not just the shared top nav), as a demoted outline card that does not add a second accent-filled action', () => {
  const html = indexPage([]);
  // A real content-level CTA to the packs page, not just the header nav link.
  assert.match(html, /<h2>Want it finished and printable\?<\/h2>/);
  assert.match(html, /<div class="card card--outline card--nav"><h3><a href="repertoire-packs\.html">Repertoire packs, \$9 each<\/a><\/h3>/);
  // Still only one accent-filled action on the page: the band picker.
  assert.doesNotMatch(html, /class="[^"]*\bcard--primary\b[^"]*"/);
  assert.doesNotMatch(html, /class="pack-cta"/);
});

test('indexPage (G2): an opening card with real band data shows the WDL bar + score for 1600-1800 inline, never an approximated number', () => {
  const contentEntries = [{
    openingConfig: { slug: 'italian-game' },
    model: {
      name: 'Italian Game',
      eco: 'C50',
      side: 'white',
      bands: [
        { band: '1600-1800', enoughData: true, games: 12345, whitePct: 40, drawPct: 20, blackPct: 40, scoreForSide: 50 },
      ],
    },
  }];
  const html = indexPage(contentEntries, null);
  assert.match(html, /<div class="card card--stat card--outline">/);
  assert.match(html, /class="wdl-bar"/);
  assert.match(html, /Scores 50\.0% for white at 1600-1800 \(12,345 games\)/);
});

test('indexPage embeds WebSite + Organization JSON-LD', () => {
  const html = indexPage([]);
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const types = scripts.map((s) => s['@type']).sort();
  assert.deepEqual(types, ['Organization', 'WebSite']);
});

test('buildStatic also writes sitemap.xml (listing exactly the emitted .html pages) and robots.txt pointing at it', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, repertoireStubs, contentWritten, ecoWritten, ecoExplorerResult, packWritten, pageFilenames } = await buildStatic({ fetchImpl, useCache: false });

    assert.ok(fs.existsSync(path.join(outDir, 'sitemap.xml')));
    assert.ok(fs.existsSync(path.join(outDir, 'robots.txt')));
    assert.ok(fs.existsSync(path.join(outDir, 'eco-explorer.html')), 'Phase 7e: eco-explorer.html must be written');
    assert.ok(fs.existsSync(path.join(outDir, 'eco-explorer.js')), 'Phase 7e: eco-explorer.js bundle must be written');
    assert.ok(fs.existsSync(path.join(outDir, 'eco-reverse-lookup.json')), 'Phase 7e: the FEN reverse-lookup asset must be written');
    assert.ok(ecoExplorerResult.reverseLookupCount > 0);

    // index + player.html (stub) + italian-game-drill.html (stub) +
    // repertoire-builder.html (real, WS-1 W1a) + opening-report.html +
    // drill-reference.html (still WS-1 placeholders) +
    // privacy/about/contact/methodology + 404 +
    // drill.html (the WS-1 hub, drillFile) + repertoire.html = 13 fixed
    // entries + 8 redirect stubs + one page per configured opening + hub + all guides + hub + FAQ
    // + (Phase 7d) 64 T1 family hubs + 5 T2 volume pages + 2 T2
    // browse-index pages + (Phase 7e) 1 ECO explorer page + (M2) 3
    // Repertoire Pack pages.
    // pageFilenames includes 404.html, the 8 repertoire redirect stubs,
    // player.html/italian-game-drill.html (also now redirect stubs), and
    // the 3 pack pages (for the filename-uniqueness check). The sitemap
    // itself must exclude only 404.html and the redirect stubs -- all four
    // WS-1 pages (repertoire-builder.html, opening-report.html, drill.html,
    // drill-reference.html) have shipped for real and are NOT excluded, and
    // STORE (src/render.js) now carries real, non-placeholder Gumroad urls
    // so the pack pages are indexable and DO belong in the sitemap too --
    // see the separate assertion below, and src/sitemap.js's
    // buildSitemapEntries/REDIRECT_STUBS plus src/buildStatic.js's own
    // noindexPackFiles/noindexPlaceholderFiles filters.
    const expectedPageCount = 13 + 1 + repertoireStubs.length + contentWritten.length + ecoWritten.length + packWritten.length;
    assert.equal(pageFilenames.length, expectedPageCount);
    assert.ok(pageFilenames.includes('404.html'));
    assert.ok(pageFilenames.includes('eco-explorer.html'));
    assert.ok(pageFilenames.includes('repertoire.html'));
    assert.ok(packWritten.every((p) => !p.noindex), 'STORE now carries real Gumroad urls, so no pack page should be noindex');

    const sitemapXml = fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
    assert.match(sitemapXml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    const locMatches = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    // Excluded from the sitemap: 404.html (1), the 8 repertoire redirect
    // stubs, and player.html + italian-game-drill.html (2, now redirect
    // stubs). All four WS-1 pages (repertoire-builder.html [W1a],
    // opening-report.html [W2], drill.html and drill-reference.html [Drill
    // Engine v2]) have shipped for real and are no longer excluded, so
    // there are zero remaining WS-1 placeholder pages to subtract. The pack
    // pages are NOT excluded either -- STORE (src/render.js) now carries
    // real, non-placeholder Gumroad urls, so they're indexable.
    const excludedCount = 1 + repertoireStubs.length + 2;
    assert.equal(locMatches.length, expectedPageCount - excludedCount, '404.html and the redirect stubs must be excluded from the sitemap; the now-indexable pack pages and shipped WS-1 pages must be included');
    assert.ok(locMatches.some((loc) => loc.includes('repertoire-packs')), 'the now-indexable pack pages should appear in the sitemap');
    assert.ok(locMatches.includes('https://repertoire-builder.com/'), 'home should canonicalize to the directory form');
    assert.ok(locMatches.includes('https://repertoire-builder.com/repertoire.html'), 'the collapsed repertoire page must be in the sitemap');
    assert.ok(locMatches.includes('https://repertoire-builder.com/italian-game.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/chess-opening-faq.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/privacy.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/methodology.html'));
    // Redirect sources and still-placeholder pages must NOT appear.
    assert.ok(!locMatches.includes('https://repertoire-builder.com/italian-game-drill.html'), 'a redirect source must never appear in the sitemap');
    assert.ok(!locMatches.includes('https://repertoire-builder.com/player.html'), 'a redirect source must never appear in the sitemap');
    // All four WS-1 pages have shipped for real: drill.html and
    // drill-reference.html (Drill Engine v2, this branch) plus
    // repertoire-builder.html (WS-1 W1a) and opening-report.html (WS-1 W2,
    // both merged to master separately) -- all four are indexable now.
    assert.ok(locMatches.includes('https://repertoire-builder.com/drill.html'), 'the WS-1 drill hub is real now and must be indexed');
    assert.ok(locMatches.includes('https://repertoire-builder.com/drill-reference.html'), 'the WS-1 drill reference is real now and must be indexed');
    assert.ok(locMatches.includes('https://repertoire-builder.com/repertoire-builder.html'), 'the WS-1 repertoire builder shipped for real (WS-1 W1a) and must be indexed');
    assert.ok(locMatches.includes('https://repertoire-builder.com/opening-report.html'), 'the WS-1 opening report shipped for real (WS-1 W2) and must be indexed');
    assert.equal(ecoWritten.length, 64 + 5 + 2, 'Phase 7d: 64 T1 hubs + 5 T2 volume pages + 2 T2 browse-index pages');
    assert.ok(locMatches.includes('https://repertoire-builder.com/sicilian-defense-variations.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/eco-volume-b.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/eco-openings.html'));
    assert.ok(locMatches.includes('https://repertoire-builder.com/eco-explorer.html'));
    // player-lookup.js/drill.js/repertoire-builder.js/opening-report.js/
    // drill-hub.js/repertoire.js/eco-explorer.js/eco-reverse-lookup.json/
    // ads.txt/CNAME are not pages and must not appear.
    assert.ok(!sitemapXml.includes('player-lookup.js'));
    assert.ok(!sitemapXml.includes('drill.js'));
    assert.ok(!sitemapXml.includes('repertoire-builder.js'));
    assert.ok(!sitemapXml.includes('opening-report.js'));
    assert.ok(!sitemapXml.includes('drill-hub.js'));
    assert.ok(!sitemapXml.includes('repertoire.js'));
    assert.ok(!sitemapXml.includes('eco-explorer.js'));
    assert.ok(!sitemapXml.includes('eco-reverse-lookup.json'));
    assert.ok(!sitemapXml.includes('ads.txt'));
    assert.ok(!sitemapXml.includes('404.html'), '404.html must never appear in sitemap.xml');
    // Every redirect stub must be excluded from the sitemap too (a redirect
    // source must never appear in a sitemap -- spec WS-3.2 section 2.2).
    for (const { file } of repertoireStubs) {
      assert.ok(REDIRECT_STUBS.has(file), `${file} should be a member of sitemap.js's REDIRECT_STUBS`);
      assert.ok(!locMatches.includes(`https://repertoire-builder.com/${file}`), `${file} must not appear in the sitemap`);
    }

    const robotsTxt = fs.readFileSync(path.join(outDir, 'robots.txt'), 'utf8');
    assert.match(robotsTxt, /^User-agent: \*/);
    assert.match(robotsTxt, /Sitemap: https:\/\/repertoire-builder\.com\/sitemap\.xml/);
  })
);

test('buildStatic writes dist/404.html with the shared shell, noindex, and copies the identity assets into dist/', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    const notFoundHtml = fs.readFileSync(path.join(outDir, '404.html'), 'utf8');
    assert.match(notFoundHtml, /<meta name="robots" content="noindex">/);
    assert.match(notFoundHtml, /class="site-header"/);
    assert.match(notFoundHtml, /class="site-nav"/);
    assert.match(notFoundHtml, /class="site-footer"/);

    for (const file of ['og-default.png', 'apple-touch-icon.png', 'favicon.svg']) {
      const outPath = path.join(outDir, file);
      assert.ok(fs.existsSync(outPath), `expected ${file} to be copied into dist/`);
      assert.ok(fs.statSync(outPath).size > 0, `${file} should not be empty`);
    }

    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /<meta property="og:image" content="https:\/\/repertoire-builder\.com\/og-default\.png">/);
    assert.match(homeHtml, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
    assert.match(homeHtml, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
  })
);

test('buildStatic never emits an internal href="index.html" link -- the repertoire/home nav target is "/"', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    for (const file of ['index.html', 'italian-game.html', 'repertoire-1600-1800-white.html', '404.html']) {
      const html = fs.readFileSync(path.join(outDir, file), 'utf8');
      assert.doesNotMatch(html, /href="index\.html"/, `${file} should not link to href="index.html"`);
    }
  })
);

test('buildStatic writes italian-game-drill.html as a redirect stub to drill.html, and drill.html + drill-hub.js as the real WS-1 Drill Engine v2 hub', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir, pageFilenames } = await buildStatic({ fetchImpl, useCache: false });

    assert.ok(fs.existsSync(path.join(outDir, 'italian-game-drill.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'drill.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'drill-hub.js')));
    assert.ok(pageFilenames.includes('italian-game-drill.html'));
    assert.ok(pageFilenames.includes('drill.html'));
    assert.ok(!pageFilenames.includes('drill-hub.js'), 'drill-hub.js is a script, not a page');

    const stubHtml = fs.readFileSync(path.join(outDir, 'italian-game-drill.html'), 'utf8');
    assert.match(stubHtml, /<meta http-equiv="refresh" content="0; url=\/drill\.html">/);
    assert.match(stubHtml, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/drill\.html">/);

    const drillHtml = fs.readFileSync(path.join(outDir, 'drill.html'), 'utf8');
    assert.match(drillHtml, /<h1 class="page-title">Opening drill<\/h1>/);
    // Real now (Drill Engine v2 shipped this task) -- no longer noindexed.
    assert.doesNotMatch(drillHtml, /<meta name="robots" content="noindex">/);

    // See buildDrillBundle's own test above for why this is a sandboxed
    // execution check rather than a textual require()/module.exports ban.
    const drillHubJs = fs.readFileSync(path.join(outDir, 'drill-hub.js'), 'utf8');
    assert.doesNotThrow(() => runBundleInSandbox(drillHubJs));
  })
);

test('assertFilenamesUnique still passes with the WS-1 placeholder pages/bundles in the full static build filename list', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    // buildStatic() already runs assertFilenamesUnique() internally and
    // would have thrown during the build above if the new filenames
    // collided with anything -- a successful build IS the assertion here.
    await assert.doesNotReject(() => buildStatic({ fetchImpl, useCache: false }));
  })
);

test('the home page links to the (now WS-1 hub) drill, and the opening report is still linked too', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    const homeHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(homeHtml, /href="drill\.html"/);
    assert.match(homeHtml, /Drill it: play the move your rating band plays/);
    assert.match(homeHtml, /href="opening-report\.html"/);
  })
);

test('the nav on an existing static page now includes the (WS-1 hub) drill link and the new builder link', () =>
  withTempDist(async () => {
    const { fetchImpl } = fakeExplorerFetch();
    const { outDir } = await buildStatic({ fetchImpl, useCache: false });

    // Root-relative (leading slash) -- see this file's earlier comment on
    // src/render.js's siteRelativeHref().
    const openingsHtml = fs.readFileSync(path.join(outDir, 'openings.html'), 'utf8');
    assert.match(openingsHtml, /href="\/drill\.html"/);
    assert.match(openingsHtml, /href="\/repertoire-builder\.html"/);
  })
);

test('copyAggregateShardsToDist: no-op (not an error) when data/aggregates does not exist yet -- WS-3 B2 has not run', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-no-aggregates-'));
  try {
    const result = copyAggregateShardsToDist(emptyDir);
    assert.deepEqual(result, { copied: false, files: [] });
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('copyAggregateShardsToDist: copies manifest.json + every listed shard verbatim into dist/data/, once aggregate data exists', () =>
  withTempDist(async () => {
    fs.mkdirSync(path.join(path.join(__dirname, '..', 'dist')), { recursive: true });
    const aggregatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-fixture-aggregates-'));
    try {
      fs.mkdirSync(path.join(aggregatesDir, 'f'), { recursive: true });
      fs.writeFileSync(path.join(aggregatesDir, 'f', 'italian-game.json'), '{"positions":{}}', 'utf8');
      const manifest = {
        pipelineVersion: 1,
        retrievedAt: new Date().toISOString(),
        shards: [{ file: 'f/italian-game.json', bytes: fs.statSync(path.join(aggregatesDir, 'f', 'italian-game.json')).size, positions: 0 }],
      };
      fs.writeFileSync(path.join(aggregatesDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
      fs.writeFileSync(path.join(aggregatesDir, 'root.json'), '{"positions":{},"pathIndex":{}}', 'utf8');

      const distDir = path.join(__dirname, '..', 'dist');
      const result = copyAggregateShardsToDist(aggregatesDir);
      assert.equal(result.copied, true);
      assert.deepEqual(result.files.sort(), ['data/f/italian-game.json', 'data/manifest.json'].sort());
      assert.ok(fs.existsSync(path.join(distDir, 'data', 'manifest.json')));
      assert.ok(fs.existsSync(path.join(distDir, 'data', 'f', 'italian-game.json')));
      assert.equal(
        fs.readFileSync(path.join(distDir, 'data', 'f', 'italian-game.json'), 'utf8'),
        '{"positions":{}}'
      );
    } finally {
      fs.rmSync(aggregatesDir, { recursive: true, force: true });
    }
  })
);

test('copyAggregateShardsToDist: throws loudly if the manifest lists a shard that is missing on disk', () =>
  withTempDist(() => {
    fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
    const aggregatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichess-broken-aggregates-'));
    try {
      fs.writeFileSync(
        path.join(aggregatesDir, 'manifest.json'),
        JSON.stringify({ pipelineVersion: 1, retrievedAt: new Date().toISOString(), shards: [{ file: 'f/missing.json', bytes: 10 }] }),
        'utf8'
      );
      fs.writeFileSync(path.join(aggregatesDir, 'root.json'), '{"positions":{},"pathIndex":{}}', 'utf8');
      assert.throws(() => copyAggregateShardsToDist(aggregatesDir), /manifest lists shard/);
    } finally {
      fs.rmSync(aggregatesDir, { recursive: true, force: true });
    }
  })
);
