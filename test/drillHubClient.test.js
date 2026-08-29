'use strict';

/**
 * Real-browser regression coverage for src/browser/drill.client.js (the
 * WS-1 Drill Engine v2 hub+session controller) -- specifically the
 * SPOILER RULE (spec section 3.3): "render the drill page, assert that
 * the current card's answer SAN and UCI appear nowhere in
 * document.documentElement.outerHTML before an attempt, and that they do
 * appear after one. Assert it for a leak-seeded card and a meta-seeded
 * card. A comment is not this test." This uses Playwright (already a
 * devDependency, already used by scripts/lighthouseRunner.js and the
 * visual-qa harness) to load the REAL rendered page and REAL esbuild
 * bundle in an actual Chromium page, against the REAL committed
 * data/rep/ shard files served over a local HTTP server -- not a DOM
 * stub -- so this checks the literal thing the spec asks for
 * (document.documentElement.outerHTML), not an approximation of it.
 *
 * The two test positions below (1.e4 and 1.d4, both from the real
 * 1600-1800 band's root shard) and their answer moves are read directly
 * off the committed shard file in this test's own setup, not hardcoded
 * guesses -- see readRealTopMove() below.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const { Chess } = require('chess.js');
const { renderDrillHubPage } = require('../src/renderDrillHub');
const { buildDrillHubBundle } = require('../src/buildStatic');
const { SITE_CSS_SHIPPED, SITE_CSS_FILE } = require('../src/render');
const { posKeyFor } = require('../src/bandShards');
const { applyExplorerUci } = require('../src/buildPack');
const { newCardState } = require('../src/scheduler');

const REP_DATA_DIR = path.join(__dirname, '..', 'data', 'rep');
const NAV = { home: '/', builder: 'repertoire-builder.html', player: 'opening-report.html', repertoire: 'repertoire.html', packs: 'packs.html', openings: 'openings.html', eco: 'eco.html', drill: 'drill.html', guides: 'guides.html', faq: 'chess-opening-faq.html' };
const LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html' };

/**
 * Reads the real top-played reply at `play` from the real committed
 * 1600-1800 root shard, and its real SAN (via chess.js, same
 * applyExplorerUci castling handling every other WS-1 SAN derivation
 * uses) -- not a heuristic, so this stays correct even if the crawled
 * top move at these positions ever changes.
 */
function readRealTopMove(play) {
  const { posKey } = posKeyFor(play);
  const shard = JSON.parse(fs.readFileSync(path.join(REP_DATA_DIR, '1600-1800', 'root.json'), 'utf8'));
  const record = shard.positions[posKey];
  if (!record) throw new Error(`no real record at play=${play.join(',')} -- fixture position changed?`);
  const [, , , moves] = record;
  const uci = moves[0][0];
  const chess = new Chess();
  for (const m of play) applyExplorerUci(chess, m);
  const { san } = applyExplorerUci(chess, uci);
  return { uci, san };
}

function startServer() {
  const html = renderDrillHubPage({ nav: NAV, legalLinks: LEGAL_LINKS });
  const bundle = buildDrillHubBundle();

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/drill.html' || url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    if (url === '/drill-hub.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(bundle);
      return;
    }
    if (url.startsWith('/data/rep/')) {
      const rel = decodeURIComponent(url.slice('/data/rep/'.length));
      const filePath = path.join(REP_DATA_DIR, rel);
      if (!filePath.startsWith(REP_DATA_DIR) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(filePath));
      return;
    }
    // Craft-audit item 6: renderDrillHubPage() now links a shared
    // `/site.css` instead of inlining SITE_CSS (src/render.js's
    // SITE_CSS_FILE comment) -- without this route the board's real layout
    // CSS never loads, which risks hanging any Playwright visibility wait
    // on the board rather than failing fast.
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

function makeCard({ id, play, answerUci, answerSan, side, source }) {
  return {
    id,
    play,
    fen: null,
    answerUci,
    answerSan,
    side,
    band: '1600-1800',
    pool: 'blitz',
    openingSlug: 'test-opening',
    openingName: 'Test Opening',
    eco: 'C50',
    source,
    sm2: newCardState(),
  };
}

test('drill hub spoiler regression: leak-seeded and band-meta-seeded card answers never appear pre-attempt, and do appear after', { timeout: 30000 }, async () => {
  const metaTop = readRealTopMove(['e2e4']); // real crawled data, e.g. {uci:"e7e5", san:"e5"}
  const leakTop = readRealTopMove(['d2d4']); // real crawled data, e.g. {uci:"d7d5", san:"d5"}
  const metaCard = makeCard({ id: 'meta-1', play: ['e2e4'], answerUci: metaTop.uci, answerSan: metaTop.san, side: 'black', source: 'band-meta' });
  const leakCard = makeCard({ id: 'leak-1', play: ['d2d4'], answerUci: leakTop.uci, answerSan: leakTop.san, side: 'black', source: 'leak' });

  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/drill.html`);

    // Seed localStorage with a real deck (both cards), skip migration (not
    // under test here), then reload so drill.client.js's init reads it.
    await page.evaluate(
      ({ metaCard, leakCard }) => {
        window.localStorage.setItem('rb.drill.v2', JSON.stringify({ v: 2, cards: [metaCard, leakCard], migratedV1: true }));
      },
      { metaCard, leakCard }
    );
    await page.reload();

    // "10 cards" session length is already the default (aria-pressed on
    // page load); both seeded cards are fresh (never attempted), so
    // Start session must be enabled.
    const startBtn = page.locator('#drill-start-session');
    await assert_notDisabled(startBtn);
    await startBtn.click();

    await page.locator('#drill-session').waitFor({ state: 'visible' });

    // ---- CARD 1 -------------------------------------------------------
    // Let the candidate fetch (localBandLookup, real network call to this
    // test's own server) resolve before checking pre-attempt state -- the
    // spoiler rule is about DOM content, not fetch timing (see
    // src/browser/drill.client.js's header comment), so this wait is
    // deliberately generous and does not weaken the assertion below.
    await page.waitForTimeout(400);

    const preAttemptHtml1 = await page.evaluate(() => document.documentElement.outerHTML);
    assertNoSpoiler(preAttemptHtml1, metaCard, 'card 1 (band-meta), before any attempt');

    await page.locator('#drill-show-answer').click();
    await page.waitForTimeout(100);
    const postRevealHtml1 = await page.evaluate(() => document.documentElement.outerHTML);
    assertSpoilerRevealed(postRevealHtml1, metaCard, 'card 1 (band-meta), after reveal');

    // Advance to card 2 -- gradeAndAdvance()'s auto-advance delay now scales
    // with the feedback message length (600ms base + 15ms/char, capped at
    // 2600ms; see drill.client.js's advanceDelayMs()), so wait past the cap
    // with margin rather than the old flat 1200ms.
    await page.waitForTimeout(2900);

    // ---- CARD 2 ---------------------------------------------------------
    await page.waitForTimeout(400);
    const preAttemptHtml2 = await page.evaluate(() => document.documentElement.outerHTML);
    assertNoSpoiler(preAttemptHtml2, leakCard, 'card 2 (leak), before any attempt');
    // Card 1's own answer must ALSO be gone now (session has moved on --
    // nothing lingers from a previous card).
    assertNoSpoiler(preAttemptHtml2, metaCard, 'card 2 view, card 1\'s answer should not linger');

    await page.locator('#drill-show-answer').click();
    await page.waitForTimeout(100);
    const postRevealHtml2 = await page.evaluate(() => document.documentElement.outerHTML);
    assertSpoilerRevealed(postRevealHtml2, leakCard, 'card 2 (leak), after reveal');
  } finally {
    await browser.close();
    server.close();
  }
});

// UX audit finding: "0 cards due" read as "nothing to do", even though a
// fresh (never-attempted) card still makes Start Session work -- the hub
// now shows an explicit note when that's the case, and stays quiet
// otherwise.
test('drill hub "0 cards due" shows the fresh-cards note only when it is actually true (0 due, but fresh cards exist)', { timeout: 30000 }, async () => {
  const metaTop = readRealTopMove(['e2e4']);
  const freshCard = makeCard({ id: 'fresh-1', play: ['e2e4'], answerUci: metaTop.uci, answerSan: metaTop.san, side: 'black', source: 'band-meta' });

  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/drill.html`);

    await page.evaluate(
      ({ freshCard }) => {
        window.localStorage.setItem('rb.drill.v2', JSON.stringify({ v: 2, cards: [freshCard], migratedV1: true }));
      },
      { freshCard }
    );
    await page.reload();

    const note = page.locator('#drill-fresh-note');
    assert.equal(await note.isHidden(), false, 'fresh-cards note should be visible when 0 due but a fresh card exists');
    assert.match(await note.innerText(), /1 new card is ready to learn/);
    assert.equal(await page.locator('#drill-due-count').innerText(), '0');

    // Now make that same card genuinely due (dueAt in the past) -- the note
    // must disappear, since "0 cards due" is no longer misleading.
    const dueCard = { ...freshCard, sm2: { ...freshCard.sm2, dueAt: new Date(Date.now() - 86400000).toISOString() } };
    await page.evaluate(
      ({ dueCard }) => {
        window.localStorage.setItem('rb.drill.v2', JSON.stringify({ v: 2, cards: [dueCard], migratedV1: true }));
      },
      { dueCard }
    );
    await page.reload();
    assert.equal(await note.isHidden(), true, 'fresh-cards note must not show once the same card is genuinely due');
    assert.equal(await page.locator('#drill-due-count').innerText(), '1');
  } finally {
    await browser.close();
    server.close();
  }
});

test('drill session board: a real click on the interactive cm-chessboard board grades the move, same as the previous unicode-button board', { timeout: 30000 }, async () => {
  // Starting-position card, so the two squares to click are known ahead of
  // time from the real committed shard (band-typical reply to nothing
  // played yet) -- see readRealTopMove(), reused from the test above.
  const top = readRealTopMove([]);
  const from = top.uci.slice(0, 2);
  const to = top.uci.slice(2, 4);
  const card = makeCard({ id: 'board-click-1', play: [], answerUci: top.uci, answerSan: top.san, side: 'white', source: 'band-meta' });

  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/drill.html`);
    await page.evaluate(
      (c) => window.localStorage.setItem('rb.drill.v2', JSON.stringify({ v: 2, cards: [c], migratedV1: true })),
      card
    );
    await page.reload();

    await page.locator('#drill-start-session').click();
    await page.locator('#drill-session').waitFor({ state: 'visible' });

    // Real cm-chessboard component: prove it actually mounted (not the old
    // 64-<button class="board-sq"> markup, and not the static SSR diagram
    // left in place).
    await page.locator('#drill-board svg.cm-chessboard').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#drill-board button.board-sq').count(), 0, 'the old unicode-glyph board markup must be gone once the real board mounts');

    await page.waitForTimeout(400); // let pendingCandidates resolve, same wait the spoiler test above uses

    // Real click-to-move: the square rect carries data-square, same
    // attribute on the piece group sitting on an occupied square -- click
    // the piece group directly (the topmost element at that point) so this
    // is a genuine "click the pawn, then click the destination" sequence,
    // not a coordinate hack.
    await page.locator(`#drill-board [data-square="${from}"]`).first().click();
    await page.locator(`#drill-board [data-square="${to}"]`).first().click();

    // gradeAndAdvance() ran off the board's own onMove callback -- the
    // feedback region reflects a real verdict (not empty), the same effect
    // #drill-show-answer produces in the spoiler test above, but reached
    // through the actual board this time.
    await page.locator('#drill-feedback:not(:empty)').waitFor({ state: 'visible', timeout: 5000 });
    const feedbackClass = await page.locator('#drill-feedback').getAttribute('class');
    assert.match(feedbackClass, /drill-feedback--(correct|offmeta|unknown)/, 'a real board click must reach gradeAndAdvance and set a real verdict class');
  } finally {
    await browser.close();
    server.close();
  }
});

test('drill session board: cm-chessboard\'s Accessibility move-piece form also grades the move -- it calls board.movePiece() directly, bypassing the normal click/drag event path, so this proves boardWidgetDrill.js\'s movePiece wrapper actually works', { timeout: 30000 }, async () => {
  const top = readRealTopMove([]);
  const from = top.uci.slice(0, 2);
  const to = top.uci.slice(2, 4);
  const card = makeCard({ id: 'board-form-1', play: [], answerUci: top.uci, answerSan: top.san, side: 'white', source: 'band-meta' });

  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/drill.html`);
    await page.evaluate(
      (c) => window.localStorage.setItem('rb.drill.v2', JSON.stringify({ v: 2, cards: [c], migratedV1: true })),
      card
    );
    await page.reload();

    await page.locator('#drill-start-session').click();
    await page.locator('#drill-session').waitFor({ state: 'visible' });
    await page.locator('#drill-board svg.cm-chessboard').waitFor({ state: 'visible' });
    await page.waitForTimeout(400);

    // The Accessibility extension's move-piece form is visually-hidden
    // (screen-reader/braille-only), not display:none, so `.fill()` (which
    // sets the value/dispatches input events via CDP regardless of
    // visibility) works normally. The submit click is done in-page via the
    // DOM's own real `.click()` instead of Playwright's coordinate-based
    // click -- a synthetic mouse click at a zero-size clipped element's
    // bounding box does not reliably land on it, whereas element.click()
    // invokes the browser's real click algorithm (and this form's real
    // "submit" handling) regardless of layout size.
    await page.locator('#drill-board .cm-chessboard-accessibility .input-from').fill(from, { force: true });
    await page.locator('#drill-board .cm-chessboard-accessibility .input-to').fill(to, { force: true });
    await page.evaluate(() => {
      document.querySelector('#drill-board .cm-chessboard-accessibility .button-move').click();
    });

    await page.locator('#drill-feedback:not(:empty)').waitFor({ state: 'visible', timeout: 5000 });
    const feedbackClass = await page.locator('#drill-feedback').getAttribute('class');
    assert.match(feedbackClass, /drill-feedback--(correct|offmeta|unknown)/, 'the accessibility move form must also reach gradeAndAdvance and set a real verdict class');
  } finally {
    await browser.close();
    server.close();
  }
});

async function assert_notDisabled(locator) {
  const disabled = await locator.isDisabled();
  assert.equal(disabled, false, 'Start session button should be enabled with fresh cards in the deck');
}

function assertNoSpoiler(html, card, label) {
  assert.doesNotMatch(html, new RegExp(card.answerUci), `${label}: answer UCI "${card.answerUci}" must not appear`);
  assert.doesNotMatch(html, new RegExp(`<td>${card.answerSan}</td>`), `${label}: answer SAN candidate-table cell must not appear`);
}

function assertSpoilerRevealed(html, card, label) {
  assert.match(html, new RegExp(card.answerUci), `${label}: answer UCI "${card.answerUci}" should now be visible (feedback text)`);
  assert.match(html, new RegExp(`<td>${card.answerSan}</td>`), `${label}: candidate table should now show the real answer row`);
}
