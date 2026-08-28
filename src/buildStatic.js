'use strict';

/**
 * Full static-site build for GitHub Pages staging (local-only: this script
 * does not touch git, GitHub, or any account -- it only writes files under
 * dist/). Produces a self-contained dist/ directory that works when opened
 * directly in a browser via a file:// URL, no server required, since
 * GitHub Pages itself just serves static files.
 *
 * Two features, two different strategies:
 *
 * - Rating-band repertoire explorer: pre-rendered at build time into 8
 *   static HTML files (one per RATING_BANDS key x color), reusing
 *   buildRepertoireTree() + renderRepertoirePage() unchanged. This is the
 *   ONLY place the Lichess API token (LICHESS_API_TOKEN / .lichess-token,
 *   read by fetchOpeningExplorer.js) is used -- it is read locally during
 *   this build step to call the Explorer API, and the resulting HTML files
 *   contain only the aggregated stats the API returned, never the token
 *   itself. assertNoTokenLeak() below checks every file written to dist/
 *   for the literal token string as a build-time safety net, and
 *   test/buildStatic.test.js exercises the same check against a fake token.
 *
 * - Player lookup: a static HTML shell (player.html) plus a plain-JS bundle
 *   (player-lookup.js) built with esbuild (a real CommonJS bundle, entry
 *   point src/browser/playerLookup.client.js, which require()s
 *   fetchLichess.js/process.js/render.js directly like any other module in
 *   this project) into a single self-contained IIFE with no runtime
 *   require() -- see bundleBrowserEntry() below. That bundle calls
 *   Lichess's already-public, keyless general API directly from the
 *   visitor's browser -- no token is read, embedded, or needed for this
 *   page at all.
 *
 * - Content pages (phases 1-2 of the content-depth
 *   build): one page per opening in src/openings.js (started at 10, grows
 *   over time -- see that file's own header comment) + the openings hub
 *   (phase 1), plus an FAQ page and 7 editorial guide articles + a guides
 *   hub (phase 2), all pre-rendered the same way via buildContentPages()
 *   (src/buildContent.js).
 *   Also token-gated the same way -- see that module's own header comment.
 *
 * - sitemap.xml / robots.txt / structured data (phase 3): sitemap.xml and
 *   robots.txt (src/sitemap.js) are generated from the actual list of
 *   .html filenames this build writes, so they can't drift from what's
 *   really on disk. JSON-LD (src/structuredData.js) is emitted per-page by
 *   src/renderContent.js/src/buildStatic.js's indexPage(), not here.
 *
 * Usage: node src/buildStatic.js [--no-cache]
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { buildRepertoireTree } = require('./buildRepertoire');
const { RATING_BANDS } = require('./processRepertoire');
const { renderRedirectStubPage, renderGenericRedirectStub, escapeHtml, formatPct, renderDocumentHead, renderHeader, renderFooter, renderPageHead, HEADER_BAND_OPTIONS, HEADER_BAND_DEFAULT, stripCssComments } = require('./render');
const { renderRepertoireExplorerPage } = require('./renderRepertoireExplorer');
const { renderOpeningStatCard, renderMethodologyPage } = require('./renderContent');
// Board-visibility work (homepage hero demo) -- see
// src/renderRepertoireExplorer.js's header comment for why a page-assembly
// module (this file, for indexPage()) may require() boardSvg.js directly
// (Node `fs` read, sprite embed) while render.js itself never may.
const { spriteDefsHtml, pieceAttributionHtml } = require('./boardSvg');
const { MISTAKE_THRESHOLDS } = require('./processOpenings');
const { loadAggregates } = require('./aggregateSource');
const { BALANCED_ELO_WINDOW } = require('./ingest/gameFilter');
const { getApiToken } = require('./fetchOpeningExplorer');
const { buildContentPages } = require('./buildContent');
const { buildEcoPages } = require('./buildEcoPages');
const { buildPackPages } = require('./buildPackPages');
const { packsIndexFilename, packOgImageFilename, PRICE_USD } = require('./renderPackPages');
const { buildEcoDataset } = require('./ecoData');
const { buildFamilyIndex, t1Families } = require('./ecoFamilies');
const { ECO_INDEX_FILE } = require('./renderEcoPages');
const { buildEcoExplorerPage, ECO_EXPLORER_FILE, REVERSE_LOOKUP_FILE } = require('./buildEcoExplorer');
const { withExplorerCache } = require('./explorerCache');
const { renderPrivacyPage, renderAboutPage, renderContactPage, render404Page, adsTxtContent, cloudflareHeadersContent } = require('./renderCompliance');
const { renderSitemapXml, robotsTxtContent } = require('./sitemap');
const { indexNowKeyFileName, indexNowKeyFileContent } = require('./indexNow');
const { renderRssXml } = require('./rss');
const { homeJsonLd } = require('./structuredData');
const { SITE_NAME, SITE_TAGLINE, absoluteUrl, pageTitle } = require('./site');
const { aggregatesAvailable, AGGREGATES_DIR } = require('./explorerSource');
// WS-1 placeholder-page renderers + IS_PLACEHOLDER flags (WS-1 spec section 6.2's binding shared-file mitigation --
// see each renderer's own header comment). buildDrillData/renderDrillPage
// (the OLD single-opening drill pilot's build/render functions) are
// deliberately no longer required here -- src/buildDrill.js and
// src/renderDrill.js are untouched on disk and still export those
// functions, simply unused by this file's main build sequence until the
// Drill Engine v2 follow-on task rewrites them into the new hub.
const { renderRepertoireBuilderPage, IS_PLACEHOLDER: BUILDER_IS_PLACEHOLDER } = require('./renderRepertoireBuilder');
const { renderOpeningReportPage, IS_PLACEHOLDER: OPENING_REPORT_IS_PLACEHOLDER } = require('./renderOpeningReport');
const { renderDrillHubPage, renderDrillReferencePage, IS_PLACEHOLDER: DRILL_HUB_IS_PLACEHOLDER } = require('./renderDrillHub');
const { renderCompareOpeningsPage } = require('./renderCompareOpenings');

// Pre-rendering all 8 band/color combinations issues many sequential
// Explorer API requests (each combination expands several plies), which can
// trip Lichess's rate limiter well before the whole batch finishes. This
// wrapper is ONLY used as the default (real) fetch implementation -- any
// caller that passes its own `fetchImpl` (as every test in
// test/buildStatic.test.js does) bypasses it entirely, so it never adds
// delays or retries to the test suite.
async function politeFetch(url, options) {
  const MAX_ATTEMPTS = 6;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt === MAX_ATTEMPTS) {
      return response;
    }
    const retryAfterHeader = response.headers && typeof response.headers.get === 'function'
      ? Number(response.headers.get('retry-after'))
      : NaN;
    const waitMs = (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 5) * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  // Unreachable, but keeps control flow explicit.
  return fetch(url, options);
}

const OUT_DIR = path.join(__dirname, '..', 'dist');
const COLORS = ['white', 'black'];

// Identity artwork committed under assets/ by scripts/build-og-image.js (run
// by hand, not part of this build -- see that script's own header comment).
// Copied verbatim into dist/ on every build so a normal `npm run
// build:static` never needs Playwright itself.
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const IDENTITY_ASSET_FILES = ['og-default.png', 'apple-touch-icon.png', 'favicon.svg'];

// Self-hosted heading webfont. assets/fonts/fraunces-variable.woff2 was extracted once from the
// @fontsource-variable/fraunces devDependency (an OFL-licensed npm package
// that bundles the actual Google Fonts binary, so the build never fetches
// anything from Google at runtime or build time); copied verbatim into
// dist/fonts/ here, same pattern as IDENTITY_ASSET_FILES above. render.js's
// @font-face/preload reference this exact dist/-relative path.
const FONT_ASSET_FILES = ['fraunces-variable.woff2'];

// Nav link targets for the static build -- flat filenames, no server routes.
// 'guides'/'faq' added once guides.html/chess-opening-faq.html actually
// existed; 'drill' added once italian-game-drill.html existed
// (single-opening drill pilot). 'repertoire' pointed at '/' (the home page)
// until WS-3.2 collapsed the 8 repertoire-<band>-<color>.html pages into one
// real repertoire.html -- now that a single canonical repertoire page
// exists, the nav link goes straight there.
//
// `home` ('/') is a NEW key, added the same time 'repertoire' stopped
// aliasing it: every "Home" breadcrumb and the header's brand-logo link
// (render.js's renderHeader(), `nav.home || nav.repertoire || '/'`) used to
// read `nav.repertoire` specifically BECAUSE it used to equal '/' -- now
// that 'repertoire' points at a real, different page, every one of those
// call sites was repointed to `nav.home` instead (see this build's own
// history for exactly which templates that touched: src/renderContent.js,
// src/renderDrill.js, src/renderEcoExplorerPage.js, src/renderEcoPages.js).
// `home` is deliberately NOT in NAV_ORDER (render.js), so it never adds a
// visible "Home" link to the top nav bar itself -- only the brand logo and
// breadcrumbs use it.
// WS-1 page filenames (the WS-1 spec section 3.6):
// flat filenames matching the site's existing convention, not a
// directory-style path. BUILDER_FILE/OPENING_REPORT_FILE/DRILL_HUB_FILE/
// DRILL_REFERENCE_FILE are what 'builder'/'player'/'drill' point at below
// now that WS-1's placeholder pages exist -- player.html and
// italian-game-drill.html (their PREVIOUS targets) become redirect stubs
// to OPENING_REPORT_FILE/DRILL_HUB_FILE respectively (spec 3.2/3.3), never
// deleted.
const BUILDER_FILE = 'repertoire-builder.html';
const OPENING_REPORT_FILE = 'opening-report.html';
const DRILL_HUB_FILE = 'drill.html';
const DRILL_REFERENCE_FILE = 'drill-reference.html';
const PLAYER_STUB_FILE = 'player.html';
const DRILL_PILOT_STUB_FILE = 'italian-game-drill.html';

const STATIC_NAV = { home: '/', builder: BUILDER_FILE, player: OPENING_REPORT_FILE, repertoire: 'repertoire.html', packs: packsIndexFilename(), openings: 'openings.html', eco: ECO_INDEX_FILE, drill: DRILL_HUB_FILE, guides: 'guides.html', faq: 'chess-opening-faq.html' };

// The one opening the OLD single-opening drill pilot covered, and the
// rating band its server-rendered starting position and candidate table
// default to (still used by render404Page's repertoireLink below). Kept
// here (not hardcoded inside renderDrill.js) so a future change only has
// to touch this one call site.
const DRILL_OPENING_SLUG = 'italian-game';
const DRILL_DEFAULT_BAND = '1600-1800';

// Maps an opening slug to its drill page filename, so buildContentPages()
// can thread a "Drill this opening" CTA into that opening's page. Points
// at the new hub (DRILL_HUB_FILE) rather than the old single-opening
// pilot's own filename -- the hub is what a visitor should land on now
// that italian-game-drill.html is a redirect stub (spec 3.3); Drill Engine
// v2's follow-on task is expected to make this map cover more than one
// opening.
const DRILL_PAGES = { [DRILL_OPENING_SLUG]: DRILL_HUB_FILE };

// Compliance pages: privacy policy, about, and
// contact, linked from every page's footer via renderFooter()'s optional
// `legalLinks` param (see src/render.js). Kept as flat filenames matching
// every other static page, and shared with src/renderContent.js's own
// CONTENT_LEGAL_LINKS constant (kept in sync by comment there, since that
// module can't require() this one without a circular dependency).
const LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html', faq: 'chess-opening-faq.html' };

const BROWSER_ENTRY = path.join(__dirname, 'browser', 'playerLookup.client.js');
const DRILL_ENTRY = path.join(__dirname, 'browser', 'drill.client.js');
const ECO_EXPLORER_ENTRY = path.join(__dirname, 'browser', 'ecoExplorer.client.js');
const REPERTOIRE_ENTRY = path.join(__dirname, 'browser', 'repertoire.client.js');
// WS-1 placeholder client entry points (spec section 6.2) -- each
// follow-on task (W1a/W2/W3) rewrites the FILE at this path, never this
// constant or the bundle function below it.
const REPERTOIRE_BUILDER_ENTRY = path.join(__dirname, 'browser', 'repertoireBuilder.client.js');
const OPENING_REPORT_ENTRY = path.join(__dirname, 'browser', 'openingReport.client.js');
const DRILL_HUB_ENTRY = path.join(__dirname, 'browser', 'drillHub.client.js');
// WS-1 spec section 3.4 (task W4, band persistence). Unlike the three
// placeholders above, this entry point's content is final as of this
// commit, not a stub a follow-on task replaces -- see
// src/browser/bandHeaderControl.client.js's own header comment.
const BAND_HEADER_CONTROL_ENTRY = path.join(__dirname, 'browser', 'bandHeaderControl.client.js');
// Site-audit item 11 (2026-08-25) -- the Compare Openings tool. See
// src/browser/compareOpenings.client.js's own header comment.
const COMPARE_OPENINGS_ENTRY = path.join(__dirname, 'browser', 'compareOpenings.client.js');
// Board-visibility work -- the homepage hero live demo. See
// src/browser/homeDemo.client.js's own header comment.
const HOME_DEMO_ENTRY = path.join(__dirname, 'browser', 'homeDemo.client.js');

// The 8 old repertoire-<band>-<color>.html filenames (RATING_BANDS x
// white/black) -- now redirect stubs (spec WS-3.2 section 2.2), never
// deleted. src/sitemap.js's REDIRECT_STUBS computes this exact same set
// independently (documented there as duplicated on purpose, to avoid a
// circular require -- this module already requires sitemap.js).
function repertoireFileName(band, color) {
  const safeBand = band.replace(/[^\w-]/g, '');
  return `repertoire-${safeBand}-${color}.html`;
}

/**
 * Site-relative link into the collapsed repertoire.html -- band/color
 * travel in the URL FRAGMENT, never a query string (spec WS-3.2 section
 * 2.2: fragments are never sent to the server, are ignored for
 * canonicalization, and cannot create an indexable duplicate URL).
 */
function repertoireFragmentUrl(band, color) {
  return `repertoire.html#band=${encodeURIComponent(band)}&color=${encodeURIComponent(color)}`;
}

/**
 * Bundles a single CommonJS entry point (and everything it require()s,
 * transitively) into one self-contained IIFE with esbuild, for direct use
 * as a <script src="..."> in the static build. No runtime require(), no
 * module resolution at load time -- esbuild resolves and inlines the whole
 * graph at build time, which is what keeps the output working from a
 * file:// URL (native ESM `import` is blocked by CORS over file://; a
 * pre-bundled IIFE has no such restriction). `bundle: true` + `write:
 * false` returns the built text directly with no temp files on disk.
 * `esbuild.buildSync` throws (loudly, synchronously) on any resolution or
 * syntax error in the entry point or anything it require()s, so a broken
 * source edit fails the build instead of silently shipping a stale bundle
 * -- the same failure-loudly guarantee the old string-splice approach had.
 */
function bundleBrowserEntry(entryPath, headerComment) {
  const result = esbuild.buildSync({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2019'],
    logLevel: 'silent',
    // Whitespace/dead-code minification only -- NOT minifyIdentifiers.
    // test/buildStatic.test.js's own bundle tests (and any future ones)
    // assert on real function names being present in the output (e.g.
    // `/function fetchRatingHistory/`) as proof the right modules got
    // bundled; renaming identifiers would make that check meaningless
    // without a source map, for a source-size win this project doesn't
    // need (nothing here is minimizing against a CDN egress cost). Added
    // for Phase 7e (src/browser/ecoExplorer.client.js, the heaviest bundle
    // on this site at ~230 KB raw / ~43 KB gzip unminified) but applies to
    // every bundle equally -- real bytes shipped to every visitor, not a
    // T3-specific hack.
    minifyWhitespace: true,
    minifySyntax: true,
  });
  // Any bundle that require()s src/render.js -- even for one unrelated
  // named export -- carries render.js's ENTIRE module body along with it:
  // esbuild bundles a required CommonJS module wholesale (there is no
  // static export list to tree-shake against the way real ESM named
  // imports have), so the raw, comment-bearing SITE_CSS template literal
  // ends up embedded as a JS string literal in the compiled bundle even
  // when nothing in the client code ever reads SITE_CSS. Stripping the
  // <style> tag's HTML text (render.js's own SITE_CSS_SHIPPED) does
  // nothing for this leak -- that only touches the separately-computed
  // Node-side HTML string, never these bundled JS bytes. Stripped here,
  // AFTER minification (real comments are already gone by this point, so
  // this only ever matches CSS text baked into a string literal) and
  // BEFORE the header banner is added, so the banner itself is never at
  // risk of being stripped as a false match.
  const stripped = stripCssComments(result.outputFiles[0].text);
  return headerComment ? `${headerComment}\n${stripped}` : stripped;
}

function buildPlayerLookupBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/playerLookup.client.js and its module dependencies',
    ' * (src/fetchLichess.js, src/process.js, src/render.js). Do not edit',
    ' * this file directly -- edit the source files above and re-run `node',
    ' * src/buildStatic.js`.',
    ' *',
    ' * This calls only Lichess\'s keyless public API (https://lichess.org/api)',
    ' * directly from your browser. No Lichess API token is used, read, or present',
    ' * anywhere in this file. */',
  ].join('\n');

  return bundleBrowserEntry(BROWSER_ENTRY, header);
}

/**
 * Same esbuild strategy as buildPlayerLookupBundle(), for the opening
 * drill's client bundle: entry point src/browser/drill.client.js, which
 * require()s src/chessPosition.js and src/drillLogic.js (both pure). All
 * drill data is baked into the page at build time (see the #drill-data
 * JSON block src/renderDrill.js emits) -- this bundle never makes a
 * network request itself.
 */
function buildDrillBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/drill.client.js and its module dependencies',
    ' * (src/chessPosition.js, src/drillLogic.js). Do not edit this file',
    ' * directly -- edit the source files above and re-run `node',
    ' * src/buildStatic.js`.',
    ' *',
    ' * This makes no network requests -- every position/percentage it uses',
    ' * comes from the #drill-data JSON block already on the page. */',
  ].join('\n');

  return bundleBrowserEntry(DRILL_ENTRY, header);
}

/**
 * Same esbuild strategy again, for the collapsed repertoire.html's client
 * bundle (WS-3.2): entry point src/browser/repertoire.client.js, which
 * require()s src/browser/bandState.client.js and src/render.js (for
 * renderRepertoireTree/escapeHtml, same as buildPlayerLookupBundle()
 * already does). Makes no network requests -- every band x color
 * combination it can paint comes from the #repertoire-data JSON block
 * already on the page, baked in at build time.
 */
function buildRepertoireBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/repertoire.client.js and its module dependencies',
    ' * (src/browser/bandState.client.js, src/render.js). Do not edit this',
    ' * file directly -- edit the source files above and re-run `node',
    ' * src/buildStatic.js`.',
    ' *',
    ' * This makes no network requests -- every band/color combination it',
    ' * can paint comes from the #repertoire-data JSON block already on the',
    ' * page, baked in at build time. */',
  ].join('\n');

  return bundleBrowserEntry(REPERTOIRE_ENTRY, header);
}

/**
 * Same esbuild strategy again, for T3's client bundle (Phase 7e): entry
 * point src/browser/ecoExplorer.client.js, which require()s
 * src/boardWidget.js, src/pgnWrapper.js, and chess.js -- the only bundle on
 * this site that ships chess.js to the browser (see src/pgnWrapper.js's own
 * header comment for why this page, and only this page, needs it: it is
 * the sole place visitor-supplied PGN/FEN input reaches a chess engine).
 * This bundle also issues the one runtime fetch() this static site makes
 * for same-origin data -- see src/ecoExplorerData.js's header comment.
 */
function buildEcoExplorerBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/ecoExplorer.client.js and its module dependencies',
    ' * (src/boardWidget.js, src/pgnWrapper.js, chess.js, cm-chessboard).',
    ' * Do not edit this file directly -- edit the source files above and',
    ' * re-run `node src/buildStatic.js`.',
    ' *',
    ' * This is the only page on this site that parses visitor-supplied PGN/',
    ' * FEN text (always through src/pgnWrapper.js\'s size-capped, depth-',
    ' * guarded wrapper -- never chess.js directly) and the only page that',
    ' * issues a runtime fetch() for same-origin data (eco-reverse-lookup.json,',
    ' * lazy-loaded on first use). No Lichess API token is used, read, or',
    ' * present anywhere in this file. */',
  ].join('\n');

  return bundleBrowserEntry(ECO_EXPLORER_ENTRY, header);
}

/**
 * WS-1 placeholder bundle for repertoire-builder.html (WS-1 spec section 6.2). Bundles whatever
 * src/browser/repertoireBuilder.client.js currently contains -- a trivial
 * placeholder today, the real Repertoire Builder v1 client once the
 * follow-on task rewrites that one file. This function and its call site
 * in buildStatic() below never change when that happens.
 */
function buildRepertoireBuilderBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/repertoireBuilder.client.js. Do not edit this file',
    ' * directly -- edit the source file above and re-run `node',
    ' * src/buildStatic.js`. */',
  ].join('\n');
  return bundleBrowserEntry(REPERTOIRE_BUILDER_ENTRY, header);
}

/**
 * WS-1 placeholder bundle for opening-report.html. Same pattern as
 * buildRepertoireBuilderBundle() above -- see that function's own comment.
 */
function buildOpeningReportBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/openingReport.client.js. Do not edit this file',
    ' * directly -- edit the source file above and re-run `node',
    ' * src/buildStatic.js`. */',
  ].join('\n');
  return bundleBrowserEntry(OPENING_REPORT_ENTRY, header);
}

/**
 * WS-1 placeholder bundle for drill.html (the hub). Same pattern as
 * buildRepertoireBuilderBundle() above -- see that function's own comment.
 */
function buildDrillHubBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/drillHub.client.js. Do not edit this file',
    ' * directly -- edit the source file above and re-run `node',
    ' * src/buildStatic.js`. */',
  ].join('\n');
  return bundleBrowserEntry(DRILL_HUB_ENTRY, header);
}

/**
 * WS-1 spec section 3.4 (task W4) -- the site-wide band-persistence header
 * control's bundle, written to dist/band-header.js and loaded (deferred)
 * only by pages src/render.js's renderHeader() renders the control on
 * (BAND_CONTROL_PAGES there). Same bundling shape as every other entry
 * point here; unlike buildRepertoireBuilderBundle() and its two siblings
 * above, this one's source is not a placeholder a later task replaces.
 */
function buildBandHeaderControlBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/bandHeaderControl.client.js. Do not edit this file',
    ' * directly -- edit the source file above and re-run `node',
    ' * src/buildStatic.js`. */',
  ].join('\n');
  return bundleBrowserEntry(BAND_HEADER_CONTROL_ENTRY, header);
}

/**
 * Site-audit item 11 -- the Compare Openings tool's bundle, written to
 * dist/compare-openings.js and loaded only by compare-openings.html. No
 * chess.js/cm-chessboard in this one's dependency graph at all (see
 * src/browser/compareOpenings.client.js's own header comment for why) --
 * by far the smallest interactive bundle on this site.
 */
function buildCompareOpeningsBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/compareOpenings.client.js. Do not edit this file',
    ' * directly -- edit the source file above and re-run `node',
    ' * src/buildStatic.js`. */',
  ].join('\n');
  return bundleBrowserEntry(COMPARE_OPENINGS_ENTRY, header);
}

/**
 * Board-visibility work -- the homepage hero demo's bundle.
 * Entry point src/browser/homeDemo.client.js, which require()s only
 * src/boardWidget.js (createBoard/COLOR/FEN, cm-chessboard core + the
 * Accessibility extension) -- NOT src/boardWidgetFree.js/chess.js. Spec
 * section 2.3's hard budget is <=120KB uncompressed; measured directly
 * (esbuild, this project's own bundling settings) before writing this
 * file's logic: src/boardWidgetFree.js (createBoard + chess.js together)
 * alone already bundles to ~120.7KB, over budget before a single byte of
 * this page's own glue code. Per spec section 2.3's own named fallback --
 * "If it does not fit, restrict input to the three pre-authored replies via
 * a UCI allowlist and drop chess.js entirely" -- this bundle takes that
 * path: src/browser/homeDemo.client.js implements its own small
 * allowlist-only move-input handler (see that file's own comment) instead
 * of reusing mountFreeBoard. Real measured result: ~65KB uncompressed,
 * comfortably under budget.
 */
function buildHomeDemoBundle() {
  const header = [
    '/* Auto-generated by src/buildStatic.js (esbuild) from',
    ' * src/browser/homeDemo.client.js and its module dependencies',
    ' * (src/boardWidget.js, cm-chessboard). Do not edit this file directly',
    ' * -- edit the source files above and re-run `node src/buildStatic.js`.',
    ' *',
    ' * This makes no network requests -- the three pre-authored reply',
    ' * captions and their percentages come from the #home-demo-data JSON',
    ' * block already on the page, baked in at build time. No chess.js: move',
    ' * input is restricted to the three UCI moves in that same data block',
    ' * (spec section 2.3\'s named budget fallback), not general chess',
    ' * legality. */',
  ].join('\n');
  return bundleBrowserEntry(HOME_DEMO_ENTRY, header);
}

// The homepage's one clear "what do I click first" step (growth-audit
// finding: 4 body sections -- rating-band picker, packs, drill, opening
// report -- all read as equal-weight competing CTAs, with nothing telling
// a first-time visitor which to try). This site's own real per-visitor
// tool (opening-report.html, a live Lichess-username lookup already built)
// is the natural single answer, same direction the audit itself suggested.
// Becomes the page's one accent-filled action (design-standards.md's
// per-page hierarchy rule) via .start-here-cta below -- same visual recipe
// as .pack-cta/.lookup-form button, copied rather than shared across pages
// per this file's own established convention (see .pack-cta's comment).
// That means the rating-band picker right after this section can no
// longer ALSO be accent-filled without giving the page two competing
// primary actions again -- see the scoped .home-band-picker override in
// SITE_CSS, which demotes ONLY the homepage's own instance of the shared
// .band-pill class (repertoire.html's own use of the same pills is
// untouched). Packs/drill stay as they already were (outline cards, never
// accent-filled to begin with -- see packsCtaSection()'s own comment).
//
// Site-audit item 2 (2026-08-25): promoted from a plain "go look up your
// username on a different page" link to a REAL, functional lookup form
// rendered directly in the hero -- a visitor can now type their username
// and submit without a page visit just to find the input box. This is a
// plain HTML GET form (action=opening-report.html, no new client-side JS
// bundle on the homepage at all): opening-report.html's own
// openingReport.client.js already reads a `?username=` query param and
// auto-runs the report on load (its own prefill handling, unchanged here),
// so a native form submission is both the simplest and the most robust
// implementation -- it degrades to exactly today's "click through, then
// type" flow with JavaScript disabled, never a dead button. `pattern` and
// `maxlength` mirror src/leakAnalysis.js's own USERNAME_RE (`/^[\w-]{2,30}$/`)
// exactly, for the same native-browser-validation nicety
// renderOpeningReport.js's own form already gives visitors, not a new rule.
//
// Reuses .lookup-form/.lookup-row wholesale (renderOpeningReport.js's own
// form markup, verbatim structure) rather than the old .start-here-cta --
// zero new CSS needed, and it's a proven, already-shipped visual pattern
// (same accent-filled button treatment .start-here-cta used to provide by
// its own header comment: "same visual recipe as .pack-cta/.lookup-form
// button").
function startHereSection() {
  return `<h2 class="section-lead sr-only">Start here</h2>
    <form class="lookup-form" action="${OPENING_REPORT_FILE}" method="get">
      <label for="home-username">Lichess username</label>
      <div class="lookup-row">
        <input type="text" id="home-username" name="username" placeholder="e.g. DrNykterstein" autocomplete="off" maxlength="30" pattern="[\\w-]{2,30}" required>
        <button type="submit">Get my report &rarr;</button>
      </div>
    </form>
    <p class="start-here-alt">Get a real, personalized read on your own games, or <a href="#rating-band">jump to openings by rating band &darr;</a> if you&rsquo;d rather browse first.</p>`;
}

// Drill CTA card for the home page. Kept as its own additive block (a new
// section, appended without touching any of indexPage()'s existing copy)
// since a separate, later pass is expected to rework the rest of this
// page's headline/subtitle/section order -- keeping this isolated avoids
// that future edit and this one stepping on each other.
function drillCtaSection(drillFile) {
  if (!drillFile) return '';
  return `<h2>Drill it: play the move your rating band plays</h2>
    <div class="card-grid card-grid--single">
      <div class="card card--outline card--nav"><h3><a href="${escapeHtml(drillFile)}">Italian Game drill</a></h3><p>Pick the move, see instantly whether it is the move players at your rating actually make, and what that move scores.</p></div>
    </div>`;
}

// Site-audit item 1 (2026-08-26): repertoire-builder.html
// (the site's own namesake tool) lost its only inbound link when 'builder'
// was dropped from render.js's NAV_ORDER as part of the nav collapse -- this
// card is what keeps it reachable, same outline-card treatment as the drill/
// packs cards below it so it doesn't compete with the band picker's single
// accent-filled action.
function builderCtaSection() {
  return `<h2>Build your own repertoire</h2>
    <div class="card-grid card-grid--single">
      <div class="card card--outline card--nav"><h3><a href="${escapeHtml(BUILDER_FILE)}">Repertoire Builder</a></h3><p>Pick your moves, ply by ply, and see the real score and sample size for each one as you go - build a repertoire you chose, not one this site chose for you.</p></div>
    </div>`;
}

// Repertoire pack CTA card for the home page (2026-08-19 revenue-path fix:
// the site-wide top nav already carries a "Repertoire packs" link
// (render.js's NAV_ORDER), but that is one plain text link among nine,
// indistinguishable from "ECO index" or "Guides" -- nothing in the
// homepage's own body content told a visitor a $9 finished pack exists at
// all. Reuses the exact card--outline/card--nav treatment drillCtaSection
// above already established (own outline card, own hairline border, no
// fill), so this stays demoted below the band picker's single
// accent-filled action rather than competing with it -- see
// design-standards.md's "one accent-filled action per view" and this
// file's own comment above bandPickerHtml() naming the picker as that one
// action. Placed directly after the band picker (indexPage()) since a
// finished pack is the natural next step once a visitor has seen their
// band's own repertoire.
function packsCtaSection() {
  return `<h2>Want it finished and printable?</h2>
    <div class="card-grid card-grid--single">
      <div class="card card--outline card--nav"><h3><a href="${escapeHtml(packsIndexFilename())}">Repertoire packs, $${PRICE_USD} each</a></h3><p>A pruned, finished repertoire for your band: a full PGN, a drill-ready file, and a printable study guide. The rule that picks every move is printed on the page - the free tools above stay free either way.</p></div>
    </div>`;
}

// The four rating-band pickers as one role=group control with 44px pill
// links (render.js's .band-picker/.band-pill). Link targets/labels
// unchanged in spirit from the pre-WS-3.2 four floating .card elements
// (band + color, e.g. "as White") -- only the destination changed, from one
// of 8 separate repertoire-<band>-<color>.html files to a single
// repertoire.html with band+color in the URL fragment (spec WS-3.2 section
// 2.2). `data-band`/`data-color` are what src/browser/repertoire.client.js
// reads to wire up in-page switching on repertoire.html itself; on the home
// page these pills are plain cross-page links (the client bundle isn't
// loaded there) and the data attributes are simply unused, which is
// harmless. Every href still works with JS disabled: it lands on
// repertoire.html with the right fragment, which is also what the page's
// OWN default-state markup already shows for the 1600-1800/white pill.
function bandPickerHtml() {
  const pills = Object.keys(RATING_BANDS)
    .flatMap((band) => ['white', 'black'].map((color) => {
      const href = repertoireFragmentUrl(band, color);
      const colorLabel = color === 'white' ? 'White' : 'Black';
      return `<a class="band-pill" href="${escapeHtml(href)}" data-band="${escapeHtml(band)}" data-color="${escapeHtml(color)}">${escapeHtml(band)} <span class="band-pill-color">as ${escapeHtml(colorLabel)}</span></a>`;
    }))
    .join('\n      ');
  return `<div class="band-picker" role="group" aria-label="Pick your rating band and color">
      ${pills}
    </div>`;
}

// Above-the-fold data strip: for each rating band, the single top-scoring
// tracked opening at that band, its score, and a fixed-domain micro-bar
// (45-57%, the observed cross-opening spread -- render.js's
// --chart-domain-lo/--chart-domain-hi). Full-bleed (render.js's
// .zone-full-bleed) so it's the first element on the site that reaches the
// viewport edge, and it puts a real number above the fold on both the
// 1440x900 and 360x800 viewports design-standards.md requires -- the
// homepage previously showed no data until the second screenful. Built
// entirely from contentEntries the caller already has (no extra fetch).
function dataStripHtml(contentEntries) {
  if (contentEntries.length === 0) return '';
  const domainLo = 45;
  const domainHi = 57;
  const cols = Object.keys(RATING_BANDS).map((bandName) => {
    let best = null;
    for (const entry of contentEntries) {
      const b = (entry.model.bands || []).find((x) => x.band === bandName);
      if (b && b.enoughData && b.scoreForSide != null && (!best || b.scoreForSide > best.score)) {
        best = { name: entry.model.name, score: b.scoreForSide, side: entry.model.side, games: b.games };
      }
    }
    if (!best) {
      return `<div class="data-strip-col">
        <span class="data-strip-band">${escapeHtml(bandName)}</span>
        <span class="data-strip-empty">Not enough data yet</span>
      </div>`;
    }
    const fillPct = Math.max(0, Math.min(100, ((best.score - domainLo) / (domainHi - domainLo)) * 100));
    return `<div class="data-strip-col">
      <span class="data-strip-band">${escapeHtml(bandName)}</span>
      <span class="data-strip-opening">${escapeHtml(best.name)}</span>
      <span class="data-strip-score">${formatPct(best.score)}%<span class="data-strip-meta"> for ${escapeHtml(best.side)}, ${best.games.toLocaleString()} games</span></span>
      <svg class="data-strip-bar" viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-hidden="true"><title>${escapeHtml(best.name)} scores ${formatPct(best.score)}% at ${escapeHtml(bandName)}</title><rect class="data-strip-bar-track" x="0" y="0" width="100" height="12"></rect><rect class="data-strip-bar-fill" x="0" y="0" width="${fillPct}" height="12"></rect></svg>
    </div>`;
  }).join('');
  return `<div class="zone-full-bleed data-strip">
    <div class="data-strip-inner">${cols}</div>
  </div>`;
}

// Board-visibility work -- the homepage hero demo's rating band
// and color. Matches REPERTOIRE_DEFAULT_BAND/'black' -- the hero shows the
// same real 1600-1800 data this build's own repertoire.html would show for
// that band, playing Black (the side actually making the demo's move).
const HOME_DEMO_BAND = '1600-1800';
const HOME_DEMO_COLOR = 'black';

/**
 * Extracts the homepage hero demo's build-time data from the SAME
 * repertoireCombos buildRepertoireTree() output writeRepertoirePage() and
 * repertoire.client.js's own baked payload already use (spec section 2.3:
 * "build-time constants ... through the same aggregate path buildStatic.js's
 * indexPage() already uses" -- no new fetch, no bandData.client.js runtime
 * lookup, no chess.js on the build side).
 *
 * Deliberately data-driven rather than hardcoding "e5/c5/e6" as the three
 * pre-authored replies: buildRepertoireTree's color:'black' tree already
 * follows White's single most-played move (root, mover:'white') into the
 * top `breadth` (3) most-played Black replies (root.children) -- exactly
 * "the three pre-authored replies" the spec names (verified against a real
 * build: e5/c5/e6 at 62.5%/42.1%/19.5%/10.3%), without this function needing
 * to hardcode their SAN. If a future rebuild's data shifts (a different
 * White move overtakes 1. e4 at this band), this returns null rather than
 * shipping a hero whose caption no longer matches its hardcoded board
 * position -- see src/browser/homeDemo.client.js's own comment for why the
 * board's start FEN is a literal constant, not derived from this data.
 *
 * @param {Object<string, {tree: Array}>} combos buildRepertoireCombos() output
 * @param {string} [band] Craft-audit item 2: parameterized so this function
 *   can extract the same shape for any of HEADER_BAND_OPTIONS, not only the
 *   original hardcoded 1600-1800 -- see buildHomeDemoDataAllBands() below.
 *   Defaults to HOME_DEMO_BAND, preserving this function's original
 *   single-band call shape for every existing caller/test.
 * @returns {{band: string, openingSan: string, openingPlayedPct: number,
 *   replies: Object<string, {san: string, playedPct: number, score: number}>}|null}
 *   `replies` is keyed by UCI (e.g. "e7e5"), not SAN -- see
 *   src/browser/homeDemo.client.js's own comment for why (no chess.js
 *   client-side, so no SAN generation from a played move either; the board
 *   input handler matches on from/to squares).
 */
function buildHomeDemoData(combos, band = HOME_DEMO_BAND) {
  const combo = combos && combos[`${band}|${HOME_DEMO_COLOR}`];
  const root = combo && Array.isArray(combo.tree) ? combo.tree[0] : null;
  if (!root || root.uci !== 'e2e4' || !Array.isArray(root.children) || root.children.length === 0) {
    return null;
  }
  const replies = {};
  for (const child of root.children) {
    if (child.uci == null || child.san == null || child.playedPct == null || child.winPct == null || child.drawPct == null) continue;
    // Keyed by UCI, not SAN: src/browser/homeDemo.client.js's board input
    // handling matches on from/to squares (cm-chessboard's own input event
    // shape), not on algebraic notation -- see that file's header comment
    // for why (measured bundle-budget fallback, spec section 2.3: no
    // chess.js, so no SAN generation client-side either).
    replies[child.uci] = {
      san: child.san,
      playedPct: child.playedPct,
      // Standard chess-scoring convention (win=1, draw=0.5) -- the same
      // definition src/processOpenings.js's scoreFor() uses site-wide,
      // computed here from the already-fetched per-move winPct/drawPct
      // (this ply-1 candidate breakdown has no separate totals struct of
      // its own to run scoreFor() against directly).
      score: Number((child.winPct + child.drawPct / 2).toFixed(1)),
    };
  }
  if (Object.keys(replies).length === 0) return null;
  return {
    band,
    openingSan: root.san,
    openingPlayedPct: root.playedPct,
    replies,
  };
}

/**
 * Craft-audit item 2: the homepage hero demo used to be permanently locked
 * to 1600-1800 data regardless of the site-wide band control's own state --
 * this computes the SAME extraction as buildHomeDemoData() above for every
 * band the site offers, from the SAME already-fetched `combos` (no new
 * fetch -- every band+color combo buildRepertoireCombos() produces is
 * already present in `combos`, the same object bandPickerHtml()/
 * dataStripHtml() already iterate over the full band set of). A band whose
 * White top move at this band isn't 1. e4 is simply absent from the
 * returned map's own non-null entries (buildHomeDemoData's own data-drift
 * guard, unchanged) -- src/browser/homeDemo.client.js falls back to the
 * default band's data rather than switching to a band with no valid entry.
 *
 * @param {Object<string, {tree: Array}>} combos
 * @returns {Object<string, ReturnType<typeof buildHomeDemoData>>} keyed by
 *   band name; a band with no qualifying 1. e4 line maps to null.
 */
function buildHomeDemoDataAllBands(combos) {
  const byBand = {};
  for (const band of HEADER_BAND_OPTIONS) {
    byBand[band] = buildHomeDemoData(combos, band);
  }
  return byBand;
}

/**
 * Renders the hero demo's <aside> plus its baked JSON data block and script
 * tag (spec section 2.3). Both are '' when heroDemo is null -- either this
 * particular indexPage() call didn't pass one (most existing tests, and any
 * build where buildHomeDemoData() above declined for the reasons in its own
 * comment), in which case indexPage() falls back to its earlier single-column
 * header with no board, no bundle, and no piece attribution added to the
 * footer.
 *
 * @param {ReturnType<typeof buildHomeDemoData>} heroDemo the DEFAULT band's
 *   data (HOME_DEMO_BAND) -- what the server-rendered markup below shows
 *   before any client JS runs, same progressive-enhancement shape as every
 *   other control on this site.
 * @param {Object<string, ReturnType<typeof buildHomeDemoData>>} [heroDemoAllBands]
 *   Craft-audit item 2: every band's own data (buildHomeDemoDataAllBands()),
 *   baked into the page's JSON payload so src/browser/homeDemo.client.js can
 *   switch the caption/replies/link to whichever band the visitor actually
 *   has persisted, instead of this demo staying locked to `heroDemo.band`
 *   regardless of the site-wide band control. Optional and defaults to just
 *   `heroDemo` itself under its own band key -- every existing caller that
 *   omits this argument keeps rendering a single-band demo exactly as
 *   before, just now also reachable (inertly) if a visitor's persisted band
 *   happens to already match `heroDemo.band`.
 * @returns {{asideHtml: string, dataScriptHtml: string}}
 */
function homeDemoMarkup(heroDemo, heroDemoAllBands = null) {
  if (!heroDemo) return { asideHtml: '', dataScriptHtml: '' };
  const introCaption = `${escapeHtml(heroDemo.band)} plays 1. ${escapeHtml(heroDemo.openingSan)} ${formatPct(heroDemo.openingPlayedPct)}% of the time. Your move.`;
  const repertoireHref = repertoireFragmentUrl(heroDemo.band, 'black');
  // sr-only h2 (accessibility pass): this aside was the page's
  // only section between <h1> and the first visible <h2> ("Start with your
  // rating band"), and cm-chessboard's Accessibility extension
  // (node_modules/cm-chessboard/src/extensions/accessibility/Accessibility.js,
  // hardcoded, not configurable) injects its own <h3 id="hl_form_...">Move
  // piece</h3> client-side inside #home-demo-board once the widget mounts --
  // with no h2 ancestor yet, that made Lighthouse's heading-order audit fail
  // (h1 -> h3, skipping a level) on every page carrying this hero demo.
  // Reusing the aside's own aria-label text as a visually-hidden real
  // heading fixes the sequence for real (h1 -> h2 -> h3) without changing
  // anything visible -- the aria-label itself is left in place too, since
  // removing it would drop the landmark's accessible name for AT that
  // doesn't expose heading-derived names for <aside> the same way. The
  // aria-label/h2 text never needs to change on a band switch: every
  // non-null byBand entry is, by buildHomeDemoData's own data-drift guard,
  // ALWAYS a 1. e4 line (a band whose top move isn't e4 is simply absent).
  const asideHtml = `<aside class="home-demo" aria-label="Try a real reply to 1. ${escapeHtml(heroDemo.openingSan)}">
        ${spriteDefsHtml()}
        <h2 class="sr-only">Try a real reply to 1. ${escapeHtml(heroDemo.openingSan)}</h2>
        <p id="home-demo-caption" class="home-demo-caption" role="status" aria-live="polite">${introCaption}</p>
        <div id="home-demo-board" class="home-demo-board-mount"></div>
        <p class="home-demo-actions">
          <a href="${escapeHtml(repertoireHref)}" id="home-demo-repertoire-link">See the full ${escapeHtml(heroDemo.band)} repertoire &rarr;</a>
          <button type="button" id="home-demo-reset" class="home-demo-reset">Reset</button>
        </p>
      </aside>`;
  const byBand = heroDemoAllBands || { [heroDemo.band]: { openingSan: heroDemo.openingSan, openingPlayedPct: heroDemo.openingPlayedPct, replies: heroDemo.replies } };
  const dataScriptHtml = `<script type="application/json" id="home-demo-data">${JSON.stringify({
    replies: heroDemo.replies, band: heroDemo.band, openingSan: heroDemo.openingSan, openingPlayedPct: heroDemo.openingPlayedPct, byBand,
  })}</script>
  <script src="home-demo.js" defer></script>`;
  return { asideHtml, dataScriptHtml };
}

// Product decision: the rating-band picker below is the homepage's single
// primary action -- repertoire lookup is the site's core value prop and
// existing traffic driver (now a single role=group pill control, not four
// accent-filled cards competing with
// unrelated nav cards on the same page -- see bandPickerHtml above). The
// drill card and openings cards (below) stay demoted to outline cards
// (card--outline) -- same link targets, lower visual weight; see
// design-standards.md 4.5's "one primary action per view". Openings cards
// additionally carry inline WDL data via renderOpeningStatCard. The hero
// demo's own single action (spec section 2.3's "one-accent-filled-action
// rule") is a plain text link, never a second filled button -- the band
// picker above stays the page's only accent-filled control.
function indexPage(contentEntries = [], drillFile = null, heroDemo = null, heroDemoAllBands = null) {
  const openingsSection = contentEntries.length > 0
    ? `<h2 class="section-lead">Openings by real win rate</h2>
    <p class="repertoire-intro">${contentEntries.length} openings, ranked by what they actually score in real games
       at each rating band - see <a href="openings.html">all openings &rarr;</a></p>
    <div class="card-grid">
      ${contentEntries
        .slice(0, 6)
        .map((e) => renderOpeningStatCard(e.openingConfig, e.model, 'card--outline', { bandAware: true }))
        .join('\n      ')}
    </div>`
    : '';

  const homeDescription = 'Which chess openings players at your rating actually play, and which of those picks actually win. Real win rates from millions of Lichess games.';
  const homeJsonLdBlock = homeJsonLd({ url: absoluteUrl(''), description: homeDescription });

  const pageHeadHtml = renderPageHead({
    title: 'The chess opening meta, by rating band',
    subtitle: 'Which openings players at your rating actually play, and how often those picks actually win. Every number on this site comes straight from real Lichess games.',
  });
  // Board Visibility spec section 2.3's placement: directly under the h1/
  // subtitle, above "Start with your rating band" -- text in the left
  // column, board in the right column at >=1024px (see SITE_CSS's
  // .home-hero-layout), stacked below that. Falls back to the plain
  // earlier plain header (no grid wrapper) when heroDemo is null.
  //
  // Site-audit item 2: startHereSection() (the real username-lookup form)
  // now renders HERE, inside home-hero-text right after the h1/subtitle --
  // the literal top of the page, ahead of the demo board in both the
  // 2-column desktop layout and the stacked mobile one -- rather than its
  // old position several sections further down. dataStripHtml/the
  // rating-band picker (both rendered later in this function, unchanged)
  // are now genuinely secondary content a visitor scrolls past the primary
  // CTA to reach, not before it.
  const { asideHtml: homeDemoAsideHtml, dataScriptHtml: homeDemoDataScriptHtml } = homeDemoMarkup(heroDemo, heroDemoAllBands);
  const heroHtml = homeDemoAsideHtml
    ? `<div class="home-hero-layout">
      <div class="home-hero-text">
        ${pageHeadHtml}
        ${startHereSection()}
      </div>
      ${homeDemoAsideHtml}
    </div>`
    : `${pageHeadHtml}
    ${startHereSection()}`;

  // Piece attribution (boardSvg.js's Cburnett SVG set, CC BY-SA 3.0) is
  // required only when the hero demo actually rendered a board -- same
  // convention every other board-bearing page on this site already
  // follows (see e.g. src/renderRepertoireExplorer.js's own footer line).
  const footerCredit = homeDemoAsideHtml
    ? `Data source: <a href="https://lichess.org/api" rel="noopener noreferrer">lichess.org/api</a>. ${pieceAttributionHtml()}`
    : 'Data source: <a href="https://lichess.org/api" rel="noopener noreferrer">lichess.org/api</a>.';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({
    title: `The Chess Opening Meta by Rating Band | ${SITE_NAME}`,
    description: homeDescription,
    canonical: absoluteUrl(''),
    jsonLd: homeJsonLdBlock,
    feedUrl: absoluteUrl('feed.xml'),
  })}
<body>
<div class="page">
  ${renderHeader(STATIC_NAV, 'home')}
  <main id="main-content">
    ${heroHtml}

    ${dataStripHtml(contentEntries)}

    <h2 id="rating-band">Or browse by rating band</h2>
    <p class="repertoire-intro">Openings behave differently at every rating. Pick your band - everything below is
       filtered to real games at that level.</p>
    <div class="home-band-picker">${bandPickerHtml()}</div>

    ${builderCtaSection()}

    ${packsCtaSection()}

    ${drillCtaSection(drillFile)}

    ${openingsSection}
  </main>
  ${renderFooter(footerCredit, LEGAL_LINKS)}
  ${homeDemoDataScriptHtml}
</div>
</body>
</html>
`;
}

function playerLookupPage() {
  const title = pageTitle('Player lookup');
  const description = 'Look up any Lichess username to see rating history and recent games, fetched live and rendered directly in your browser - no account or token needed.';
  const canonical = absoluteUrl('player.html');
  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical })}
<body>
<div class="page page--wide">
  ${renderHeader(STATIC_NAV, 'player')}
  <main id="main-content">
    <h1 class="page-title">Player lookup</h1>
    <p class="subtitle">Enter a Lichess username to view rating history and recent games. This runs
       entirely in your browser, calling Lichess&rsquo;s public API directly - no token
       needed and none is used.</p>
    <form id="lookup-form" class="lookup-form">
      <input type="text" id="username" name="username" placeholder="e.g. DrNykterstein" required>
      <button type="submit">View</button>
    </form>
    <div id="result"></div>
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api" rel="noopener noreferrer">lichess.org/api</a>, called directly from this page in your browser.', LEGAL_LINKS)}
  <script src="player-lookup.js"></script>
</div>
</body>
</html>
`;
}

// Default band+color repertoire.html server-renders into its markup (spec
// WS-3.2 section 2.1's binding rule) -- matches bandState.client.js's own
// DEFAULT_STATE and buildContent.js's DEFAULT_BAND, so "the default" means
// the same rating band everywhere on the site.
const REPERTOIRE_DEFAULT_BAND = '1600-1800';
const REPERTOIRE_DEFAULT_COLOR = 'white';

/**
 * Fetches all 8 (RATING_BANDS x white/black) repertoire trees -- same total
 * fetch volume as the old 8-separate-pages build, just no longer written to
 * 8 separate files. Migrated onto src/explorerSource.js inside
 * buildRepertoireTree() itself (src/buildRepertoire.js) -- see that
 * module's own header comment for the aggregate-first, live-API-fallback
 * design.
 *
 * @returns {Promise<Object<string, {ratingBand, color, opening, totals, tree}>>}
 *   keyed "<band>|<color>".
 */
async function buildRepertoireCombos({ fetchImpl = politeFetch } = {}) {
  const combos = {};
  for (const band of Object.keys(RATING_BANDS)) {
    for (const color of COLORS) {
      const data = await buildRepertoireTree({ ratingBand: band, color, fetchImpl });
      combos[`${band}|${color}`] = {
        ratingBand: data.ratingBand,
        color: data.color,
        opening: data.opening,
        totals: data.totals,
        tree: data.tree,
      };
    }
  }
  return combos;
}

/**
 * Writes the single collapsed repertoire.html (spec WS-3.2 section 2) plus
 * its client bundle. The default band+color is fully server-rendered into
 * the markup; every other combo this build fetched travels as baked JSON
 * for src/browser/repertoire.client.js to swap in client-side.
 *
 * @param {Object<string, object>} combos buildRepertoireCombos() output.
 * @returns {{file: string}}
 */
function writeRepertoirePage(combos) {
  const html = renderRepertoireExplorerPage({
    combos,
    defaultBand: REPERTOIRE_DEFAULT_BAND,
    defaultColor: REPERTOIRE_DEFAULT_COLOR,
    bandPickerHtml: bandPickerHtml(),
    nav: STATIC_NAV,
    legalLinks: LEGAL_LINKS,
    canonical: absoluteUrl('repertoire.html'),
    description: 'Explore chess opening repertoires by rating band and color: the moves players actually play at each ply, and how each one scores, from real Lichess games.',
  });
  fs.writeFileSync(path.join(OUT_DIR, 'repertoire.html'), html, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'repertoire.js'), buildRepertoireBundle(), 'utf8');
  return { file: 'repertoire.html' };
}

/**
 * Writes the 8 old repertoire-<band>-<color>.html files as redirect stubs
 * to the collapsed repertoire.html (spec WS-3.2 section 2.2) -- NEVER
 * deleted, since they're the only thing preserving inbound link equity to
 * URLs that may still be indexed/linked from elsewhere.
 *
 * @returns {Array<{band: string, color: string, file: string}>}
 */
function buildRedirectStubs() {
  const written = [];
  for (const band of Object.keys(RATING_BANDS)) {
    for (const color of COLORS) {
      const file = repertoireFileName(band, color);
      const targetPath = `/${repertoireFragmentUrl(band, color)}`;
      const html = renderRedirectStubPage({
        band,
        color,
        targetPath,
        canonicalUrl: absoluteUrl('repertoire.html'),
      });
      fs.writeFileSync(path.join(OUT_DIR, file), html, 'utf8');
      written.push({ band, color, file });
    }
  }
  return written;
}

/**
 * Copies data/aggregates/ (manifest.json + every shard it lists) verbatim
 * into dist/data/ -- spec WS-3.2 section 2.4, same
 * copy-verbatim-and-fail-loudly-if-missing shape as IDENTITY_ASSET_FILES/
 * FONT_ASSET_FILES above, except missing source data here is NOT a build
 * failure: this repo's first human-gated live dump ingest (WS-3 B2) hasn't
 * run yet, so data/aggregates/ legitimately doesn't exist on disk today
 * (see src/explorerSource.js's header comment for the full reasoning).
 * Ships only the shards the manifest actually lists, per spec 2.4's "ship
 * only shards the site actually references" -- today, that's zero pages
 * (WS-1.4's future general position explorer is what will actually fetch
 * from here client-side; see src/browser/repertoire.client.js's header
 * comment for why THIS page's own 8-combo swap uses inline baked JSON
 * instead). This step exists now so the plumbing is built, tested, and
 * ready the moment WS-3 B2 lands real data -- not dead code.
 *
 * @param {string} [aggregatesDir]
 * @returns {{copied: boolean, files: string[]}}
 */
function copyAggregateShardsToDist(aggregatesDir = AGGREGATES_DIR) {
  if (!aggregatesAvailable(aggregatesDir)) {
    return { copied: false, files: [] };
  }
  const dataOutDir = path.join(OUT_DIR, 'data');
  fs.mkdirSync(dataOutDir, { recursive: true });
  const manifestSrc = path.join(aggregatesDir, 'manifest.json');
  fs.copyFileSync(manifestSrc, path.join(dataOutDir, 'manifest.json'));
  const manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
  // Every returned path is 'data/'-prefixed and dist/-relative -- consistent
  // for both the manifest and every shard, so a caller (assertFilenamesUnique)
  // never mistakes 'data/manifest.json' for a top-level page.
  const files = ['data/manifest.json'];
  for (const shard of manifest.shards || []) {
    const shardSrc = path.join(aggregatesDir, shard.file);
    if (!fs.existsSync(shardSrc)) {
      throw new Error(`copyAggregateShardsToDist: manifest lists shard "${shard.file}" which is missing at ${shardSrc}`);
    }
    const shardDest = path.join(dataOutDir, shard.file);
    fs.mkdirSync(path.dirname(shardDest), { recursive: true });
    fs.copyFileSync(shardSrc, shardDest);
    files.push(path.join('data', shard.file).replace(/\\/g, '/'));
  }
  return { copied: true, files };
}

// data/rep/ (scripts/buildBandShards.js's committed output -- see that
// script's own header comment for why this is a committed source
// directory rather than a write straight into dist/) -- copied verbatim
// into dist/data/rep/ here, same convention as copyAggregateShardsToDist()
// just above for the (differently-sourced, differently-committed)
// data/aggregates/ dataset.
const REP_DATA_DIR = path.join(__dirname, '..', 'data', 'rep');

/**
 * Copies data/rep/ (WS-1 band-meta shards) verbatim into dist/data/rep/,
 * when it exists -- mirrors copyAggregateShardsToDist() above exactly,
 * except data/rep/ IS committed to git (spec section
 * 2.1: "Shard output is COMMITTED to the repo ... the deploy build must
 * not depend on a live crawl"), so a missing manifest here means the
 * crawler (scripts/buildBandShards.js) simply hasn't been run/committed
 * yet -- a no-op, not a build failure (same "expected until it's run"
 * reasoning as the aggregates copy above, and the same reasoning
 * scripts/verifyBandShards.js applies to its own missing-manifest check).
 *
 * @param {string} [repDir]
 * @returns {{copied: boolean, files: string[]}}
 */
function copyBandShardsToDist(repDir = REP_DATA_DIR) {
  const manifestSrc = path.join(repDir, 'manifest.json');
  if (!fs.existsSync(manifestSrc)) {
    return { copied: false, files: [] };
  }
  const repOutDir = path.join(OUT_DIR, 'data', 'rep');
  fs.mkdirSync(repOutDir, { recursive: true });
  fs.copyFileSync(manifestSrc, path.join(repOutDir, 'manifest.json'));
  const manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
  const files = ['data/rep/manifest.json'];
  for (const band of manifest.bands || []) {
    for (const shard of band.shards || []) {
      const shardSrc = path.join(repDir, shard.file);
      if (!fs.existsSync(shardSrc)) {
        throw new Error(`copyBandShardsToDist: manifest lists shard "${shard.file}" which is missing at ${shardSrc}`);
      }
      const shardDest = path.join(repOutDir, shard.file);
      fs.mkdirSync(path.dirname(shardDest), { recursive: true });
      fs.copyFileSync(shardSrc, shardDest);
      files.push(path.join('data', 'rep', shard.file).replace(/\\/g, '/'));
    }
  }
  return { copied: true, files };
}

/**
 * Reads back every file just written to outDir (recursively, including any
 * subdirectory -- e.g. a future nested output) and fails loudly if the
 * literal token string appears anywhere in it. This is the explicit,
 * automated check the task calls for, run both here (real build) and by
 * test/buildStatic.test.js (fake token, fake fetch, no live calls).
 */
function assertNoTokenLeak(outDir, token) {
  if (!token) return;
  const offenders = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes(token)) {
        offenders.push(path.relative(outDir, full));
      }
    }
  }
  walk(outDir);
  if (offenders.length > 0) {
    throw new Error(`Lichess API token leaked into generated static output: ${offenders.join(', ')}`);
  }
}

/**
 * Fails loudly if the literal string "PLACEHOLDER" appears anywhere in
 * dist/ (monetization-layer spec 1.4: "a test asserting no page in dist/
 * renders a literal PLACEHOLDER string"). This is what makes it safe for
 * render.js's STORE constant to carry sentinel PLACEHOLDER urls in source
 * -- src/renderPackPages.js's packCtaHtml() never emits STORE.packs[id] as
 * an href while it's still a placeholder (see isPlaceholderStoreUrl()), so
 * this check should always pass; it exists as the automated backstop, the
 * same role assertNoTokenLeak() plays for the Lichess API token above.
 */
function assertNoPlaceholderLeak(outDir) {
  const offenders = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.html')) continue;
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('PLACEHOLDER')) {
        offenders.push(path.relative(outDir, full));
      }
    }
  }
  walk(outDir);
  if (offenders.length > 0) {
    throw new Error(`Literal "PLACEHOLDER" string leaked into generated static output: ${offenders.join(', ')}`);
  }
}

/**
 * Fails loudly on any filename collision across every page this build
 * writes -- a content page slug colliding with a repertoire filename or
 * another content page would silently overwrite one of them otherwise.
 */
function assertFilenamesUnique(filenames) {
  const seen = new Map();
  for (const name of filenames) {
    seen.set(name, (seen.get(name) || 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  if (dupes.length > 0) {
    throw new Error(`Duplicate output filename(s) across the static build: ${dupes.join(', ')}`);
  }
}

async function buildStatic({ fetchImpl = politeFetch, useCache = true } = {}) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // WS-3.2: one repertoire.html (band+color picked client-side, default
  // server-rendered) instead of 8 separate pages, plus the 8 old filenames
  // kept alive as redirect stubs. Same total fetch volume as before --
  // buildRepertoireCombos() still fetches all 8 band x color trees.
  const repertoireCombos = await buildRepertoireCombos({ fetchImpl });
  const { file: repertoireFile } = writeRepertoirePage(repertoireCombos);
  const repertoireStubs = buildRedirectStubs();

  // Content pages (opening pages + hub) share the same rate-limited Explorer
  // endpoint, so they get the same politeFetch treatment, plus an on-disk
  // cache -- authoring this content means rebuilding many times, and each
  // rebuild would otherwise re-issue ~90 requests. `useCache: false` (wired
  // to --no-cache below) bypasses it for a forced refresh.
  const cachedFetchImpl = withExplorerCache(fetchImpl, { enabled: useCache });

  // Cheap (~2s, no network -- see src/ecoData.js) dataset parse, just to
  // size the "browse the full ECO index" link the openings hub links out
  // to below. buildEcoPages() (called later, after content pages) parses
  // the same vendored dataset again itself rather than taking this one as
  // a parameter -- keeps it usable/testable standalone -- the double parse
  // costs a couple of extra seconds, not a couple of extra Explorer requests.
  const ecoDatasetForLink = buildEcoDataset();
  const ecoFamilyIndexForLink = buildFamilyIndex(ecoDatasetForLink.lines);
  const ecoIndexLink = {
    href: ECO_INDEX_FILE,
    familyCount: ecoFamilyIndexForLink.length,
    lineCount: ecoDatasetForLink.stats.totalLines,
  };

  const { written: contentWritten, entries: contentEntries } = await buildContentPages({
    fetchImpl: cachedFetchImpl,
    outDir: OUT_DIR,
    nav: STATIC_NAV,
    drillPages: DRILL_PAGES,
    ecoIndexLink,
  });

  // Site-audit item 11 -- Compare Openings. Written here, right after
  // contentEntries is available, same "needs the already-fetched opening
  // data" reasoning as ecoIndexLink above. Own bundle (compare-openings.js),
  // not part of buildContentPages()'s own guide/hub bundling.
  fs.writeFileSync(path.join(OUT_DIR, 'compare-openings.html'), renderCompareOpeningsPage(contentEntries, { nav: STATIC_NAV }), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'compare-openings.js'), buildCompareOpeningsBundle(), 'utf8');

  // WS-1 (the WS-1 spec section 6.2's binding
  // shared-file mitigation): the four new placeholder pages, each wired to
  // its own renderer + bundle so the follow-on task that builds the real
  // surface (W1a/W2/W3) only ever edits that renderer/client-entry file,
  // never this one. See src/renderRepertoireBuilder.js's header comment
  // for the full reasoning, repeated identically by the other two
  // renderer modules.
  fs.writeFileSync(path.join(OUT_DIR, BUILDER_FILE), renderRepertoireBuilderPage({ nav: STATIC_NAV, legalLinks: LEGAL_LINKS }), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'repertoire-builder.js'), buildRepertoireBuilderBundle(), 'utf8');

  fs.writeFileSync(path.join(OUT_DIR, OPENING_REPORT_FILE), renderOpeningReportPage({ nav: STATIC_NAV, legalLinks: LEGAL_LINKS }), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'opening-report.js'), buildOpeningReportBundle(), 'utf8');

  fs.writeFileSync(path.join(OUT_DIR, DRILL_HUB_FILE), renderDrillHubPage({ nav: STATIC_NAV, legalLinks: LEGAL_LINKS }), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'drill-hub.js'), buildDrillHubBundle(), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, DRILL_REFERENCE_FILE), renderDrillReferencePage({ nav: STATIC_NAV, legalLinks: LEGAL_LINKS }), 'utf8');

  // WS-1 spec section 3.4 (task W4) -- one shared bundle, not tied to any
  // single page above: src/render.js's renderHeader() references
  // "band-header.js" by that literal filename on every page whose `active`
  // is in BAND_CONTROL_PAGES there (builder/player/drill placeholders
  // above, plus the pre-existing repertoire.html written later in this
  // function) -- so it's written once here, unconditionally.
  fs.writeFileSync(path.join(OUT_DIR, 'band-header.js'), buildBandHeaderControlBundle(), 'utf8');

  // The pages these four replace in the NAV become redirect stubs (spec
  // 3.2/3.3), never deleted -- their real content
  // (src/browser/playerLookup.client.js's rating-history/recent-games
  // lookup; src/buildDrill.js/src/renderDrill.js/src/browser/drill.client.js's
  // single-opening drill pilot) stays on disk, untouched, for the
  // follow-on tasks (W2/W3) to fold into or rebuild from -- see
  // src/renderOpeningReport.js and src/renderDrillHub.js's own header
  // comments.
  fs.writeFileSync(
    path.join(OUT_DIR, PLAYER_STUB_FILE),
    renderGenericRedirectStub({ linkText: 'Continue to the opening report', targetPath: `/${OPENING_REPORT_FILE}`, canonicalUrl: absoluteUrl(OPENING_REPORT_FILE) }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUT_DIR, DRILL_PILOT_STUB_FILE),
    renderGenericRedirectStub({ linkText: 'Continue to the opening drill', targetPath: `/${DRILL_HUB_FILE}`, canonicalUrl: absoluteUrl(DRILL_HUB_FILE) }),
    'utf8'
  );
  const drillFile = DRILL_HUB_FILE;

  // T1 family hub pages + T2 ECO volume/browse index pages (Phase 7d):
  // same rate-limited, cached Explorer endpoint, one request at a time,
  // ~256 requests total (see src/buildEcoPages.js's own header comment for
  // the exact budget). No dependency on contentWritten -- reads openings.js
  // only to find a T0 cross-link by name, never their files. drillPages is
  // the same DRILL_PAGES map buildContentPages above already uses (site-
  // audit item 5, 2026-08-26): lets a T1 family hub cross-link its matching
  // drill, when one exists, by the same exact-name match as its T0 link.
  const { written: ecoWritten } = await buildEcoPages({
    fetchImpl: cachedFetchImpl,
    outDir: OUT_DIR,
    nav: STATIC_NAV,
    drillPages: DRILL_PAGES,
  });

  // T3: the interactive ECO explorer (Phase 7e) -- zero Explorer API
  // requests (see src/buildEcoExplorer.js's own header comment), reuses the
  // dataset/family index already parsed above for the openings-hub link.
  // Also writes dist/eco-reverse-lookup.json, the one asset this static
  // build produces that a page fetch()es at runtime rather than inlining
  // (see src/ecoExplorerData.js's header comment).
  const ecoExplorerResult = buildEcoExplorerPage({
    dataset: ecoDatasetForLink,
    familyIndex: ecoFamilyIndexForLink,
    outDir: OUT_DIR,
    nav: STATIC_NAV,
  });
  fs.writeFileSync(path.join(OUT_DIR, 'eco-explorer.js'), buildEcoExplorerBundle(), 'utf8');

  // Repertoire Pack sales pages (monetization-layer spec, section 1.11
  // "M2 -- PACK PAGES"): the packs index + two pack detail pages, plus each
  // pack's free sample.pgn. Same cached/rate-limited Explorer fetch chain
  // as every other page above -- see src/buildPackPages.js's own header
  // comment for why this re-derives the tree rather than depending on
  // packs/<id>/pack.json (a local, gitignored, hand-run artifact) existing.
  const { written: packWritten } = await buildPackPages({
    fetchImpl: cachedFetchImpl,
    outDir: OUT_DIR,
    nav: STATIC_NAV,
    legalLinks: LEGAL_LINKS,
  });

  // Per-pack OG images: same "committed under assets/, copied verbatim,
  // fail loudly if missing" pattern as IDENTITY_ASSET_FILES below --
  // regenerate with `node scripts/build-og-image.js` and commit the result
  // whenever a pack's catalogue entry changes.
  const packOgAssetFiles = packWritten
    .filter((p) => p.slug !== 'repertoire-packs')
    .map((p) => packOgImageFilename(p.slug));
  for (const assetFile of packOgAssetFiles) {
    const src = path.join(ASSETS_DIR, assetFile);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing pack OG image ${src} -- run "node scripts/build-og-image.js" first.`);
    }
    fs.copyFileSync(src, path.join(OUT_DIR, assetFile));
  }

  // Board-visibility work -- reuses the SAME repertoireCombos
  // this build already fetched for repertoire.html (buildRepertoireCombos()
  // above), never a second fetch. buildHomeDemoData() returns null if the
  // data doesn't match the hero's hardcoded board position (its own doc
  // comment), in which case indexPage() below falls back to its earlier
  // header with no board/bundle at all.
  const homeDemoData = buildHomeDemoData(repertoireCombos);
  const homeDemoDataAllBands = buildHomeDemoDataAllBands(repertoireCombos);
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), indexPage(contentEntries, drillFile, homeDemoData, homeDemoDataAllBands), 'utf8');
  if (homeDemoData) {
    fs.writeFileSync(path.join(OUT_DIR, 'home-demo.js'), buildHomeDemoBundle(), 'utf8');
  }
  // player.html itself is now the redirect stub written earlier in this
  // function (spec 3.2) -- playerLookupPage()/buildPlayerLookupBundle()
  // stay exported (test/buildStatic.test.js exercises them directly) but
  // are no longer called from this build's main sequence; their real
  // rating-history/recent-games functionality is expected to move into
  // src/renderOpeningReport.js's real implementation, not be rebuilt from
  // scratch (see that file's own header comment).

  // Compliance pages: privacy policy, about, contact,
  // and an ads.txt stub. See src/renderCompliance.js for what each contains
  // and why (AdSense review requirements). nav omits these three from the top nav bar
  // deliberately -- they're reachable from every page's footer instead (via
  // LEGAL_LINKS above), matching how most sites treat legal/about pages.
  fs.writeFileSync(path.join(OUT_DIR, 'privacy.html'), renderPrivacyPage({ nav: STATIC_NAV, legalLinks: LEGAL_LINKS }), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'about.html'), renderAboutPage({ nav: STATIC_NAV, legalLinks: LEGAL_LINKS }), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'contact.html'), renderContactPage({ nav: STATIC_NAV, legalLinks: LEGAL_LINKS }), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'ads.txt'), adsTxtContent(), 'utf8');

  // /methodology.html (spec WS-3.3 section 3.5): the public page documenting
  // exactly how every displayed rate is computed. Loads the real manifest
  // when this build is sourced from data/aggregates/ (aggregatesAvailable(),
  // already imported above for the same reason buildContent.js/
  // explorerSource.js check it); null otherwise, which
  // renderMethodologyPage() renders as an honest live-Explorer-API-fallback
  // description rather than describing a dump pipeline this build never ran
  // (see that function's own doc comment).
  const methodologyManifest = aggregatesAvailable(AGGREGATES_DIR) ? loadAggregates({ dir: AGGREGATES_DIR }).manifest : null;
  fs.writeFileSync(
    path.join(OUT_DIR, 'methodology.html'),
    renderMethodologyPage({ nav: STATIC_NAV, manifest: methodologyManifest, thresholds: MISTAKE_THRESHOLDS, balancedEloWindow: BALANCED_ELO_WINDOW }),
    'utf8'
  );

  // 404 page: same header/nav/footer shell as every other page, noindex,
  // excluded from sitemap.xml (src/sitemap.js filters it out). GitHub Pages
  // serves this automatically for a custom domain (dist/CNAME above).
  fs.writeFileSync(
    path.join(OUT_DIR, '404.html'),
    render404Page({
      nav: STATIC_NAV,
      legalLinks: LEGAL_LINKS,
      // STATIC_NAV.repertoire used to alias the home page ('/') before
      // WS-3.2 gave repertoire.html a real, distinct URL -- the 404 page's
      // "Home" link must point at the actual site root now, not there.
      homeLink: '/',
      openingsLink: STATIC_NAV.openings,
      repertoireLink: repertoireFragmentUrl(DRILL_DEFAULT_BAND, 'white'),
    }),
    'utf8'
  );

  // Identity artwork (og-default.png, apple-touch-icon.png, favicon.svg):
  // committed under assets/ by scripts/build-og-image.js, copied verbatim
  // here on every build. Fails loudly if a file is missing rather than
  // silently shipping a site with no og:image -- run
  // `node scripts/build-og-image.js` once if this throws.
  for (const assetFile of IDENTITY_ASSET_FILES) {
    const src = path.join(ASSETS_DIR, assetFile);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing identity asset ${src} -- run "node scripts/build-og-image.js" first.`);
    }
    fs.copyFileSync(src, path.join(OUT_DIR, assetFile));
  }

  // Self-hosted heading webfont (see FONT_ASSET_FILES above) -- copied into
  // dist/fonts/ verbatim, matching the /fonts/fraunces-variable.woff2 path
  // render.js's @font-face and preload <link> both reference.
  const FONT_OUT_DIR = path.join(OUT_DIR, 'fonts');
  fs.mkdirSync(FONT_OUT_DIR, { recursive: true });
  for (const fontFile of FONT_ASSET_FILES) {
    const src = path.join(ASSETS_DIR, 'fonts', fontFile);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing font asset ${src} -- see assets/fonts/ and src/render.js's --font-serif comment.`);
    }
    fs.copyFileSync(src, path.join(FONT_OUT_DIR, fontFile));
  }
  // Custom domain for GitHub Pages. dist/ is gitignored and
  // regenerated fresh on every `npm run build:static` run, and its contents
  // are what actually gets pushed to the gh-pages branch GitHub Pages
  // serves from (confirmed by diffing dist/ against `git ls-tree gh-pages`
  // -- same flat file set at the branch root), so CNAME has to be written
  // here on every build rather than added once by hand, or it would be
  // silently wiped the next time this script runs. No trailing slash, no
  // scheme, no www -- GitHub Pages requires the bare domain string.
  fs.writeFileSync(path.join(OUT_DIR, 'CNAME'), 'Repertoire-Builder.com', 'utf8');
  // Same "written on every build or it gets silently wiped" reasoning as CNAME above.
  // Tells GitHub Pages not to run Jekyll over this output -- not load-bearing for the
  // Actions-based upload-pages-artifact/deploy-pages pipeline (which never invokes Jekyll),
  // but the legacy "deploy from a branch" path this project also uses does need it, and an
  // absent .nojekyll was found missing from a manually-pushed gh-pages branch update
  // (2026-08-14) precisely because it isn't part of this script's own output.
  fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '', 'utf8');
  // Cloudflare Pages header config (dist/_headers) -- see
  // src/renderCompliance.js's cloudflareHeadersContent() header comment for
  // what it sets and why. Same "written on every build or it gets silently
  // wiped" reasoning as CNAME/.nojekyll above; harmless on GitHub Pages
  // (which just serves it as an inert static file at /_headers) until the
  // Cloudflare Pages migration is DNS-live.
  fs.writeFileSync(path.join(OUT_DIR, '_headers'), cloudflareHeadersContent(), 'utf8');
  // IndexNow key-file proof of ownership (src/indexNow.js's own header
  // comment) -- same "written on every build or it gets silently wiped"
  // reasoning as CNAME/.nojekyll/_headers above.
  fs.writeFileSync(path.join(OUT_DIR, indexNowKeyFileName()), indexNowKeyFileContent(), 'utf8');

  // dist/data/ (spec WS-3.2 section 2.4): copies data/aggregates/ verbatim
  // when it exists (see copyAggregateShardsToDist()'s own header comment
  // for why "doesn't exist yet" is expected, not an error, today).
  const aggregateShardsResult = copyAggregateShardsToDist();

  // dist/data/rep/ (WS-1 band-meta shards, spec section 2.1): copies
  // data/rep/ verbatim when it exists -- see copyBandShardsToDist()'s own
  // header comment.
  const bandShardsResult = copyBandShardsToDist();

  const pageFilenames = [
    'index.html',
    PLAYER_STUB_FILE,
    DRILL_PILOT_STUB_FILE,
    BUILDER_FILE,
    OPENING_REPORT_FILE,
    DRILL_REFERENCE_FILE,
    'privacy.html',
    'about.html',
    'contact.html',
    'methodology.html',
    '404.html',
    drillFile, // DRILL_HUB_FILE
    repertoireFile,
    ...repertoireStubs.map((r) => r.file),
    ...contentWritten.map((c) => c.file),
    ...ecoWritten.map((e) => e.file),
    ecoExplorerResult.file,
    ...packWritten.map((p) => p.file),
    'compare-openings.html',
  ];

  // Non-.html files packWritten also causes to exist on disk (each pack's
  // free sample.pgn) -- tracked for the uniqueness check below but never
  // fed to the sitemap (buildSitemapEntries() already filters to
  // `.html` only).
  const packSampleFiles = packWritten
    .filter((p) => p.slug !== 'repertoire-packs')
    .map((p) => `repertoire-packs/${p.slug}-sample.pgn`);

  assertFilenamesUnique([
    ...pageFilenames,
    'repertoire-builder.js',
    'opening-report.js',
    'drill-hub.js',
    'band-header.js',
    'repertoire.js',
    'eco-explorer.js',
    'compare-openings.js',
    REVERSE_LOOKUP_FILE,
    'CNAME',
    '_headers',
    'ads.txt',
    'feed.xml',
    indexNowKeyFileName(),
    ...IDENTITY_ASSET_FILES,
    ...packOgAssetFiles,
    ...packSampleFiles,
    ...aggregateShardsResult.files,
    ...bandShardsResult.files,
  ]);
  assertNoTokenLeak(OUT_DIR, getApiToken());
  assertNoPlaceholderLeak(OUT_DIR);

  // Pack pages still carrying a STORE PLACEHOLDER url stay out of
  // sitemap.xml while noindex (spec 1.4/1.9) -- same treatment
  // src/sitemap.js already gives 404.html/REDIRECT_STUBS: a page a crawler
  // shouldn't index shouldn't be submitted for indexing either. Once real
  // merchant urls land, packWritten's own `noindex` flips false and these
  // rejoin the sitemap on the next build with no further code change.
  const noindexPackFiles = new Set(packWritten.filter((p) => p.noindex).map((p) => p.file));
  // Same treatment, one tier up: a T1 ECO family hub page whose main line
  // has too few games at every rating band today (buildEcoPages.js's own
  // `noindex` -- computed fresh each build from live Explorer data) stays
  // out of the sitemap until real numbers exist. Not a fixed list: any
  // family graduates automatically the moment its own game count clears
  // minGamesForPct at a single band, with no code change here.
  const noindexEcoFiles = new Set(ecoWritten.filter((e) => e.noindex).map((e) => e.file));
  // WS-1 placeholder pages carry `noindex` themselves (renderDocumentHead's
  // `noindex: true`, set by each renderer while its own module's
  // IS_PLACEHOLDER export is true) -- excluded from the sitemap for the
  // same reason as a still-PLACEHOLDER pack page just above. Each renderer
  // module's IS_PLACEHOLDER flips to false, independently, the moment its
  // own follow-on task ships the real page -- this file never changes
  // when that happens.
  const noindexPlaceholderFiles = new Set([
    ...(BUILDER_IS_PLACEHOLDER ? [BUILDER_FILE] : []),
    ...(OPENING_REPORT_IS_PLACEHOLDER ? [OPENING_REPORT_FILE] : []),
    ...(DRILL_HUB_IS_PLACEHOLDER ? [DRILL_HUB_FILE, DRILL_REFERENCE_FILE] : []),
  ]);
  const sitemapFilenames = pageFilenames.filter((f) => !noindexPackFiles.has(f) && !noindexPlaceholderFiles.has(f) && !noindexEcoFiles.has(f));

  // sitemap.xml / robots.txt (phase 3): generated from the actual list of
  // .html pages just written above, so they can't drift from what's really
  // on disk -- written last, after the uniqueness/token checks, so a
  // failed build never leaves a stale sitemap pointing at pages that
  // didn't actually get (re)written this run.
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), renderSitemapXml(sitemapFilenames), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'), robotsTxtContent(), 'utf8');

  // feed.xml: RSS for the content pages that actually get added/updated
  // over time (opening guides +
  // editorial articles from buildContentPages() above) -- NOT the
  // repertoire explorer pages (a fixed band/color grid, not "content" in
  // the publishing sense) and NOT the drill pilot (a single static page).
  // Built from the same `contentWritten` entries already used for the
  // sitemap, so it can't drift from what's really on disk either.
  fs.writeFileSync(path.join(OUT_DIR, 'feed.xml'), renderRssXml(contentWritten), 'utf8');

  return {
    outDir: OUT_DIR,
    repertoireFile,
    repertoireStubs,
    contentWritten,
    ecoWritten,
    ecoExplorerResult,
    packWritten,
    pageFilenames,
    aggregateShardsCopied: aggregateShardsResult.copied,
    bandShardsCopied: bandShardsResult.copied,
  };
}

async function main() {
  const useCache = !process.argv.includes('--no-cache');
  try {
    const { outDir, repertoireFile, repertoireStubs, contentWritten, ecoWritten, ecoExplorerResult, packWritten, aggregateShardsCopied, bandShardsCopied } = await buildStatic({ useCache });
    console.log(`Wrote static site to ${outDir}`);
    console.log(`  - index.html (links to the opening report + ${repertoireFile} + openings)`);
    console.log('  - repertoire-builder.html, opening-report.html, drill.html, drill-reference.html (WS-1 placeholder pages, noindex until each ships for real)');
    console.log('  - player.html, italian-game-drill.html (now redirect stubs to opening-report.html / drill.html)');
    console.log(`  - ${repertoireFile} + repertoire.js (collapsed rating-band repertoire explorer, band+color in the URL fragment)`);
    console.log(`  - ${repertoireStubs.length} redirect stubs for the old repertoire-<band>-<color>.html URLs`);
    console.log(aggregateShardsCopied ? '  - dist/data/ (copied from data/aggregates/)' : '  - dist/data/ skipped: no data/aggregates/ on disk yet (WS-3 B2 has not run)');
    console.log(bandShardsCopied ? '  - dist/data/rep/ (WS-1 band-meta shards, copied from data/rep/)' : '  - dist/data/rep/ skipped: no data/rep/ on disk yet (scripts/buildBandShards.js has not been run)');
    for (const { file } of repertoireStubs) {
      console.log(`  - ${file}`);
    }
    console.log(`  - ${contentWritten.length} content pages (opening pages + openings hub)`);
    for (const { file } of contentWritten) {
      console.log(`  - ${file}`);
    }
    console.log(`  - ${ecoWritten.length} ECO pages (T1 family hubs + T2 volume/browse indexes, Phase 7d)${ecoWritten.some((e) => e.noindex) ? ` -- ${ecoWritten.filter((e) => e.noindex).length} family hub(s) still noindex (main line has too few games at every rating band)` : ''}`);
    console.log(`  - ${ecoExplorerResult.file} + eco-explorer.js + ${ecoExplorerResult.reverseLookupFile} (interactive ECO explorer, Phase 7e, ${ecoExplorerResult.reverseLookupCount.toLocaleString()} reverse-lookup positions)`);
    console.log('  - compare-openings.html + compare-openings.js (Compare Openings tool, site-audit item 11)');
    console.log('  - privacy.html, about.html, contact.html, ads.txt (compliance pages)');
    console.log(`  - ${packWritten.length} Repertoire Pack pages (index + detail, M2)${packWritten.some((p) => p.noindex) ? ' -- at least one still noindex (STORE still carries a PLACEHOLDER url, see src/render.js)' : ''}`);
    for (const { file, noindex } of packWritten) {
      console.log(`  - ${file}${noindex ? ' (noindex)' : ''}`);
    }
    console.log('  - sitemap.xml, robots.txt (generated from the pages actually written above, noindex pack pages and ECO family hubs excluded)');
    console.log(`  - ${indexNowKeyFileName()} (IndexNow key-file proof of ownership, src/indexNow.js)`);
    console.log('Verified: no Lichess API token string appears in any generated file.');
    console.log('Verified: no literal "PLACEHOLDER" string appears in any generated file.');
    console.log('Verified: no filename collisions across the static build.');
    console.log('Open dist/index.html directly in a browser (file:// URL) -- no server needed.');
  } catch (err) {
    console.error('Static build failed:', err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildStatic,
  buildRepertoireCombos,
  writeRepertoirePage,
  buildRedirectStubs,
  copyAggregateShardsToDist,
  copyBandShardsToDist,
  buildPlayerLookupBundle,
  buildDrillBundle,
  buildRepertoireBundle,
  buildRepertoireBuilderBundle,
  buildOpeningReportBundle,
  buildDrillHubBundle,
  buildBandHeaderControlBundle,
  buildCompareOpeningsBundle,
  buildHomeDemoBundle,
  buildHomeDemoData,
  buildHomeDemoDataAllBands,
  bundleBrowserEntry,
  indexPage,
  playerLookupPage,
  repertoireFileName,
  repertoireFragmentUrl,
  bandPickerHtml,
  assertNoTokenLeak,
  assertNoPlaceholderLeak,
  assertFilenamesUnique,
  STATIC_NAV,
  LEGAL_LINKS,
  BUILDER_FILE,
  OPENING_REPORT_FILE,
  DRILL_HUB_FILE,
  DRILL_REFERENCE_FILE,
  PLAYER_STUB_FILE,
  DRILL_PILOT_STUB_FILE,
};
