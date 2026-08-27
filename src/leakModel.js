'use strict';

/**
 * The leak-report schema, a builder, and a strict validator (WS-1 spec
 * section 2.2 -- "Contract B: the leak descriptor").
 * Pure, no I/O, Node + browser safe.
 *
 * Every consumer of a leak report -- the Personal Opening Report that
 * builds one, the Drill Engine that seeds cards from one, the Repertoire
 * Builder that links out to one -- reads it through parse() below, never
 * `JSON.parse` directly. Two untrusted-on-read entry points both funnel
 * through the same validator (security-standards.md: "localStorage is
 * untrusted on read"; spec 3.7 N3: "a shared link must not be a second,
 * weaker entry path into the same renderer"):
 *   - localStorage key `rb.leakReport.v1` (a value from a previous, possibly
 *     tampered-with or stale-schema page load).
 *   - the shareable report URL fragment (spec 3.2.4), fully attacker-
 *     controlled since it's never sent to or validated by a server.
 *
 * This module also absorbs the leak-descriptor scope originally planned as
 * a separate follow-on task, since-cancelled in favor of landing it here
 * directly (WS-1 spec section 6.5(c)).
 */

const FORMAT = 'leak-report/1';

// Spec 3.7's pattern-2 rule for "pack.json shape validation," applied here:
// every `play` entry is matched against this regex BEFORE it is ever handed
// to a chess engine for replay. Optional promotion piece only (queen, rook,
// bishop, knight) -- lowercase, matching chess.js's own `.move()` UCI
// convention.
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

// Hard length cap on the leaks array (spec 3.7's "pack.json shape
// validation" pattern: "leaks array under a hard length cap"). The report
// itself only ever ranks the top 5 (spec 3.2.3), but the cap is set above
// that so a genuinely-generated report is never rejected by its own
// validator while still bounding a malicious/corrupted document's size.
const MAX_LEAKS = 20;

const VALID_COLORS = new Set(['white', 'black']);

// The four rating bands the shard pipeline actually crawls (spec 2.1 /
// spec 3.4's scope boundary -- the below-1400 band is not
// buildable in WS-1). Kept in sync with src/processRepertoire.js's
// RATING_BANDS keys rather than importing that module directly, so this
// pure, dependency-light module stays requireable from a browser bundle
// with no risk of pulling in anything server-only. test/leakModel.test.js
// asserts these stay identical to processRepertoire.js's own keys.
const VALID_BANDS = new Set(['1400-1600', '1600-1800', '1800-2000', '2000+']);
const VALID_POOLS = new Set(['bullet', 'blitz', 'rapid_classical']);
// Site-audit item 3 (2026-08-26): which source platform a report's games
// came from. Defaults to 'lichess' on both read (parse() below) and write
// (buildLeakReport() below) so every report built before this field existed
// -- localStorage, an already-shared link -- still round-trips cleanly; the
// field is additive, not a schema version bump.
const VALID_PLATFORMS = new Set(['lichess', 'chesscom']);

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

function isNonEmptyString(v, maxLen = 200) {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

/**
 * @param {*} candidate a moveStat-shaped object: {uci, san, bandGames, score,
 *   scoreLo, scoreHi}, plus `yourCount` for `yourMove` specifically.
 * @param {{requireYourCount?: boolean}} [opts]
 * @returns {string[]} problems, empty = valid.
 */
function validateMoveStat(candidate, { requireYourCount = false } = {}) {
  const problems = [];
  if (!candidate || typeof candidate !== 'object') return ['moveStat: not an object'];
  if (!UCI_RE.test(candidate.uci)) problems.push(`moveStat: uci "${candidate.uci}" is not a valid UCI move`);
  if (!isNonEmptyString(candidate.san, 12)) problems.push('moveStat: san missing or too long');
  if (!isNonNegativeInt(candidate.bandGames)) problems.push('moveStat: bandGames must be a non-negative integer');
  if (!isFiniteNumber(candidate.score) || candidate.score < 0 || candidate.score > 1) problems.push('moveStat: score must be a finite number in [0,1]');
  if (!isFiniteNumber(candidate.scoreLo) || candidate.scoreLo < 0 || candidate.scoreLo > 1) problems.push('moveStat: scoreLo must be a finite number in [0,1]');
  if (!isFiniteNumber(candidate.scoreHi) || candidate.scoreHi < 0 || candidate.scoreHi > 1) problems.push('moveStat: scoreHi must be a finite number in [0,1]');
  if (requireYourCount && !isNonNegativeInt(candidate.yourCount)) problems.push('moveStat: yourCount must be a non-negative integer');
  return problems;
}

/**
 * @param {*} candidate a single leak entry, spec 2.2's shape.
 * @param {number} index position in the leaks array, for error labeling.
 * @returns {string[]} problems, empty = valid.
 */
function validateLeak(candidate, index) {
  const label = `leaks[${index}]`;
  const problems = [];
  if (!candidate || typeof candidate !== 'object') return [`${label}: not an object`];

  if (!isNonEmptyString(candidate.id, 64)) problems.push(`${label}: id missing or too long`);
  if (!isNonNegativeInt(candidate.rank)) problems.push(`${label}: rank must be a non-negative integer`);
  if (!VALID_COLORS.has(candidate.color)) problems.push(`${label}: color must be "white" or "black"`);

  if (!Array.isArray(candidate.play) || candidate.play.length > 24) {
    problems.push(`${label}: play must be an array of at most 24 UCI moves`);
  } else if (!candidate.play.every((uci) => typeof uci === 'string' && UCI_RE.test(uci))) {
    problems.push(`${label}: play contains a non-UCI entry`);
  }

  if (typeof candidate.posKey !== 'string' || !/^[0-9a-f]{24}$/.test(candidate.posKey)) {
    problems.push(`${label}: posKey must be a 24-char lowercase hex string`);
  }
  if (!isNonNegativeInt(candidate.ply) || candidate.ply > 24) problems.push(`${label}: ply must be a non-negative integer <= 24`);

  problems.push(...validateMoveStat(candidate.yourMove, { requireYourCount: true }).map((p) => `${label}.yourMove ${p}`));
  problems.push(...validateMoveStat(candidate.bandMove).map((p) => `${label}.bandMove ${p}`));

  if (!isFiniteNumber(candidate.costPer100) || candidate.costPer100 < 0) problems.push(`${label}: costPer100 must be a non-negative finite number`);

  if (!candidate.opening || typeof candidate.opening !== 'object') {
    problems.push(`${label}: opening must be an object`);
  } else {
    if (!isNonEmptyString(candidate.opening.name, 120)) problems.push(`${label}.opening: name missing or too long`);
    if (candidate.opening.eco != null && !/^[A-E]\d{2}$/.test(candidate.opening.eco)) problems.push(`${label}.opening: eco must be a valid ECO code or null`);
    if (candidate.opening.slug != null && !isNonEmptyString(candidate.opening.slug, 80)) problems.push(`${label}.opening: slug must be a string or null`);
  }

  if (!candidate.links || typeof candidate.links !== 'object') {
    problems.push(`${label}: links must be an object`);
  } else {
    if (candidate.links.opening != null && !isNonEmptyString(candidate.links.opening, 300)) problems.push(`${label}.links: opening must be a string or null`);
    if (!isNonEmptyString(candidate.links.drill, 300)) problems.push(`${label}.links: drill missing or too long`);
    if (!isNonEmptyString(candidate.links.builder, 300)) problems.push(`${label}.links: builder missing or too long`);
  }

  return problems;
}

/**
 * Strict, whole-document validator. Refuses (never coerces) an unrecognized
 * `format`. Accepts either a JSON string (the localStorage / URL-fragment
 * shape) or an already-parsed plain object (a report this session just
 * built, before it's ever round-tripped through JSON).
 *
 * @param {string|object} raw
 * @returns {{ok: true, report: object} | {ok: false, error: string}}
 */
function parse(raw) {
  let doc;
  if (typeof raw === 'string') {
    if (raw.length > 200000) {
      return { ok: false, error: 'leak report document too large' };
    }
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: `not valid JSON: ${err.message}` };
    }
  } else if (raw && typeof raw === 'object') {
    doc = raw;
  } else {
    return { ok: false, error: 'expected a JSON string or an object' };
  }

  if (!doc || typeof doc !== 'object') {
    return { ok: false, error: 'document is not an object' };
  }
  if (doc.format !== FORMAT) {
    return { ok: false, error: `unrecognized format "${doc.format}" (expected "${FORMAT}")` };
  }

  const problems = [];
  if (typeof doc.generated !== 'string' || Number.isNaN(Date.parse(doc.generated))) {
    problems.push('generated must be a parseable ISO8601 date string');
  }
  if (!VALID_BANDS.has(doc.band)) problems.push(`band "${doc.band}" is not a recognized rating band`);
  if (!VALID_POOLS.has(doc.pool)) problems.push(`pool "${doc.pool}" is not a recognized pool`);
  if (!isNonEmptyString(doc.username, 30) || !/^[\w-]{2,30}$/.test(doc.username)) problems.push('username must be a 2-30 char Lichess-shaped username');
  if (doc.platform != null && !VALID_PLATFORMS.has(doc.platform)) problems.push(`platform "${doc.platform}" is not a recognized platform`);
  if (!isNonNegativeInt(doc.gamesFetched)) problems.push('gamesFetched must be a non-negative integer');
  if (!isNonNegativeInt(doc.gamesUsable)) problems.push('gamesUsable must be a non-negative integer');
  if (!isNonNegativeInt(doc.gamesInCoverage)) problems.push('gamesInCoverage must be a non-negative integer');

  if (!Array.isArray(doc.leaks) || doc.leaks.length > MAX_LEAKS) {
    problems.push(`leaks must be an array of at most ${MAX_LEAKS} entries`);
  } else {
    doc.leaks.forEach((leak, i) => problems.push(...validateLeak(leak, i)));
  }

  if (problems.length > 0) {
    return { ok: false, error: problems.join('; ') };
  }

  return {
    ok: true,
    report: {
      format: FORMAT,
      generated: doc.generated,
      band: doc.band,
      pool: doc.pool,
      username: doc.username,
      platform: doc.platform || 'lichess',
      gamesFetched: doc.gamesFetched,
      gamesUsable: doc.gamesUsable,
      gamesInCoverage: doc.gamesInCoverage,
      leaks: doc.leaks,
    },
  };
}

/**
 * Constructs a leak-report/1 document from already-computed, already-valid
 * field values -- the shape a builder assembles a report into before it's
 * ever serialized. Does NOT itself validate (the caller is producing the
 * document, not reading an untrusted one); callers that want a
 * belt-and-braces check should round-trip the result through
 * `parse(JSON.stringify(result))`, which src/leakAnalysis.js's own tests do.
 *
 * @param {{band:string, pool:string, username:string, gamesFetched:number,
 *   gamesUsable:number, gamesInCoverage:number, leaks:object[], generated?:string,
 *   platform?:'lichess'|'chesscom'}} fields `platform` defaults to 'lichess'.
 * @returns {object} a leak-report/1 document.
 */
function buildLeakReport(fields) {
  return {
    format: FORMAT,
    generated: fields.generated || new Date().toISOString(),
    band: fields.band,
    pool: fields.pool,
    username: fields.username,
    platform: fields.platform || 'lichess',
    gamesFetched: fields.gamesFetched,
    gamesUsable: fields.gamesUsable,
    gamesInCoverage: fields.gamesInCoverage,
    leaks: fields.leaks || [],
  };
}

module.exports = {
  FORMAT,
  UCI_RE,
  MAX_LEAKS,
  VALID_BANDS,
  VALID_POOLS,
  VALID_COLORS,
  VALID_PLATFORMS,
  validateMoveStat,
  validateLeak,
  parse,
  buildLeakReport,
};
