'use strict';

/**
 * Real-browser regression coverage for src/browser/ecoExplorer.client.js's
 * search feature, specifically craft-audit item 5 (2026-08-28): the ~562KB
 * search line-index used to be baked inline into eco-explorer.html; it is
 * now fetched from its own external JSON asset (src/buildEcoExplorer.js's
 * LINE_INDEX_FILE) instead. A markup-only check (the config block carries
 * the right URL) cannot prove the fetch itself actually resolves and the
 * search UI actually uses the result -- this test proves that against a
 * REAL rendered page, the REAL esbuild bundle, and the REAL vendored ECO
 * dataset, served over a local HTTP server and driven with Playwright (same
 * pattern test/homeDemoClient.test.js already established).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const { buildEcoExplorerPage } = require('../src/buildEcoExplorer');
const { buildEcoDataset } = require('../src/ecoData');
const { buildFamilyIndex } = require('../src/ecoFamilies');
const { bundleBrowserEntry } = require('../src/buildStatic');
const { SITE_CSS_SHIPPED, SITE_CSS_FILE } = require('../src/render');
const { chromium } = require('playwright');

const NAV = { repertoire: '/', openings: 'openings.html', eco: 'eco-openings.html', player: 'player.html' };
const ECO_EXPLORER_ENTRY = path.join(__dirname, '..', 'src', 'browser', 'ecoExplorer.client.js');

function startServer() {
  const dataset = buildEcoDataset();
  const familyIndex = buildFamilyIndex(dataset.lines);
  const outDir = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'eco-explorer-client-test-'));
  const result = buildEcoExplorerPage({ dataset, familyIndex, nav: NAV, outDir });
  const bundle = bundleBrowserEntry(ECO_EXPLORER_ENTRY);

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/' || url === '/eco-explorer.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(result.html);
      return;
    }
    if (url === '/eco-explorer.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(bundle);
      return;
    }
    if (url === `/${result.lineIndexFile}`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(result.lineIndexJson);
      return;
    }
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

test('eco explorer search: the externally-fetched line index actually loads and searching "Najdorf" returns the real Sicilian Najdorf row', { timeout: 30000 }, async () => {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.locator('#explorer-board-mount svg.cm-chessboard').waitFor({ state: 'visible' });

    await page.locator('#explorer-search-input').fill('Najdorf');
    await page.waitForFunction(
      () => (document.getElementById('explorer-result-count').textContent || '').length > 0
        && !document.getElementById('explorer-result-count').textContent.includes('Loading'),
      { timeout: 5000 }
    );

    const resultCount = await page.locator('#explorer-result-count').textContent();
    assert.match(resultCount, /match/i, `expected a real match count, got: "${resultCount}"`);
    assert.doesNotMatch(resultCount, /unavailable/i, 'the fetch must have actually succeeded, not degraded to the failure message');

    const resultsText = await page.locator('#explorer-results').textContent();
    assert.match(resultsText, /Najdorf/, 'a real Najdorf row from the fetched line index must appear in the results table');
    assert.match(resultsText, /B9\d/, 'the Najdorf result should carry its real B9x ECO code');
  } finally {
    await browser.close();
    server.close();
  }
});

test('eco explorer search: clicking a real search result mounts that line on the board and updates the current-line status', { timeout: 30000 }, async () => {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.locator('#explorer-board-mount svg.cm-chessboard').waitFor({ state: 'visible' });

    await page.locator('#explorer-search-input').fill('Italian Game');
    await page.waitForFunction(
      () => (document.getElementById('explorer-results').textContent || '').includes('Italian Game'),
      { timeout: 5000 }
    );
    await page.locator('#explorer-results button.explorer-result-name', { hasText: 'Italian Game' }).first().click();

    await page.waitForFunction(
      () => (document.getElementById('explorer-current-line').textContent || '').includes('Italian Game'),
      { timeout: 5000 }
    );
    const currentLine = await page.locator('#explorer-current-line').textContent();
    assert.match(currentLine, /Italian Game/);
  } finally {
    await browser.close();
    server.close();
  }
});
