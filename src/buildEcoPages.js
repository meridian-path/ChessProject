'use strict';

/**
 * Orchestrates the T1 family hub + T2 ECO volume/browse index build:
 * fetch (main-line-only, 4-band Explorer stats for the ~64 T1 families) ->
 * model -> render -> write, mirroring src/buildContent.js's own
 * fetchImpl-injection convention -- no live network call happens anywhere
 * except when the real build is actually run, and every test in
 * test/buildEcoPages.test.js supplies a fake fetchImpl.
 *
 * Explorer request budget: exactly 4 requests per T1 family (one per
 * processRepertoire.js RATING_BANDS key), issued strictly one at a time via
 * the same fetchImpl chain buildStatic.js already wraps with politeFetch's
 * 429/retry-after handling and explorerCache.js's on-disk cache -- never
 * parallelized, per Lichess's own "only make one request at a time" rule
 * (see fetchOpeningExplorer.js's header comment). ~64 families x 4 bands =
 * ~256 requests total.
 */

const fs = require('fs');
const path = require('path');

const { buildEcoDataset } = require('./ecoData');
const { buildFamilyIndex, t1Families, familyHubFilename } = require('./ecoFamilies');
const { buildFamilyBandStats } = require('./processEcoFamilies');
const { RATING_BANDS, DEFAULT_SPEEDS } = require('./processRepertoire');
const { fetchMoves, AGGREGATES_DIR } = require('./explorerSource');
const { OPENINGS } = require('./openings');
const {
  VOLUME_LABELS,
  ecoVolumeFilename,
  ecoIndexPageFilename,
  renderFamilyHubPage,
  renderEcoVolumeIndexPage,
  renderEcoIndexPage,
} = require('./renderEcoPages');
const { assertPageMetadata, extractTitle, extractDescription } = require('./buildContent');

const OUT_DIR = path.join(__dirname, '..', 'dist');

// The paginated all-families browse index (T2's "paginated all-codes
// index") splits the full 149-family index into 2 pages -- a genuinely
// different traversal than the 5 code-ordered (and therefore volume-bound
// by construction) volume pages, so real <a href> pagination links stay
// crawlable rather than degenerating into a single 149-row page. ceil(149/2)
// keeps both pages close to evenly sized without
// hardcoding a family count that would silently go stale if the vendored
// dataset is ever re-pinned to a newer commit with a different family count.
const ECO_INDEX_PAGE_COUNT = 2;

/**
 * Fetches one family's main-line 4-band stats, one request at a time (see
 * this module's header comment). `moves: 0` -- callers here only need the
 * position's own win/draws/black totals, never its candidate-move list.
 *
 * `familySlug` is REQUIRED once aggregate data is present: a T1 family's
 * main line frequently runs well past root.json's ply<=ROOT_MAX_PLY coverage
 * (3 as of the 2026-08-15 shard-size fix, src/ingest/aggregate.js -- unlike
 * buildRepertoire.js's shallow walk), so the position almost always needs
 * the family shard, not just root.
 */
async function fetchFamilyBandResponses(mainLine, { fetchImpl, familySlug, aggregatesDir = AGGREGATES_DIR }) {
  const fullPlay = mainLine.plies.map((p) => p.uci);
  const bandResponses = {};
  for (const band of Object.keys(RATING_BANDS)) {
    // eslint-disable-next-line no-await-in-loop -- intentionally serial, see header comment
    bandResponses[band] = await fetchMoves({
      play: fullPlay, band, ratings: RATING_BANDS[band], speeds: DEFAULT_SPEEDS, moves: 0, familySlug, fetchImpl, dir: aggregatesDir,
    });
  }
  return bandResponses;
}

/**
 * A T1 family's matching T0 deep-dive page, when one exists by exact name
 * match against src/openings.js's curated 10 -- e.g. the "Sicilian Defense"
 * T1 hub cross-links to the existing sicilian-defense.html T0 page. `null`
 * for the 56 T1 families with no T0 counterpart (never a fabricated link).
 */
function findT0CrossLink(familyEntry) {
  const match = OPENINGS.find((o) => o.name === familyEntry.family);
  return match ? { label: match.name, href: `${match.slug}.html` } : null;
}

/**
 * Site-audit item 5 (2026-08-26): a T1 family's matching drill, when one
 * exists. Same exact-name-match discipline as findT0CrossLink above --
 * `drillPages` (buildStatic.js's DRILL_PAGES, keyed by opening slug, same
 * shape src/buildContent.js's own drillFile lookup already uses) currently
 * has exactly one entry (the Italian Game), so this is `null` for every
 * other family. Never a fabricated link to a drill that doesn't exist yet.
 */
function findDrillCrossLink(familyEntry, drillPages) {
  const match = OPENINGS.find((o) => o.name === familyEntry.family);
  const drillFile = match ? drillPages[match.slug] : null;
  return drillFile ? { label: `${match.name} drill`, href: drillFile, note: 'Pick the move, see instantly whether it is the move players at your rating actually make, and what that move scores.' } : null;
}

/**
 * ecoFamilies.js's sideForLine() heuristic (color of the family's own main
 * line's last ply) matches openings.js's hand-picked `side` for every T0
 * family EXCEPT King's Indian Defense -- verified against the real data:
 * that family's canonical root row (E61) ends one ply past the Black move
 * that traditionally defines it. Rather than let that known exception
 * mislabel this family's own T0-overlapping page, prefer openings.js's own
 * `side` whenever a T0 cross-link exists (a human already made that call
 * for these 8 families); fall back to the heuristic for the other 56,
 * where no ground truth exists to defer to.
 */
function resolveMainLineSide(familyEntry) {
  const match = OPENINGS.find((o) => o.name === familyEntry.family);
  return match ? match.side : familyEntry.mainLineSide;
}

/** Up to 3 sibling T1 families: same primary ECO volume first, then any others. */
function pickRelatedFamilies(familyEntry, t1List) {
  const others = t1List.filter((f) => f.slug !== familyEntry.slug);
  const primaryVolume = familyEntry.mainLine.eco[0];
  const sameVolume = others.filter((f) => f.mainLine.eco[0] === primaryVolume);
  const rest = others.filter((f) => f.mainLine.eco[0] !== primaryVolume);
  return [...sameVolume, ...rest]
    .slice(0, 3)
    .map((f) => ({ label: f.family, href: familyHubFilename(f.slug), note: `${f.lineCount} named lines, ECO ${f.ecoCodes[0]}` }));
}

/**
 * Groups one ECO volume's lines by exact code (not family -- a single code
 * can carry more than one distinct family, e.g. A00 alone covers 21
 * differently-named "uncommon openings" families), for the T2 volume index
 * table. Each row's `names` links to a family's T1 hub only when that
 * family actually has one (>= ecoFamilies.MIN_T1_LINES lines) -- otherwise
 * plain text, never a link to a page that doesn't exist.
 *
 * @param {Array} lines buildEcoDataset().lines
 * @param {string} volume 'A'..'E'
 * @param {Array} familyIndex ecoFamilies.buildFamilyIndex() output (all 149)
 */
function buildVolumeCodeRows(lines, volume, familyIndex) {
  const familyByName = new Map(familyIndex.map((f) => [f.family, f]));
  const byCode = new Map();
  for (const line of lines) {
    if (line.eco[0] !== volume) continue;
    if (!byCode.has(line.eco)) byCode.set(line.eco, []);
    byCode.get(line.eco).push(line);
  }
  return [...byCode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([eco, codeLines]) => {
      const familyNames = [...new Set(codeLines.map((l) => l.family))];
      const names = familyNames.map((name) => {
        const fe = familyByName.get(name);
        const href = fe && fe.lineCount >= 8 ? familyHubFilename(fe.slug) : null;
        return { name, href };
      });
      return { eco, names, lineCount: codeLines.length };
    });
}

/**
 * @param {object} opts
 * @param {Function} [opts.fetchImpl] injectable fetch, default global fetch
 * @param {string} [opts.outDir] where to write the generated files
 * @param {object} opts.nav nav object passed to renderHeader
 * @param {string} [opts.aggregatesDir] see src/explorerSource.js's `dir` param.
 * @returns {Promise<{written: Array<{file,html,slug,title,description}>,
 *   familyIndex: Array, t1: Array, stats: object}>}
 */
async function buildEcoPages({ fetchImpl = fetch, outDir = OUT_DIR, nav, aggregatesDir = AGGREGATES_DIR, drillPages = {} } = {}) {
  fs.mkdirSync(outDir, { recursive: true });

  const dataset = buildEcoDataset();
  const familyIndex = buildFamilyIndex(dataset.lines);
  const t1 = t1Families(familyIndex);

  const written = [];

  // --- T1: family hub pages ---------------------------------------------
  for (const familyEntry of t1) {
    const mainLineSide = resolveMainLineSide(familyEntry);
    // eslint-disable-next-line no-await-in-loop -- serial by design, see header comment
    const bandResponses = await fetchFamilyBandResponses(familyEntry.mainLine, { fetchImpl, familySlug: familyEntry.slug, aggregatesDir });
    const bandStats = buildFamilyBandStats({ side: mainLineSide, bandResponses });
    const t0CrossLink = findT0CrossLink(familyEntry);
    const drillCrossLink = findDrillCrossLink(familyEntry, drillPages);
    const relatedFamilies = pickRelatedFamilies(familyEntry, t1);
    const html = renderFamilyHubPage({ familyEntry, bandStats, nav, t0CrossLink, drillCrossLink, relatedFamilies, mainLineSide });
    const file = familyHubFilename(familyEntry.slug);
    fs.writeFileSync(path.join(outDir, file), html, 'utf8');
    written.push({ file, html, slug: familyEntry.slug, title: extractTitle(html), description: extractDescription(html) });
  }

  // --- T2: ECO volume index pages (A-E) -----------------------------------
  for (const volume of Object.keys(VOLUME_LABELS)) {
    const codeRows = buildVolumeCodeRows(dataset.lines, volume, familyIndex);
    const html = renderEcoVolumeIndexPage({ volume, codeRows, nav });
    const file = ecoVolumeFilename(volume);
    fs.writeFileSync(path.join(outDir, file), html, 'utf8');
    written.push({ file, html, slug: `eco-volume-${volume.toLowerCase()}`, title: extractTitle(html), description: extractDescription(html) });
  }

  // --- T2: paginated all-families browse index ----------------------------
  const stats = { totalFamilies: familyIndex.length, t1Count: t1.length, totalLines: dataset.stats.totalLines };
  const pageSize = Math.ceil(familyIndex.length / ECO_INDEX_PAGE_COUNT);
  const totalPages = Math.ceil(familyIndex.length / pageSize);
  for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
    const pageFamilies = familyIndex.slice((pageNum - 1) * pageSize, pageNum * pageSize);
    const html = renderEcoIndexPage({ pageFamilies, pageNum, totalPages, stats, nav });
    const file = ecoIndexPageFilename(pageNum);
    fs.writeFileSync(path.join(outDir, file), html, 'utf8');
    written.push({ file, html, slug: `eco-openings-page-${pageNum}`, title: extractTitle(html), description: extractDescription(html) });
  }

  assertPageMetadata(written);

  return { written, familyIndex, t1, stats };
}

module.exports = {
  buildEcoPages,
  fetchFamilyBandResponses,
  findT0CrossLink,
  findDrillCrossLink,
  pickRelatedFamilies,
  buildVolumeCodeRows,
  ECO_INDEX_PAGE_COUNT,
};
