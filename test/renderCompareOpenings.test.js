'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderCompareOpeningsPage } = require('../src/renderCompareOpenings');

const NAV = { home: '/', repertoire: 'repertoire.html', openings: 'openings.html', guides: 'guides.html', faq: 'chess-opening-faq.html', player: 'player.html' };

function fakeEntry(slug, name, side, games = 12000) {
  return {
    openingConfig: { slug, name, side },
    model: {
      name,
      side,
      bands: [
        { band: '1400-1600', games, enoughData: true, scoreForSide: 51.2, scoreForSideCI: 1.1, scoreForSideBalanced: null, scoreForSideBalancedCI: null },
        { band: '1600-1800', games, enoughData: true, scoreForSide: 54.8, scoreForSideCI: 0.9, scoreForSideBalanced: 52.1, scoreForSideBalancedCI: 1.2 },
        { band: '1800-2000', games: 300, enoughData: false, scoreForSide: null, scoreForSideCI: null, scoreForSideBalanced: null, scoreForSideBalancedCI: null },
        { band: '2000+', games: 0, enoughData: false, scoreForSide: null, scoreForSideCI: null, scoreForSideBalanced: null, scoreForSideBalancedCI: null },
      ],
    },
  };
}

const ENTRIES = [
  fakeEntry('italian-game', 'Italian Game', 'white'),
  fakeEntry('london-system', 'London System', 'white'),
  fakeEntry('sicilian-defense', 'Sicilian Defense', 'black'),
  fakeEntry('caro-kann-defense', 'Caro-Kann Defense', 'black'),
];

test('renderCompareOpeningsPage: exactly one H1, real canonical/title/description, breadcrumb present', () => {
  const html = renderCompareOpeningsPage(ENTRIES, { nav: NAV });
  const h1Matches = html.match(/<h1[ >]/g) || [];
  assert.equal(h1Matches.length, 1);
  assert.match(html, /<title>Compare Openings, Side by Side \| Repertoire Builder<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/compare-openings\.html">/);
  assert.match(html, /class="breadcrumb"/);
});

test('renderCompareOpeningsPage: both <select> elements list every opening, one <option> per opening', () => {
  const html = renderCompareOpeningsPage(ENTRIES, { nav: NAV });
  for (const e of ENTRIES) {
    const count = (html.match(new RegExp(`value="${e.openingConfig.slug}"`, 'g')) || []).length;
    assert.equal(count, 2, `${e.openingConfig.slug} should appear as an option in both selects`);
  }
});

test('renderCompareOpeningsPage: defaults to the first White and first Black opening, never the same opening picked twice', () => {
  const html = renderCompareOpeningsPage(ENTRIES, { nav: NAV });
  assert.match(html, /<option value="italian-game" selected>/); // first White, opening A
  assert.match(html, /<option value="sicilian-defense" selected>/); // first Black, opening B
});

test('renderCompareOpeningsPage: the server-rendered default results table has real numbers, not an empty shell', () => {
  const html = renderCompareOpeningsPage(ENTRIES, { nav: NAV });
  assert.match(html, /id="compare-results"/);
  assert.match(html, /54\.8%/); // the default band (1600-1800) score, real not placeholder
  assert.match(html, /12,000/);
});

test('renderCompareOpeningsPage: bakes a valid, parseable JSON payload with every opening\'s full band data, and loads the client bundle deferred', () => {
  const html = renderCompareOpeningsPage(ENTRIES, { nav: NAV });
  const match = html.match(/<script type="application\/json" id="compare-openings-data">([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected a #compare-openings-data JSON block');
  const payload = JSON.parse(match[1]);
  assert.equal(payload.length, ENTRIES.length);
  assert.deepEqual(payload[0].bands.map((b) => b.band), ['1400-1600', '1600-1800', '1800-2000', '2000+']);
  assert.match(html, /<script src="compare-openings\.js" defer><\/script>/);
});

test('renderCompareOpeningsPage: two openings of the same side still produce a valid default pair (no infinite loop / crash) when no Black opening exists', () => {
  const whiteOnly = [fakeEntry('italian-game', 'Italian Game', 'white'), fakeEntry('london-system', 'London System', 'white')];
  const html = renderCompareOpeningsPage(whiteOnly, { nav: NAV });
  assert.match(html, /<option value="italian-game" selected>/);
  assert.match(html, /<option value="london-system" selected>/); // falls back to "any other opening", never the same slug twice
});
