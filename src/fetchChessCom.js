'use strict';

/**
 * Data-fetch module for the Chess.com Published-Data API
 * (https://api.chess.com/pub -- publicly documented at
 * https://www.chess.com/news/view/published-data-api). No API key is
 * required for the endpoints used here, and every response carries
 * `Access-Control-Allow-Origin: *` -- verified live (not just from docs)
 * before this module was written: `curl -D - -H "Origin: https://
 * repertoire-builder.com" https://api.chess.com/pub/player/hikaru/games/
 * archives` returns `Access-Control-Allow-Origin: *` on 2026-08-26, so this
 * is safe to call directly from a visitor's own browser -- same "your
 * browser talks straight to the source, this site's servers (it has none)
 * never see a byte" model src/fetchLichess.js already uses.
 *
 * Same fetchImpl-injection convention as src/fetchLichess.js: every
 * exported function accepts an options object with an injectable
 * `fetchImpl` (defaulting to the global `fetch`) so tests supply a fake
 * implementation backed by fixture JSON instead of hitting the live network.
 *
 * Two endpoints only, deliberately thin (matches fetchLichess.js's own
 * scope -- this module fetches, it does not decide HOW MUCH to fetch or
 * which games are usable; that orchestration, and the month-range default,
 * live in src/browser/openingReport.client.js, mirroring where its own
 * Lichess streamGames() orchestration already lives):
 *   - GET /player/{username}/games/archives -> {archives: [monthUrl, ...]},
 *     chronological oldest-first (verified live against a real account).
 *   - GET {monthUrl} -> {games: [gameObject, ...]}, one calendar month's
 *     games. Every field this module or its caller reads from a gameObject
 *     (pgn, rated, rules, time_class, white.username, black.username,
 *     white.result, black.result) was confirmed present on a real fetched
 *     game (hikaru, 2026-08) before src/leakAnalysis.js's Chess.com parser
 *     was written against it.
 */

const BASE_URL = 'https://api.chess.com/pub';

class ChessComNotFoundError extends Error {
  constructor(username) {
    super(`Chess.com user not found: ${username}`);
    this.name = 'ChessComNotFoundError';
    this.username = username;
  }
}

class ChessComRateLimitError extends Error {
  constructor(retryAfter) {
    super(`Chess.com API rate limit hit${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`);
    this.name = 'ChessComRateLimitError';
    this.retryAfter = retryAfter || null;
  }
}

class ChessComApiError extends Error {
  constructor(status, statusText, url) {
    super(`Chess.com API request failed: ${status} ${statusText} (${url})`);
    this.name = 'ChessComApiError';
    this.status = status;
  }
}

/** Shared response handling: maps HTTP status codes to typed errors, same shape as fetchLichess.js's handleErrors(). */
async function handleErrors(response, url, username) {
  if (response.status === 404) {
    throw new ChessComNotFoundError(username);
  }
  if (response.status === 429) {
    const retryAfter = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('retry-after')
      : null;
    throw new ChessComRateLimitError(retryAfter);
  }
  if (!response.ok) {
    throw new ChessComApiError(response.status, response.statusText, url);
  }
}

/**
 * GET /player/:username/games/archives -> the full list of that player's
 * monthly archive URLs, chronological oldest-first (a real account with a
 * long history, like hikaru's, has 150+ entries -- the caller decides how
 * many of the most recent ones to actually fetch).
 * @returns {Promise<string[]>}
 */
async function fetchArchives(username, { fetchImpl = fetch, signal } = {}) {
  const url = `${BASE_URL}/player/${encodeURIComponent(username)}/games/archives`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  await handleErrors(response, url, username);
  const data = await response.json();
  return Array.isArray(data && data.archives) ? data.archives : [];
}

/**
 * GET one monthly archive URL (an entry from fetchArchives()'s own return
 * value -- never hand-build this URL from raw year/month input, since that
 * would be a second, unvalidated way to construct the exact same request).
 * @returns {Promise<object[]>} that month's raw game objects, unfiltered
 *   (rated/unrated, every time_class and variant mixed together) -- the
 *   caller (src/leakAnalysis.js's parseChessComGame()) filters to the
 *   rated/standard-chess/blitz-or-rapid population this report analyses.
 */
async function fetchArchiveGames(archiveUrl, { fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(archiveUrl, { headers: { Accept: 'application/json' }, signal });
  await handleErrors(response, archiveUrl, null);
  const data = await response.json();
  return Array.isArray(data && data.games) ? data.games : [];
}

module.exports = {
  BASE_URL,
  fetchArchives,
  fetchArchiveGames,
  ChessComNotFoundError,
  ChessComRateLimitError,
  ChessComApiError,
};
