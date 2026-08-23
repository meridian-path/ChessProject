'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderRedirectStubPage } = require('../src/render');
const { renderRepertoireExplorerPage } = require('../src/renderRepertoireExplorer');

function sampleCombos() {
  return {
    '1600-1800|white': {
      ratingBand: '1600-1800',
      color: 'white',
      opening: null,
      totals: { white: 60, draws: 20, black: 20 },
      tree: [
        { uci: 'e2e4', san: 'e4', ply: 0, mover: 'white', games: 100, playedPct: 80, winPct: 55.0, drawPct: 20.0, lossPct: 25.0, averageRating: 1650, children: null },
      ],
    },
    '1600-1800|black': {
      ratingBand: '1600-1800',
      color: 'black',
      opening: null,
      totals: { white: 45, draws: 15, black: 40 },
      tree: [],
    },
  };
}

test('renderRepertoireExplorerPage: server-renders the default combo\'s numbers directly into the markup (spec 2.1\'s binding rule)', () => {
  const html = renderRepertoireExplorerPage({
    combos: sampleCombos(),
    defaultBand: '1600-1800',
    defaultColor: 'white',
    bandPickerHtml: '<div class="band-picker" role="group" aria-label="test"></div>',
    canonical: 'https://repertoire-builder.com/repertoire.html',
    description: 'test description',
  });
  // Default totals (100 games, 60W/20D/20L) appear as real server-rendered text.
  assert.match(html, /100 games played from the starting position/);
  assert.match(html, /60W \/ 20D \/ 20L/);
  // The default tree's move (e4) is rendered directly into the markup, not only in JSON.
  assert.match(html, /move-chip--white">e4<\/span>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/repertoire\.html">/);
});

test('renderRepertoireExplorerPage: embeds every combo (not just the default) as #repertoire-data JSON, for client-side hydration', () => {
  const html = renderRepertoireExplorerPage({
    combos: sampleCombos(),
    defaultBand: '1600-1800',
    defaultColor: 'white',
    bandPickerHtml: '',
    canonical: 'https://repertoire-builder.com/repertoire.html',
  });
  const match = html.match(/<script type="application\/json" id="repertoire-data">([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected a #repertoire-data JSON block');
  const payload = JSON.parse(match[1]);
  assert.deepEqual(payload.default, { band: '1600-1800', color: 'white' });
  assert.ok(payload.combos['1600-1800|white']);
  assert.ok(payload.combos['1600-1800|black']);
  assert.equal(payload.combos['1600-1800|black'].totals.white, 45);
});

test('renderRepertoireExplorerPage: loads repertoire.js as a deferred script', () => {
  const html = renderRepertoireExplorerPage({
    combos: sampleCombos(),
    defaultBand: '1600-1800',
    defaultColor: 'white',
    bandPickerHtml: '',
    canonical: 'https://repertoire-builder.com/repertoire.html',
  });
  assert.match(html, /<script src="repertoire\.js" defer><\/script>/);
});

test('renderRepertoireExplorerPage: renders the synced board panel exactly once, with the sprite defs and a live region', () => {
  const html = renderRepertoireExplorerPage({
    combos: sampleCombos(),
    defaultBand: '1600-1800',
    defaultColor: 'white',
    bandPickerHtml: '',
    canonical: 'https://repertoire-builder.com/repertoire.html',
  });
  assert.match(html, /<aside class="repertoire-board-panel" aria-label="Board for the selected line">/);
  assert.match(html, /id="repertoire-board-mount"/);
  assert.match(html, /id="repertoire-board-hint"/);
  assert.match(html, /id="repertoire-board-status" class="sr-only" role="status" aria-live="polite"/);
  // The sprite wrapper (boardSvg.js's SPRITE_WRAPPER_ID) must appear
  // exactly once per page -- twice would mean two competing DOM ids.
  const spriteMatches = html.match(/id="cm-chessboard-sprite"/g) || [];
  assert.equal(spriteMatches.length, 1);
});

test('renderRepertoireExplorerPage: the board panel carries its own sr-only h2, ahead of where cm-chessboard injects an h3 at runtime', () => {
  const html = renderRepertoireExplorerPage({
    combos: sampleCombos(),
    defaultBand: '1600-1800',
    defaultColor: 'white',
    bandPickerHtml: '',
    canonical: 'https://repertoire-builder.com/repertoire.html',
  });
  const asideIndex = html.indexOf('<aside class="repertoire-board-panel"');
  const h2Index = html.indexOf('<h2 class="sr-only">Board for the selected line</h2>');
  const boardMountIndex = html.indexOf('<div id="repertoire-board-mount"');
  assert.ok(asideIndex !== -1, 'expected the repertoire-board-panel aside to be present');
  assert.ok(h2Index !== -1, 'expected an sr-only <h2> inside the board-panel aside');
  assert.ok(h2Index > asideIndex && h2Index < boardMountIndex, 'the h2 must sit inside the aside, before the board mount cm-chessboard writes its own h3 into');
});

test('renderRepertoireExplorerPage: the move tree is still fully server-rendered inside #repertoire-tree (progressive enhancement, not a JS prerequisite)', () => {
  const html = renderRepertoireExplorerPage({
    combos: sampleCombos(),
    defaultBand: '1600-1800',
    defaultColor: 'white',
    bandPickerHtml: '',
    canonical: 'https://repertoire-builder.com/repertoire.html',
  });
  assert.match(html, /<div id="repertoire-tree"><ul class="repertoire-tree">/);
  assert.match(html, /data-uci-path="e2e4"/);
});

test('renderRepertoireExplorerPage: throws a clear error if the default band+color has no matching combo', () => {
  assert.throws(
    () => renderRepertoireExplorerPage({
      combos: sampleCombos(),
      defaultBand: '2000+',
      defaultColor: 'white',
      bandPickerHtml: '',
    }),
    /no combo found for default/
  );
});

test('renderRedirectStubPage: ships exactly the 5 elements spec WS-3.2 section 2.2 calls for', () => {
  const html = renderRedirectStubPage({
    band: '1600-1800',
    color: 'white',
    targetPath: '/repertoire.html#band=1600-1800&color=white',
    canonicalUrl: 'https://repertoire-builder.com/repertoire.html',
  });
  // 1. instant meta refresh
  assert.match(html, /<meta http-equiv="refresh" content="0; url=\/repertoire\.html#band=1600-1800&amp;color=white">/);
  // 2. canonical link
  assert.match(html, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/repertoire\.html">/);
  // 3. noindex, follow (never bare noindex -- this is a real redirect source, not a dead page)
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  // 4. a real visible sentence and link for a human with JS/refresh disabled
  assert.match(html, /This page has moved\./);
  assert.match(html, /<a href="\/repertoire\.html#band=1600-1800&amp;color=white">/);
  // 5. a location.replace() script as a third belt
  assert.match(html, /<script>location\.replace\("\/repertoire\.html#band=1600-1800&color=white"\);<\/script>/);
});

test('renderRedirectStubPage: carries this site\'s baseline CSP/referrer meta tags (security-standards.md)', () => {
  const html = renderRedirectStubPage({
    band: '2000+',
    color: 'black',
    targetPath: '/repertoire.html#band=2000%2B&color=black',
    canonicalUrl: 'https://repertoire-builder.com/repertoire.html',
  });
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'none'">/);
  assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
});

test('renderRedirectStubPage: is a small, minimal document -- no full site stylesheet, GoatCounter, or AdSense script', () => {
  const html = renderRedirectStubPage({
    band: '1400-1600',
    color: 'white',
    targetPath: '/repertoire.html#band=1400-1600&color=white',
    canonicalUrl: 'https://repertoire-builder.com/repertoire.html',
  });
  assert.ok(!html.includes('goatcounter'), 'a redirect stub should not load analytics');
  assert.ok(!html.includes('adsbygoogle'), 'a redirect stub should not load ads');
  assert.ok(html.length < 1200, `expected a small stub document, got ${html.length} bytes`);
});
