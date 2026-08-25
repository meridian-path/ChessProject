'use strict';

/**
 * Pure processing for per-opening content pages. No I/O -- everything here
 * takes already-fetched Opening Explorer responses and openings.js config in,
 * and returns plain view-model data out, same convention as
 * processRepertoire.js (whose moveStatsFromExplorerResponse() this reuses
 * rather than re-implementing the percentage math).
 *
 * A note on whose "mistakes" this analyzes: every entry in openings.js
 * defines `line` as the featured side's OWN defining move sequence, so the
 * position reached after playing it is always the OPPONENT's move -- e.g.
 * the Italian Game's line ends on White's 3.Bc4, so Black is to move next.
 * That means "common mistakes" and "what people actually play next" are
 * naturally about how the opponent tends to respond, which is the useful
 * framing for a page about *playing* that opening ("here's how club players
 * often go wrong against you, and how to punish it").
 */

const { moveStatsFromExplorerResponse, RATING_BANDS } = require('./processRepertoire');

// Ordinal rating-band order (1400-1600, 1600-1800, 1800-2000, 2000+), used
// below to sort buildOpeningModel's `bands` array. bandResponses is built by
// its caller with the DEFAULT band inserted first (so the default-band
// lookup is a plain property access), so Object.keys(bandResponses) alone
// yields the default band hoisted ahead of lower bands -- fine for a table,
// wrong for anything that treats bands as an ordinal axis (e.g. a
// score-by-band chart, where an out-of-order x-axis misrepresents the trend).
const RATING_BAND_ORDER = Object.keys(RATING_BANDS);
const { scoreInterval, wilsonInterval } = require('./stats');

function opponentOf(side) {
  return side === 'white' ? 'black' : 'white';
}

/**
 * @param {{white:number, draws:number, black:number}} totals
 * @param {'white'|'black'} color
 * @returns {number|null} standard chess scoring (win=1, draw=0.5) as a
 *   percentage for `color`, or null if there's no data.
 */
function scoreFor(totals, color) {
  if (!totals) return null;
  const white = totals.white || 0;
  const draws = totals.draws || 0;
  const black = totals.black || 0;
  const total = white + draws + black;
  if (total <= 0) return null;
  const winsForColor = color === 'white' ? white : black;
  return Number((((winsForColor + draws / 2) / total) * 100).toFixed(1));
}

/**
 * Same computation as scoreFor(), plus the trinomial-variance confidence
 * interval around it (spec WS-3.3 section 3.1 -- src/stats.js's
 * scoreInterval(), never wilsonInterval(), since score is a mean over
 * {0, 0.5, 1}, not a binomial proportion). Kept as a separate function
 * rather than folded into scoreFor() itself so every existing scoreFor()
 * caller (there are several, all displaying a bare percentage with no CI
 * need) is untouched.
 *
 * @param {{white:number, draws:number, black:number}} totals
 * @param {'white'|'black'} color
 * @returns {{score:number, low:number, high:number, half:number}|null}
 *   `score`/`low`/`high` as PERCENTAGES (0-100, one decimal), `half` in
 *   percentage points -- null if there's no data (total <= 0).
 */
function scoreForWithCI(totals, color) {
  if (!totals) return null;
  const white = totals.white || 0;
  const draws = totals.draws || 0;
  const black = totals.black || 0;
  if (white + draws + black <= 0) return null;
  const winsForColor = color === 'white' ? white : black;
  const lossesForColor = color === 'white' ? black : white;
  const { score, low, high, half } = scoreInterval(winsForColor, draws, lossesForColor);
  return {
    score: Number((score * 100).toFixed(1)),
    low: Number((low * 100).toFixed(1)),
    high: Number((high * 100).toFixed(1)),
    half: Number((half * 100).toFixed(1)),
  };
}

// Rebuilt "common mistake" thresholds (spec WS-3.3 section 3.4), exported as
// one object (not scattered literals) so /methodology can render the actual
// live values instead of a prose paraphrase that drifts out of date --
// spec's explicit instruction. `maxScoreForMover` from the old rule (a bare
// score <= 47) is GONE: significance is now a CI comparison (condition 3
// below), not an arbitrary cutoff.
const MISTAKE_THRESHOLDS = {
  minPlayedPct: 2, // condition 1: frequency
  minBalancedN: 300, // condition 2: rating-diff-controlled sample floor
  limit: 2,
};

/**
 * Finds moves that are played often enough to matter at this rating AND
 * score badly for the side playing them AGAINST four conditions (spec
 * WS-3.3 section 3.4), all required -- a claim true by arithmetic and by a
 * real confidence interval, not an assertion of chess knowledge and not the
 * old single arbitrary literal (score <= 47):
 *
 *   1. FREQUENCY: playedPct >= minPlayedPct in the displayed band+pool.
 *   2. RATING-DIFF CONTROL: score the move on its BALANCED (rating gap <=
 *      50) subset, not all games. Requires balancedGames >= minBalancedN;
 *      below that the move isn't flagged at all -- there is no aggregate
 *      data to control for rating gap here (this is the live-Explorer-API
 *      fallback case today, since real balanced counts only exist once
 *      src/aggregateSource.js is the data source), so nothing is flagged
 *      rather than falling back to an uncontrolled number.
 *   3. SIGNIFICANCE: the move's own balanced-score CI upper bound must sit
 *      BELOW the parent position's balanced-score CI lower bound (both from
 *      src/stats.js's scoreInterval(), via scoreForWithCI() above). A move
 *      that merely scores lower than average isn't a mistake; one whose
 *      deficit survives its own error bar against the position's overall
 *      error bar is.
 *   4. TRANSPOSITION CHECK: the RESULTING position's own balanced score
 *      (merged across every move order that reaches it -- see
 *      src/aggregateSource.js's resultingPositionBalanced() doc comment)
 *      must ALSO sit below the parent's balanced-score CI lower bound. This
 *      is what stops flagging a move that simply transposes into a
 *      perfectly healthy position by an unusual order, and it's only
 *      possible because the pipeline keys by position, not move path.
 *
 * Expect this to flag FEWER moves than the old single-condition rule -- see
 * this function's callers for the honest empty-state rendering that's the
 * point, not a defect.
 *
 * @param {object} response an Explorer-shaped response for the PARENT
 *   position (src/aggregateSource.js's explorerShapedResponse() shape, or
 *   the live Explorer API's own shape as a fallback -- see module doc).
 * @param {'white'|'black'} moverColor whose candidate moves to evaluate
 * @param {{minPlayedPct?:number, minBalancedN?:number, limit?:number}} [opts]
 * @returns {Array} moves (each carrying a `score` field -- the BALANCED-
 *   subset score, per condition 2, NOT the all-games score the old version
 *   returned here), worst score first.
 */
function findCommonMistakes(response, moverColor, opts = {}) {
  const { minPlayedPct = MISTAKE_THRESHOLDS.minPlayedPct, minBalancedN = MISTAKE_THRESHOLDS.minBalancedN, limit = MISTAKE_THRESHOLDS.limit } = opts;
  const moves = moveStatsFromExplorerResponse(response, moverColor);

  // Condition 3/4's comparison point: the PARENT position's own balanced
  // score CI, from the SAME moverColor's perspective as every move below.
  // Absent entirely on the live-Explorer-API fallback (response.balanced is
  // undefined there) -- in that case conditions 2-4 can never pass, so
  // nothing is flagged, matching this function's module-doc expectation.
  const parentTotals = response && response.balanced ? response.balanced : null;
  const parentCI = parentTotals ? scoreForWithCI(parentTotals, moverColor) : null;

  return moves
    .filter((m) => m.playedPct != null && m.playedPct >= minPlayedPct) // condition 1
    .map((m) => {
      const moveCI = m.balancedGames >= minBalancedN && m.balanced ? scoreForWithCI(m.balanced, moverColor) : null;
      const resultingScore = m.resultingBalanced ? scoreFor(m.resultingBalanced, moverColor) : null;
      return { ...m, moveCI, resultingScore };
    })
    .filter((m) => m.moveCI != null) // condition 2
    .filter((m) => parentCI != null && m.moveCI.high < parentCI.low) // condition 3
    .filter((m) => m.resultingScore != null && m.resultingScore < parentCI.low) // condition 4
    .sort((a, b) => a.moveCI.score - b.moveCI.score)
    .slice(0, limit)
    .map((m) => ({ ...m, score: m.moveCI.score, scoreCI: m.moveCI.half }));
}

/**
 * Assembles one opening page's full view-model from already-fetched Explorer
 * responses. See module doc for why `mistakes`/`topReplies` are computed for
 * the opponent's color, not the featured side's.
 *
 * @param {object} opts
 * @param {object} opts.openingConfig one entry from openings.js's OPENINGS
 * @param {Record<string, object|null>} opts.bandResponses band name -> /lichess response
 * @param {object|null} opts.mastersResponse /masters response for the same line
 * @param {object|null} opts.mistakeFollowUpResponse /lichess response for the
 *   position after the single worst mistake found in the default band
 * @param {string} [opts.defaultBand]
 * @param {number} [opts.minGamesForPct] below this many games, suppress
 *   percentages for that band rather than print a noisy one (spec 5.7)
 */
function buildOpeningModel({
  openingConfig,
  bandResponses,
  mastersResponse = null,
  mistakeFollowUpResponse = null,
  defaultBand = '1600-1800',
  minGamesForPct = 1000,
}) {
  const opponentColor = opponentOf(openingConfig.side);
  const defaultResp = bandResponses ? bandResponses[defaultBand] : null;

  // eco: authoritative from the API when available (spec 1.2 -- print the
  // API's value if it disagrees with ecoHint, never assume equal).
  // name: always the curated openings.js name, deliberately NOT the API's
  // per-position name. The API's `opening.name` at a given position can be
  // a much longer, more specific classification than the opening this page
  // is actually about (observed live: the London System position returned
  // "Queen's Pawn Game: Accelerated London System" -- accurate, but it blew
  // past the 65-char title cap and would have made the page's own H1,
  // title, breadcrumb, and URL slug all disagree with each other). Keeping
  // one short, human-chosen name everywhere is both an SEO-length
  // requirement and a coherence one.
  const apiOpening = defaultResp && defaultResp.opening ? defaultResp.opening : null;
  const eco = apiOpening && apiOpening.eco ? apiOpening.eco : openingConfig.ecoHint;
  const name = openingConfig.name;

  // WS-3.3's balanced-subset minimum for a CROSS-OPENING ranking to use it
  // (spec section 3.4's condition-2 minBalancedN, reused here rather than a
  // second invented constant -- same "rating gap <=50 subset is only
  // trustworthy at n>=300" judgment applies to both).
  const minBalancedNForBand = MISTAKE_THRESHOLDS.minBalancedN;

  const bandKeysOrdinal = Object.keys(bandResponses || {}).sort(
    (a, b) => RATING_BAND_ORDER.indexOf(a) - RATING_BAND_ORDER.indexOf(b)
  );
  const bands = bandKeysOrdinal.map((band) => {
    const resp = bandResponses[band];
    const totals = { white: (resp && resp.white) || 0, draws: (resp && resp.draws) || 0, black: (resp && resp.black) || 0 };
    const games = totals.white + totals.draws + totals.black;
    const enoughData = games >= minGamesForPct;

    // Wilson half-widths (percentage points) for the three displayed rates
    // -- spec 3.2 requires an interval on every displayed rate, not just
    // score. Suppressed under the same minGamesForPct gate as the
    // percentages themselves (an interval on a suppressed number is
    // meaningless).
    const whiteCI = enoughData ? Number((wilsonInterval(totals.white, games).half * 100).toFixed(1)) : null;
    const drawCI = enoughData ? Number((wilsonInterval(totals.draws, games).half * 100).toFixed(1)) : null;
    const blackCI = enoughData ? Number((wilsonInterval(totals.black, games).half * 100).toFixed(1)) : null;

    const scoreCIResult = enoughData ? scoreForWithCI(totals, openingConfig.side) : null;

    // Balanced (rating gap <=50) score for this SAME band -- the
    // rating-diff-controlled figure WS-3.3 section 3.3 requires cross-
    // opening rankings to rank on. Only present at all once this build is
    // sourced from src/aggregateSource.js (resp.balanced) -- undefined on
    // the live-Explorer-API fallback, which findCommonMistakes() already
    // treats the same way (see that function's own doc).
    const balancedTotals = resp && resp.balanced ? resp.balanced : null;
    const balancedGames = balancedTotals ? balancedTotals.white + balancedTotals.draws + balancedTotals.black : 0;
    const balancedEnough = balancedGames >= minBalancedNForBand;
    const balancedScoreCI = balancedEnough ? scoreForWithCI(balancedTotals, openingConfig.side) : null;

    return {
      band,
      games,
      whitePct: enoughData ? Number(((totals.white / games) * 100).toFixed(1)) : null,
      drawPct: enoughData ? Number(((totals.draws / games) * 100).toFixed(1)) : null,
      blackPct: enoughData ? Number(((totals.black / games) * 100).toFixed(1)) : null,
      whiteCI,
      drawCI,
      blackCI,
      scoreForSide: scoreCIResult ? scoreCIResult.score : null,
      scoreForSideCI: scoreCIResult ? scoreCIResult.half : null,
      balancedGames,
      scoreForSideBalanced: balancedScoreCI ? balancedScoreCI.score : null,
      scoreForSideBalancedCI: balancedScoreCI ? balancedScoreCI.half : null,
      enoughData,
    };
  });

  const openingByUci = {};
  if (defaultResp && Array.isArray(defaultResp.moves)) {
    for (const m of defaultResp.moves) {
      if (m.opening) openingByUci[m.uci] = m.opening;
    }
  }
  const topReplies = defaultResp
    ? moveStatsFromExplorerResponse(defaultResp, opponentColor)
        .slice(0, 6)
        .map((m) => ({ ...m, opening: openingByUci[m.uci] || null }))
    : [];

  const mistakes = defaultResp ? findCommonMistakes(defaultResp, opponentColor) : [];
  if (mistakes.length > 0 && mistakeFollowUpResponse) {
    const punishingReplies = moveStatsFromExplorerResponse(mistakeFollowUpResponse, openingConfig.side);
    mistakes[0] = { ...mistakes[0], punishingReply: punishingReplies[0] || null };
  }

  // Same findCommonMistakes() call as `mistakes` above, run against every
  // OTHER already-fetched band too -- the .balanced/resultingBalanced data
  // it needs is a property of the position lookup itself (band+pool+posKey,
  // see aggregateSource.js's explorerShapedResponse), not something only the
  // default-band fetch produces, so this costs zero extra Explorer calls:
  // bandResponses already holds all 4 bands (fetchOpeningData fetches them
  // for the existing per-band comparison table). No punishingReply here --
  // that needs one more conditional fetch per band, left as a disclosed
  // future enhancement rather than built now (see the mistakes-by-band guide
  // factory's own header comment).
  const mistakesByBand = {};
  for (const band of Object.keys(bandResponses || {})) {
    mistakesByBand[band] = bandResponses[band] ? findCommonMistakes(bandResponses[band], opponentColor) : [];
  }
  mistakesByBand[defaultBand] = mistakes;

  const masterGames = mastersResponse && Array.isArray(mastersResponse.topGames) ? mastersResponse.topGames : [];
  const recentGames = defaultResp && Array.isArray(defaultResp.recentGames) ? defaultResp.recentGames : [];

  return {
    slug: openingConfig.slug,
    eco,
    name,
    side: openingConfig.side,
    opponentColor,
    line: openingConfig.line,
    defaultBand,
    bands,
    topReplies,
    mistakes,
    mistakesByBand,
    masterGames,
    recentGames,
  };
}

/**
 * Ranks the 10 tracked openings at one rating band, for cross-opening
 * comparison articles (phase 2) -- rebuilt per spec WS-3.3 section 3.3's
 * selection-effect disclosure rule:
 *
 *   1. Rank on the BALANCED-subset score (scoreForSideBalanced, rating gap
 *      <=50) when every ranked entry has one, since that removes the
 *      largest single confound (which players choose an opening) instead
 *      of merely disclosing it. `usedBalanced: true` on the returned rows
 *      when this happened.
 *   2. FALLS BACK to the all-games score (scoreForSide, `usedBalanced:
 *      false`) when balanced data isn't available for this build -- true
 *      of every ranking today, since real balanced counts only exist once
 *      src/aggregateSource.js is the data source (WS-3 B2's live ingest,
 *      not yet run). This is a disclosed degradation, not a silent one:
 *      never claim a control that wasn't actually applied (Non-Negotiable
 *      5) -- callers must render `usedBalanced` honestly, not assume true.
 *   3. A row ties with (shares the rank of) the CURRENT TIE GROUP'S ANCHOR
 *      -- the top-scoring row that started that group -- when their score
 *      gap is smaller than the sum of their own CI half-widths, rather
 *      than being shown as a strict, unsupported ordering. Comparison is
 *      against the group anchor, not merely the immediately preceding row:
 *      chaining ties through a sequence of small adjacent gaps (row 1 ties
 *      row 2, row 2 ties row 3, ...) can transitively group rows whose own
 *      CIs never overlap at all -- the same non-transitivity fallacy as
 *      "A resembles B, B resembles C, therefore A resembles C." Anchoring
 *      every comparison to the group's top row keeps each tie group
 *      statistically defensible: every member is directly indistinguishable
 *      from the group's best score, not just from its neighbor. This is
 *      competition-style ranking (a tie consumes its rank position, so the
 *      next distinct row is numbered by count, not by 1-more-than-the-tie).
 *
 * Openings whose band doesn't have enough games at all (see
 * buildOpeningModel's minGamesForPct) are left out entirely rather than
 * shown with a noisy percentage -- same "don't print a confident number
 * from 8 games" rule as the per-opening page itself.
 *
 * @param {Array<{openingConfig:object, model:object}>} entries
 * @param {string} band a RATING_BANDS key, e.g. '1600-1800'
 * @returns {Array<{slug,name,side,band,games,scoreForSide,scoreForSideCI,
 *   scoreForSideBalanced,scoreForSideBalancedCI,usedBalanced,rank}>} best
 *   (ranked) score first.
 */
function rankOpeningsByScore(entries, band) {
  const rows = entries
    .map(({ openingConfig, model }) => {
      const b = (model.bands || []).find((x) => x.band === band);
      return {
        slug: openingConfig.slug,
        name: model.name,
        side: model.side,
        band,
        games: b ? b.games : 0,
        scoreForSide: b ? b.scoreForSide : null,
        scoreForSideCI: b ? b.scoreForSideCI : null,
        scoreForSideBalanced: b ? b.scoreForSideBalanced : null,
        scoreForSideBalancedCI: b ? b.scoreForSideBalancedCI : null,
        enoughData: b ? b.enoughData : false,
      };
    })
    .filter((e) => e.enoughData);

  // Use the balanced score for ranking only when EVERY row being ranked has
  // one -- ranking some rows on a controlled figure and others on an
  // uncontrolled one would silently mix two different measurements in one
  // ordering, which is worse than falling back for all of them.
  const usedBalanced = rows.length > 0 && rows.every((r) => r.scoreForSideBalanced != null);
  const rankScore = (r) => (usedBalanced ? r.scoreForSideBalanced : r.scoreForSide);
  const rankHalf = (r) => (usedBalanced ? r.scoreForSideBalancedCI : r.scoreForSideCI) || 0;

  const sorted = rows
    .map((r) => ({ ...r, usedBalanced }))
    .sort((a, b) => rankScore(b) - rankScore(a));

  // Competition-style rank assignment with ties: a row ties (shares a rank)
  // with the row that ANCHORS its current tie group -- the top-scoring row
  // since the last real (non-tied) break -- when their score gap is
  // smaller than the SUM of their own CI half-widths, the gap the data
  // cannot actually distinguish. Comparing against the group anchor rather
  // than only the previous row prevents a chain of small adjacent gaps
  // from transitively tying rows whose own CIs don't overlap at all (see
  // point 3 in the function doc above).
  let rank = 1;
  let anchorIndex = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (i === 0) {
      sorted[i].rank = rank;
      continue;
    }
    const anchor = sorted[anchorIndex];
    const cur = sorted[i];
    const gap = rankScore(anchor) - rankScore(cur);
    const tie = gap < rankHalf(anchor) + rankHalf(cur);
    if (!tie) {
      rank = i + 1;
      anchorIndex = i;
    }
    sorted[i].rank = rank;
  }
  return sorted;
}

/**
 * Flattens every opening's already-computed mistakes (findCommonMistakes
 * output, see buildOpeningModel) into one list tagged with which opening and
 * side it came from, worst-scoring first -- the data source for the
 * "most common opening mistakes" articles (phase 2/candidate 5), which are
 * unique to this site precisely because nobody else aggregates this across
 * openings.
 *
 * @param {Array<{openingConfig:object, model:object}>} entries
 * @param {string} [band] which band's mistakes to read, via
 *   model.mistakesByBand[band]. Defaults to model.defaultBand's own
 *   `mistakes` field (unchanged behavior for the original 1600-1800 page) --
 *   passing the default band explicitly is equivalent, since
 *   mistakesByBand[defaultBand] is always set to the same array.
 * @returns {Array<{slug,name,opponentColor,defaultBand,band,san,playedPct,score,punishingReply}>}
 */
function aggregateMistakesAcrossOpenings(entries, band = null) {
  const out = [];
  for (const { openingConfig, model } of entries) {
    const usedBand = band || model.defaultBand;
    const mistakes = band ? (model.mistakesByBand && model.mistakesByBand[band]) || [] : model.mistakes || [];
    for (const m of mistakes) {
      out.push({
        slug: openingConfig.slug,
        name: model.name,
        opponentColor: model.opponentColor,
        defaultBand: model.defaultBand,
        band: usedBand,
        san: m.san,
        playedPct: m.playedPct,
        score: m.score,
        punishingReply: m.punishingReply || null,
      });
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

/**
 * For a single opening's model, the spread between its highest- and
 * lowest-scoring rating band (bands with enough data only) -- how much the
 * featured side's score for this exact line moves across 1400-1600 through
 * 2000+. Used by the "does opening choice matter under 1500" article to ask
 * a computable version of that question instead of asserting an opinion.
 *
 * @param {object} model output of buildOpeningModel
 * @returns {{minBand:string, minScore:number, maxBand:string, maxScore:number, range:number}|null}
 *   null if fewer than 2 bands have enough data to compare.
 */
function scoreRangeAcrossBands(model) {
  const withData = (model.bands || []).filter((b) => b.enoughData && b.scoreForSide != null);
  if (withData.length < 2) return null;
  const min = withData.reduce((a, b) => (b.scoreForSide < a.scoreForSide ? b : a));
  const max = withData.reduce((a, b) => (b.scoreForSide > a.scoreForSide ? b : a));
  return {
    minBand: min.band,
    minScore: min.scoreForSide,
    maxBand: max.band,
    maxScore: max.scoreForSide,
    range: Number((max.scoreForSide - min.scoreForSide).toFixed(1)),
  };
}

module.exports = {
  scoreFor,
  scoreForWithCI,
  MISTAKE_THRESHOLDS,
  findCommonMistakes,
  buildOpeningModel,
  opponentOf,
  rankOpeningsByScore,
  aggregateMistakesAcrossOpenings,
  scoreRangeAcrossBands,
};
