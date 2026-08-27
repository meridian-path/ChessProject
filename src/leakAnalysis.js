'use strict';

/**
 * Personal Opening Report -- aggregation, ranking, and untrusted-input
 * handling (WS-1 spec section 3.2.2/3.2.3, and section 3.7's four new
 * sinks N1-N4). This module holds the statistically load-bearing part of
 * the report (spec 3.2.3: "the single most important design call here")
 * plus every validator the report's untrusted-input sinks need, so all of
 * it is exercised by one test file (test/leakAnalysis.test.js) instead of
 * being scattered across the DOM-wiring controller
 * (src/browser/openingReport.client.js), which is otherwise untestable
 * without a full DOM.
 *
 * NO I/O OF ITS OWN. `buildLeakAnalysis()` below accepts an injected
 * `lookupFn` (the exact shape of src/browser/bandData.client.js's
 * `lookup()`) and an injected `identifyFn` (fen -> {eco,name}|null) rather
 * than importing either directly -- the same fetchImpl-injection
 * convention every *Source.js module and bandData.client.js itself already
 * use in this codebase, which is what makes this module fully unit-
 * testable against fake data with zero live network calls.
 *
 * THE RANKING RULE (spec 3.2.3, restated so a reader doesn't need the spec
 * open): a club player's own games can only establish FREQUENCY (how often
 * they reach a position and which move they pick) -- 25 games in one's most
 * -played line is nowhere near enough to distinguish a 45% score from a 52%
 * score. The band dataset (n in the millions at shallow plies) supplies the
 * SCORE. A leak is only real when both: (a) the band's best move at that
 * position scores measurably better than the user's own move (both
 * confidence intervals, not point estimates -- `delta` below only counts
 * when the intervals genuinely don't overlap), and (b) both moves have
 * n >= 300 in the band data. This is Non-Negotiable 5 (statistical
 * honesty) applied to the one number this page's entire pitch rests on.
 *
 * UNTRUSTED INPUT (security-standards.md's definition explicitly includes
 * "anything a third-party API returns" -- this module treats Lichess's own
 * /api/games/user response exactly like visitor-typed text):
 *   - parseGameLine(): each ndjson line is a third-party JSON object. Byte-
 *     capped, JSON.parse in try/catch, every field type/shape-checked
 *     before use. A malformed line is dropped, never thrown.
 *   - extractUserPlies(): replays third-party SAN move text through a real
 *     chess.js instance, wrapped in try/catch per move -- an illegal/
 *     unparseable token ends that one game's replay (whatever was already
 *     collected is kept), never aborts the whole report.
 *   - isValidUsername()/isValidGameId() (spec 3.7 N2/N1): the exact regex
 *     gates a caller must apply BEFORE issuing a request or building an
 *     outbound URL from either value.
 *   - encodeShareFragment()/decodeShareFragment() (spec 3.7 N3): the
 *     shareable URL-fragment descriptor is fully attacker-controlled (never
 *     sent to or validated by a server) -- decoded inside try/catch,
 *     length-capped BEFORE decode, then validated by the exact same
 *     leakModel.parse() a localStorage read uses. Spec 3.2.4 describes the
 *     share payload loosely as a "compact descriptor (band plus top leak
 *     posKeys)"; spec 3.7 N3's binding security requirement is narrower and
 *     more specific -- "run the SAME leakModel.parse() validator... a
 *     shared link must not be a second, weaker entry path into the same
 *     renderer." This module resolves that tension in favor of the binding
 *     security requirement: the fragment carries a full, schema-valid
 *     leak-report/1 document (JSON, no separate weaker schema to maintain
 *     or accidentally under-validate), and the spec's own 1500-char
 *     fallback-to-username-prefill threshold is the practical trigger for
 *     "this report is too large to fit compactly" rather than a sign a
 *     second schema was intended.
 */

const { Chess } = require('chess.js');
const { posKeyFor } = require('./bandShards');
const { parse: parseLeakReport, buildLeakReport, UCI_RE, VALID_BANDS, VALID_POOLS } = require('./leakModel');
const { parsePgnSafe } = require('./pgnWrapper');

// -- spec 3.2.1 / 3.7 constants ---------------------------------------------

// Spec 3.7 altered #1: "cap ... each game's move string at 4 KB before it
// reaches chess.js". A real 24-ply SAN string is under 200 bytes; 4 KB is
// generous headroom, not a realistic ceiling.
const MAX_MOVE_STRING_CHARS = 4 * 1024;
// Spec 3.2.1: "Truncate each game's move string to the first 24 plies as it
// is parsed, before anything is retained. We need openings, not games."
const MAX_PLY = 24;
// Spec 3.2.1's "free-tier honesty": "if the account has fewer than 20
// usable games in the pool, say exactly that and stop."
const MIN_GAMES_USABLE = 20;
// Spec 3.2.3: "the user played that move at least 3 times".
const MIN_USER_MOVE_COUNT = 3;
// Spec 3.2.3: "bandGames is at least 300 for BOTH moves" -- the same n=300
// floor src/buildPack.js already publishes and ships (spec's own words:
// "Using one rule sitewide is itself the Non-Negotiable-1 protection").
const MIN_BAND_GAMES = 300;
// Spec 3.2.3: "costPer100 is at least 0.5".
const MIN_COST_PER_100 = 0.5;
// Spec 3.2.3: "take the top five, and never pad the list to five".
const MAX_LEAKS_RETURNED = 5;
// Spec 3.7 N1: Lichess game ids are exactly 8 chars in the ordinary web UI
// but the API documents up to 12 for some internal cases -- kept generous
// (matches leakModel.js's own validateLeak, which this module's output must
// stay compatible with) while still rejecting anything that could not be a
// real id.
const GAME_ID_RE = /^[a-zA-Z0-9]{8,12}$/;
// Spec 3.7 N2: "Cap at 30 chars and match ^[\w-]{2,30}$ BEFORE any request
// is made or any DOM write happens". Matches leakModel.js's own username
// check exactly (kept in sync -- test/leakAnalysis.test.js asserts this).
const USERNAME_RE = /^[\w-]{2,30}$/;
// Spec 3.7 N3: "Decode inside try/catch, cap at 2000 chars".
const SHARE_FRAGMENT_MAX_CHARS = 2000;

function byteLength(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  return Buffer.byteLength(str, 'utf8'); // Node test-environment fallback
}

// -- spec 3.7 N2: the ?username= URL parameter ------------------------------

/** @returns {boolean} true only for a plausible Lichess username. */
function isValidUsername(candidate) {
  return typeof candidate === 'string' && USERNAME_RE.test(candidate);
}

// -- spec 3.7 N1: Lichess game ids -------------------------------------------

/** @returns {boolean} true only for a plausible Lichess game id. */
function isValidGameId(candidate) {
  return typeof candidate === 'string' && GAME_ID_RE.test(candidate);
}

/**
 * @param {string} gameId
 * @returns {string|null} an https://lichess.org/<id> URL, or null if
 *   `gameId` fails isValidGameId() -- callers MUST check for null and
 *   render the row without a link rather than building a URL from an
 *   unvalidated field by string concatenation (spec 3.7 N1, verbatim).
 */
function buildGameUrl(gameId) {
  return isValidGameId(gameId) ? `https://lichess.org/${gameId}` : null;
}

// -- spec 3.2.1: parse one ndjson line (one third-party game object) --------

/**
 * @param {string} line one line from the streamed ndjson response.
 * @returns {{ok:true, game:{id:string, white:string|null, black:string|null,
 *   movesText:string, winner:'white'|'black'|null}} | {ok:false, reason:string}}
 */
function parseGameLine(line) {
  if (typeof line !== 'string') return { ok: false, reason: 'not-a-string' };
  const trimmed = line.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  let raw;
  try {
    raw = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, reason: 'invalid-json' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-an-object' };
  if (!isValidGameId(raw.id)) return { ok: false, reason: 'bad-id' };
  if (typeof raw.moves !== 'string' || raw.moves.length === 0) return { ok: false, reason: 'no-moves' };
  if (!raw.players || typeof raw.players !== 'object') return { ok: false, reason: 'no-players' };

  const whiteUser = raw.players.white && raw.players.white.user;
  const blackUser = raw.players.black && raw.players.black.user;
  const white = whiteUser && typeof whiteUser.name === 'string' ? whiteUser.name : null;
  const black = blackUser && typeof blackUser.name === 'string' ? blackUser.name : null;

  const movesText = byteLength(raw.moves) > MAX_MOVE_STRING_CHARS
    ? raw.moves.slice(0, MAX_MOVE_STRING_CHARS)
    : raw.moves;

  const winner = raw.winner === 'white' || raw.winner === 'black' ? raw.winner : null;

  return { ok: true, game: { id: raw.id, white, black, movesText, winner } };
}

// -- spec 3.2.2: AGGREGATE (per game) ----------------------------------------

/**
 * Determines the visitor's colour in one game (case-insensitive Lichess
 * username match), replays its SAN move text through a real chess.js
 * instance (string-form `.move()` -- returns null rather than throwing for
 * most illegal input in this project's pinned chess.js 1.4.0, per
 * src/pgnWrapper.js's own header comment; both a null return and a thrown
 * error are handled the same way here: stop this game's replay, keep
 * whatever was already collected), and records one entry per ply where the
 * VISITOR was to move, up to MAX_PLY. NEVER uses buildPack.js's
 * applyExplorerUci here -- that function exists for the Lichess Opening
 * EXPLORER's own castling encoding quirk (king-captures-own-rook UCI),
 * which does not apply to this endpoint: Lichess's /api/games/user export
 * is plain SAN, and chess.js's own `.lan` (its resulting UCI) uses the
 * ordinary king's-landing-square convention -- the same convention
 * src/bandShards.js's posKeyFor()/src/browser/bandData.client.js's lookup()
 * already replay via applyExplorerUci, which is backward-compatible with
 * standard-form UCI castling (it only remaps when the `to` square holds a
 * same-colour rook, which never happens for a `.lan`-derived move) -- see
 * that function's own header comment for the structural detection this
 * relies on.
 *
 * @param {{id:string, white:string|null, black:string|null, movesText:string,
 *   winner:'white'|'black'|null}} game parseGameLine()'s output.
 * @param {string} username already known-valid (isValidUsername()) by the
 *   caller -- this function still only ever compares it, never uses it to
 *   build a URL or DOM write.
 * @returns {{ok:true, color:'white'|'black', resultForUser:'win'|'draw'|'loss',
 *   plies:Array<{ply:number, play:string[], uci:string, san:string}>} |
 *   {ok:false, reason:string}}
 */
function extractUserPlies(game, username) {
  const lower = username.toLowerCase();
  let color = null;
  if (game.white && game.white.toLowerCase() === lower) color = 'white';
  else if (game.black && game.black.toLowerCase() === lower) color = 'black';
  if (!color) return { ok: false, reason: 'not-a-participant' };

  const tokens = game.movesText.split(/\s+/).filter(Boolean).slice(0, MAX_PLY);
  const chess = new Chess();
  const plies = [];
  const playSoFar = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const toMoveColor = chess.turn() === 'w' ? 'white' : 'black';
    let moveResult = null;
    try {
      moveResult = chess.move(tokens[i]);
    } catch (err) {
      break; // drop the rest of THIS game's replay; keep what's already collected
    }
    if (!moveResult) break;

    if (toMoveColor === color) {
      plies.push({ ply: i, play: playSoFar.slice(), uci: moveResult.lan, san: moveResult.san });
    }
    playSoFar.push(moveResult.lan);
  }

  const resultForUser = game.winner == null ? 'draw' : (game.winner === color ? 'win' : 'loss');
  return { ok: true, color, resultForUser, plies };
}

// -- spec 3.2.3: RANK ---------------------------------------------------------

/**
 * Highest-confidence-interval-lower-bound move among candidates with
 * n >= MIN_BAND_GAMES -- the identical rule src/buildPack.js already
 * publishes and ships (spec 3.2.3: "Using one rule sitewide is itself the
 * Non-Negotiable-1 protection").
 * @param {Array<{uci:string, san:string, games:number, score:number,
 *   scoreLo:number, scoreHi:number}>} moves bandData.client.js lookup()'s
 *   `.moves` array for one position.
 * @returns {object|null} the winning move, or null if none meets the floor.
 */
function bandBestMoveOf(moves) {
  const eligible = moves.filter((m) => m.games >= MIN_BAND_GAMES);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, m) => (m.scoreLo > best.scoreLo ? m : best));
}

/**
 * The shared AGGREGATE + RANK core (spec 3.2.2/3.2.3) -- platform-agnostic.
 * Site-audit item 3 (2026-08-26) split this out of what used to be
 * buildLeakAnalysis()'s own body: it now takes an array of ALREADY-EXTRACTED
 * per-game ply data (extractUserPlies()'s or extractUserPliesFromPgn()'s own
 * `ok:true` output), so the statistically load-bearing logic itself (band
 * lookup, delta/costPer100, ranking, report assembly) exists in exactly one
 * place regardless of which platform's games produced it. buildLeakAnalysis()
 * (Lichess ndjson) and buildLeakAnalysisFromChessCom() (Chess.com's monthly
 * archive JSON) below are both thin wrappers: parse their own platform's raw
 * format into this shape, then call this function unchanged.
 *
 * Walks each usable game's recorded plies IN ORDER, calling the injected
 * `lookupFn` at every one, and stops that game's contribution the first time
 * a position resolves out of band coverage (spec 3.2.2: "Stop at the first
 * position where bandData reports out-of-book") -- both because a leak past
 * that depth would rest on band data the crawl never gathered, and because
 * it bounds the work (the crawl's own ply<=12 reach means deeper positions
 * are essentially always out of book). `gamesInCoverage` (the leak-report/1
 * schema's report-level denominator, spec 3.2.3's costPer100 formula) is
 * counted as "games that contributed at least one in-coverage data point" --
 * the spec states the formula but not this exact denominator definition;
 * this is a stated, disclosed design judgment, not an unstated guess.
 *
 * A single in-memory posKey -> bandResult cache avoids re-issuing
 * `lookupFn` for the same position reached by many different games (the
 * overwhelmingly common case for the first several plies of any opening) --
 * on TOP of, not instead of, bandData.client.js's own per-shard fetch
 * cache, since this cache also skips the chess.js replay `lookupFn` would
 * otherwise redo.
 *
 * @param {{usableGames:Array, gamesFetched:number, skippedCount:number,
 *   username:string, band:string, pool:string, platform:'lichess'|'chesscom',
 *   lookupFn:Function, identifyFn?:Function, maxLeaks?:number}} args
 *   `identifyFn(fen)` -> `Promise<{eco:string, name:string}|null>`, used to
 *   fill each leak's optional `opening` label; omit or supply a function
 *   that always resolves null to skip identification entirely (the leak
 *   still ranks and renders, just without a named opening).
 * @returns {Promise<{ok:true, report:object, watchList:object[], gamesFetched:number,
 *   gamesUsable:number, skippedCount:number} | {ok:false, reason:string,
 *   gamesFetched:number, gamesUsable:number}>}
 */
async function aggregateAndRank({ usableGames, gamesFetched, skippedCount, username, band, pool, platform = 'lichess', lookupFn, identifyFn = async () => null, maxLeaks = MAX_LEAKS_RETURNED }) {
  const gamesUsable = usableGames.length;
  if (gamesUsable < MIN_GAMES_USABLE) {
    return { ok: false, reason: 'too-few-games', gamesFetched, gamesUsable };
  }

  const byPosKey = new Map(); // posKey -> { bandResult, play, ply, entries: Map(uci -> {...}) }
  const lookupCache = new Map(); // posKey -> bandResult (see header comment)
  let gamesInCoverage = 0;

  for (const g of usableGames) {
    let contributed = false;
    for (const p of g.plies) {
      const { posKey, fen } = posKeyFor(p.play);
      let bandResult = lookupCache.get(posKey);
      if (bandResult === undefined) {
        bandResult = await lookupFn({ play: p.play, band, pool });
        lookupCache.set(posKey, bandResult);
      }
      if (!bandResult || bandResult.coverage !== 'in') break; // spec 3.2.2

      contributed = true;
      let moveGroup = byPosKey.get(posKey);
      if (!moveGroup) {
        moveGroup = { bandResult, play: p.play, ply: p.ply, fen, entries: new Map() };
        byPosKey.set(posKey, moveGroup);
      }
      let entry = moveGroup.entries.get(p.uci);
      if (!entry) {
        entry = { uci: p.uci, san: p.san, count: 0, wins: 0, draws: 0, losses: 0, color: g.color };
        moveGroup.entries.set(p.uci, entry);
      }
      entry.count += 1;
      if (g.resultForUser === 'win') entry.wins += 1;
      else if (g.resultForUser === 'draw') entry.draws += 1;
      else entry.losses += 1;
    }
    if (contributed) gamesInCoverage += 1;
  }

  const leakCandidates = [];
  const watchCandidates = [];

  for (const [posKey, moveGroup] of byPosKey) {
    const bandBest = bandBestMoveOf(moveGroup.bandResult.moves);
    if (!bandBest) continue; // not enough band data at this position to rank against

    for (const entry of moveGroup.entries.values()) {
      if (entry.count < MIN_USER_MOVE_COUNT) continue;
      const yourBandMove = moveGroup.bandResult.moves.find((m) => m.uci === entry.uci);
      if (!yourBandMove || yourBandMove.games < MIN_BAND_GAMES) continue; // spec: n>=300 for BOTH moves

      const delta = bandBest.scoreLo - yourBandMove.scoreHi;
      const yourMove = {
        uci: entry.uci, san: entry.san, bandGames: yourBandMove.games,
        score: yourBandMove.score, scoreLo: yourBandMove.scoreLo, scoreHi: yourBandMove.scoreHi,
        yourCount: entry.count,
      };
      const bandMove = {
        uci: bandBest.uci, san: bandBest.san, bandGames: bandBest.games,
        score: bandBest.score, scoreLo: bandBest.scoreLo, scoreHi: bandBest.scoreHi,
      };

      if (delta <= 0) {
        // Not a ranked leak (spec 3.2.3: "Include a leak only if delta is
        // above 0"). A poor-own-result opening still surfaces on the
        // separate, never-ranked-with-leaks watch list (spec 3.2.4).
        const winRate = entry.count > 0 ? (entry.wins + entry.draws * 0.5) / entry.count : null;
        if (winRate != null && winRate < 0.45 && entry.count >= MIN_USER_MOVE_COUNT) {
          watchCandidates.push({
            posKey, ply: moveGroup.ply, play: moveGroup.play, color: entry.color,
            yourMove, bandMove, sampleSize: entry.count, winRate,
          });
        }
        continue;
      }

      const costPer100 = 100 * (entry.count / gamesInCoverage) * delta;
      if (costPer100 < MIN_COST_PER_100) continue;

      leakCandidates.push({
        posKey, ply: moveGroup.ply, play: moveGroup.play, color: entry.color,
        fen: moveGroup.fen, yourMove, bandMove, costPer100,
      });
    }
  }

  leakCandidates.sort((a, b) => b.costPer100 - a.costPer100);
  const top = leakCandidates.slice(0, maxLeaks);

  const leaks = [];
  for (let i = 0; i < top.length; i += 1) {
    const c = top[i];
    const opening = (await identifyFn(c.fen)) || { name: 'Unnamed position', eco: null };
    const slug = null; // no per-position slug source exists yet -- see this module's header
    leaks.push({
      id: `${c.posKey}-${c.yourMove.uci}`,
      rank: i + 1,
      color: c.color,
      play: c.play,
      posKey: c.posKey,
      ply: c.ply,
      yourMove: c.yourMove,
      bandMove: c.bandMove,
      costPer100: c.costPer100,
      opening: { name: opening.name, eco: opening.eco || null, slug },
      links: {
        opening: null, // filled in by the caller once it has resolved a real guide/ECO-volume URL (spec 3.6)
        drill: `drill.html#seed=leak&posKey=${encodeURIComponent(c.posKey)}`,
        builder: `repertoire-builder.html#band=${encodeURIComponent(band)}&pool=${encodeURIComponent(pool)}&color=${encodeURIComponent(c.color)}`,
      },
    });
  }

  const report = buildLeakReport({ band, pool, username, platform, gamesFetched, gamesUsable, gamesInCoverage, leaks });
  // Round-trip through the strict validator before handing it back (this
  // module's own doc comment on leakModel.buildLeakReport recommends
  // exactly this belt-and-braces check for anything that assembles a
  // report from scratch).
  const validated = parseLeakReport(JSON.stringify(report));
  if (!validated.ok) {
    return { ok: false, reason: `internal: assembled an invalid leak report (${validated.error})`, gamesFetched, gamesUsable };
  }

  return {
    ok: true,
    report: validated.report,
    watchList: watchCandidates.sort((a, b) => a.winRate - b.winRate).slice(0, 10),
    gamesFetched,
    gamesUsable,
    gamesInCoverage,
    skippedCount,
  };
}

/**
 * Lichess entry point -- unchanged behavior from before the site-audit
 * item 3 (2026-08-26) refactor above: parses each ndjson line, extracts the
 * visitor's own plies, and hands the result to the shared aggregateAndRank()
 * core. Every existing caller/test keeps working unmodified.
 *
 * @param {{ndjsonLines:string[], username:string, band:string, pool:string,
 *   lookupFn:Function, identifyFn?:Function, maxLeaks?:number}} args
 * @returns {Promise<{ok:true, report:object, watchList:object[], gamesFetched:number,
 *   gamesUsable:number, skippedCount:number} | {ok:false, reason:string,
 *   gamesFetched:number, gamesUsable:number}>}
 */
async function buildLeakAnalysis({ ndjsonLines, username, band, pool, lookupFn, identifyFn = async () => null, maxLeaks = MAX_LEAKS_RETURNED }) {
  const gamesFetched = ndjsonLines.length;
  let skippedCount = 0;
  const usableGames = [];

  for (const line of ndjsonLines) {
    const parsed = parseGameLine(line);
    if (!parsed.ok) { skippedCount += 1; continue; }
    const extracted = extractUserPlies(parsed.game, username);
    if (!extracted.ok) { skippedCount += 1; continue; }
    usableGames.push(extracted);
  }

  return aggregateAndRank({ usableGames, gamesFetched, skippedCount, username, band, pool, platform: 'lichess', lookupFn, identifyFn, maxLeaks });
}

// -- Chess.com integration (site-audit item 3, 2026-08-26) -------------------
//
// Chess.com's own username length (3-25 chars, verified against their
// registration rules); word chars + hyphen, same conservative-superset
// approach as USERNAME_RE above -- a defense-in-depth gate before a value
// reaches the fetch layer or a URL-building sink, not a claim to exactly
// replicate Chess.com's own validation.
const CHESSCOM_USERNAME_RE = /^[\w-]{3,25}$/;

/** @returns {boolean} true only for a plausible Chess.com username. */
function isValidChessComUsername(candidate) {
  return typeof candidate === 'string' && CHESSCOM_USERNAME_RE.test(candidate);
}

/**
 * Validates and normalizes one raw Chess.com archive-month game object
 * (src/fetchChessCom.js's fetchArchiveGames() -- one entry of that
 * response's own `games` array, verified live against a real account before
 * this was written -- see fetchChessCom.js's own header comment) into the
 * same {white, black, winner} shape parseGameLine() produces for a Lichess
 * ndjson line, PLUS the raw `pgn` string (Chess.com's own move format is
 * full PGN with headers/move-numbers, not Lichess's bare SAN-token `moves`
 * field, so it cannot share parseGameLine()'s `movesText` shape -- see
 * extractUserPliesFromPgn() below, which parses `pgn` via the same
 * security-hardened pgnWrapper.js every visitor-pasted PGN on this site
 * already goes through, since a third-party API response is untrusted input
 * exactly like visitor-typed text (security-standards.md)).
 *
 * Filters to the real, comparable population: `rated` games only (an
 * unrated game says nothing about how the visitor actually plays under the
 * same incentives band data was crawled from), `rules === "chess"` only (no
 * variants -- this site has no variant band data), and `time_class` blitz or
 * rapid only (the same two speeds Lichess's own fetch already filters to
 * server-side via `perfType=blitz,rapid`).
 *
 * @param {object} raw one Chess.com archive-month game object.
 * @returns {{ok:true, game:{white:string|null, black:string|null, pgn:string,
 *   winner:'white'|'black'|null}} | {ok:false, reason:string}}
 */
function parseChessComGame(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-an-object' };
  if (typeof raw.pgn !== 'string' || raw.pgn.length === 0) return { ok: false, reason: 'no-pgn' };
  if (raw.rated !== true) return { ok: false, reason: 'not-rated' };
  if (raw.rules !== 'chess') return { ok: false, reason: 'not-standard-chess' };
  if (raw.time_class !== 'blitz' && raw.time_class !== 'rapid') return { ok: false, reason: 'not-blitz-or-rapid' };
  if (!raw.white || typeof raw.white !== 'object' || !raw.black || typeof raw.black !== 'object') return { ok: false, reason: 'no-players' };

  const white = typeof raw.white.username === 'string' ? raw.white.username : null;
  const black = typeof raw.black.username === 'string' ? raw.black.username : null;
  // Exactly one side reads "win" for a decisive game; neither does for a
  // draw (both sides carry one of Chess.com's several draw-shaped result
  // strings -- agreed/repetition/stalemate/insufficient/50move/
  // timevsinsufficient) -- verified against real game data, not guessed
  // from docs alone.
  const winner = raw.white.result === 'win' ? 'white' : (raw.black.result === 'win' ? 'black' : null);

  return { ok: true, game: { white, black, pgn: raw.pgn, winner } };
}

/**
 * Chess.com's own analogue of extractUserPlies() above -- same output
 * shape, same MAX_PLY cap, same resultForUser derivation, but the move data
 * comes from a real PGN string (parsePgnSafe(), not a manual chess.js
 * token-by-token replay loop) since Chess.com's `pgn` field is real PGN,
 * unlike Lichess's bare-SAN-token `moves` field. Unlike extractUserPlies()'s
 * "stop at the first illegal token, keep what was already collected"
 * recovery, an unparseable PGN here drops the WHOLE game -- Chess.com's own
 * PGN exports are programmatically generated, not visitor-typed, so a
 * malformed one is a real anomaly worth dropping outright rather than a
 * routine transcription typo worth partially recovering from.
 *
 * @param {{white:string|null, black:string|null, pgn:string,
 *   winner:'white'|'black'|null}} game parseChessComGame()'s output.
 * @param {string} username already known-valid (isValidChessComUsername())
 *   by the caller.
 * @returns {{ok:true, color:'white'|'black', resultForUser:'win'|'draw'|'loss',
 *   plies:Array<{ply:number, play:string[], uci:string, san:string}>} |
 *   {ok:false, reason:string}}
 */
function extractUserPliesFromPgn(game, username) {
  const lower = username.toLowerCase();
  let color = null;
  if (game.white && game.white.toLowerCase() === lower) color = 'white';
  else if (game.black && game.black.toLowerCase() === lower) color = 'black';
  if (!color) return { ok: false, reason: 'not-a-participant' };

  const parsed = parsePgnSafe(game.pgn);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const moves = parsed.moves.slice(0, MAX_PLY);
  const plies = [];
  const playSoFar = [];

  for (let i = 0; i < moves.length; i += 1) {
    const toMoveColor = i % 2 === 0 ? 'white' : 'black';
    const m = moves[i];
    if (toMoveColor === color) {
      plies.push({ ply: i, play: playSoFar.slice(), uci: m.uci, san: m.san });
    }
    playSoFar.push(m.uci);
  }

  const resultForUser = game.winner == null ? 'draw' : (game.winner === color ? 'win' : 'loss');
  return { ok: true, color, resultForUser, plies };
}

/**
 * Chess.com entry point, parallel to buildLeakAnalysis() above -- parses
 * each raw archive-month game object, extracts the visitor's own plies, and
 * hands the result to the SAME shared aggregateAndRank() core, so the
 * statistically load-bearing logic is identical regardless of platform.
 *
 * @param {{games:object[], username:string, band:string, pool:string,
 *   lookupFn:Function, identifyFn?:Function, maxLeaks?:number}} args
 *   `games` is the flat, already-collected array of raw Chess.com game
 *   objects across however many monthly archives the caller chose to fetch
 *   (src/browser/openingReport.client.js's own month-walking orchestration,
 *   mirroring where its Lichess streamGames() orchestration already lives).
 * @returns {Promise<{ok:true, report:object, watchList:object[], gamesFetched:number,
 *   gamesUsable:number, skippedCount:number} | {ok:false, reason:string,
 *   gamesFetched:number, gamesUsable:number}>}
 */
async function buildLeakAnalysisFromChessCom({ games, username, band, pool, lookupFn, identifyFn = async () => null, maxLeaks = MAX_LEAKS_RETURNED }) {
  const gamesFetched = games.length;
  let skippedCount = 0;
  const usableGames = [];

  for (const raw of games) {
    const parsed = parseChessComGame(raw);
    if (!parsed.ok) { skippedCount += 1; continue; }
    const extracted = extractUserPliesFromPgn(parsed.game, username);
    if (!extracted.ok) { skippedCount += 1; continue; }
    usableGames.push(extracted);
  }

  return aggregateAndRank({ usableGames, gamesFetched, skippedCount, username, band, pool, platform: 'chesscom', lookupFn, identifyFn, maxLeaks });
}

// -- spec 3.7 N3: the shareable report fragment ------------------------------

/**
 * @param {object} report a valid leak-report/1 document (leakModel.parse()'d).
 * @returns {{ok:true, fragment:string} | {ok:false, reason:string}}
 *   `fragment` is a URL-fragment-ready `r=<value>` pair (join with `&` to
 *   any existing band/pool/color fragment params -- see
 *   src/browser/bandState.client.js's own fragment format, which this is
 *   deliberately compatible with: both read/write the SAME
 *   `window.location.hash` via URLSearchParams, distinguished only by key).
 *   `ok:false` when the serialized report would exceed
 *   SHARE_FRAGMENT_MAX_CHARS -- the caller falls back to a plain
 *   username-prefilled link instead (spec 3.2.4).
 */
function encodeShareFragment(report) {
  const json = JSON.stringify(report);
  const params = new URLSearchParams();
  params.set('r', json);
  const fragment = params.toString();
  if (fragment.length > SHARE_FRAGMENT_MAX_CHARS) {
    return { ok: false, reason: 'too-large' };
  }
  return { ok: true, fragment };
}

/**
 * @param {string} hashValue the FULL fragment value (e.g.
 *   `window.location.hash.slice(1)`, WITHOUT the leading `#`) -- may
 *   legitimately also contain `band=`/`pool=`/`color=` pairs
 *   (bandState.client.js's own keys); only `r` is read here.
 * @returns {{ok:true, report:object} | {ok:false, reason:string}}
 */
function decodeShareFragment(hashValue) {
  if (typeof hashValue !== 'string' || hashValue.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (hashValue.length > SHARE_FRAGMENT_MAX_CHARS * 4) {
    // Cheap pre-check before even constructing URLSearchParams over a
    // hostile, arbitrarily long fragment.
    return { ok: false, reason: 'fragment-too-large' };
  }
  let params;
  try {
    params = new URLSearchParams(hashValue);
  } catch (err) {
    return { ok: false, reason: 'unparseable' };
  }
  const raw = params.get('r');
  if (!raw) return { ok: false, reason: 'no-report-param' };
  if (raw.length > SHARE_FRAGMENT_MAX_CHARS) return { ok: false, reason: 'too-large' };

  // parseLeakReport (leakModel.parse) does its own JSON.parse-in-try/catch
  // and full shape validation -- the exact same validator localStorage
  // reads use (spec 3.7 N3's binding requirement).
  const result = parseLeakReport(raw);
  if (!result.ok) return { ok: false, reason: result.error };
  return { ok: true, report: result.report };
}

module.exports = {
  MAX_MOVE_STRING_CHARS,
  MAX_PLY,
  MIN_GAMES_USABLE,
  MIN_USER_MOVE_COUNT,
  MIN_BAND_GAMES,
  MIN_COST_PER_100,
  MAX_LEAKS_RETURNED,
  GAME_ID_RE,
  USERNAME_RE,
  CHESSCOM_USERNAME_RE,
  SHARE_FRAGMENT_MAX_CHARS,
  VALID_BANDS,
  VALID_POOLS,
  UCI_RE,
  byteLength,
  isValidUsername,
  isValidChessComUsername,
  isValidGameId,
  buildGameUrl,
  parseGameLine,
  parseChessComGame,
  extractUserPlies,
  extractUserPliesFromPgn,
  bandBestMoveOf,
  buildLeakAnalysis,
  buildLeakAnalysisFromChessCom,
  encodeShareFragment,
  decodeShareFragment,
};
