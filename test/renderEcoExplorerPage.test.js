'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderEcoExplorerPage, ECO_EXPLORER_FILE, jsonDataScript } = require('../src/renderEcoExplorerPage');

const NAV = { repertoire: '/', openings: 'openings.html', eco: 'eco-openings.html', player: 'player.html' };

function baseArgs(overrides = {}) {
  return {
    nav: NAV,
    t0CrossLinkMap: { 'Italian Game': 'italian-game.html' },
    lineIndexUrl: 'eco-explorer-lines.json',
    reverseLookupUrl: 'eco-reverse-lookup.json',
    topFamilies: [{ family: 'Sicilian Defense', slug: 'sicilian-defense', lineCount: 391, ecoCodes: ['B20', 'B99'] }],
    stats: { totalLines: 3810, totalFamilies: 149 },
    ...overrides,
  };
}

test('jsonDataScript escapes "<" so a literal </script sequence cannot break out of the tag', () => {
  const html = jsonDataScript('x', { evil: '</script><script>alert(1)</script>' });
  assert.ok(!html.includes('</script><script>'), 'the raw closing/opening tag sequence must not survive escaping');
  assert.match(html, /\\u003c\/script/);
});

test('renderEcoExplorerPage renders a well-formed document with the expected title/canonical/nav-active state', () => {
  const html = renderEcoExplorerPage(baseArgs());
  assert.match(html, /<title>Interactive ECO Opening Explorer \| Repertoire Builder<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/eco-explorer\.html">/);
  assert.match(html, /aria-current="page"/);
  assert.equal(ECO_EXPLORER_FILE, 'eco-explorer.html');
});

test('renderEcoExplorerPage meta description stays within the 160-char SEO cap', () => {
  const html = renderEcoExplorerPage(baseArgs());
  const match = html.match(/<meta name="description" content="([^"]*)">/);
  assert.ok(match);
  assert.ok(match[1].length <= 160, `description is ${match[1].length} chars`);
});

test('renderEcoExplorerPage bakes the T0 map and config as separate escaped JSON script blocks, and no longer bakes a line index (craft-audit item 5, first half: that ~562KB search index is now fetched externally, not inlined)', () => {
  const html = renderEcoExplorerPage(baseArgs());
  assert.doesNotMatch(html, /id="explorer-line-index"/, 'the line index must no longer be baked inline');

  const t0Match = html.match(/<script type="application\/json" id="explorer-t0-map">([\s\S]*?)<\/script>/);
  assert.deepEqual(JSON.parse(t0Match[1]), { 'Italian Game': 'italian-game.html' });

  const configMatch = html.match(/<script type="application\/json" id="explorer-config">([\s\S]*?)<\/script>/);
  assert.deepEqual(JSON.parse(configMatch[1]), { lineIndexUrl: 'eco-explorer-lines.json', reverseLookupUrl: 'eco-reverse-lookup.json' });
});

test('renderEcoExplorerPage references the eco-explorer.js bundle exactly once, deferred', () => {
  const html = renderEcoExplorerPage(baseArgs());
  const matches = [...html.matchAll(/<script src="eco-explorer\.js" defer><\/script>/g)];
  assert.equal(matches.length, 1);
});

test('renderEcoExplorerPage embeds the sprite-defs block exactly once (one board on this page)', () => {
  const html = renderEcoExplorerPage(baseArgs());
  const matches = [...html.matchAll(/id="cm-chessboard-sprite"/g)];
  assert.equal(matches.length, 1);
});

test('renderEcoExplorerPage: the board figure carries its own sr-only h2, ahead of where cm-chessboard injects an h3 at runtime', () => {
  const html = renderEcoExplorerPage(baseArgs());
  const figureIndex = html.indexOf('<figure class="board-figure"');
  const h2Index = html.indexOf('<h2 class="sr-only">Explorer board</h2>');
  const boardMountIndex = html.indexOf('<div id="explorer-board-mount"');
  assert.ok(figureIndex !== -1, 'expected the board-figure figure to be present');
  assert.ok(h2Index !== -1, 'expected an sr-only <h2> inside the board figure');
  assert.ok(h2Index > figureIndex && h2Index < boardMountIndex, 'the h2 must sit inside the figure, before the board mount cm-chessboard writes its own h3 into');
});

test('renderEcoExplorerPage emits a noscript fallback linking to the crawlable ECO index', () => {
  const html = renderEcoExplorerPage(baseArgs());
  assert.match(html, /<noscript>[\s\S]*eco-openings\.html[\s\S]*<\/noscript>/);
});

test('renderEcoExplorerPage renders every topFamilies entry as a real, crawlable <a> link (no-JS visible content)', () => {
  const html = renderEcoExplorerPage(baseArgs());
  assert.match(html, /<a href="sicilian-defense-variations\.html">Sicilian Defense<\/a>/);
});

test('renderEcoExplorerPage escapes a family name containing HTML-significant characters in the topFamilies list', () => {
  const html = renderEcoExplorerPage(baseArgs({
    topFamilies: [{ family: '<script>alert(1)</script>', slug: 'evil', lineCount: 1, ecoCodes: ['A00'] }],
  }));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderEcoExplorerPage emits only a BreadcrumbList JSON-LD block, no DefinedTermSet (craft-audit item 5: that 500-code block duplicated the per-volume DefinedTermSet blocks src/renderEcoPages.js already emits, for a type Google does not surface as a rich result)', () => {
  const html = renderEcoExplorerPage(baseArgs());
  const ldMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const definedTermSet = ldMatches.find((d) => d['@type'] === 'DefinedTermSet');
  assert.equal(definedTermSet, undefined, 'this page should no longer emit a DefinedTermSet block');
  const breadcrumb = ldMatches.find((d) => d['@type'] === 'BreadcrumbList');
  assert.ok(breadcrumb);
});

test('renderEcoExplorerPage opts into the wide layout (data-dense page type, same as player.html/repertoire pages)', () => {
  const html = renderEcoExplorerPage(baseArgs());
  assert.match(html, /<div class="page page--wide">/);
});
