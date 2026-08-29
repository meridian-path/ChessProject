'use strict';

/**
 * Orchestrates the Repertoire Pack sales pages (monetization-layer spec,
 * section 1.11 "M2 -- PACK PAGES"): the packs index + two pack detail pages,
 * plus the free sample.pgn each detail page links to.
 *
 * Reuses src/buildPack.js's buildPackTree() the same way scripts/
 * buildPacks.js (M1) already does -- through the SAME cached/rate-limited
 * Explorer fetch chain every other page in this static build already uses
 * (src/buildStatic.js's politeFetch + src/explorerCache.js), so this is a
 * live-data build step like every other page, NOT a dependency on
 * packs/<id>/pack.json ever having been generated locally. buildPackTree()
 * is a pure function of the cached aggregate responses (see
 * test/buildPack.test.js's determinism test), so re-running it here
 * reproduces byte-identical results to whatever scripts/buildPacks.js (run
 * by hand to produce the actual $9 sellable files) already wrote.
 *
 * Deliberately does NOT require('../scripts/buildPacks') for its catalogue
 * -- that script top-level requires('playwright') for its PDF generation,
 * and this module must stay Playwright-free (it's required from
 * src/buildStatic.js, which "must not depend on a browser being available"
 * -- see that file's own header comment). PACK_CATALOGUE below is therefore
 * a small, independently-kept duplicate of scripts/buildPacks.js's own
 * CATALOGUE -- same convention as src/sitemap.js's redirectStubFileName()
 * duplicating a src/buildStatic.js helper for the same "avoid an unwanted
 * import graph" reason.
 *
 * Per-pack OG images and the sellable artifact files themselves
 * (repertoire.pgn / pack.json / study-guide.pdf / README.txt under
 * packs/<id>/, gitignored) are NOT this module's job -- OG images are a
 * scripts/build-og-image.js extension (committed under assets/, like
 * og-default.png already is), and the sellable files stay scripts/
 * buildPacks.js's job (M1), run by hand. This module reads packs/<id>/*
 * ONLY as a best-effort source for real file-size figures shown on the
 * page (readFileSizesIfPresent() below) -- when that directory doesn't
 * exist (a fresh checkout, or CI, where it's never generated), the page
 * still builds correctly, it just omits the size figures rather than
 * inventing them.
 */

const fs = require('fs');
const path = require('path');

const {
  buildPackTree,
  packJsonFromResult,
  pruneToTopLines,
  pgnFromTree,
  fenAfter,
} = require('./buildPack');
const { STORE, isPlaceholderStoreUrl } = require('./render');
const {
  packsIndexFilename,
  packDetailFilename,
  packSampleFilename,
  renderPacksIndexPage,
  renderPackDetailPage,
} = require('./renderPackPages');
const { SITE_NAME, SITE_ORIGIN } = require('./site');
const { AGGREGATES_DIR, actualPoolSpeeds } = require('./explorerSource');
const { assertPageMetadata, extractTitle, extractDescription } = require('./buildContent');

const OUT_DIR = path.join(__dirname, '..', 'dist');
const PACKS_DIR = path.join(__dirname, '..', 'packs');

// Mirrors scripts/buildPacks.js's own CATALOGUE exactly -- see this file's
// header comment for why it's a kept-in-sync duplicate rather than a shared
// import. Any change to the launch catalogue (a third pack, a renamed
// title) must be made in BOTH files.
const PACK_CATALOGUE = [
  { id: 'white-1400-1600', title: 'White at 1400-1600', color: 'white', band: '1400-1600', firstMoveUci: 'e2e4' },
  { id: 'black-vs-e4-1400-1600', title: 'Black vs 1.e4 at 1400-1600', color: 'black', band: '1400-1600', firstMoveUci: 'e2e4' },
];

const SAMPLE_LINE_COUNT = 47; // spec 1.6.3, matches scripts/buildPacks.js's own SAMPLE_LINE_COUNT

const SELLABLE_FILES = ['repertoire.pgn', 'pack.json', 'study-guide.pdf', 'README.txt'];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}

/**
 * @returns {Record<string,string>|null} real, on-disk file sizes for one
 *   pack's four sellable files, keyed by filename -- null when packs/<id>/
 *   doesn't exist locally (see this file's header comment).
 */
function readFileSizesIfPresent(id) {
  const dir = path.join(PACKS_DIR, id);
  if (!fs.existsSync(dir)) return null;
  const sizes = {};
  let anyFound = false;
  for (const file of SELLABLE_FILES) {
    const filePath = path.join(dir, file);
    if (fs.existsSync(filePath)) {
      sizes[file] = formatBytes(fs.statSync(filePath).size);
      anyFound = true;
    }
  }
  return anyFound ? sizes : null;
}

/**
 * Builds one pack's full in-memory bundle: the raw tree (for the contents
 * table -- see src/renderPackPages.js's collectContentsRows()), the same
 * packJsonFromResult() computation M1 uses (so line_count/position_count/
 * threshold_used on the page are byte-identical to what the sold pack.json
 * itself states -- spec 4.6: "every count in pack copy is interpolated from
 * pack.json at build time"), and a freshly-regenerated free sample.pgn.
 */
async function buildOnePackBundle(def, { fetchImpl, retrieved, aggregatesDir }) {
  // Which pool this SPECIFIC build actually drew from -- see
  // src/explorerSource.js's actualPoolSpeeds() doc. Passed to
  // buildPackTree() below for the live-API-fallback case only (the
  // aggregate path ignores it, always blitz); the returned value is what
  // actually matters, since it is what pack.json/README/the sales page
  // disclose as `speeds`.
  const speeds = actualPoolSpeeds(aggregatesDir);
  const result = await buildPackTree({
    ratingBand: def.band,
    color: def.color,
    firstMoveUci: def.firstMoveUci,
    speeds,
    fetchImpl,
    aggregatesDir,
  });
  const packJson = packJsonFromResult(result, { id: def.id, title: def.title, speeds, retrieved });

  // The position AFTER the pack's own stated first move -- more legible as
  // marketing artwork than the bare starting position every root.fen
  // otherwise represents (see src/buildPack.js's own node.fen convention:
  // "position BEFORE this node's own move" -- root.fen is therefore the
  // starting position, not this pack's own identity position).
  const rootFen = fenAfter([def.firstMoveUci]);

  const sampleTree = pruneToTopLines(result.tree, SAMPLE_LINE_COUNT);
  const samplePgn = pgnFromTree(sampleTree, {
    Event: `${SITE_NAME} Repertoire Pack (free sample)`,
    Site: SITE_ORIGIN,
    Date: retrieved.replace(/-/g, '.'),
    Round: '-',
    White: def.color === 'white' ? def.title : '?',
    Black: def.color === 'black' ? def.title : '?',
    Result: '*',
  });

  const storeUrl = STORE.packs[def.id];
  const noindex = isPlaceholderStoreUrl(storeUrl);

  return {
    id: def.id,
    title: def.title,
    color: def.color,
    band: def.band,
    firstMoveUci: def.firstMoveUci,
    firstMoveSan: result.tree.san,
    rootFen,
    tree: result.tree,
    lineCount: packJson.line_count,
    positionCount: packJson.position_count,
    thresholdUsed: packJson.threshold_used,
    ruleVersion: packJson.rule_version,
    speeds,
    retrieved,
    sampleLineCount: SAMPLE_LINE_COUNT,
    storeUrl,
    noindex,
    fileSizes: readFileSizesIfPresent(def.id),
    samplePgn,
  };
}

/**
 * @param {object} opts
 * @param {Function} [opts.fetchImpl]
 * @param {string} [opts.outDir]
 * @param {object} opts.nav
 * @param {object} [opts.legalLinks]
 * @param {string} [opts.aggregatesDir]
 * @returns {Promise<{written: Array<{file,html,slug,title,description}>, packs: Array}>}
 */
async function buildPackPages({ fetchImpl = fetch, outDir = OUT_DIR, nav, legalLinks, aggregatesDir = AGGREGATES_DIR } = {}) {
  const packsOutDir = path.join(outDir, 'repertoire-packs');
  fs.mkdirSync(packsOutDir, { recursive: true });

  const retrieved = new Date().toISOString().slice(0, 10);
  const packs = [];
  for (const def of PACK_CATALOGUE) {
    // eslint-disable-next-line no-await-in-loop -- serial by design, same as every other Explorer-backed builder in this codebase (see src/buildEcoPages.js's header comment)
    const pack = await buildOnePackBundle(def, { fetchImpl, retrieved, aggregatesDir });
    packs.push(pack);
  }

  const written = [];

  for (const pack of packs) {
    const otherPacks = packs.filter((p) => p.id !== pack.id).map((p) => ({ id: p.id, title: p.title }));
    const html = renderPackDetailPage({ pack, otherPacks, nav, legalLinks });
    const file = packDetailFilename(pack.id);
    fs.writeFileSync(path.join(outDir, file), html, 'utf8');
    fs.writeFileSync(path.join(outDir, packSampleFilename(pack.id)), pack.samplePgn, 'utf8');
    written.push({ file, html, slug: pack.id, title: extractTitle(html), description: extractDescription(html), noindex: pack.noindex });
  }

  const indexHtml = renderPacksIndexPage({ packs, nav, legalLinks });
  const indexFile = packsIndexFilename();
  fs.writeFileSync(path.join(outDir, indexFile), indexHtml, 'utf8');
  written.unshift({ file: indexFile, html: indexHtml, slug: 'repertoire-packs', title: extractTitle(indexHtml), description: extractDescription(indexHtml), noindex: packs.every((p) => p.noindex) });

  // Same build-time title/description budget every other page builder in
  // this codebase enforces (src/buildContent.js's own assertPageMetadata,
  // matching html-validate's long-title rule) -- catches an over-length or
  // duplicate <title>/meta description here, at build time, rather than
  // only downstream in CI's separate html-validate pass.
  assertPageMetadata(written);

  return { written, packs };
}

module.exports = {
  buildPackPages,
  buildOnePackBundle,
  readFileSizesIfPresent,
  formatBytes,
  PACK_CATALOGUE,
  SAMPLE_LINE_COUNT,
};
