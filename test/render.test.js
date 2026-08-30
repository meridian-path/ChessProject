'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SITE_CSS, SITE_CSS_SHIPPED, SITE_CSS_FILE, stripCssComments, DESIGN_TOKENS, THEME_ROLES, renderDocumentHead, renderNewsletterSignup, renderFooter, renderHeader, renderRepertoireTree, siteRelativeHref, HEADER_BAND_OPTIONS, HEADER_BAND_DEFAULT, BAND_CONTROL_PAGES, escapeHtml, displayName, displayNameText } = require('../src/render');
const { RATING_BANDS } = require('../src/processRepertoire');
const { BANDS: BAND_STATE_BANDS, DEFAULT_STATE: BAND_STATE_DEFAULT } = require('../src/browser/bandState.client');
const { hygieneOffenses } = require('../scripts/verifyAggregates');

// --- item 1(a): public-content hygiene, the <style> emission path ----------------
// Regression guard for the 6th occurrence of incident class
// public-repo-hygiene-leak (2026-08-27): SITE_CSS's own engineering-doc
// comments (design-standards.md references, internal spec/phase/WS series
// labels) were shipping straight into every page's View Source because
// nothing ever stripped comments before emission. stripCssComments() /
// SITE_CSS_SHIPPED close that; these tests fail loudly if either the strip
// itself or the swap-over at the <style> emission point ever regresses.

test('stripCssComments removes /* */ blocks and leaves no dangling whitespace-only lines', () => {
  const input = '  :root {\n    /* a real engineering note */\n    color: red;\n  }\n\n  /* another\n     multi-line\n     comment */\n  .foo { color: blue; }\n';
  const out = stripCssComments(input);
  assert.doesNotMatch(out, /\/\*/, 'no comment-open marker should remain');
  assert.doesNotMatch(out, /\*\//, 'no comment-close marker should remain');
  assert.doesNotMatch(out, /^[\t ]+$/m, 'no line should be whitespace-only after stripping');
  assert.match(out, /color: red;/);
  assert.match(out, /\.foo \{ color: blue; \}/);
});

test('stripCssComments leaves content:""/url() declarations and real rules intact', () => {
  assert.match(stripCssComments(SITE_CSS), /content:\s*"";/, 'a real content: "" declaration must survive comment-stripping');
  assert.match(stripCssComments(SITE_CSS), /--focus-ring-width:\s*3px;/, 'real token declarations must survive comment-stripping');
});

test('SITE_CSS_SHIPPED is comment-free and carries zero hygieneOffenses, even though the raw source-only SITE_CSS legitimately does', () => {
  assert.doesNotMatch(SITE_CSS_SHIPPED, /\/\*/, 'SITE_CSS_SHIPPED must never contain a CSS comment-open marker');
  assert.deepEqual(hygieneOffenses(SITE_CSS_SHIPPED), [], 'SITE_CSS_SHIPPED must carry zero internal-hygiene offenses -- this is what actually ships');
  // Not a hygiene bug: SITE_CSS's own SOURCE comments are real engineering
  // documentation and are expected to reference internal docs/labels -- see
  // stripCssComments()'s own doc comment in src/render.js. This assertion
  // exists only to make the SOURCE-vs-SHIPPED distinction explicit and
  // guard against someone "fixing" it by scrubbing the comments themselves.
  assert.ok(hygieneOffenses(SITE_CSS).length > 0, 'sanity check: the raw, source-only SITE_CSS is expected to carry real engineering-doc references');
});

test('renderDocumentHead links the shared, comment-free SITE_CSS_SHIPPED as an external stylesheet (craft-audit item 6), not an inline <style> block', () => {
  const html = renderDocumentHead('Test page');
  assert.match(html, new RegExp(`<link rel="stylesheet" href="/${SITE_CSS_FILE}">`), 'expected a link to the shared stylesheet');
  assert.doesNotMatch(html, /<style>[\s\S]*--color-accent[\s\S]*<\/style>/, 'SITE_CSS itself must no longer be inlined as a page <style> block');
});

// --- craft-audit instance 8, accepted item 3: sitewide straight-vs-curly
// apostrophe mix (433 straight/71 pages), root-caused to escapeHtml()
// applied to data-derived opening/family display names. displayName()/
// displayNameText() normalize any apostrophe preceded by a word character
// (Queen's, King's, Bird's, and a bare trailing possessive like Reynolds',
// Adams') to the typographic form, without touching escapeHtml() itself --
// see src/render.js's own doc comment for why that separation matters
// (attribute values, SVG title text, and JSON-LD all still need the plain
// ASCII apostrophe).

test('displayName converts a word-preceded apostrophe to &rsquo; while still escaping HTML-unsafe characters', () => {
  assert.equal(displayName("Queen's Gambit"), 'Queen&rsquo;s Gambit');
  assert.equal(displayName("King's Indian Defense"), 'King&rsquo;s Indian Defense');
  assert.equal(displayName('Bird\'s Opening & <Test>'), 'Bird&rsquo;s Opening &amp; &lt;Test&gt;');
});

test('displayName also converts a bare trailing possessive apostrophe (Reynolds\', Adams\') -- real opening names, not just the Queen\'s-shape', () => {
  assert.equal(displayName("Reynolds' Variation"), 'Reynolds&rsquo; Variation');
  assert.equal(displayName("Adams' Gambit"), 'Adams&rsquo; Gambit');
});

test('displayName leaves a non-apostrophe string and ordinary escapeHtml output untouched', () => {
  assert.equal(displayName('Sicilian Defense'), escapeHtml('Sicilian Defense'));
  assert.equal(displayName(''), '');
});

test('displayNameText converts an intra-word apostrophe to the literal curly character, matching escapeHtmlText\'s no-quote-escaping contract', () => {
  assert.equal(displayNameText("Queen's Gambit (D06): Win Rates by Rating"), 'Queen’s Gambit (D06): Win Rates by Rating');
  assert.equal(displayNameText('A & B'), 'A &amp; B');
});

// Regression guard for the specific <title> bug instance 8 found: escapeHtmlText()
// never escapes quotes at all (by design, for the html-validate title-length reason
// documented on that function), so a raw ASCII apostrophe used to reach <title> as a
// literal, straight character -- one of the audit's "58 raw ASCII apostrophes".
test('renderDocumentHead renders an intra-word apostrophe in <title> as the typographic character, not a straight one', () => {
  const html = renderDocumentHead("Queen's Gambit (D06): Win Rates by Rating");
  assert.match(html, /<title>Queen’s Gambit \(D06\): Win Rates by Rating<\/title>/);
  assert.doesNotMatch(html, /<title>[^<]*Queen's/);
});

// Regression coverage: the self-hosted Fraunces
// heading webfont must stay scoped to headings only, self-hosted (never a
// Google Fonts link), and preloaded -- these are all easy to silently
// regress in a large inline-CSS template literal with no other test
// touching it.

test('--font-serif leads with the self-hosted Fraunces Variable face and still falls back to a real serif stack', () => {
  const value = DESIGN_TOKENS['--font-serif'];
  assert.ok(value.startsWith('"Fraunces Variable"'), 'Fraunces Variable must be the first choice in --font-serif');
  assert.match(value, /serif"?,?\s*$|serif$/i, '--font-serif must still end in a generic serif fallback');
  assert.doesNotMatch(value, /fonts\.googleapis\.com|fonts\.gstatic\.com/, '--font-serif must never reference Google Fonts directly');
});

test('SITE_CSS declares an @font-face for Fraunces Variable, self-hosted with font-display: swap', () => {
  assert.match(SITE_CSS, /@font-face\s*\{[^}]*font-family:\s*'Fraunces Variable'/);
  assert.match(SITE_CSS, /@font-face\s*\{[^}]*font-display:\s*swap/);
  assert.match(SITE_CSS, /src:\s*url\('\/fonts\/fraunces-variable\.woff2'\)/, 'the font must be served from this site, not a third party');
  assert.doesNotMatch(SITE_CSS, /fonts\.googleapis\.com|fonts\.gstatic\.com/, 'SITE_CSS must never link Google Fonts directly');
});

test('SITE_CSS keeps --font-serif on headings (h1/h2/h3) only, and off body/UI/data elements', () => {
  assert.match(SITE_CSS, /h1,\s*h2,\s*h3\s*\{[^}]*font-family:\s*var\(--font-serif\)/, 'headings must use the display face');

  // Non-heading elements that used to (or could accidentally) share
  // --font-serif: chess move chips (UI), stat numerals (data), and prose
  // blockquotes (body copy) must all stay on --font-sans so reading/data
  // legibility can't regress when the display face is swapped in.
  const moveChipRule = SITE_CSS.match(/\.move-chip\s*\{[^}]*\}/);
  const statValueRule = SITE_CSS.match(/\.stat-value\s*\{[^}]*\}/);
  const blockquoteRule = SITE_CSS.match(/\.prose blockquote\s*\{[^}]*\}/);
  assert.ok(moveChipRule && statValueRule && blockquoteRule, 'expected all three rules to still exist in SITE_CSS');
  assert.match(moveChipRule[0], /font-family:\s*var\(--font-sans\)/);
  assert.match(statValueRule[0], /font-family:\s*var\(--font-sans\)/);
  assert.match(blockquoteRule[0], /font-family:\s*var\(--font-sans\)/);
});

test('renderDocumentHead preloads the self-hosted woff2 with crossorigin, before the shared stylesheet link', () => {
  const head = renderDocumentHead('Test Page');
  const preloadMatch = head.match(/<link rel="preload" href="\/fonts\/fraunces-variable\.woff2" as="font" type="font\/woff2" crossorigin>/);
  assert.ok(preloadMatch, 'expected a font preload link with as="font", type="font/woff2", and crossorigin');
  const styleLinkIndex = head.indexOf(`<link rel="stylesheet" href="/${SITE_CSS_FILE}">`);
  assert.ok(styleLinkIndex !== -1, 'expected a link to the shared stylesheet');
  assert.ok(head.indexOf(preloadMatch[0]) < styleLinkIndex, 'the font preload should come before the stylesheet link so the browser discovers it as early as possible');
});

// Security-standards.md "Headers" section: the CSP and referrer meta tags
// must appear exactly as specified, and GoatCounter must load over an
// explicit https scheme rather than protocol-relative.

test('renderDocumentHead ships the CSP meta tag exactly as the security standard specifies', () => {
  const head = renderDocumentHead('Test Page');
  assert.match(
    head,
    /<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'none'">/
  );
});

test('renderDocumentHead ships the strict-origin-when-cross-origin referrer meta tag', () => {
  const head = renderDocumentHead('Test Page');
  assert.match(head, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
});

test('renderDocumentHead loads the GoatCounter script over an explicit https scheme, not protocol-relative', () => {
  const head = renderDocumentHead('Test Page');
  assert.match(head, /src="https:\/\/gc\.zgo\.at\/count\.js"/);
  assert.doesNotMatch(head, /src="\/\/gc\.zgo\.at\/count\.js"/);
});

// Newsletter signup: wired to the real builtittheycome.substack.com
// publication (same publication as filetools and lol-practice-system).
// Regression coverage for the real-embed wiring -- easy to silently regress
// back to a broken <form action> pointed at Substack's /embed URL (which
// does not actually subscribe anyone) or to lose the lazy-load/escaping
// behavior in a large template-literal rewrite.

test('renderNewsletterSignup points the real embed slot at the exact builtittheycome.substack.com publication', () => {
  const html = renderNewsletterSignup();
  assert.match(html, /data-newsletter-src="https:\/\/builtittheycome\.substack\.com\/embed"/);
  assert.doesNotMatch(html, /<form[^>]*action="https:\/\/builtittheycome\.substack\.com/, 'must not POST to the Substack embed URL as a form action -- Substack has no such endpoint');
});

test('renderNewsletterSignup does not eagerly emit a live <iframe> -- the embed is created client-side only near the viewport', () => {
  const html = renderNewsletterSignup();
  assert.doesNotMatch(html, /<iframe/, 'an eagerly-rendered iframe on a sitewide footer would cost the Lighthouse Performance budget');
  assert.match(html, /data-newsletter-slot/);
});

test('renderNewsletterSignup provides a noscript fallback link to the real publication', () => {
  const html = renderNewsletterSignup();
  assert.match(html, /<noscript><p class="newsletter-description"><a href="https:\/\/builtittheycome\.substack\.com" target="_blank" rel="noopener noreferrer">Subscribe on Substack<\/a><\/p><\/noscript>/);
});

test('renderNewsletterSignup only assigns the iframe src client-side when it starts with https:// (no javascript:/data: scheme)', () => {
  const html = renderNewsletterSignup();
  assert.match(html, /if\(!src\|\|!\/\^https:\\\/\\\/\/\.test\(src\)\)return;/, 'the client-side loader must scheme-check data-newsletter-src before assigning it to iframe.src');
});

// Footer email signup polish: the Substack iframe carries the foreign
// publication name "I like to Build" and cannot be restyled from outside
// (cross-origin), and it painted an empty box during the load gap before
// this fix -- see docs/design/REFERENCE_LIBRARY.md-cited audit. Fix is a
// site-voiced lead-in naming the publication, plus real loading-state text
// so the reserved slot never reads as a blank rectangle before the widget
// arrives.

test('renderNewsletterSignup names the real Substack publication in the lead-in copy, so "I like to Build" is not unexplained once the widget loads', () => {
  const html = renderNewsletterSignup();
  assert.match(html, /&ldquo;I like to Build&rdquo;/);
});

test('renderNewsletterSignup renders real loading-state text in the reserved slot -- never an empty box during the load gap', () => {
  const html = renderNewsletterSignup();
  assert.match(html, /<div class="newsletter-embed newsletter-embed--loading"[^>]*>Loading sign-up form&hellip;<\/div>/);
});

test('renderNewsletterSignup: the client-side swap assigns the iframe only the base "newsletter-embed" class, dropping the loading-state class', () => {
  const html = renderNewsletterSignup();
  assert.match(html, /iframe\.className='newsletter-embed';/);
  assert.doesNotMatch(html, /iframe\.className='newsletter-embed newsletter-embed--loading'/);
});

// Donation identity consolidation: the footer used to link two donation
// platforms under two different handles (Ko-fi "flavaa", Buy Me a Coffee
// "dylanger254") -- a trust seam. Ko-fi is now the only linked donation
// platform on the live site.

test('renderFooter links only Ko-fi in the support-links block, never Buy Me a Coffee', () => {
  const html = renderFooter('footer copy');
  assert.match(html, /href="https:\/\/ko-fi\.com\/flavaa"[^>]*>&#9749; Support on Ko-fi<\/a>/);
  assert.doesNotMatch(html, /buymeacoffee\.com/);
  assert.doesNotMatch(html, /Buy Me a Coffee/);
});

// Regression: a legalLinks object missing `methodology` (some callers --
// src/renderEcoPages.js's ECO_LEGAL_LINKS, src/renderEcoExplorerPage.js's
// ECO_EXPLORER_LEGAL_LINKS -- carry privacy/about/contact but not
// methodology) used to leave a whitespace-only text node inside the
// <nav class="legal-links"> block, which html-validate's no-trailing-
// whitespace rule flags. Caught by running html-validate across the FULL
// dist/**/*.html output, not just the pages a task directly touches.
test('renderFooter: a legalLinks object missing methodology renders no blank line (no-trailing-whitespace safe)', () => {
  const html = renderFooter('footer copy', { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html' });
  const navMatch = html.match(/<nav class="legal-links"[^>]*>([\s\S]*?)<\/nav>/);
  const inner = navMatch[1];
  assert.doesNotMatch(inner, /^[\t ]+\r?\n[\t ]*$/m, 'no line inside the nav should contain only whitespace');
  assert.match(inner, /Privacy policy/);
  assert.match(inner, /About/);
  assert.match(inner, /Contact/);
  assert.doesNotMatch(inner, /Methodology/);
});

test('renderFooter: a legalLinks object WITH methodology renders the fourth link, still with no blank lines', () => {
  const html = renderFooter('footer copy', { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html' });
  const navMatch = html.match(/<nav class="legal-links"[^>]*>([\s\S]*?)<\/nav>/);
  const inner = navMatch[1];
  assert.doesNotMatch(inner, /^[\t ]+\r?\n[\t ]*$/m, 'no line inside the nav should contain only whitespace');
  assert.match(inner, /href="\/methodology\.html">Methodology<\/a>/);
});

// -----------------------------------------------------------------------
// renderHeader(): WS-1 spec section 3.4 (task W4), the site-wide band-
// persistence control. Three things worth a regression test: (1) it only
// appears on the pages BAND_CONTROL_PAGES names, never elsewhere -- a
// silent expansion would put a band picker on pages with no band-
// dependent numbers at all; (2) HEADER_BAND_OPTIONS/HEADER_BAND_DEFAULT
// (render.js's own hardcoded copies -- this file is deliberately a leaf
// module with zero requires, see its own top comment) never drift from
// processRepertoire.js's RATING_BANDS keys or bandState.client.js's BANDS/
// DEFAULT_STATE, which is what would actually break persistence if either
// source changed and this file's literals weren't updated to match;
// (3) the band-header.js bundle is only referenced on pages that actually
// render the control, never as dead weight on every page.
// -----------------------------------------------------------------------

test('renderHeader: HEADER_BAND_OPTIONS never drifts from processRepertoire.js RATING_BANDS or bandState.client.js BANDS/DEFAULT_STATE', () => {
  assert.deepEqual(HEADER_BAND_OPTIONS, Object.keys(RATING_BANDS), 'render.js HEADER_BAND_OPTIONS must match processRepertoire.js RATING_BANDS keys exactly, same order');
  for (const band of HEADER_BAND_OPTIONS) {
    assert.ok(BAND_STATE_BANDS.includes(band), `HEADER_BAND_OPTIONS entry "${band}" must be one of bandState.client.js's own BANDS`);
  }
  assert.equal(HEADER_BAND_DEFAULT, BAND_STATE_DEFAULT.band, 'HEADER_BAND_DEFAULT must match bandState.client.js DEFAULT_STATE.band exactly, or the server-rendered <select> would silently disagree with the client default');
});

test('renderHeader: renders the band control with all four options, the default selected, and its own script, only for pages in BAND_CONTROL_PAGES', () => {
  for (const active of BAND_CONTROL_PAGES) {
    const html = renderHeader({ builder: 'a.html', player: 'b.html', repertoire: 'c.html', drill: 'd.html' }, active);
    assert.match(html, /<select id="site-band-select" class="band-header-select" data-band-header-control/, `active="${active}" should render the band control`);
    for (const band of HEADER_BAND_OPTIONS) {
      assert.match(html, new RegExp(`<option value="${band.replace('+', '\\+')}"[^>]*>${band.replace('+', '\\+')}</option>`), `active="${active}" should offer band option ${band}`);
    }
    assert.match(html, new RegExp(`<option value="${HEADER_BAND_DEFAULT}" selected>`), `active="${active}" should pre-select the default band`);
    assert.match(html, /<script src="band-header\.js" defer><\/script>/, `active="${active}" should load band-header.js`);
  }
});

test('renderHeader: omits the band control and its script entirely for a page not in BAND_CONTROL_PAGES', () => {
  for (const active of ['openings', 'eco', 'guides', 'faq', 'packs', null]) {
    const html = renderHeader({ builder: 'a.html', openings: 'e.html', faq: 'f.html' }, active);
    assert.doesNotMatch(html, /band-header-control|data-band-header-control/, `active="${active}" must not render the band control`);
    assert.doesNotMatch(html, /band-header\.js/, `active="${active}" must not load band-header.js`);
  }
});

test('renderHeader: band control markup is well-formed regardless of which nav keys are present (server.js\'s 2-key nav)', () => {
  const html = renderHeader({ player: '/', repertoire: '/repertoire' }, 'player');
  assert.match(html, /data-band-header-control/);
  assert.match(html, /aria-label="Rating band, remembered for your next visit"/);
});

// -----------------------------------------------------------------------
// renderRepertoireTree/renderRepertoireNode -- the Explorer synced board
// panel's data plumbing (task B1). Every row is a real <button> carrying
// its own full data-uci-path from the tree root, so
// src/browser/repertoire.client.js can replay it through
// chessPosition.js's applyUciMoves()/fenFromBoard() with no chess engine.
// -----------------------------------------------------------------------

function sampleRepertoireTree() {
  return [
    {
      uci: 'e2e4', san: 'e4', ply: 0, mover: 'white', games: 100, playedPct: 80,
      winPct: 55.0, drawPct: 20.0, lossPct: 25.0, averageRating: 1650,
      children: [
        {
          uci: 'e7e5', san: 'e5', ply: 1, mover: 'black', games: 60, playedPct: 60,
          winPct: 30.0, drawPct: 20.0, lossPct: 50.0, averageRating: 1640,
          children: null,
        },
      ],
    },
  ];
}

test('renderRepertoireTree: each row is a real <button>, not a div, with aria-pressed="false" by default', () => {
  const html = renderRepertoireTree(sampleRepertoireTree());
  assert.match(html, /<button type="button" class="rep-node-row" aria-pressed="false"/);
  assert.doesNotMatch(html, /<div class="rep-node-row">/);
});

test('renderRepertoireTree: data-uci-path is the full space-joined UCI path from the tree root, per node', () => {
  const html = renderRepertoireTree(sampleRepertoireTree());
  assert.match(html, /data-uci-path="e2e4"/, 'the root move\'s own path is just its own uci');
  assert.match(html, /data-uci-path="e2e4 e7e5"/, 'the child\'s path is the root\'s uci plus its own');
});

test('renderRepertoireTree: data-san and data-ply are emitted per row', () => {
  const html = renderRepertoireTree(sampleRepertoireTree());
  assert.match(html, /data-san="e4" data-ply="0"/);
  assert.match(html, /data-san="e5" data-ply="1"/);
});

test('renderRepertoireTree: an empty tree still renders the empty-state message, not a broken button', () => {
  const html = renderRepertoireTree([]);
  assert.match(html, /class="empty-note"/);
  assert.doesNotMatch(html, /rep-node-row/);
});

// -----------------------------------------------------------------------
// The two new design tokens this task authorised (design-standards.md /
// the Board Visibility spec section 3): --color-selected-bg and
// --board-sticky-max. No other new tokens.
// -----------------------------------------------------------------------

test('DESIGN_TOKENS: --board-sticky-max is the one new global token, a vh value', () => {
  assert.equal(DESIGN_TOKENS['--board-sticky-max'], '38vh');
});

test('THEME_ROLES: --color-selected-bg is defined for both themes and distinct from --color-hover at the same accent percentage', () => {
  assert.match(THEME_ROLES.light['--color-selected-bg'], /color-mix\(in oklch, var\(--color-accent\) 16%, transparent\)/);
  assert.match(THEME_ROLES.dark['--color-selected-bg'], /color-mix\(in oklch, var\(--color-accent\) 24%, transparent\)/);
  assert.notEqual(THEME_ROLES.light['--color-selected-bg'], THEME_ROLES.light['--color-hover']);
  assert.notEqual(THEME_ROLES.dark['--color-selected-bg'], THEME_ROLES.dark['--color-hover']);
});

// -----------------------------------------------------------------------
// siteRelativeHref() / renderHeader() / renderFooter(): the fix for the
// broken-nav-link incident on the Repertoire Pack detail pages (the first
// pages nested one directory deep, /repertoire-packs/<id>.html). Every nav/
// legal-link filename constant (buildStatic.js's STATIC_NAV/LEGAL_LINKS and
// siblings) is a bare page-relative filename with no leading slash -- only
// correct from a page at the site root. renderHeader()/renderFooter() must
// normalize every one of those to a root-relative absolute path so the same
// nav/footer markup works unchanged from any page depth.
// -----------------------------------------------------------------------

test('siteRelativeHref prepends a leading slash to a bare page-relative filename', () => {
  assert.equal(siteRelativeHref('eco-openings.html'), '/eco-openings.html');
  assert.equal(siteRelativeHref('repertoire-packs/white-1400-1600-sample.pgn'), '/repertoire-packs/white-1400-1600-sample.pgn');
});

test('siteRelativeHref is a no-op for values that are already correct as-is (no double slash)', () => {
  assert.equal(siteRelativeHref('/'), '/');
  assert.equal(siteRelativeHref('/repertoire'), '/repertoire');
  assert.equal(siteRelativeHref('/opening-report.html'), '/opening-report.html');
  assert.equal(siteRelativeHref('https://example.com/x'), 'https://example.com/x');
  assert.equal(siteRelativeHref('http://example.com/x'), 'http://example.com/x');
  assert.equal(siteRelativeHref('//example.com/x'), '//example.com/x');
  assert.equal(siteRelativeHref('#section'), '#section');
});

test('siteRelativeHref passes through falsy values unchanged', () => {
  assert.equal(siteRelativeHref(''), '');
  assert.equal(siteRelativeHref(undefined), undefined);
  assert.equal(siteRelativeHref(null), null);
});

test('renderHeader renders every STATIC_NAV-style (bare filename) nav link as a root-relative absolute href, and the brand/home link too', () => {
  const nav = { home: '/', builder: 'repertoire-builder.html', player: 'opening-report.html', repertoire: 'repertoire.html', packs: 'repertoire-packs.html', openings: 'openings.html', eco: 'eco-openings.html', drill: 'drill.html', guides: 'guides.html', faq: 'chess-opening-faq.html' };
  const html = renderHeader(nav, 'packs');
  // Site-audit item 1: NAV_ORDER collapsed to these 5
  // -- 'builder'/'repertoire'/'eco'/'faq' are still valid STATIC_NAV keys
  // (other pages link to them directly) but must NOT render as top-nav links
  // any more, even when present in the nav object passed in.
  for (const key of ['player', 'packs', 'openings', 'drill', 'guides']) {
    assert.match(html, new RegExp(`href="/${nav[key]}"`), `nav.${key} must render with a leading slash so it resolves correctly from a page nested one directory deep`);
  }
  for (const key of ['builder', 'repertoire', 'eco', 'faq']) {
    assert.doesNotMatch(html, new RegExp(`href="/${nav[key]}"`), `nav.${key} was dropped from the top nav by the site-audit item 1 collapse and must not render`);
  }
  assert.match(html, /class="brand" href="\/"/, 'the brand/home link must resolve to the real site root, not a page-relative "/"');
});

test('renderHeader leaves an already-absolute nav object (server.js\'s SERVER_NAV) unchanged -- no double slash', () => {
  const html = renderHeader({ player: '/', openings: '/repertoire' }, 'player');
  // No nav.home in this 2-key server nav -- the brand link falls back to
  // nav.openings (render.js's own `nav.home || nav.openings || nav.repertoire
  // || '/'`), which is already absolute and must render unchanged.
  assert.match(html, /class="brand" href="\/repertoire"/);
  assert.match(html, /href="\/repertoire">Explore/);
  assert.match(html, /href="\/" aria-current="page">My report/);
  assert.doesNotMatch(html, /href="\/\//, 'must never double up a leading slash');
});

test('renderFooter renders every legalLinks value as a root-relative absolute href', () => {
  const html = renderFooter('footer copy', { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html' });
  assert.match(html, /href="\/privacy\.html">Privacy policy/);
  assert.match(html, /href="\/about\.html">About/);
  assert.match(html, /href="\/contact\.html">Contact/);
  assert.match(html, /href="\/methodology\.html">Methodology/);
});
