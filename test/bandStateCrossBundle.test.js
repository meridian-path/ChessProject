'use strict';

/**
 * Real-browser regression coverage for the cross-bundle band-state sync bug.
 * src/browser/bandState.client.js is required
 * separately by src/buildStatic.js's buildBandHeaderControlBundle()
 * (dist/band-header.js) and buildRepertoireBundle() (dist/repertoire.js) --
 * two SEPARATE esbuild entry points, so each gets its own independent copy
 * of that module's module-scoped `listeners` array. Every existing unit
 * test (test/bandState.test.js, test/bandHeaderControl.client.test.js)
 * exercises exactly one of those bundles at a time against a stubbed
 * `window`, so none of them could ever have caught a bug that only exists
 * when BOTH real bundles run together on the same real page. This test
 * serves the REAL rendered repertoire.html (src/renderRepertoireExplorer.js)
 * plus BOTH real esbuild bundles over a local HTTP server, exactly the way
 * repertoire.html loads them in production (src/render.js's renderHeader()
 * for 'repertoire' loads band-header.js; renderRepertoireExplorerPage loads
 * repertoire.js) -- same pattern test/homeDemoClient.test.js already
 * established for a real cm-chessboard mount, applied here to a real
 * cross-bundle interaction instead of a single bundle.
 *
 * Repro (pre-fix): selectOption() on the header's #site-band-select changes
 * the URL fragment and localStorage (bandState.client.js's writeBandState())
 * but #repertoire-subtitle-text/#repertoire-tree/.band-pill never repaint,
 * because writeBandState()'s notifyListeners() only reaches its OWN
 * bundle's (band-header.js's) module-scoped listeners, never
 * repertoire.js's separately-bundled onBandStateChange(paint) subscriber.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { buildRepertoireBundle, buildBandHeaderControlBundle, bandPickerHtml } = require('../src/buildStatic');
const { renderRepertoireExplorerPage } = require('../src/renderRepertoireExplorer');
const { SITE_CSS_SHIPPED, SITE_CSS_FILE } = require('../src/render');
const { chromium } = require('playwright');

// Two real-shaped combos (same shape buildRepertoireCombos() produces) --
// deliberately distinct games/ratingBand/opening data between the two so a
// stale-vs-fresh repaint is unambiguous from the rendered text alone.
const FIXTURE_COMBOS = {
  '1600-1800|white': {
    ratingBand: '1600-1800',
    color: 'white',
    opening: null,
    totals: { white: 5000, draws: 400, black: 4600 },
    tree: [{
      uci: 'e2e4', san: 'e4', mover: 'white', ply: 0,
      games: 6000, playedPct: 62.5, winPct: 44.8, drawPct: 4.1, lossPct: 51.1,
      children: [],
    }],
  },
  '1800-2000|white': {
    ratingBand: '1800-2000',
    color: 'white',
    opening: null,
    totals: { white: 9000, draws: 900, black: 8100 },
    tree: [{
      uci: 'd2d4', san: 'd4', mover: 'white', ply: 0,
      games: 11000, playedPct: 58.2, winPct: 47.2, drawPct: 5.4, lossPct: 47.4,
      children: [],
    }],
  },
};

function startServer() {
  const html = renderRepertoireExplorerPage({
    combos: FIXTURE_COMBOS,
    defaultBand: '1600-1800',
    defaultColor: 'white',
    bandPickerHtml: bandPickerHtml(),
    canonical: 'https://repertoire-builder.com/repertoire.html',
    description: 'test fixture',
  });
  const repertoireBundle = buildRepertoireBundle();
  const bandHeaderBundle = buildBandHeaderControlBundle();

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/' || url === '/repertoire.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    if (url === '/repertoire.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(repertoireBundle);
      return;
    }
    if (url === '/band-header.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(bandHeaderBundle);
      return;
    }
    // Craft-audit item 6: renderRepertoireExplorerPage() now links a shared
    // `/site.css` instead of inlining SITE_CSS (src/render.js's
    // SITE_CSS_FILE comment) -- serve it here too so the page renders the
    // same as production rather than unstyled.
    if (url === `/${SITE_CSS_FILE}`) {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(SITE_CSS_SHIPPED);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('cross-bundle regression: picking a different band in the site-wide HEADER control (band-header.js) actually repaints repertoire.html (repertoire.js) -- subtitle, totals, and tree all update', { timeout: 30000 }, async () => {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/repertoire.html`);

    // Both real bundles must actually have loaded before this proves
    // anything -- confirm the header control is present (band-header.js
    // ran) and the tree is server-rendered (repertoire.js's module scope
    // is live) before touching the control.
    await page.locator('#site-band-select').waitFor({ state: 'visible' });
    const initialSubtitle = await page.locator('#repertoire-subtitle-text').textContent();
    assert.equal(initialSubtitle, 'Rating band 1600-1800, playing as white');

    await page.selectOption('#site-band-select', '1800-2000');

    // The fragment/localStorage side effect (this part passed even before
    // the fix -- writeBandState() itself was never broken) --
    // confirms the header control's own write path ran.
    await page.waitForFunction(() => location.hash.indexOf('band=1800-2000') !== -1, { timeout: 5000 });

    // The actual regression: repertoire.js's onBandStateChange(paint)
    // subscriber, registered in a DIFFERENT bundle, must have received the
    // notification and repainted. Pre-fix, this hangs/times out because
    // the subtitle never changes from the 1600-1800 text asserted above.
    await page.waitForFunction(
      () => document.getElementById('repertoire-subtitle-text').textContent.indexOf('1800-2000') !== -1,
      { timeout: 5000 }
    );

    const subtitle = await page.locator('#repertoire-subtitle-text').textContent();
    assert.equal(subtitle, 'Rating band 1800-2000, playing as white');

    const totals = await page.locator('#repertoire-totals').textContent();
    assert.match(totals, /18,000 games played/, 'totals must repaint to the newly-selected band\'s numbers');

    const treeMove = await page.locator('#repertoire-tree .move-chip').first().textContent();
    assert.equal(treeMove, 'd4', 'the tree must repaint to the newly-selected band\'s moves (was e4)');
  } finally {
    await browser.close();
    server.close();
  }
});

test('cross-bundle regression: a browser back navigation after a header-control band change still repaints repertoire.html via the hashchange path', { timeout: 30000 }, async () => {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/repertoire.html`);
    await page.locator('#site-band-select').waitFor({ state: 'visible' });

    // history.replaceState (what writeBandState() uses) never fires
    // 'hashchange' -- so drive a real navigation entry via location.hash=
    // directly, the same way a real browser back/forward action does, to
    // confirm the pre-existing hashchange fallback still works for BOTH
    // bundles independently of the new cross-bundle bridge.
    await page.evaluate(() => { location.hash = 'band=1800-2000&pool=blitz&color=white'; });
    await page.waitForFunction(
      () => document.getElementById('repertoire-subtitle-text').textContent.indexOf('1800-2000') !== -1,
      { timeout: 5000 }
    );
    const subtitle = await page.locator('#repertoire-subtitle-text').textContent();
    assert.equal(subtitle, 'Rating band 1800-2000, playing as white');

    // The header <select> (a DIFFERENT bundle's own hashchange listener)
    // must also have re-synced to the same state.
    const selectValue = await page.locator('#site-band-select').inputValue();
    assert.equal(selectValue, '1800-2000');
  } finally {
    await browser.close();
    server.close();
  }
});
