'use strict';

/**
 * Repertoire Pack generator -- the monetization-layer artifact spec
 * (Repertoire Pack build plan, sections 1.2/1.3). Pure tree-
 * building logic lives here; PGN/manifest/README serialization also lives
 * here (all pure functions, no I/O); the orchestration script that fetches
 * live data and writes files to disk is scripts/buildPacks.js.
 *
 * THE RULE, restated from the spec so a reader doesn't need the spec open:
 *
 *  - Root: the position after the pack's stated first move (e.g. 1.e4 for a
 *    White pack, or White's 1.e4 itself for a Black-vs-e4 pack -- either
 *    way, ply 0 is always White's move, since White always moves first).
 *  - At an OPPONENT-to-move node: include replies in descending frequency
 *    until cumulative frequency >= 90% at that node; drop any reply below
 *    1.5% frequency or below n=300 games.
 *  - At OUR-to-move node: among candidates with n >= 300, take the move
 *    with the highest lower-bound confidence-interval score, where
 *    score = (W + 0.5*D) / n. Tie-break within 0.5 percentage points
 *    toward the move producing fewer opponent replies above the 1.5%
 *    threshold at the resulting position.
 *  - Stop expanding a node once ply reaches MAX_PLY, or n < MIN_N at that
 *    node, or reach < MIN_REACH.
 *  - Size cap: if the resulting position count exceeds SIZE_CAP, raise the
 *    opponent-reply frequency threshold in 0.5pp steps until under cap.
 *
 * ONE DELIBERATE, DISCLOSED DEVIATION FROM THE SPEC'S WORDING: the spec
 * calls the lower bound used to pick our own move a "Wilson 95% lower
 * bound on score-for-our-side". src/stats.js's own module doc explains,
 * with the reasoning spelled out, why a literal Wilson interval (built for
 * a binomial proportion) must NOT be applied to `score = (W + 0.5D)/n`,
 * which is a trinomial sample mean, not a binomial proportion -- doing so
 * would be "exactly the impressive-looking-but-false arithmetic
 * Non-Negotiable 5 (statistical honesty) prohibits" (stats.js's own
 * words). This module therefore uses stats.js's `scoreInterval()` (the
 * function already built for exactly this quantity, using the correct
 * trinomial-variance normal approximation) and takes its `.low` bound.
 * The resulting number is numerically close to what a (mathematically
 * incorrect) direct Wilson-on-score call would have produced, and every
 * on-page/PDF/README label calls it a "confidence lower bound", never a
 * "Wilson interval", to stay honest about which formula actually ran --
 * see pack.json's `wilson` field doc below for where that label lives.
 */

const { RATING_BANDS, DEFAULT_SPEEDS } = require('./processRepertoire');
const { scoreInterval } = require('./stats');
const { Chess } = require('chess.js');
// applyExplorerUci/pgnFromTree moved to src/buildPackCore.js (a zero-
// dependency, genuinely pure sibling module) and re-exported below
// unchanged -- see that file's own header comment for why: WS-1 spec
// section 3.7/4.7 requires src/browser/bandData.client.js and
// src/repertoireModel.js to reuse these exact two functions, and
// requiring them via THIS file (which also requires ./explorerSource,
// which requires fs/path) broke every browser bundle that transitively
// needed either of them (esbuild "Could not resolve fs/path" against
// platform:'browser' -- a real, reproduced failure, not a hypothetical
// one; discovered building WS-1's Repertoire Builder page). Every
// existing caller of buildPack.js's own applyExplorerUci/pgnFromTree
// exports is unaffected -- same names, same behavior, now implemented in
// buildPackCore.js and simply re-exported here.
const { applyExplorerUci, pgnFromTree } = require('./buildPackCore');
// Safe as a top-level require here (unlike ./explorerSource's own
// fs/path-bearing fetchMoves(), which stays a local require inside
// buildTree() below): no browser esbuild entry point requires buildPack.js
// itself -- src/browser/*.client.js only pulls in applyExplorerUci/
// pgnFromTree via buildPackCore.js, the zero-dependency split that exists
// for exactly this reason (see that comment above).
const { poolDisclosure } = require('./explorerSource');

const RULE_VERSION = '1';
const MIN_N = 300;
const MIN_OPPONENT_FREQ = 0.015; // 1.5%
const CUMULATIVE_TARGET = 0.90;
const MAX_PLY = 12;
const MIN_REACH = 0.005;
const SIZE_CAP = 800;
const THRESHOLD_STEP = 0.005; // 0.5 percentage points
const TIE_BAND = 0.005; // 0.5 percentage points, spec 1.3's tie-break window

/**
 * FEN after replaying a UCI move list from the standard starting position.
 * Throws if any move is illegal -- every move list this module plays comes
 * from the Lichess Opening Explorer (live or aggregate-cache), so an
 * illegal move here means a real data/logic bug, not untrusted input (this
 * is the same "legal by construction" assumption src/chessPosition.js's
 * header comment documents for the rest of this codebase's build-time
 * code -- this module is build-time only, never runs on visitor input).
 */
function fenAfter(play) {
  const chess = new Chess();
  for (const uci of play) {
    try {
      // chess.js 1.4.0 THROWS for an illegal move (object-form `.move()`),
      // it does not return null the way SAN-string-form `.move()` does --
      // verified directly against this project's own pinned version
      // (same "verified today, not assumed" discipline pgnWrapper.js's
      // header comment documents for this exact library).
      applyExplorerUci(chess, uci);
    } catch (err) {
      throw new Error(`buildPack.fenAfter: illegal move "${uci}" in play list [${play.join(',')}]: ${err.message}`);
    }
  }
  return chess.fen();
}

/**
 * Per-move stats relative to whichever color is `moverColor` (the side
 * that PLAYS this candidate move) -- symmetric for our-moves and
 * opponent-moves, since both need "the mover's own win/draw/loss counts
 * for this move" the same way.
 *
 * @returns {{uci, san, n, w, d, l, freq, score, low, high, averageRating}}
 *   `freq` is this move's share of `totalAtNode` (0 when totalAtNode is 0).
 *   `score`/`low`/`high` are null when n === 0 (scoreInterval's own
 *   null-safe fraction-in-[0,1] convention, see stats.js).
 */
function statsForCandidate(m, moverColor, totalAtNode) {
  const white = m.white || 0;
  const draws = m.draws || 0;
  const black = m.black || 0;
  const n = white + draws + black;
  const w = moverColor === 'white' ? white : black;
  const l = moverColor === 'white' ? black : white;
  const interval = n > 0 ? scoreInterval(w, draws, l) : { score: null, low: null, high: null };
  return {
    uci: m.uci,
    san: m.san,
    n,
    w,
    d: draws,
    l,
    freq: totalAtNode > 0 ? n / totalAtNode : 0,
    score: interval.score,
    low: interval.low,
    high: interval.high,
    averageRating: typeof m.averageRating === 'number' ? m.averageRating : null,
  };
}

/** Raw candidates for one Explorer/aggregate response, sorted by games desc. */
function candidatesFor(response, moverColor) {
  const moves = Array.isArray(response.moves) ? response.moves : [];
  const totalAtNode = (response.white || 0) + (response.draws || 0) + (response.black || 0);
  return moves
    .map((m) => statsForCandidate(m, moverColor, totalAtNode))
    .sort((a, b) => b.n - a.n);
}

/** Opponent replies kept under the current threshold + 90%-cumulative rule. */
function includedOpponentReplies(candidates, threshold) {
  const included = [];
  let cum = 0;
  for (const c of candidates) {
    if (cum >= CUMULATIVE_TARGET) break;
    if (c.freq < threshold || c.n < MIN_N) break; // sorted desc by n -> monotonic, safe to stop
    included.push(c);
    cum += c.freq;
  }
  return included;
}

/**
 * Builds the pack's move tree for one (color, firstMove) pair. Pure aside
 * from the injected `fetchImpl`/`dir` (both forwarded verbatim to
 * src/explorerSource.js's fetchMoves(), the same seam every other builder
 * in this codebase already uses for testability -- see buildRepertoire.js).
 *
 * @param {object} opts
 * @param {string} opts.ratingBand a RATING_BANDS key.
 * @param {'white'|'black'} opts.color which side this pack is built for.
 * @param {string} opts.firstMoveUci the pack's stated, fixed first move
 *   (e.g. 'e2e4') -- part of the pack's identity, not derived by the rule.
 * @param {string[]} [opts.speeds]
 * @param {Function} [opts.fetchImpl]
 * @param {string} [opts.aggregatesDir]
 * @param {number} [opts.movesPerRequest] candidate moves requested per
 *   Explorer call -- generous default so the 90%-cumulative / size-cap
 *   logic has enough candidates to actually work with.
 * @returns {Promise<{ratingBand, color, firstMoveUci, tree: object,
 *   thresholdUsed: number, positionCount: number}>} `tree` is the single
 *   root node (see module doc for node shape); `thresholdUsed` is the
 *   opponent-frequency threshold this run settled on (>= MIN_OPPONENT_FREQ,
 *   raised in 0.5pp steps if the size cap was hit -- spec 1.3's size-cap
 *   rule, recorded so pack.json/README can state it, never hide it).
 */
async function buildPackTree({
  ratingBand,
  color,
  firstMoveUci,
  speeds = DEFAULT_SPEEDS,
  fetchImpl = fetch,
  aggregatesDir,
  movesPerRequest = 40,
} = {}) {
  // eslint-disable-next-line global-require -- deliberately lazy; see this file's top-of-file comment.
  const { fetchMoves, AGGREGATES_DIR } = require('./explorerSource');
  if (aggregatesDir === undefined) aggregatesDir = AGGREGATES_DIR;
  const ratings = RATING_BANDS[ratingBand];
  if (!ratings) {
    throw new Error(`buildPack.buildPackTree: unknown rating band "${ratingBand}". Valid bands: ${Object.keys(RATING_BANDS).join(', ')}`);
  }
  if (color !== 'white' && color !== 'black') {
    throw new Error(`buildPack.buildPackTree: color must be "white" or "black", got "${color}"`);
  }
  if (typeof firstMoveUci !== 'string' || firstMoveUci.length < 4) {
    throw new Error(`buildPack.buildPackTree: firstMoveUci must be a UCI move string, got "${firstMoveUci}"`);
  }

  // Response cache keyed by play-path so a size-cap retry (which re-walks
  // the whole tree at a higher threshold) never re-issues a request this
  // run already made -- keeps the retry cheap and, more importantly, keeps
  // Non-Negotiable 3 honest (no repeat live bursts for the same position).
  const responseCache = new Map();
  async function fetchNode(play) {
    const key = play.join(',');
    if (responseCache.has(key)) return responseCache.get(key);
    const response = await fetchMoves({ play, band: ratingBand, ratings, speeds, moves: movesPerRequest, fetchImpl, dir: aggregatesDir });
    responseCache.set(key, response);
    return response;
  }

  // `reach` (the argument) is the probability a game reaching the pack
  // root reaches the POSITION `play` resolves to, i.e. the position this
  // call is about to query candidate moves FROM.
  //
  // Each produced NODE's own `.reach` field, by contrast, is the
  // probability of reaching the position immediately AFTER that node's
  // own move has been played -- i.e. of that specific move having
  // actually happened. That's what makes `.reach` useful for sampling
  // (spec 1.6.3's "highest-reach lines") and drill ordering (spec 1.10c):
  // it must reflect how often a real opponent actually plays into this
  // specific branch, not merely how often the position it branches FROM
  // is reached. Concretely: an opponent move's own `.reach` is scaled by
  // THAT move's own frequency (each sibling reply gets a different,
  // smaller reach than the position they all branch from); our own
  // (single, deterministic) move's `.reach` is unchanged from the
  // position it's chosen at, since we always play it with certainty.
  // Either way, the value recursed into a node's OWN children is exactly
  // that same node's `.reach` -- the resulting position's reach IS the
  // reach of having played the move that reaches it.
  async function expand(play, threshold, reach) {
    const ply = play.length;
    if (ply >= MAX_PLY || reach < MIN_REACH) return [];

    const response = await fetchNode(play);
    const totalAtNode = (response.white || 0) + (response.draws || 0) + (response.black || 0);
    if (totalAtNode < MIN_N) return [];

    const whiteToMove = ply % 2 === 0;
    const moverColor = whiteToMove ? 'white' : 'black';
    const isOurMove = moverColor === color;
    const candidates = candidatesFor(response, moverColor);
    const currentFen = fenAfter(play);

    if (isOurMove) {
      const eligible = candidates.filter((c) => c.n >= MIN_N);
      if (eligible.length === 0) return [];

      const bestLow = Math.max(...eligible.map((c) => c.low));
      const tied = eligible.filter((c) => bestLow - c.low <= TIE_BAND);
      let chosen = tied[0];
      if (tied.length > 1) {
        // Tie-break: fewer opponent replies above threshold at the
        // resulting position (spec 1.3). Only fetched for genuinely tied
        // candidates, so this never adds cost to the common (no-tie) case.
        let bestBranchCount = Infinity;
        for (const cand of tied) {
          const childPlay = [...play, cand.uci];
          const childResponse = await fetchNode(childPlay);
          const childTotal = (childResponse.white || 0) + (childResponse.draws || 0) + (childResponse.black || 0);
          const childCandidates = candidatesFor(childResponse, moverColor === 'white' ? 'black' : 'white');
          const branchCount = childCandidates.filter((c) => childTotal > 0 && c.freq >= threshold && c.n >= MIN_N).length;
          if (branchCount < bestBranchCount) {
            bestBranchCount = branchCount;
            chosen = cand;
          }
        }
      }

      const node = buildNode({ fen: currentFen, ply, mover: moverColor, cand: chosen, isOurMove: true, reach });
      node.children = await expand([...play, chosen.uci], threshold, reach);
      return [node];
    }

    // Opponent to move: expand every kept reply as a sibling branch, each
    // with its OWN reach (parent reach scaled by this reply's own
    // frequency -- see this function's doc comment above).
    const included = includedOpponentReplies(candidates, threshold);
    const nodes = [];
    for (const cand of included) {
      const nodeReach = reach * cand.freq;
      const node = buildNode({ fen: currentFen, ply, mover: moverColor, cand, isOurMove: false, reach: nodeReach });
      node.children = await expand([...play, cand.uci], threshold, nodeReach);
      nodes.push(node);
    }
    return nodes;
  }

  function buildNode({ fen, ply, mover, cand, isOurMove, reach }) {
    return {
      fen,
      ply,
      side: mover,
      san: cand.san,
      uci: cand.uci,
      n: cand.n,
      w: cand.w,
      d: cand.d,
      l: cand.l,
      score: cand.score,
      // `wilson` is the pack.json field name the spec's schema uses; see
      // this file's header comment for why the actual math underneath is
      // stats.js's scoreInterval (trinomial CI), not a binomial Wilson
      // interval, and why that's the correct choice, not a shortcut.
      wilson: cand.low != null && cand.high != null ? [round4(cand.low), round4(cand.high)] : null,
      reach: round4(reach),
      averageRating: cand.averageRating,
      isOurMove,
      children: null,
    };
  }

  async function buildOnce(threshold) {
    const rootFen = fenAfter([]);
    const root = {
      fen: rootFen,
      ply: 0,
      side: 'white', // White always moves first, regardless of which color this pack is for
      san: null, // filled below once we know it from the actual position
      uci: firstMoveUci,
      n: null,
      w: null,
      d: null,
      l: null,
      score: null,
      wilson: null,
      reach: 1,
      averageRating: null,
      isOurMove: color === 'white',
      children: await expand([firstMoveUci], threshold, 1),
    };
    // Resolve the root's own SAN via chess.js directly (it has no "parent
    // candidates list" to read a san field from, unlike every other node).
    const chess = new Chess();
    let moveResult;
    try {
      moveResult = applyExplorerUci(chess, firstMoveUci); // throws on illegal, see fenAfter's comment
    } catch (err) {
      throw new Error(`buildPack.buildPackTree: firstMoveUci "${firstMoveUci}" is illegal from the starting position: ${err.message}`);
    }
    root.san = moveResult.san;
    return root;
  }

  let threshold = MIN_OPPONENT_FREQ;
  let root = await buildOnce(threshold);
  let positionCount = countPositions(root);
  // Size cap: raise the opponent-reply threshold in 0.5pp steps until the
  // tree fits under SIZE_CAP (spec 1.3). responseCache above means each
  // retry only pays for genuinely new (higher-threshold-excluded) work.
  while (positionCount > SIZE_CAP) {
    threshold += THRESHOLD_STEP;
    root = await buildOnce(threshold);
    positionCount = countPositions(root);
  }

  return { ratingBand, color, firstMoveUci, tree: root, thresholdUsed: round4(threshold), positionCount };
}

function round4(n) {
  return typeof n === 'number' ? Math.round(n * 10000) / 10000 : n;
}

/** Counts every node in the tree, root included -- what SIZE_CAP is checked against. */
function countPositions(root) {
  let count = 1;
  function walk(nodes) {
    for (const node of nodes || []) {
      count += 1;
      walk(node.children);
    }
  }
  walk(root.children);
  return count;
}

/** Flattens the tree (pre-order) into pack.json's `positions` array shape. */
function flattenPositions(root) {
  const out = [];
  function visit(node) {
    out.push({
      fen: node.fen,
      ply: node.ply,
      side: node.side,
      san: node.san,
      uci: node.uci,
      n: node.n,
      w: node.w,
      d: node.d,
      l: node.l,
      score: node.score != null ? round4(node.score) : null,
      wilson: node.wilson,
      reach: node.reach,
      isOurMove: node.isOurMove,
    });
    for (const child of node.children || []) visit(child);
  }
  visit(root);
  return out;
}

/**
 * The pack owner's own first real move, in SAN -- e.g. "e4" for a White
 * pack, "g6" for a Black-vs-1.e4 pack. Site-audit item (2026-08-29): the
 * pack's own first move was never stated anywhere on its sales page,
 * "only inferable from the board thumbnail". Not the same field for both
 * colors: `root.uci` is always fixed to the pack's defining scenario move
 * (buildPackTree()'s own firstMoveUci), which for a White pack IS the
 * owner's own first move (root.isOurMove is true there), but for a Black
 * pack is the OPPONENT's forced first move (root.isOurMove is false) --
 * the owner's real first move is root's own single child instead (a real
 * repertoire has exactly one chosen reply at every one of the owner's own
 * decision points, per buildPackTree()'s own "our move: pick the single
 * best" branch, confirmed structurally, not assumed: the very first ply
 * after a fixed opponent move can only ever have the one real position to
 * choose from). Handles both shapes with the same one check rather than a
 * per-color branch, so a future third pack color/shape doesn't need a new
 * case here.
 * @param {object} tree buildPackTree()'s own `result.tree` (the root node).
 * @returns {string|null} the SAN, or null if the tree is somehow empty.
 */
function ownFirstMoveSan(tree) {
  if (!tree) return null;
  if (tree.isOurMove) return tree.san;
  const child = tree.children && tree.children[0];
  return child ? child.san : null;
}

/** All root-to-leaf paths, each as an array of nodes (root included). */
function collectLeafPaths(root) {
  const out = [];
  function walk(node, pathSoFar) {
    const path = [...pathSoFar, node];
    if (!node.children || node.children.length === 0) {
      out.push(path);
    } else {
      for (const child of node.children) walk(child, path);
    }
  }
  walk(root, []);
  return out;
}

/**
 * Rebuilds a tree containing only nodes on the top-`count` root-to-leaf
 * lines by reach (descending) -- used for the free sample.pgn (spec
 * 1.6.3: "the first 47 lines"). Ties broken by original tree order
 * (Array.sort is stable).
 */
function pruneToTopLines(root, count) {
  const leaves = collectLeafPaths(root)
    .slice()
    .sort((a, b) => (b[b.length - 1].reach || 0) - (a[a.length - 1].reach || 0))
    .slice(0, count);

  const keepAtDepth = [];
  for (const path of leaves) {
    for (let d = 0; d < path.length; d += 1) {
      if (!keepAtDepth[d]) keepAtDepth[d] = new Set();
      keepAtDepth[d].add(path.slice(0, d + 1).map((n) => n.uci).join(','));
    }
  }

  function rebuild(node, depth, prefixKey) {
    const key = prefixKey ? `${prefixKey},${node.uci}` : node.uci;
    return {
      ...node,
      children: (node.children || [])
        .filter((c) => keepAtDepth[depth + 1] && keepAtDepth[depth + 1].has(`${key},${c.uci}`))
        .map((c) => rebuild(c, depth + 1, key)),
    };
  }
  return rebuild(root, 0, '');
}

/**
 * Builds pack.json (spec 1.2 item 2) from a buildPackTree() result.
 *
 * @param {object} result buildPackTree()'s return value.
 * @param {{id:string, title:string, speeds:string[], source?:string}} meta
 * @returns {object} plain, JSON.stringify-ready object -- byte-identical
 *   for byte-identical input aggregates (see test/buildPack.test.js's
 *   determinism test), since every field here is a pure function of
 *   `result` plus the caller-supplied, non-data-derived `meta`.
 */
function packJsonFromResult(result, { id, title, speeds, source = 'lichess-opening-explorer', retrieved }) {
  const positions = flattenPositions(result.tree);
  const lineCount = collectLeafPaths(result.tree).length;
  return {
    format: 'repertoire-pack/1',
    id,
    title,
    color: result.color,
    band: result.ratingBand,
    speeds,
    source,
    retrieved,
    rule_version: RULE_VERSION,
    threshold_used: result.thresholdUsed,
    line_count: lineCount,
    position_count: positions.length,
    positions,
  };
}

/**
 * README.txt body (spec 1.2 item 4). Plain text, no markup -- this ships
 * inside the sold artifact, read in a text editor, not a browser, so no
 * escaping/HTML concerns apply (unlike everything render.js produces).
 *
 * @param {object} packJson packJsonFromResult()'s output.
 * @param {{siteUrl:string, refreshPromiseVerified:boolean}} opts
 *   `refreshPromiseVerified` gates the refresh-policy paragraph -- spec
 *   1.2 item 4: "only promise the refresh line if the chosen merchant
 *   actually supports updating files for existing buyers... write nothing
 *   if not." Defaults to false (the safe default -- no promise unless a
 *   caller has actually verified it against the chosen merchant).
 */
function readmeText(packJson, { siteUrl, refreshPromiseVerified = false } = {}) {
  const lines = [
    packJson.title,
    ''.padEnd(packJson.title.length, '='),
    '',
    "WHAT'S IN THE BOX",
    `  repertoire.pgn    -- ${packJson.line_count} lines, ${packJson.position_count} annotated positions, standard PGN with variations.`,
    '  pack.json         -- the same data as a structured manifest; imports directly into the drill trainer at ' + siteUrl + '.',
    '  study-guide.pdf   -- a printable guide covering the highest-frequency branch points, with the band\'s full reply distribution at each one.',
    '  README.txt        -- this file.',
    '',
    'HOW TO USE THESE FILES',
    `  - This site (${siteUrl}): use the importer to load repertoire.pgn or pack.json directly into the Repertoire Builder and Drill Engine.`,
    '  - Lichess Study: import repertoire.pgn via Study > Import PGN game.',
    '  - ChessBase or any standard PGN reader: repertoire.pgn opens directly; the variations are ordinary PGN variations.',
    '',
    'HOW THIS PACK WAS BUILT',
    `  Every move was picked by one published, mechanical rule (version ${packJson.rule_version}), run against Lichess Opening Explorer`,
    `  data (database: lichess, speeds: ${packJson.speeds.join('/')}, rating band: ${packJson.band}), retrieved ${packJson.retrieved}.`,
    '',
    '  At each of our own decision points: among replies with at least 300 games in this band and pool, the pack plays the move',
    '  with the highest confidence-interval lower bound on score (wins plus half of draws, divided by games). At each opponent',
    '  decision point: the pack includes replies in descending frequency until they cover at least 90% of games at that position,',
    `  dropping any reply below 1.5% frequency or below 300 games. This run used a ${(packJson.threshold_used * 100).toFixed(1)}%`,
    '  frequency floor (raised above the 1.5% default only if needed to keep the pack under its size cap -- stated here either way).',
    '',
    'DISCLOSED LIMITATIONS',
    '  - Score is computed as (wins + 0.5 x draws) / games, which is a sample mean, not a win/loss proportion -- its confidence',
    '    interval uses a normal approximation over that trinomial outcome, not a binomial Wilson interval. That approximation is',
    '    sound at the sample sizes this pack requires (n >= 300) but is not an exact coverage guarantee.',
    '  - This pack is NOT transposition-aware: the same position reached by a different move order is counted separately if the',
    '    Opening Explorer indexes it under a different node. Pack size is stated here as "lines," not "positions covered."',
    // Source-aware: packJson.speeds is what this specific run actually
    // drew from (src/explorerSource.js's actualPoolSpeeds()), not a
    // hardcoded literal -- see that function's doc for why "blitz and
    // rapid" was previously false on any aggregate-sourced run. Both halves
    // of the sentence (included and excluded) come from poolDisclosure(),
    // which derives both from packJson.speeds so they can never contradict
    // -- this line previously always said "classical and bullet", silently
    // omitting rapid from the excluded list on a blitz-only run.
    `  - Data pool is ${poolDisclosure(packJson.speeds)}, matching the speeds line above.`,
    '  - The chosen move at each point is the highest lower-bound scorer among moves with enough games in this band and pool --',
    '    not a claim that it is objectively the best move in the position.',
    '',
    'DATA SOURCE AND LICENSE',
    '  Data: Lichess (https://database.lichess.org), released under CC0 -- free for any use, commercial included.',
    '  This pack is a derived work built from that public data; it is not affiliated with or endorsed by Lichess.',
    '',
  ];
  if (refreshPromiseVerified) {
    lines.push(
      'REFRESH POLICY',
      '  Packs are regenerated when the underlying band data is refreshed. Buyers receive the refreshed files at the same',
      '  download link.',
      ''
    );
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  RULE_VERSION,
  MIN_N,
  MIN_OPPONENT_FREQ,
  CUMULATIVE_TARGET,
  MAX_PLY,
  MIN_REACH,
  SIZE_CAP,
  THRESHOLD_STEP,
  TIE_BAND,
  fenAfter,
  applyExplorerUci,
  statsForCandidate,
  candidatesFor,
  includedOpponentReplies,
  buildPackTree,
  countPositions,
  flattenPositions,
  collectLeafPaths,
  ownFirstMoveSan,
  pruneToTopLines,
  pgnFromTree,
  packJsonFromResult,
  readmeText,
};
