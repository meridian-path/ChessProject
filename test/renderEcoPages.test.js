'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VOLUME_LABELS,
  ecoVolumeFilename,
  ecoIndexPageFilename,
  ecoRangeLabel,
  renderVariationTree,
  renderFamilyHubPage,
  renderEcoVolumeIndexPage,
  renderEcoIndexPage,
} = require('../src/renderEcoPages');
const { buildFamilyIndex } = require('../src/ecoFamilies');
const { buildFamilyBandStats } = require('../src/processEcoFamilies');

const NAV = { repertoire: '/', openings: 'openings.html', eco: 'eco-openings.html' };

function makeLine(overrides) {
  return {
    eco: 'A00', name: "King's Gambit", family: "King's Gambit", variation: null, subvariation: null, segments: [],
    sourceFile: 'a.tsv', sourceRow: 2,
    plies: [
      { ply: 1, color: 'white', san: 'e4', uci: 'e2e4', fen: 'x' },
      { ply: 2, color: 'black', san: 'e5', uci: 'e7e5', fen: 'y' },
    ],
    finalFen: 'y', inSourceB: false,
    ...overrides,
  };
}

function makeFamilyEntry(overrides) {
  const lines = overrides.lines || [makeLine({})];
  const familyIndex = buildFamilyIndex(lines);
  return { ...familyIndex[0], ...overrides };
}

// ---------------------------------------------------------------------------
// ecoVolumeFilename / ecoIndexPageFilename / ecoRangeLabel
// ---------------------------------------------------------------------------

test('ecoVolumeFilename / ecoIndexPageFilename: stable, predictable filenames', () => {
  assert.equal(ecoVolumeFilename('B'), 'eco-volume-b.html');
  assert.equal(ecoIndexPageFilename(1), 'eco-openings.html');
  assert.equal(ecoIndexPageFilename(2), 'eco-openings-2.html');
});

test('ecoRangeLabel: a single code prints bare; more than one prints a min-max range', () => {
  assert.equal(ecoRangeLabel(['B20']), 'B20');
  assert.equal(ecoRangeLabel(['B20', 'B50', 'B99']), 'B20–B99');
});

// ---------------------------------------------------------------------------
// renderVariationTree
// ---------------------------------------------------------------------------

test('renderVariationTree: renders one <li> per line, with an eco-chip, and every family line represented', () => {
  const root = makeLine({ eco: 'B20', name: 'Sicilian Defense', family: 'Sicilian Defense', variation: null, segments: [] });
  const najdorf = makeLine({ eco: 'B90', name: 'Sicilian Defense: Najdorf Variation', family: 'Sicilian Defense', variation: 'Najdorf Variation', segments: ['Najdorf Variation'] });
  const entry = { family: 'Sicilian Defense', slug: 'sicilian-defense', lines: [root, najdorf] };
  const html = renderVariationTree(entry);
  assert.match(html, /<ul class="repertoire-tree">/);
  const chipCount = (html.match(/class="eco-chip"/g) || []).length;
  assert.equal(chipCount, 2);
  assert.match(html, /B20/);
  assert.match(html, /B90/);
  assert.match(html, /Najdorf Variation/);
});

// Craft-audit instance 8, accepted item 3: the ECO family/variation-tree
// pages (eco-volume-c/d/e.html, kings-gambit-accepted-variations.html, etc.)
// were the worst offenders in the sitewide straight-vs-curly apostrophe
// count (up to 53 straight apostrophes on one page) -- every row label here
// comes straight from the vendored ECO dataset's raw ASCII apostrophe.
test('renderVariationTree renders an intra-word apostrophe in a family/line label as the typographic character, not escapeHtml\'s straight &#39;', () => {
  const root = makeLine({ eco: 'C30', name: "King's Gambit", family: "King's Gambit", variation: null, segments: [] });
  const accepted = makeLine({ eco: 'C33', name: "King's Gambit Accepted", family: "King's Gambit", variation: 'Accepted', segments: ['Accepted'] });
  const entry = { family: "King's Gambit", slug: 'kings-gambit', lines: [root, accepted] };
  const html = renderVariationTree(entry);
  assert.match(html, /King&rsquo;s Gambit/);
  assert.doesNotMatch(html, /King&#39;s/);
});

// ---------------------------------------------------------------------------
// renderFamilyHubPage
// ---------------------------------------------------------------------------

test('renderFamilyHubPage: escapes an apostrophe in the family name everywhere it appears, never raw', () => {
  const line = makeLine({ eco: 'C30', name: "King's Gambit", family: "King's Gambit" });
  const entry = makeFamilyEntry({ lines: [line] });
  const bandStats = buildFamilyBandStats({ side: entry.mainLineSide, bandResponses: {} });
  const html = renderFamilyHubPage({ familyEntry: entry, bandStats, nav: NAV });
  assert.ok(!html.includes("King's Gambit <"), 'a raw apostrophe should never appear unescaped next to markup');
  assert.match(html, /King&#39;s Gambit/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/repertoire-builder\.com\/kings-gambit-variations\.html">/);
});

test('renderFamilyHubPage: a t0CrossLink renders as a visible related-page link', () => {
  const line = makeLine({ eco: 'C50', name: 'Italian Game', family: 'Italian Game' });
  const entry = makeFamilyEntry({ lines: [line] });
  const bandStats = buildFamilyBandStats({ side: entry.mainLineSide, bandResponses: {} });
  const html = renderFamilyHubPage({
    familyEntry: entry,
    bandStats,
    nav: NAV,
    t0CrossLink: { label: 'Italian Game', href: 'italian-game.html' },
  });
  assert.match(html, /href="italian-game\.html"/);
});

test('renderFamilyHubPage: a drillCrossLink renders as a visible related-page link alongside the t0CrossLink (site-audit item 5)', () => {
  const line = makeLine({ eco: 'C50', name: 'Italian Game', family: 'Italian Game' });
  const entry = makeFamilyEntry({ lines: [line] });
  const bandStats = buildFamilyBandStats({ side: entry.mainLineSide, bandResponses: {} });
  const html = renderFamilyHubPage({
    familyEntry: entry,
    bandStats,
    nav: NAV,
    t0CrossLink: { label: 'Italian Game', href: 'italian-game.html' },
    drillCrossLink: { label: 'Italian Game drill', href: 'drill.html', note: 'Pick the move.' },
  });
  assert.match(html, /href="italian-game\.html"/);
  assert.match(html, /href="drill\.html">Italian Game drill/);
});

test('renderFamilyHubPage: omitting drillCrossLink renders no drill link -- never a fabricated one', () => {
  const line = makeLine({ eco: 'B90', name: 'Sicilian Defense: Najdorf', family: 'Sicilian Defense' });
  const entry = makeFamilyEntry({ lines: [line] });
  const bandStats = buildFamilyBandStats({ side: entry.mainLineSide, bandResponses: {} });
  const html = renderFamilyHubPage({ familyEntry: entry, bandStats, nav: NAV });
  assert.doesNotMatch(html, /href="drill\.html"/);
});

test('renderFamilyHubPage: mainLineSide override changes which side the bands table reports a score for', () => {
  const line = makeLine({ eco: 'E61', name: "King's Indian Defense", family: "King's Indian Defense", plies: [
    { ply: 1, color: 'white', san: 'd4', uci: 'd2d4', fen: 'x' },
    { ply: 2, color: 'black', san: 'Nf6', uci: 'g8f6', fen: 'y' },
    { ply: 3, color: 'white', san: 'c4', uci: 'c2c4', fen: 'z' },
  ] });
  const entry = makeFamilyEntry({ lines: [line] });
  assert.equal(entry.mainLineSide, 'white'); // last ply is White's c4
  const bandStats = buildFamilyBandStats({ side: 'black', bandResponses: {} });
  const html = renderFamilyHubPage({ familyEntry: entry, bandStats, nav: NAV, mainLineSide: 'black' });
  assert.match(html, /playing as black/);
});

test('renderFamilyHubPage: noindex defaults to false -- no robots meta tag unless the caller explicitly passes noindex:true', () => {
  const line = makeLine({ eco: 'B90', name: 'Sicilian Defense: Najdorf', family: 'Sicilian Defense' });
  const entry = makeFamilyEntry({ lines: [line] });
  const bandStats = buildFamilyBandStats({ side: entry.mainLineSide, bandResponses: {} });
  const html = renderFamilyHubPage({ familyEntry: entry, bandStats, nav: NAV });
  assert.doesNotMatch(html, /name="robots"/);
});

test('renderFamilyHubPage: noindex:true (src/buildEcoPages.js, main line too few games at every band) renders the noindex robots meta tag', () => {
  const line = makeLine({ eco: 'D00', name: 'Blackmar-Diemer Gambit Accepted', family: 'Blackmar-Diemer Gambit Accepted' });
  const entry = makeFamilyEntry({ lines: [line] });
  const bandStats = buildFamilyBandStats({
    side: entry.mainLineSide,
    bandResponses: { '1400-1600': { white: 60, draws: 10, black: 61 } }, // 131 games, under minGamesForPct
  });
  assert.ok(bandStats.bands.every((b) => !b.enoughData));
  const html = renderFamilyHubPage({ familyEntry: entry, bandStats, nav: NAV, noindex: true });
  assert.match(html, /<meta name="robots" content="noindex">/);
});

// AdSense content-depth fix, part 2 (src/ecoFamilyStrategy.js): every T1
// family hub gets its own "The idea" section, same heading src/openings.js's
// T0 pages use, but describing the FAMILY's own major branches rather than
// one specific line -- see that module's own header comment for why.
test('renderFamilyHubPage: renders the strategy paragraph under an "The idea" heading, escaped and curly-quoted like any other prose', () => {
  const line = makeLine({ eco: 'C50', name: 'Italian Game', family: 'Italian Game' });
  const entry = makeFamilyEntry({ lines: [line] });
  const bandStats = buildFamilyBandStats({ side: entry.mainLineSide, bandResponses: {} });
  const html = renderFamilyHubPage({
    familyEntry: entry,
    bandStats,
    nav: NAV,
    strategy: "The family's branches split on how quickly White's own bishop trade resolves.",
  });
  assert.match(html, /<h2>The idea<\/h2>\s*<p>The family&rsquo;s branches split on how quickly White&rsquo;s own bishop trade resolves\.<\/p>/);
});

test('renderFamilyHubPage: omitting strategy renders an empty paragraph, never the literal word "undefined"', () => {
  const line = makeLine({ eco: 'C50', name: 'Italian Game', family: 'Italian Game' });
  const entry = makeFamilyEntry({ lines: [line] });
  const bandStats = buildFamilyBandStats({ side: entry.mainLineSide, bandResponses: {} });
  const html = renderFamilyHubPage({ familyEntry: entry, bandStats, nav: NAV });
  assert.doesNotMatch(html, /undefined/);
});

// ---------------------------------------------------------------------------
// renderEcoVolumeIndexPage
// ---------------------------------------------------------------------------

test('renderEcoVolumeIndexPage: renders a DefinedTermSet with one DefinedTerm per code, url only when a code row carries one', () => {
  const codeRows = [
    { eco: 'B20', names: [{ name: 'Sicilian Defense', href: 'sicilian-defense-variations.html' }], lineCount: 4 },
    { eco: 'B21', names: [{ name: 'Smith-Morra Gambit', href: null }], lineCount: 2 },
  ];
  const html = renderEcoVolumeIndexPage({ volume: 'B', codeRows, nav: NAV });
  const jsonLdBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const termSet = jsonLdBlocks.find((b) => b['@type'] === 'DefinedTermSet');
  assert.ok(termSet);
  assert.equal(termSet.hasDefinedTerm.length, 2);
  const b20Term = termSet.hasDefinedTerm.find((t) => t.termCode === 'B20');
  assert.ok(b20Term.url.endsWith('sicilian-defense-variations.html'));
  const b21Term = termSet.hasDefinedTerm.find((t) => t.termCode === 'B21');
  assert.equal(b21Term.url, undefined);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
});

test('renderEcoVolumeIndexPage: an unlinked code name renders as plain text, never a dangling <a href>', () => {
  const codeRows = [{ eco: 'A99', names: [{ name: 'Some Obscure Line', href: null }], lineCount: 1 }];
  const html = renderEcoVolumeIndexPage({ volume: 'A', codeRows, nav: NAV });
  assert.ok(!html.includes('<a href="">'));
  assert.match(html, /Some Obscure Line/);
});

// 80-identical-Sicilian-rows fix: a row's variation renders alongside its family name.
test('renderEcoVolumeIndexPage: a name with a dominant variation renders "Family: Variation", linked when the family has one', () => {
  const codeRows = [{ eco: 'B90', names: [{ name: 'Sicilian Defense', href: 'sicilian-defense-variations.html', variation: 'Najdorf Variation' }], lineCount: 15 }];
  const html = renderEcoVolumeIndexPage({ volume: 'B', codeRows, nav: NAV });
  assert.match(html, /<a href="sicilian-defense-variations\.html">Sicilian Defense: Najdorf Variation<\/a>/);
});

test('renderEcoVolumeIndexPage: a name with no dominant variation renders the family name alone, exactly as before', () => {
  const codeRows = [{ eco: 'B20', names: [{ name: 'Sicilian Defense', href: 'sicilian-defense-variations.html', variation: null }], lineCount: 27 }];
  const html = renderEcoVolumeIndexPage({ volume: 'B', codeRows, nav: NAV });
  assert.match(html, /<a href="sicilian-defense-variations\.html">Sicilian Defense<\/a>/);
  assert.ok(!html.includes('Sicilian Defense:'));
});

// AdSense content-depth fix, part 2: every ECO volume page gets its own
// differentiating strategy paragraph under "What sets this volume apart".
test('renderEcoVolumeIndexPage: renders the strategy paragraph under a "What sets this volume apart" heading', () => {
  const codeRows = [{ eco: 'B20', names: [{ name: 'Sicilian Defense', href: 'sicilian-defense-variations.html' }], lineCount: 4 }];
  const html = renderEcoVolumeIndexPage({
    volume: 'B',
    codeRows,
    nav: NAV,
    strategy: "Volume B's own openings all share one asymmetrical reply to White's first move.",
  });
  assert.match(html, /<h2>What sets this volume apart<\/h2>\s*<p>Volume B&rsquo;s own openings all share one asymmetrical reply to White&rsquo;s first move\.<\/p>/);
});

test('renderEcoVolumeIndexPage: omitting strategy renders an empty paragraph, never the literal word "undefined"', () => {
  const codeRows = [{ eco: 'A99', names: [{ name: 'Some Obscure Line', href: null }], lineCount: 1 }];
  const html = renderEcoVolumeIndexPage({ volume: 'A', codeRows, nav: NAV });
  assert.doesNotMatch(html, /undefined/);
});

// ---------------------------------------------------------------------------
// renderEcoIndexPage
// ---------------------------------------------------------------------------

test('renderEcoIndexPage: links a >=8-line family to its hub, renders a <8-line family as plain text', () => {
  const pageFamilies = [
    { family: 'Big Family', slug: 'big-family', lineCount: 20, ecoCodes: ['A10', 'A19'] },
    { family: 'Tiny Family', slug: 'tiny-family', lineCount: 3, ecoCodes: ['A50'] },
  ];
  const html = renderEcoIndexPage({
    pageFamilies, pageNum: 1, totalPages: 1,
    stats: { totalFamilies: 149, t1Count: 64, totalLines: 3810 },
    nav: NAV,
  });
  assert.match(html, /<a href="big-family-variations\.html">Big Family<\/a>/);
  assert.ok(!html.includes('tiny-family-variations.html'));
  assert.match(html, /Tiny Family/);
});

test('renderEcoIndexPage: pagination links appear only when totalPages > 1, and point at the right page filenames', () => {
  const pageFamilies = [{ family: 'A Family', slug: 'a-family', lineCount: 10, ecoCodes: ['A10'] }];
  const single = renderEcoIndexPage({ pageFamilies, pageNum: 1, totalPages: 1, stats: { totalFamilies: 1, t1Count: 1, totalLines: 10 }, nav: NAV });
  assert.ok(!single.includes('class="pagination"'));

  const page1 = renderEcoIndexPage({ pageFamilies, pageNum: 1, totalPages: 2, stats: { totalFamilies: 1, t1Count: 1, totalLines: 10 }, nav: NAV });
  assert.match(page1, /href="eco-openings-2\.html" rel="next"/);
  assert.ok(!page1.includes('rel="prev"'));

  const page2 = renderEcoIndexPage({ pageFamilies, pageNum: 2, totalPages: 2, stats: { totalFamilies: 1, t1Count: 1, totalLines: 10 }, nav: NAV });
  assert.match(page2, /href="eco-openings\.html" rel="prev"/);
  assert.ok(!page2.includes('rel="next"'));
});

test('VOLUME_LABELS: exactly the 5 ECO volumes A-E', () => {
  assert.deepEqual(Object.keys(VOLUME_LABELS), ['A', 'B', 'C', 'D', 'E']);
});
