'use strict';

/**
 * Orchestrates T3 (the interactive ECO explorer, Phase 7e): data ->
 * render -> write, mirroring src/buildEcoPages.js's own division of
 * labor. Unlike T1/T2 (buildEcoPages.js), this page makes ZERO Lichess
 * Explorer API requests -- every fact on it comes from the two vendored,
 * pinned, license-checked datasets src/ecoData.js already parses (Source A
 * for the search index, Source B for the FEN reverse-lookup table), so
 * there is no rate limit to respect and no fetchImpl to inject here.
 *
 * esbuild bundling of this page's browser entry point
 * (src/browser/ecoExplorer.client.js) is wired in src/buildStatic.js
 * itself, alongside the drill/player-lookup bundles it already owns --
 * this module only produces the HTML page and its two JSON assets (the
 * search line-index and the FEN reverse-lookup table, both fetched by the
 * client rather than inlined -- see src/ecoExplorerData.js's own header
 * comment), all written to disk.
 */

const fs = require('fs');
const path = require('path');

const { buildExplorerLineIndex, buildT0CrossLinkMap, buildReverseLookupIndex } = require('./ecoExplorerData');
const { t1Families } = require('./ecoFamilies');
const { loadSourceB, DEFAULT_DATA_DIR } = require('./ecoData');
const { OPENINGS } = require('./openings');
const { renderEcoExplorerPage, ECO_EXPLORER_FILE } = require('./renderEcoExplorerPage');
const { extractTitle, extractDescription } = require('./buildContent');

const OUT_DIR = path.join(__dirname, '..', 'dist');
const REVERSE_LOOKUP_FILE = 'eco-reverse-lookup.json';
// Craft-audit item 5 (2026-08-28): the search index used to be baked inline
// into eco-explorer.html (~562 KB raw, re-downloaded uncacheable on every
// visit); it's now its own static asset, same convention as
// REVERSE_LOOKUP_FILE above.
const LINE_INDEX_FILE = 'eco-explorer-lines.json';
const TOP_FAMILIES_COUNT = 12;

/**
 * @param {object} opts
 * @param {object} opts.dataset src/ecoData.js's buildEcoDataset() output
 * @param {Array} opts.familyIndex src/ecoFamilies.js's buildFamilyIndex(dataset.lines) output
 * @param {object} opts.nav nav object passed to renderHeader
 * @param {string} [opts.outDir]
 * @param {Function} [opts.readFileImpl] injectable, for tests -- defaults to fs.readFileSync (utf8)
 * @param {string} [opts.dataDir] injectable, for tests -- defaults to ecoData.js's own vendored-data path
 * @returns {{file:string, html:string, slug:string, title:string, description:string,
 *   reverseLookupFile:string, reverseLookupCount:number, reverseLookupJson:string,
 *   lineIndexFile:string, lineIndexCount:number, lineIndexJson:string}}
 */
function buildEcoExplorerPage({
  dataset,
  familyIndex,
  nav,
  outDir = OUT_DIR,
  readFileImpl = (p) => fs.readFileSync(p, 'utf8'),
  dataDir = DEFAULT_DATA_DIR,
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });

  const t1 = t1Families(familyIndex);
  const lineIndex = buildExplorerLineIndex(dataset.lines, familyIndex);
  const lineIndexJson = JSON.stringify(lineIndex);
  const t0CrossLinkMap = buildT0CrossLinkMap(OPENINGS);

  const sourceB = loadSourceB(readFileImpl, dataDir);
  const reverseLookupIndex = buildReverseLookupIndex(sourceB.byFen);
  const reverseLookupJson = JSON.stringify(reverseLookupIndex);

  const topFamilies = [...t1].sort((a, b) => b.lineCount - a.lineCount).slice(0, TOP_FAMILIES_COUNT);

  const html = renderEcoExplorerPage({
    nav,
    t0CrossLinkMap,
    lineIndexUrl: LINE_INDEX_FILE,
    reverseLookupUrl: REVERSE_LOOKUP_FILE,
    topFamilies,
    stats: { totalLines: dataset.stats.totalLines, totalFamilies: familyIndex.length },
  });

  fs.writeFileSync(path.join(outDir, ECO_EXPLORER_FILE), html, 'utf8');
  fs.writeFileSync(path.join(outDir, REVERSE_LOOKUP_FILE), reverseLookupJson, 'utf8');
  fs.writeFileSync(path.join(outDir, LINE_INDEX_FILE), lineIndexJson, 'utf8');

  return {
    file: ECO_EXPLORER_FILE,
    html,
    slug: 'eco-explorer',
    title: extractTitle(html),
    description: extractDescription(html),
    reverseLookupFile: REVERSE_LOOKUP_FILE,
    reverseLookupCount: reverseLookupIndex.length,
    reverseLookupJson,
    lineIndexFile: LINE_INDEX_FILE,
    lineIndexCount: lineIndex.length,
    lineIndexJson,
  };
}

module.exports = {
  ECO_EXPLORER_FILE,
  REVERSE_LOOKUP_FILE,
  LINE_INDEX_FILE,
  TOP_FAMILIES_COUNT,
  buildEcoExplorerPage,
};
