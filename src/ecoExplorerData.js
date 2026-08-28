'use strict';

/**
 * Build-time data shaping for T3, the interactive ECO explorer
 * (src/renderEcoExplorerPage.js + src/browser/ecoExplorer.client.js). Pure
 * functions only -- takes src/ecoData.js's `buildEcoDataset()` output (and
 * src/ecoFamilies.js's family index) in, returns plain, JSON-serializable
 * data out. No I/O, no network, independently unit-testable.
 *
 * Two distinct payloads, sized very differently on purpose ("split T3's
 * data payload" -- the reasoning is inlined below rather than pointed at
 * elsewhere):
 *
 * - `buildExplorerLineIndex()` -- the SEARCH index, one compact array per
 *   line (not an object -- object keys repeated 3,810 times cost real
 *   bytes gzip can't fully undo). Craft-audit item 5 (2026-08-28): used to
 *   be inlined directly into the page's own HTML at build time (the same
 *   pattern src/renderDrill.js still uses for its much smaller baked drill
 *   tree) -- at ~562 KB raw / ~53 KB gzip, that meant re-downloading the
 *   whole index, uncacheable, on every visit. src/buildEcoExplorer.js now
 *   writes it to its own static asset (dist/eco-explorer-lines.json,
 *   same convention as the reverse-lookup file below) and
 *   src/browser/ecoExplorer.client.js fetches it once, eagerly, as soon as
 *   the script runs (not lazily like the reverse lookup below -- search is
 *   this page's primary feature, not a secondary one gated on user action).
 *   A fetch failure (e.g. this page opened directly from disk) degrades to
 *   an honest status message, same discipline as the reverse-lookup fetch.
 *   Measured: 3,810 rows, ~53 KB gzip -- see this module's own test for the
 *   exact shape.
 *
 * - `buildReverseLookupIndex()` -- the FEN -> opening-name REVERSE lookup,
 *   sourced from hayatbiralem/eco.json (Source B, 12,379 position entries,
 *   ~170 KB gzip even after stripping every field this page doesn't need).
 *   Also too large to justify blocking first paint, and less urgently
 *   needed than search -- src/buildEcoExplorer.js writes it to its own
 *   static asset (dist/eco-reverse-lookup.json) and the browser fetches it
 *   lazily, only the first time a visitor actually pastes a FEN/PGN or
 *   makes a free-play move.
 *
 * Both payloads now trade away this site's file:// invariant for this one
 * page's two features (search, FEN identification) -- two scoped, declared
 * exceptions (see this project's TESTING.md), not something a reader should
 * discover by surprise. Every other page on the site still holds the
 * invariant; see src/render.js's SITE_CSS_FILE comment for why an external
 * `<link rel="stylesheet">` is a different case (a browser-resolved asset
 * reference, not a script-driven fetch) that does NOT carry the same
 * exception.
 */

const { familyHubFilename, MIN_T1_LINES } = require('./ecoFamilies');

/**
 * Truncates a FEN to its first 4 space-separated fields (board placement,
 * active color, castling rights, en-passant target), dropping the halfmove
 * clock and fullmove number. Those two counters never distinguish one
 * "opening position" from another for identification purposes -- two games
 * reaching the identical board/turn/castling/en-passant state ARE the same
 * position (a genuine transposition), regardless of how many moves or
 * half-moves-since-a-pawn-or-capture it took to get there -- so dropping
 * them is a correctness-preserving size reduction, not a lossy
 * approximation. Exported so src/buildEcoExplorer.js and the browser
 * client (which must truncate a chess.js-produced FEN the same way before
 * looking it up) apply the identical rule.
 */
function truncateFenForLookup(fen) {
  return String(fen).split(' ').slice(0, 4).join(' ');
}

/**
 * @param {Array} lines buildEcoDataset().lines
 * @param {Array} familyIndex ecoFamilies.buildFamilyIndex() output (all 149)
 * @returns {Array<[eco:string, name:string, family:string, san:string, hubFile:string|null]>}
 *   `san` is every ply's SAN move, space-joined (e.g. "e4 e5 Nf3") -- SAN
 *   rather than UCI, deliberately: it is both what a visitor actually types
 *   when searching ("Nf3", not "g1f3") AND directly replayable client-side
 *   through chess.js's own `chess.move(san, {strict:true})` (the exact same
 *   call src/ecoData.js's deriveLine() already used to validate this row at
 *   build time -- replaying the identical SAN sequence reproduces the
 *   identical result deterministically, so no UCI round-trip is needed).
 *   No per-ply FEN is stored here either, which is most of what keeps this
 *   payload ~50 KB gzip instead of ~72+ KB (measured, see this module's
 *   test). `hubFile` is this line's family's T1 hub filename when that
 *   family has one (>= MIN_T1_LINES lines), else `null` -- never a
 *   fabricated link to a page that doesn't exist.
 */
function buildExplorerLineIndex(lines, familyIndex) {
  const hubFileByFamily = new Map(
    familyIndex
      .filter((f) => f.lineCount >= MIN_T1_LINES)
      .map((f) => [f.family, familyHubFilename(f.slug)])
  );
  return lines.map((line) => [
    line.eco,
    line.name,
    line.family,
    line.plies.map((p) => p.san).join(' '),
    hubFileByFamily.get(line.family) || null,
  ]);
}

/**
 * @param {Array} openings src/openings.js's OPENINGS array
 * @returns {Record<string,string>} exact opening `name` -> that opening's
 *   own T0 page filename, for the ~10 families with a hand-built deep-dive
 *   page. Same exact-name-match convention src/buildEcoPages.js's
 *   findT0CrossLink() already uses for T1 -- never a fabricated link.
 */
function buildT0CrossLinkMap(openings) {
  const map = {};
  for (const o of openings) {
    map[o.name] = `${o.slug}.html`;
  }
  return map;
}

/**
 * @param {Map<string,{eco:string,name:string}>} sourceBByFen Source B's raw
 *   FEN -> {eco, name, ...} map (src/ecoData.js's loadSourceB output)
 * @returns {Array<[truncatedFen:string, eco:string, name:string]>} sorted
 *   ascending by `truncatedFen`, ready for client-side binary search
 *   (ecoExplorer.client.js's lookupFen). Two Source B entries that
 *   truncate to the same key (a real transposition at the counter level)
 *   collapse to one row, first-seen-wins -- deterministic given a stable
 *   input iteration order, and harmless: both would have named the exact
 *   same physical position, so this can only ever discard a duplicate,
 *   never a materially different one. Measured against the real vendored
 *   data: 12,377 raw entries -> 12,106 unique truncated keys.
 */
function buildReverseLookupIndex(sourceBByFen) {
  const seen = new Map();
  for (const [fen, entry] of sourceBByFen.entries()) {
    const key = truncateFenForLookup(fen);
    if (!seen.has(key)) {
      seen.set(key, [key, entry.eco, entry.name]);
    }
  }
  return [...seen.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

module.exports = {
  truncateFenForLookup,
  buildExplorerLineIndex,
  buildT0CrossLinkMap,
  buildReverseLookupIndex,
};
