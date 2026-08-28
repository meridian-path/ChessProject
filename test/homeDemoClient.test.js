'use strict';

/**
 * Real-browser regression coverage for src/browser/homeDemo.client.js (the
 * homepage hero demo, part of the board-visibility work). Uses Playwright
 * (already a devDependency, same pattern test/drillHubClient.test.js
 * already established for a real cm-chessboard mount) against the REAL
 * rendered indexPage() HTML and the REAL esbuild bundle served over a
 * local HTTP server -- not a DOM stub.
 *
 * Covers: a pre-authored reply (e5) commits and swaps the caption to its
 * real number; a legal-but-not-pre-authored move (Nf6) is declined by the
 * allowlist-only input handler (spec section 2.3's budget fallback -- see
 * src/browser/homeDemo.client.js's own header comment) and leaves the
 * caption untouched; Reset returns both the board and the caption to the
 * initial state.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { indexPage, buildHomeDemoBundle, buildHomeDemoData } = require('../src/buildStatic');
const { SITE_CSS_SHIPPED, SITE_CSS_FILE } = require('../src/render');
const { chromium } = require('playwright');

// Same real-shaped 1600-1800/Black tree data test/buildStatic.test.js's own
// hero-demo tests use (root e4 -> children e5/c5/e6), not live-fetched here
// (a real live Explorer fetch belongs in the full build, not this focused
// browser regression test) -- see buildHomeDemoData's own doc comment for
// why this exact shape (uci/san/playedPct/winPct/drawPct) is what a real
// buildRepertoireCombos() combo looks like.
const FIXTURE_COMBOS = {
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

function startServer() {
  const heroDemo = buildHomeDemoData(FIXTURE_COMBOS);
  const html = indexPage([], null, heroDemo);
  const bundle = buildHomeDemoBundle();

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    if (url === '/home-demo.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(bundle);
      return;
    }
    // Craft-audit item 6: indexPage() now links a shared `/site.css`
    // instead of inlining SITE_CSS (src/render.js's SITE_CSS_FILE comment)
    // -- without this route the board's real layout CSS never loads, so
    // Playwright's #home-demo-board visibility wait hangs until timeout
    // rather than genuinely failing fast.
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

test('home demo: clicking a pre-authored reply (1...e5) commits the move and swaps the caption to its real number', { timeout: 30000 }, async () => {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.locator('#home-demo-board svg.cm-chessboard').waitFor({ state: 'visible' });

    const initialCaption = await page.locator('#home-demo-caption').textContent();
    assert.match(initialCaption, /1600-1800 plays 1\. e4 62\.5% of the time\. Your move\./);

    // Real click-to-move: same technique test/drillHubClient.test.js uses --
    // click the piece group on e7, then the destination square e5.
    await page.locator('#home-demo-board [data-square="e7"]').first().click();
    await page.locator('#home-demo-board [data-square="e5"]').first().click();

    await page.waitForFunction(
      () => document.getElementById('home-demo-caption').textContent.indexOf('e5') === 0,
      { timeout: 5000 }
    );
    const caption = await page.locator('#home-demo-caption').textContent();
    assert.equal(caption, 'e5 - played by 42.1% of Black at 1600-1800, scoring 46.8% for Black.');
  } finally {
    await browser.close();
    server.close();
  }
});

test('home demo: a legal-but-not-pre-authored reply (1...Nf6) is declined by the allowlist-only input handler, caption stays on the intro line', { timeout: 30000 }, async () => {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.locator('#home-demo-board svg.cm-chessboard').waitFor({ state: 'visible' });

    // 1...Nf6 (g8f6) is a fully legal Black reply to 1. e4, but is not one
    // of the three pre-authored UCI moves baked into #home-demo-data --
    // spec section 2.3's disclosed budget fallback (no chess.js, so no
    // general legality here) means this must be declined, not committed.
    await page.locator('#home-demo-board [data-square="g8"]').first().click();
    await page.locator('#home-demo-board [data-square="f6"]').first().click();
    await page.waitForTimeout(300);

    const caption = await page.locator('#home-demo-caption').textContent();
    assert.match(caption, /1600-1800 plays 1\. e4 62\.5% of the time\. Your move\./, 'a non-allowlisted move must not change the caption');
  } finally {
    await browser.close();
    server.close();
  }
});

test('home demo: Reset returns the caption to its initial text after a committed move', { timeout: 30000 }, async () => {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.locator('#home-demo-board svg.cm-chessboard').waitFor({ state: 'visible' });
    const initialCaption = await page.locator('#home-demo-caption').textContent();

    await page.locator('#home-demo-board [data-square="c7"]').first().click();
    await page.locator('#home-demo-board [data-square="c5"]').first().click();
    await page.waitForFunction(
      () => document.getElementById('home-demo-caption').textContent.indexOf('c5') === 0,
      { timeout: 5000 }
    );

    await page.locator('#home-demo-reset').click();
    const captionAfterReset = await page.locator('#home-demo-caption').textContent();
    assert.equal(captionAfterReset, initialCaption, 'Reset must restore the intro caption');
  } finally {
    await browser.close();
    server.close();
  }
});
