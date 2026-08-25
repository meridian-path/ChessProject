'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  packsIndexFilename,
  packDetailFilename,
  packSampleFilename,
  packOgImageFilename,
  boardFromFen,
  collectContentsRows,
  renderPacksIndexPage,
  renderPackDetailPage,
  renderLeakReportUpsell,
} = require('../src/renderPackPages');

const NAV = { home: '/', repertoire: 'repertoire.html', packs: packsIndexFilename() };
const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

test('filename helpers produce the spec-prescribed URLs', () => {
  assert.equal(packsIndexFilename(), 'repertoire-packs.html');
  assert.equal(packDetailFilename('white-1400-1600'), 'repertoire-packs/white-1400-1600.html');
  assert.equal(packSampleFilename('white-1400-1600'), 'repertoire-packs/white-1400-1600-sample.pgn');
  assert.equal(packOgImageFilename('white-1400-1600'), 'og-pack-white-1400-1600.png');
});

// ---------------------------------------------------------------------------
// boardFromFen
// ---------------------------------------------------------------------------

test('boardFromFen places pieces on the correct squares from a FEN placement field', () => {
  const board = boardFromFen(`${STARTING_FEN} w KQkq - 0 1`);
  assert.equal(board.a1, 'R');
  assert.equal(board.e1, 'K');
  assert.equal(board.e8, 'k');
  assert.equal(board.e4, undefined);
});

// ---------------------------------------------------------------------------
// collectContentsRows -- a small hand-built tree matching buildPack.js's
// own node shape (same fixture style as test/buildPack.test.js).
// ---------------------------------------------------------------------------

function ourNode(overrides) {
  return { fen: 'x', ply: 2, side: 'white', san: 'c3', uci: 'c2c3', n: 15000, w: 7500, d: 3000, l: 4500, score: 0.6, wilson: [0.55, 0.65], reach: 0.4, isOurMove: true, children: [], ...overrides };
}

function opponentNode(overrides) {
  return { fen: 'x', ply: 1, side: 'black', san: 'c5', uci: 'c7c5', n: 40000, w: 18000, d: 4000, l: 18000, score: 0.5, wilson: [0.49, 0.51], reach: 0.4, isOurMove: false, children: [], ...overrides };
}

test('collectContentsRows walks a White-pack tree (root is our own forced first move)', () => {
  const c5 = opponentNode({ children: [ourNode({})] });
  const e5 = opponentNode({ san: 'e5', uci: 'e7e5', n: 25000, reach: 0.25, children: [] });
  const root = { fen: STARTING_FEN, ply: 0, side: 'white', san: 'e4', uci: 'e2e4', n: null, score: null, wilson: null, reach: 1, isOurMove: true, children: [c5, e5] };

  const rows = collectContentsRows(root);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].opponentSan, 'c5');
  assert.equal(rows[0].ourSan, 'c3');
  assert.ok(Math.abs(rows[0].freq - 40000 / 65000) < 1e-9);
  assert.equal(rows[0].siblingGroup.length, 2);
  assert.equal(rows[1].opponentSan, 'e5');
  assert.equal(rows[1].ourSan, null, 'e5 has no children in this fixture -- the pack ends there');
});

test('collectContentsRows walks a Black-pack tree (root is White\'s fixed first move, our own first reply is forced/single)', () => {
  const whiteReply2 = opponentNode({ san: 'Nf3', uci: 'g1f3', side: 'white', ply: 2, n: 30000, children: [] });
  const ourReply1 = ourNode({ san: 'c5', uci: 'c7c5', side: 'black', ply: 1, isOurMove: true, children: [whiteReply2] });
  const root = { fen: STARTING_FEN, ply: 0, side: 'white', san: 'e4', uci: 'e2e4', n: null, score: null, wilson: null, reach: 1, isOurMove: false, children: [ourReply1] };

  const rows = collectContentsRows(root);
  // The first real branch point is White's SECOND move (Nf3 here), not the
  // fixed 1.e4 nor our own single forced 1...c5 reply -- see this module's
  // own collectContentsRows() doc comment.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].opponentSan, 'Nf3');
});

// ---------------------------------------------------------------------------
// Page rendering -- placeholder vs. real STORE url, escaping, structure.
// ---------------------------------------------------------------------------

function makePack(overrides) {
  const c5 = opponentNode({ children: [ourNode({})] });
  const root = { fen: STARTING_FEN, ply: 0, side: 'white', san: 'e4', uci: 'e2e4', n: null, score: null, wilson: null, reach: 1, isOurMove: true, children: [c5] };
  return {
    id: 'white-1400-1600',
    title: 'White at 1400-1600',
    color: 'white',
    band: '1400-1600',
    firstMoveUci: 'e2e4',
    firstMoveSan: 'e4',
    rootFen: `${STARTING_FEN} b KQkq - 0 1`,
    tree: root,
    lineCount: 391,
    positionCount: 812,
    thresholdUsed: 0.015,
    ruleVersion: '1',
    speeds: ['blitz', 'rapid'],
    retrieved: '2026-08-15',
    sampleLineCount: 47,
    storeUrl: 'https://PLACEHOLDER/l/rb-white-1400-1600',
    noindex: true,
    fileSizes: null,
    ...overrides,
  };
}

test('renderPackDetailPage never emits the literal PLACEHOLDER string while STORE is unset, and renders an honest pending CTA', () => {
  const pack = makePack({});
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.ok(!html.includes('PLACEHOLDER'), 'a placeholder STORE url must never reach rendered output');
  assert.ok(html.includes('Not listed for sale yet'));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(!html.includes('application/ld+json') || !html.includes('"@type":"Product"'), 'no Product JSON-LD for an unlisted pack');
});

test('renderPackDetailPage renders a real CTA + Product JSON-LD once STORE carries a real url, and drops noindex', () => {
  const pack = makePack({ storeUrl: 'https://repertoirebuilder.gumroad.com/l/rb-white-1400-1600', noindex: false });
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.ok(html.includes('href="https://repertoirebuilder.gumroad.com/l/rb-white-1400-1600"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('data-goatcounter-click="/out/pack-white-1400-1600"'));
  assert.ok(!html.includes('<meta name="robots" content="noindex">'));
  assert.ok(html.includes('"@type":"Product"'));
  assert.ok(html.includes('Get the pack'));
});

test('renderPackDetailPage carries no merchant JavaScript, no embedded checkout, no third-party payment script -- plain <a href> only (spec 1.4)', () => {
  const pack = makePack({ storeUrl: 'https://repertoirebuilder.gumroad.com/l/rb-white-1400-1600', noindex: false });
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.ok(!/gumroad\.com\/js|ko-fi\.com\/widget|checkout\.js/i.test(html));
});

test('renderPackDetailPage escapes untrusted-looking title content rather than emitting it raw', () => {
  const pack = makePack({ title: 'White <script>alert(1)</script>' });
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.ok(!html.includes('<script>alert(1)</script>'));
});

test('renderPackDetailPage prints real, generator-derived counts, never a hardcoded line count (spec 4.6)', () => {
  const pack = makePack({ lineCount: 217 });
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.ok(html.includes('217 lines'));
  assert.ok(!html.includes('612'), 'the spec\'s own illustrative 612 figure must never leak into real copy');
});

test('renderPacksIndexPage is asymmetric: the first pack is a full-width feature block, the rest are quiet rows (spec 1.6.4)', () => {
  const white = makePack({});
  const black = makePack({ id: 'black-vs-e4-1400-1600', title: 'Black vs 1.e4 at 1400-1600', color: 'black' });
  const html = renderPacksIndexPage({ packs: [white, black], nav: NAV });
  assert.ok(html.includes('pack-feature'));
  assert.ok(html.includes('pack-quiet-row'));
  // The feature block's own markup should come before the quiet row's in
  // document order -- White is packs[0] in the fixture above.
  assert.ok(html.indexOf('pack-feature') < html.indexOf('pack-quiet-row'));
});

test('renderPacksIndexPage: the before/after pitch statement renders before the pack list, not stacked with the other two pack-statement sections (site-audit item 4)', () => {
  const white = makePack({});
  const black = makePack({ id: 'black-vs-e4-1400-1600', title: 'Black vs 1.e4 at 1400-1600', color: 'black' });
  const html = renderPacksIndexPage({ packs: [white, black], nav: NAV });
  // Body only, not the whole page -- SITE_CSS's own selector text (e.g.
  // ".pack-feature-board" contains "pack-feature" as a substring) is present
  // in <style> unconditionally, so a whole-page substring/order check would
  // false-pass or false-fail on stylesheet rule order rather than real body
  // content order (same gotcha this file's other index-page tests already
  // guard against).
  const body = html.slice(html.indexOf('<body'));
  assert.ok(body.includes('pack-statement--pitch'));
  assert.ok(body.includes('what you study'));
  // Reads before the pack list (the pitch, then the price), and the pack
  // list itself sits between it and the free-guarantee/non-influence
  // statements -- never three consecutive same-archetype sections.
  const pitchIndex = body.indexOf('pack-statement--pitch');
  const featureIndex = body.indexOf('pack-feature');
  const gatedIndex = body.indexOf('Nothing here is gated');
  assert.ok(pitchIndex < featureIndex && featureIndex < gatedIndex);
});

test('renderPacksIndexPage gives a quiet-row pack its own direct buy link once it has a real store url', () => {
  // White (packs[0], the feature) also needs a real store url here --
  // otherwise its own CTA renders the --pending state, and the "exactly
  // one plain pack-cta" check below would trivially pass for the wrong
  // reason (zero, not one). Both assertions search only the <body>, not
  // the whole html string -- SITE_CSS's own .pack-cta--compact selector
  // text is present in <style> unconditionally, regardless of whether any
  // pack actually uses that class, so a whole-page substring check would
  // false-pass every time.
  const white = makePack({ storeUrl: 'https://repertoirebuilder.gumroad.com/l/blzarx', noindex: false });
  const black = makePack({ id: 'black-vs-e4-1400-1600', title: 'Black vs 1.e4 at 1400-1600', color: 'black', storeUrl: 'https://repertoirebuilder.gumroad.com/l/lyjgj', noindex: false });
  const html = renderPacksIndexPage({ packs: [white, black], nav: NAV });
  const body = html.slice(html.indexOf('<body'));
  // Both the existing "see what's in it" link AND a real, direct buy link
  // for the second pack, next to each other -- not a replacement, an
  // addition (a visitor who already wants this pack shouldn't need the
  // detail page first; one who wants to see the lines still can).
  assert.ok(body.includes('See what&rsquo;s in it'));
  assert.ok(body.includes('href="https://repertoirebuilder.gumroad.com/l/lyjgj"'));
  assert.ok(body.includes('class="pack-cta pack-cta--compact"'), 'the quiet row\'s own buy link should use the compact, never-accent-filled treatment');
  // Only packs[0]'s feature block gets the full accent-filled button --
  // the compact link must never carry that class alone (without the
  // --compact modifier), which would give the page two accent-filled
  // actions and break spec 1.6.4's one-hero-CTA rule.
  const ctaMatches = body.match(/class="pack-cta"/g) || [];
  assert.equal(ctaMatches.length, 1, 'exactly one plain (non-compact) pack-cta -- the feature block\'s own button');
});

test('renderPacksIndexPage: both the feature block\'s buy button and every quiet row\'s compact buy link carry GoatCounter\'s click-tracking attribute', () => {
  // Page-view analytics alone can't tell whether a visitor actually clicks
  // through to the merchant -- packCtaHtml() (shared by the detail page and
  // both index-page CTA shapes) already emits GoatCounter's own documented
  // data-goatcounter-click attribute (count.js, already loaded sitewide,
  // binds a click handler to any element carrying it -- no new script or
  // origin), so this only needed a regression test locking the index page's
  // own two buy buttons to that same behavior, not a new build.
  const white = makePack({ storeUrl: 'https://repertoirebuilder.gumroad.com/l/blzarx', noindex: false });
  const black = makePack({ id: 'black-vs-e4-1400-1600', title: 'Black vs 1.e4 at 1400-1600', color: 'black', storeUrl: 'https://repertoirebuilder.gumroad.com/l/lyjgj', noindex: false });
  const html = renderPacksIndexPage({ packs: [white, black], nav: NAV });
  const body = html.slice(html.indexOf('<body'));
  assert.match(body, /class="pack-cta" href="https:\/\/repertoirebuilder\.gumroad\.com\/l\/blzarx" rel="noopener noreferrer" data-goatcounter-click="\/out\/pack-white-1400-1600"/, 'the feature block\'s own accent-filled buy button must carry the click-tracking attribute');
  assert.match(body, /class="pack-cta pack-cta--compact" href="https:\/\/repertoirebuilder\.gumroad\.com\/l\/lyjgj" rel="noopener noreferrer" data-goatcounter-click="\/out\/pack-black-vs-e4-1400-1600"/, 'the quiet row\'s own compact buy link must carry the click-tracking attribute too');
});

test('renderPacksIndexPage renders no buy link at all for a quiet-row pack still carrying a PLACEHOLDER url', () => {
  const white = makePack({});
  const black = makePack({ id: 'black-vs-e4-1400-1600', title: 'Black vs 1.e4 at 1400-1600', color: 'black' }); // default fixture storeUrl is a PLACEHOLDER
  const html = renderPacksIndexPage({ packs: [white, black], nav: NAV });
  const body = html.slice(html.indexOf('<body')); // SITE_CSS's own .pack-cta--compact selector is always in <style>, unconditionally -- must not search the whole page
  assert.ok(body.includes('See what&rsquo;s in it'));
  assert.ok(!body.includes('pack-cta--compact'), 'nothing to buy yet -- no compact CTA, and no repeated "not listed for sale" noise on every quiet row');
});

// Regression (CI incident, dist/repertoire-packs.html failed html-validate's
// no-trailing-whitespace rule on the PR that introduced packPreviewHtml()):
// a template placeholder that CAN resolve to '' (packPreviewHtml() with an
// empty/short tree, packCtaHtml() in compact mode with a still-placeholder
// url, renderPackDetailPage()'s relatedLink with zero otherPacks) must never
// sit alone on its own indented template line -- when it does, the line's
// own leading whitespace survives as a whitespace-only line in the real
// rendered output, exactly the html-validate failure this test file's own
// header comment on renderFooter() already documents once before (see
// test/render.test.js). Same regex convention as that existing regression.
const NO_BLANK_LINE = /^[\t ]+\r?\n[\t ]*$/m;

test('renderPacksIndexPage: a quiet-row pack with a placeholder store url (empty packCtaHtml) and a same-day-thin tree (empty packPreviewHtml) leaves no whitespace-only line', () => {
  const white = makePack({});
  const thinBlack = makePack({
    id: 'black-vs-e4-1400-1600',
    title: 'Black vs 1.e4 at 1400-1600',
    color: 'black',
    // default fixture storeUrl is a PLACEHOLDER -- packCtaHtml(pack, true) returns ''
    tree: { fen: 'x', ply: 0, side: 'white', san: 'e4', uci: 'e2e4', n: null, score: null, wilson: null, reach: 1, isOurMove: true, children: [] },
  });
  const html = renderPacksIndexPage({ packs: [white, thinBlack], nav: NAV });
  assert.doesNotMatch(html, NO_BLANK_LINE);
});

test('renderPackDetailPage: zero otherPacks (empty relatedLink) leaves no whitespace-only line', () => {
  const pack = makePack({});
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.doesNotMatch(html, NO_BLANK_LINE);
});

test('renderPacksIndexPage is noindex only when every pack is still a placeholder', () => {
  const allPlaceholder = renderPacksIndexPage({ packs: [makePack({ noindex: true }), makePack({ id: 'b', noindex: true })], nav: NAV });
  assert.ok(allPlaceholder.includes('<meta name="robots" content="noindex">'));

  const oneLive = renderPacksIndexPage({ packs: [makePack({ noindex: false, storeUrl: 'https://real/x' }), makePack({ id: 'b', noindex: true })], nav: NAV });
  assert.ok(!oneLive.includes('<meta name="robots" content="noindex">'));
});

test('renderLeakReportUpsell renders nothing when no matching pack exists, and a text-only link (never accent-filled) when one does', () => {
  assert.equal(renderLeakReportUpsell(null), '');
  const html = renderLeakReportUpsell(makePack({}));
  assert.ok(html.includes('pack-upsell-link'));
  assert.ok(!html.includes('pack-cta'), 'the leak-report upsell must never carry the page\'s one accent-filled action');
});

test('every disclosed limitation ships on the pack detail page (spec 1.2 item 4 / 1.6.6)', () => {
  const pack = makePack({});
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.ok(html.includes('confidence interval uses a normal approximation'));
  assert.ok(html.includes('Not transposition-aware'));
  assert.ok(html.includes('blitz and rapid games only'));
  assert.ok(html.includes('not a claim that it is objectively the best move'));
});

test('disclosed limitations\' pool line is speeds-aware, not a hardcoded "blitz and rapid" literal -- a pack actually built from aggregate data (single-pool speeds) discloses that honestly, both in the limitations list and the generation-rule sentence', () => {
  const pack = makePack({ speeds: ['blitz'] });
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.ok(html.includes('Data pool is blitz games only'), 'expected the single-pool phrasing, not "blitz and rapid"');
  assert.ok(!html.includes('blitz and rapid games only'), 'must not claim rapid data this pack never drew from');
  assert.ok(html.includes('speeds blitz,'), 'generationRuleHtml\'s speeds sentence should also read the real single-pool value');
  assert.ok(
    html.includes('bullet, rapid and classical are excluded'),
    'the excluded-pools clause must name rapid too on a blitz-only build, not silently imply rapid is included (the redundant per-callsite ternary this replaced always said "classical and bullet")'
  );
});

// ---------------------------------------------------------------------------
// Broken-nav-link regression: pack detail pages live one directory deep
// (/repertoire-packs/<id>.html), the first pages on the site that do --
// every internal href on this page (nav, breadcrumb, footer, sister-pack
// cross-link, sample.pgn download) must resolve as a root-relative absolute
// path, never a bare page-relative filename (which resolves to a doubled,
// nonexistent /repertoire-packs/repertoire-packs/... path from this depth).
// ---------------------------------------------------------------------------

test('renderPackDetailPage: the breadcrumb link back to the packs index is root-relative, not page-relative', () => {
  const pack = makePack({});
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.match(html, /<a href="\/repertoire-packs\.html">Repertoire packs<\/a>/, 'breadcrumb must not link "repertoire-packs.html" (resolves to a doubled path from a page already inside /repertoire-packs/)');
});

test('renderPackDetailPage: the sister-pack cross-link is root-relative', () => {
  const pack = makePack({});
  const html = renderPackDetailPage({ pack, otherPacks: [{ id: 'black-vs-e4-1400-1600', title: 'Black vs 1.e4 at 1400-1600' }], nav: NAV });
  assert.match(html, /href="\/repertoire-packs\/black-vs-e4-1400-1600\.html">Also see:/);
  assert.doesNotMatch(html, /href="repertoire-packs\/black-vs-e4-1400-1600\.html"/, 'must not be a bare page-relative href -- would double up to /repertoire-packs/repertoire-packs/...');
});

test('renderPackDetailPage: the free sample.pgn download link is root-relative (this is the actual purchase-adjacent download that 404d in production)', () => {
  const pack = makePack({});
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.match(html, /href="\/repertoire-packs\/white-1400-1600-sample\.pgn" download/);
});

test('renderPackDetailPage: every nav link in the header is root-relative from this nested page', () => {
  const pack = makePack({});
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  assert.match(html, /href="\/repertoire\.html"/);
  assert.match(html, /href="\/repertoire-packs\.html"/);
});

test('renderPackDetailPage: every footer legal link is root-relative from this nested page', () => {
  const pack = makePack({});
  const legalLinks = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html' };
  const html = renderPackDetailPage({ pack, otherPacks: [], nav: NAV, legalLinks });
  assert.match(html, /href="\/privacy\.html">Privacy policy/);
  assert.match(html, /href="\/about\.html">About/);
  assert.match(html, /href="\/contact\.html">Contact/);
  assert.match(html, /href="\/methodology\.html">Methodology/);
});

test('the free guarantee and non-influence statements ship verbatim-in-substance on both page types', () => {
  const pack = makePack({});
  const detail = renderPackDetailPage({ pack, otherPacks: [], nav: NAV });
  const index = renderPacksIndexPage({ packs: [pack], nav: NAV });
  for (const html of [detail, index]) {
    assert.ok(html.includes('have no paid tier'));
    assert.ok(html.includes('Buying a pack changes nothing on this site') || html.includes('Buying this pack changes nothing'));
  }
});
