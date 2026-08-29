'use strict';

/**
 * Page controller for /opening-report.html -- the Personal Opening Report
 * (WS-1 spec section 3.2). Esbuild entry point (src/buildStatic.js's
 * buildOpeningReportBundle()), same real-CommonJS-module convention as
 * src/browser/playerLookup.client.js: this file require()s project modules
 * directly and esbuild bundles everything into one self-contained IIFE, so
 * it still works from a file:// URL with a single <script> tag for
 * everything EXCEPT this page's two deliberate runtime-fetch exceptions
 * (the visitor's own Lichess data, and the same-origin band-shard/reverse-
 * lookup JSON -- see src/browser/bandData.client.js and
 * src/ecoExplorerData.js's own header comments for the precedent).
 *
 * SEVEN DESIGNED STATES (spec 3.2.4, all real copy, none a blank div):
 *   1. unknown user            -- Lichess 404
 *   2. private or no games     -- 200 OK, zero usable rated blitz/rapid games
 *   3. fewer than 20 usable    -- leakAnalysis.buildLeakAnalysis's own floor
 *   4. all games out of coverage -- gamesInCoverage === 0
 *   5. Lichess unreachable     -- network/CORS failure (a raw fetch TypeError)
 *   6. Lichess rate-limited    -- HTTP 429
 *   7. visitor cancelled mid-fetch -- AbortController, still analyses whatever was parsed
 * Plus the ordinary working (streaming progress + cancel) and success
 * states, and one more real, non-failure outcome success can land on: a
 * report that completed but found no leak worth ranking (spec's own
 * n>=300/delta>0/cost>=0.5 floors can legitimately clear everyone).
 *
 * UNTRUSTED INPUT (security-standards.md: "anything a third-party API
 * returns" counts as untrusted, same as visitor-typed text):
 *   - Every string this file interpolates into markup -- a Lichess username,
 *     an opponent name, an opening name from the reverse-lookup dataset --
 *     goes through escapeHtml() (this file's own HTML-string templating) or
 *     .textContent, never raw. Grepped explicitly at QA time; see this
 *     project's TESTING.md.
 *   - The four sinks from spec 3.7 (game ids -> outbound links, the
 *     ?username= URL parameter, the shareable report fragment, the same-
 *     origin shard/reverse-lookup fetch) are validated through
 *     src/leakAnalysis.js's isValidGameId/buildGameUrl/isValidUsername/
 *     decodeShareFragment -- this file never re-implements those checks,
 *     it only calls them, so there is exactly one place each rule can be
 *     wrong (test/leakAnalysis.test.js's job, not this file's).
 */

const {
  isValidUsername, isValidChessComUsername, buildGameUrl, buildLeakAnalysis, buildLeakAnalysisFromChessCom,
  encodeShareFragment, decodeShareFragment, inferRatingForPool, bandRangeFor,
} = require('../leakAnalysis');
const { parse: parseLeakReport } = require('../leakModel');
const { lookup: bandLookup } = require('./bandData.client');
const { FILES, RANKS, START_BOARD, applyUciMoves } = require('../chessPosition');
const { fetchRatingHistory, fetchRecentGames, fetchUserProfile } = require('../fetchLichess');
const {
  fetchArchives: fetchChessComArchives, fetchArchiveGames: fetchChessComArchiveGames,
  ChessComNotFoundError, ChessComRateLimitError,
} = require('../fetchChessCom');
const { summarizeRatingHistory, summarizeGames } = require('../process');
const {
  renderRatingTable, escapeHtml, displayName, formatPct, wrapTable,
} = require('../render');
const { readBandState, writeBandState } = require('./bandState.client');

const GAMES_ENDPOINT_BASE = 'https://lichess.org/api/games/user/';
const MAX_GAMES = 300;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // spec 3.7 altered #1: cap the ndjson response at 8MB total
// Site-audit item 3 (2026-08-26): Chess.com publishes games in monthly
// archives rather than one combined feed (src/fetchChessCom.js), so there is
// no single "how many games" request parameter to mirror MAX_GAMES with --
// this is the disclosed month-range default instead (see this file's own
// fetchChessComRecentGames()): walk backward from the most recent month, one
// request per month, stopping at MAX_GAMES games or this many months back,
// whichever comes first. Real copy in renderOpeningReport.js's "How this
// works" section states this exact number, not a hidden implementation
// detail.
const CHESSCOM_MAX_MONTHS = 12;
const STORAGE_KEY = 'rb.leakReport.v1';
const SHARE_FRAGMENT_MAX_CHARS_FALLBACK_NOTE = 'That report was too large to fit in a shareable link, so this link re-runs the lookup for that username instead.';
const REVERSE_LOOKUP_URL = 'eco-reverse-lookup.json';

// -- tiny pure helpers (kept local; see this file's header comment for why
// board rendering isn't a require() of src/boardSvg.js) -----------------

function truncateFenForLookup(fen) {
  return String(fen).split(' ').slice(0, 4).join(' ');
}

function thumbPieceHtml(piece) {
  if (!piece) return '';
  const isWhite = piece === piece.toUpperCase();
  const id = `${isWhite ? 'w' : 'b'}${piece.toLowerCase()}`;
  return `<svg class="thumb-piece" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`;
}

/** @param {string[]} play a leak's `play` UCI path (always chess.js-standard, never Explorer-encoded -- see src/leakAnalysis.js's header comment). */
function renderThumbBoard(play, label) {
  let board;
  try {
    board = applyUciMoves(START_BOARD, play);
  } catch (err) {
    board = START_BOARD; // never let a bad path crash the report; show the start position rather than nothing
  }
  const rankOrder = [...RANKS].reverse();
  let squares = '';
  for (const rank of rankOrder) {
    for (const file of FILES) {
      const square = `${file}${rank}`;
      const isDark = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 0;
      squares += `<span class="thumb-sq thumb-sq--${isDark ? 'dark' : 'light'}">${thumbPieceHtml(board[square])}</span>`;
    }
  }
  return `<div class="thumb-board" role="img" aria-label="${escapeHtml(label)}">${squares}</div>`;
}

function formatSanLineFromUci(play) {
  // A leak's `play` is a UCI path. This is deliberately NOT a full SAN
  // replay -- chess.js is already bundled here transitively (leakAnalysis.js
  // requires it), but a real move-by-move SAN line isn't needed for
  // anything else on this page, so a plain ply-count sentence is enough for
  // the thumbnail's accessible label without adding a second chess.js call
  // site just for prose.
  return play.length === 0 ? 'the starting position' : `after ${play.length} half-move${play.length === 1 ? '' : 's'}`;
}

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  const statusEl = $('report-status');
  const resultEl = $('report-result');
  const form = $('report-form');
  const usernameInput = $('report-username');
  const platformSelect = $('report-platform'); // optional: a stale cached HTML shell without it just always reads as 'lichess' below, never crashes
  if (!statusEl || !resultEl || !form || !usernameInput) return;

  // Site-audit item 3 (2026-08-26): the only two real values report-platform's
  // own <option>s carry -- never trust the raw select value or a URL param
  // beyond this check.
  function currentPlatform() {
    return platformSelect && platformSelect.value === 'chesscom' ? 'chesscom' : 'lichess';
  }

  function setPlatform(platform) {
    if (platformSelect) platformSelect.value = platform === 'chesscom' ? 'chesscom' : 'lichess';
    if (usernameInput) usernameInput.placeholder = platform === 'chesscom' ? 'e.g. Hikaru' : 'e.g. DrNykterstein';
  }

  if (platformSelect) {
    platformSelect.addEventListener('change', () => setPlatform(platformSelect.value));
  }

  let activeController = null; // AbortController for the in-flight games fetch, if any
  let reverseLookupPromise = null;

  function setStatus(html) {
    statusEl.innerHTML = html;
  }

  function setResult(html) {
    resultEl.innerHTML = html;
  }

  // -- lazy-fetched opening-name identification (spec 3.6's internal-link
  // hub; same lazy-fetch-once-cache pattern as src/browser/ecoExplorer
  // .client.js's own reverse-lookup loader) ---------------------------------

  function loadReverseLookup() {
    if (reverseLookupPromise) return reverseLookupPromise;
    reverseLookupPromise = fetch(REVERSE_LOOKUP_URL)
      .then((res) => (res && res.ok ? res.json() : null))
      .catch(() => null);
    return reverseLookupPromise;
  }

  function binarySearchFen(index, key) {
    let lo = 0;
    let hi = index.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const midKey = index[mid][0];
      if (midKey === key) return index[mid];
      if (midKey < key) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  async function identifyOpening(fen) {
    const index = await loadReverseLookup();
    if (!index) return null;
    const match = binarySearchFen(index, truncateFenForLookup(fen));
    return match ? { eco: match[1], name: match[2] } : null;
  }

  // -- spec 3.6: link each leak into the site's own ECO coverage -----------

  function ecoVolumeFilename(volume) {
    // Deliberately duplicated from src/renderEcoPages.js's own
    // ecoVolumeFilename() (a 1-line pure function) rather than require()d --
    // renderEcoPages.js is a server-only module (never bundled into a
    // browser entry; see its own header comment), and this page's only use
    // is this one filename-building rule.
    return `eco-volume-${volume.toLowerCase()}.html`;
  }

  // -- rendering: one leak row, collapsed with a progressive-disclosure
  // "why this is the recommendation" detail (spec 3.2.4 Screen 2) ----------

  function renderLeakRow(leak, index) {
    const detailId = `leak-detail-${index}`;
    const openingLabel = leak.opening && leak.opening.name ? displayName(leak.opening.name) : 'this position';
    const openingLink = leak.links.opening
      ? `<a href="${escapeHtml(leak.links.opening)}">${openingLabel}</a>`
      : openingLabel;
    return `
      <li class="leak-row">
        <span class="leak-rank">#${index + 1}</span>
        ${renderThumbBoard(leak.play, `Position after ${formatSanLineFromUci(leak.play)}, ${leak.color} to move`)}
        <div>
          <p class="leak-moves">In ${openingLink}, you played <strong>${escapeHtml(leak.yourMove.san)}</strong>
            (${leak.yourMove.yourCount} times). Your rating band's best move here is
            <strong>${escapeHtml(leak.bandMove.san)}</strong>.</p>
          <p class="leak-cost"><span class="leak-cost-label">Costs you about</span>${leak.costPer100.toFixed(1)} points per 100 games</p>
          <button type="button" class="leak-toggle" aria-expanded="false" aria-controls="${detailId}" data-leak-toggle="${index}">Why this is the recommendation</button>
        </div>
        <div class="leak-actions">
          <a href="${escapeHtml(leak.links.drill)}">Drill this</a>
          <a href="${escapeHtml(leak.links.builder)}">Fix it in the Repertoire Builder</a>
        </div>
        <div class="leak-detail" id="${detailId}" hidden>
          <p class="report-provenance">Your move: ${formatPct(leak.yourMove.score * 100)}% score over ${leak.yourMove.bandGames.toLocaleString()}
            band games at this position (your own sample: ${leak.yourMove.yourCount} games). Band's best:
            ${escapeHtml(leak.bandMove.san)}, ${formatPct(leak.bandMove.score * 100)}% score over ${leak.bandMove.bandGames.toLocaleString()} games.
            Confidence lower/upper bounds: yours ${formatPct(leak.yourMove.scoreLo * 100)}&ndash;${formatPct(leak.yourMove.scoreHi * 100)}%,
            band's ${formatPct(leak.bandMove.scoreLo * 100)}&ndash;${formatPct(leak.bandMove.scoreHi * 100)}%.</p>
        </div>
      </li>`;
  }

  function renderWatchList(watchList) {
    if (!watchList || watchList.length === 0) return '';
    const rows = watchList.map((w) => `<li>${escapeHtml(w.yourMove.san)}, played ${w.sampleSize} times, ${(w.winRate * 100).toFixed(0)}% score in your own games
      (this is your own small sample, not ranked against band data as a leak).</li>`).join('');
    return `<section>
      <h2>Watch list, not verdicts</h2>
      <p class="report-provenance">Openings where your own results have been poor, at a sample too small to rank as a leak.</p>
      <ul class="watch-list">${rows}</ul>
    </section>`;
  }

  function resultBadge(result) {
    const label = result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Draw';
    return `<span class="badge badge--${escapeHtml(result)}">${label}</span>`;
  }

  /**
   * Same shape as src/render.js's renderGamesTable(), plus a real outbound
   * link per row (spec 3.7 N1: "the report links back to real games") --
   * kept local rather than editing render.js (a shared file this task must
   * not touch, per WS-1 spec 6.2) or process.js's summarizeGames() (which
   * doesn't carry `id` through). `rawGames` and `gameSummary.results` are
   * the SAME array, same order (summarizeGames() is a plain `.map()` over
   * its input) -- zipped by index here rather than duplicating
   * summarizeGames' own field-extraction logic a second time.
   */
  function renderRecentGamesTable(gameSummary, rawGames) {
    if (gameSummary.totalGames === 0) {
      return '<p class="empty-note">No recent games found.</p>';
    }
    const rows = gameSummary.results
      .map((r, i) => {
        const gameUrl = buildGameUrl(rawGames[i] && rawGames[i].id);
        const link = gameUrl
          ? `<a href="${escapeHtml(gameUrl)}" target="_blank" rel="noopener noreferrer">View</a>`
          : '&ndash;';
        return `
        <tr class="result-${escapeHtml(r.result)}">
          <td>${escapeHtml(r.date || '-')}</td>
          <td>${escapeHtml(r.opponent)}</td>
          <td class="num">${escapeHtml(r.opponentRating ?? '-')}</td>
          <td>${escapeHtml(r.color)}</td>
          <td>${escapeHtml(r.variant)} / ${escapeHtml(r.speed)}</td>
          <td>${resultBadge(r.result)}</td>
          <td>${link}</td>
        </tr>`;
      })
      .join('');

    return `<p class="summary-line">${gameSummary.wins}W / ${gameSummary.losses}L / ${gameSummary.draws}D
         out of ${gameSummary.totalGames} games (win rate ${formatPct(gameSummary.winRate)}%,
         avg opponent rating ${gameSummary.avgOpponentRating ?? 'n/a'})</p>` +
      wrapTable(`
      <table>
        <thead>
          <tr><th>Date</th><th>Opponent</th><th class="num">Opp. rating</th><th>Color</th><th>Variant/Speed</th><th>Result</th><th>Game</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`, 'Recent games');
  }

  // Site-audit item, live-reproduced twice (once succeeding, once not, same
  // account, same code): "Ratings by variant - No rating history found."
  // rendered for an account with years of real Lichess rating history,
  // while Recent games (a separate fetch) populated fine in the same
  // section -- an empty-state message presenting an intermittent fetch
  // problem as a settled fact. Two real fixes, not a root-cause guess (the
  // real cause -- an occasional truncated/empty response from Lichess's own
  // API under this page's concurrent request load -- is outside this site's
  // control):
  // 1. Promise.allSettled, not Promise.all -- the two fetches are
  //    independent data (ratings-by-variant vs. recent games), so one
  //    failing must not blank out the other; a prior version lost BOTH on
  //    either one failing.
  // 2. A resolved-but-empty rating-history array is only trustworthy as a
  //    genuine "no history" when the account also has zero recent games --
  //    a real recent RATED game (which the sibling fetch already confirms)
  //    necessarily implies a rating exists for at least one variant, so an
  //    empty array alongside real recent games is treated as a likely
  //    silent failure (GOV.UK error-honesty pattern: say "couldn't load",
  //    never "none found", when a failure is plausible over a genuine
  //    empty state).
  async function renderPlayerHistorySection(username) {
    const [historyResult, gamesResult] = await Promise.allSettled([
      fetchRatingHistory(username),
      fetchRecentGames(username, { max: 15 }),
    ]);

    const gameSummary = gamesResult.status === 'fulfilled' ? summarizeGames(gamesResult.value, username) : summarizeGames([], username);
    const gamesHtml = gamesResult.status === 'fulfilled'
      ? renderRecentGamesTable(gameSummary, gamesResult.value)
      : '<p class="empty-note">Could not load recent games right now.</p>';

    let ratingHtml;
    if (historyResult.status !== 'fulfilled') {
      ratingHtml = '<p class="empty-note">Could not load rating history right now.</p>';
    } else {
      const ratingRows = summarizeRatingHistory(historyResult.value);
      const likelySilentFailure = ratingRows.length === 0 && gameSummary.totalGames > 0;
      ratingHtml = likelySilentFailure
        ? '<p class="empty-note">Could not load rating history right now.</p>'
        : renderRatingTable(ratingRows);
    }

    return `<section>
      <h2>Rating history and recent games</h2>
      <h3>Ratings by variant</h3>
      ${ratingHtml}
      <h3>Recent games</h3>
      ${gamesHtml}
    </section>`;
  }

  function wireLeakToggles(container) {
    container.querySelectorAll('[data-leak-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const detail = document.getElementById(btn.getAttribute('aria-controls'));
        if (!detail) return;
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        if (expanded) detail.setAttribute('hidden', '');
        else detail.removeAttribute('hidden');
      });
    });
  }

  function wireShareButton(container, report) {
    const btn = container.querySelector('[data-share-report]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const bandFragment = (() => {
        try {
          const state = readBandState();
          return `band=${encodeURIComponent(state.band)}&pool=${encodeURIComponent(state.pool)}&color=${encodeURIComponent(state.color)}`;
        } catch (err) {
          return '';
        }
      })();
      const encoded = encodeShareFragment(report);
      const base = `${window.location.origin}${window.location.pathname}`;
      let url;
      let note = '';
      if (encoded.ok) {
        url = `${base}#${bandFragment ? `${bandFragment}&` : ''}${encoded.fragment}`;
      } else {
        url = `${base}?username=${encodeURIComponent(report.username)}`;
        note = SHARE_FRAGMENT_MAX_CHARS_FALLBACK_NOTE;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
          btn.textContent = note ? `Link copied (${note})` : 'Link copied';
        } else {
          btn.textContent = 'Copy failed - select and copy the address bar';
        }
      } catch (err) {
        btn.textContent = 'Copy failed - select and copy the address bar';
      }
    });
  }

  // The band-mismatch warning's own "Switch to the closer band" link:
  // updates the site-wide band selector (writeBandState() also notifies the
  // header's own dropdown across bundles, so it stays in sync without this
  // function touching that DOM directly) and re-runs the report against the
  // corrected band, rather than just telling the visitor to go find the
  // selector themselves.
  function wireBandWarningFix(container, correctBand, report) {
    const link = container.querySelector('[data-band-warning-fix]');
    if (!link) return;
    link.addEventListener('click', (evt) => {
      evt.preventDefault();
      const current = (() => {
        try {
          return readBandState();
        } catch (err) {
          return { band: correctBand, pool: 'blitz', color: 'white' };
        }
      })();
      writeBandState({ band: correctBand, pool: current.pool, color: current.color });
      runReport(report.username, report.platform === 'chesscom' ? 'chesscom' : 'lichess');
    });
  }

  function renderSuccessScreen(report, watchList, opts = {}) {
    const { cancelled = false, bandWarning = null } = opts;
    const platform = report.platform === 'chesscom' ? 'chesscom' : 'lichess';
    setPlatform(platform);
    const top = report.leaks[0];
    const verdict = top
      ? `Your biggest opening leak is ${escapeHtml(top.yourMove.san)}${top.opening && top.opening.name ? ` in the ${displayName(top.opening.name)}` : ''}. It costs you about ${top.costPer100.toFixed(1)} points per 100 games.`
      : 'No leak cleared our statistical floor - your play is close to what your rating band recommends at the positions we could compare.';
    const platformLabel = platform === 'chesscom' ? ' (Chess.com)' : '';
    // Ordered to match the real pipeline (fetched -> usable for analysis ->
    // reached band-data coverage), so two close-but-different numbers (e.g.
    // 241 usable, 240 in coverage) read as "almost all, minus the odd one
    // out" instead of a contradiction (site-audit item: "caption math reads
    // contradictory").
    const provenance = `${report.gamesFetched.toLocaleString()} games fetched, ${report.gamesUsable.toLocaleString()} usable for analysis, ${report.gamesInCoverage.toLocaleString()} of those reached data we have coverage for. ${escapeHtml(report.band)} band, ${escapeHtml(report.pool)}${platformLabel}, retrieved ${escapeHtml(new Date(report.generated).toISOString().slice(0, 10))}.${cancelled ? ' (You cancelled the fetch early - this is based on the games already retrieved.)' : ''}`;

    const leakRows = report.leaks.map((leak, i) => renderLeakRow(leak, i)).join('');

    // Site-audit item: the report has always compared the visitor's moves
    // against whichever band the header selector holds, with no check
    // against their own real rating. A real, resolved mismatch (see
    // profilePromise in runReport()) renders as a prominent callout right
    // above the verdict, never silently -- but never blocks the report
    // itself, since comparing against a different band on purpose is a
    // legitimate use (a 1200 player curious what 2000+ looks like).
    const bandWarningHtml = bandWarning
      ? `<p class="report-band-warning" role="alert">Heads up: your real ${escapeHtml(bandWarning.pool.replace('_', '/'))} rating looks like <strong>${bandWarning.rating.toLocaleString()}</strong>, but this report compares your play against the <strong>${escapeHtml(bandWarning.band)}</strong> band. <a href="#" data-band-warning-fix>Switch to the closer band</a> for a report that actually matches your level.</p>`
      : '';

    // Rating history/recent games (renderPlayerHistorySection below) hits
    // Lichess-only endpoints (src/fetchLichess.js) -- Chess.com reports get
    // an honest note instead of a section that would silently fail or,
    // worse, fetch Lichess data for a Chess.com username that may not even
    // exist there under the same handle.
    const historySection = platform === 'chesscom'
      ? '<p class="empty-note">Rating history and recent games are Lichess-only for now.</p>'
      : '<div id="report-history-mount"><p class="status-message status-message--loading">Loading rating history and recent games&hellip;</p></div>';

    setResult(`
      <section>
        ${bandWarningHtml}
        <p class="report-verdict">${verdict}</p>
        <p class="report-provenance">${provenance}</p>
        <ul class="leak-list">${leakRows}</ul>
        <button type="button" class="fetch-cancel" data-share-report>Copy my report link</button>
      </section>
      ${renderWatchList(watchList)}
      ${historySection}
    `);
    if (bandWarning) wireBandWarningFix(resultEl, bandWarning.band, report);
    wireLeakToggles(resultEl);
    wireShareButton(resultEl, report);

    if (platform !== 'chesscom') {
      renderPlayerHistorySection(report.username).then((html) => {
        const mount = $('report-history-mount');
        if (mount) mount.innerHTML = html;
      });
    }
  }

  function renderDesignedState(kind, extra = {}) {
    const platform = extra.platform === 'chesscom' ? 'chesscom' : 'lichess';
    const platformName = platform === 'chesscom' ? 'Chess.com' : 'Lichess';
    const usernameShape = platform === 'chesscom' ? '3-25 letters, digits, hyphens, or underscores' : '2-30 letters, digits, hyphens, or underscores';
    const messages = {
      'unknown-user': `No ${platformName} account found for "${escapeHtml(extra.username || '')}". Check the spelling and try again.`,
      'no-games': `We couldn't find any rated blitz or rapid games for "${escapeHtml(extra.username || '')}" on ${platformName} to analyse.`,
      'too-few-games': `"${escapeHtml(extra.username || '')}" has only ${extra.gamesUsable != null ? extra.gamesUsable : 'a few'} usable rated blitz/rapid games. We need at least 20 to say anything statistically honest. Play some more games and check back.`,
      'no-coverage': `None of "${escapeHtml(extra.username || '')}"'s games reached a position our band data covers yet. Our coverage is still bounded. Try a more mainstream opening, or check back as coverage grows.`,
      unreachable: `Could not reach ${platformName} from this page (network error, or your browser blocked the cross-origin request). Check your connection and try again.`,
      'rate-limited': `${platformName} asked us to slow down. Try again in a minute.`,
      cancelled: 'Fetch cancelled before enough games were retrieved to build a report.',
      'invalid-username': `"${escapeHtml(extra.username || '')}" isn't a ${platformName}-shaped username (${usernameShape}). Check it and try again.`,
    };
    setResult(`<p class="status-message status-message--error">${messages[kind] || 'Something went wrong building your report.'}</p>`);
  }

  // -- streaming fetch (spec 3.2.1) -----------------------------------------

  function updateProgress(count) {
    setStatus(`
      <div class="fetch-progress">
        <progress value="${count}" max="${MAX_GAMES}"></progress>
        <span class="fetch-progress-count">${count} of ${MAX_GAMES} games</span>
        <button type="button" class="fetch-cancel" data-cancel-fetch>Cancel</button>
      </div>`);
    const cancelBtn = statusEl.querySelector('[data-cancel-fetch]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (activeController) activeController.abort();
      }, { once: true });
    }
  }

  /**
   * Streams the ndjson response line by line, enforcing the 8MB total cap
   * (spec 3.7 altered #1) and updating the progress UI as lines arrive.
   * @returns {Promise<{lines:string[], cancelled:boolean}>}
   */
  async function streamGames(username, controller) {
    const url = `${GAMES_ENDPOINT_BASE}${encodeURIComponent(username)}?max=${MAX_GAMES}&rated=true&perfType=blitz,rapid&opening=true&moves=true&tags=false&clocks=false&evals=false&sort=dateDesc`;
    const response = await fetch(url, { headers: { Accept: 'application/x-ndjson' }, signal: controller.signal });

    if (response.status === 404) {
      const err = new Error('unknown-user');
      err.kind = 'unknown-user';
      throw err;
    }
    if (response.status === 429) {
      const err = new Error('rate-limited');
      err.kind = 'rate-limited';
      throw err;
    }
    if (!response.ok) {
      const err = new Error(`lichess-error-${response.status}`);
      err.kind = 'unreachable';
      throw err;
    }
    if (!response.body || !response.body.getReader) {
      // No streaming support -- fall back to a single text() read (still
      // capped, still line-split the same way).
      const text = await response.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      updateProgress(lines.length);
      return { lines, cancelled: false };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalBytes = 0;
    const lines = [];
    let cancelled = false;

    while (true) {
      let chunk;
      try {
        // eslint-disable-next-line no-await-in-loop
        chunk = await reader.read();
      } catch (err) {
        if (controller.signal.aborted) { cancelled = true; break; }
        throw err;
      }
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch (err) { /* already closing */ }
        break; // stop reading further; analyse whatever was collected
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) lines.push(trimmed);
      }
      updateProgress(lines.length);
    }
    if (buffer.trim()) lines.push(buffer.trim());
    return { lines, cancelled };
  }

  /**
   * Chess.com's own analogue of streamGames() above (site-audit item 3,
   * 2026-08-26). Chess.com has no single bulk-export endpoint like Lichess's
   * ndjson stream -- games are published one calendar month at a time
   * (src/fetchChessCom.js). Walks backward from the visitor's most recent
   * archive month, one request at a time (this project's own standing
   * politeness convention -- see src/fetchOpeningExplorer.js's header
   * comment for the precedent), stopping once MAX_GAMES real games have been
   * collected or CHESSCOM_MAX_MONTHS months have been walked, whichever
   * comes first -- the disclosed default this task's own copy in
   * src/renderOpeningReport.js states plainly, not a hidden implementation
   * detail. Unfiltered games are returned; src/leakAnalysis.js's
   * parseChessComGame() (called downstream, inside buildLeakAnalysisFromChessCom)
   * is what actually filters to rated/blitz-or-rapid/standard-chess.
   * @returns {Promise<{games:object[], cancelled:boolean}>}
   */
  async function fetchChessComRecentGames(username, controller) {
    let archives;
    try {
      archives = await fetchChessComArchives(username, { fetchImpl: fetch, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) {
        const cancelErr = new Error('cancelled');
        cancelErr.kind = 'cancelled';
        throw cancelErr;
      }
      if (err instanceof ChessComNotFoundError) {
        const e = new Error('unknown-user');
        e.kind = 'unknown-user';
        throw e;
      }
      if (err instanceof ChessComRateLimitError) {
        const e = new Error('rate-limited');
        e.kind = 'rate-limited';
        throw e;
      }
      const e = new Error('unreachable');
      e.kind = 'unreachable';
      throw e;
    }

    // Most recent month first -- archives arrives chronological oldest-first
    // (verified live before this was written; see fetchChessCom.js's own
    // header comment).
    const recentArchives = archives.slice(-CHESSCOM_MAX_MONTHS).reverse();
    const games = [];
    let cancelled = false;

    for (const archiveUrl of recentArchives) {
      if (controller.signal.aborted) { cancelled = true; break; }
      let monthGames;
      try {
        // eslint-disable-next-line no-await-in-loop -- intentionally serial, see this function's own header comment
        monthGames = await fetchChessComArchiveGames(archiveUrl, { fetchImpl: fetch, signal: controller.signal });
      } catch (err) {
        if (controller.signal.aborted) { cancelled = true; break; }
        if (games.length === 0) {
          // The very first (most recent) month failing means we have
          // nothing at all -- surface a real error rather than a silent
          // empty report.
          if (err instanceof ChessComRateLimitError) {
            const e = new Error('rate-limited');
            e.kind = 'rate-limited';
            throw e;
          }
          const e = new Error('unreachable');
          e.kind = 'unreachable';
          throw e;
        }
        break; // a LATER month failing after we already have some games: keep what was already collected
      }
      games.push(...monthGames);
      updateProgress(Math.min(games.length, MAX_GAMES));
      if (games.length >= MAX_GAMES) break;
    }

    return { games, cancelled };
  }

  // -- orchestration ----------------------------------------------------------

  async function runReport(username, platform = 'lichess') {
    const isValid = platform === 'chesscom' ? isValidChessComUsername : isValidUsername;
    if (!isValid(username)) {
      renderDesignedState('invalid-username', { username, platform });
      return;
    }
    if (activeController) activeController.abort();
    activeController = new AbortController();
    const controller = activeController;

    setStatus('<p class="status-message status-message--loading">Starting&hellip;</p>');
    setResult('');

    // Kicked off now, in parallel with the (much heavier) game fetch below,
    // and only awaited once we know a report is actually coming -- one
    // lightweight profile call, used solely to warn if the header's
    // selected band doesn't match the visitor's own real rating (site-audit
    // item: a silent band mismatch on the report's core flow). Lichess-only,
    // same restriction renderPlayerHistorySection's rating-history section
    // already uses; a failed fetch (network hiccup, a genuinely rating-less
    // account) degrades to no warning rather than blocking the report.
    const profilePromise = platform === 'chesscom' ? Promise.resolve(null) : fetchUserProfile(username).catch(() => null);

    let lines = [];
    let chessComGames = [];
    let cancelled = false;
    try {
      if (platform === 'chesscom') {
        const streamed = await fetchChessComRecentGames(username, controller);
        chessComGames = streamed.games;
        cancelled = streamed.cancelled;
      } else {
        const streamed = await streamGames(username, controller);
        lines = streamed.lines;
        cancelled = streamed.cancelled;
      }
    } catch (err) {
      if (controller.signal.aborted) {
        cancelled = true;
      } else if (err && err.kind) {
        setStatus('');
        renderDesignedState(err.kind, { username, platform });
        return;
      } else {
        setStatus('');
        renderDesignedState('unreachable', { username, platform });
        return;
      }
    }

    setStatus('<p class="status-message status-message--loading">Analysing your games&hellip;</p>');

    const fetchedCount = platform === 'chesscom' ? chessComGames.length : lines.length;
    if (cancelled && fetchedCount === 0) {
      setStatus('');
      renderDesignedState('cancelled', { username, platform });
      return;
    }

    const state = (() => {
      try {
        return readBandState();
      } catch (err) {
        return { band: '1600-1800', pool: 'blitz' };
      }
    })();

    // A real macrotask boundary (site-audit item, live-reproduced: a warm
    // lookupCache turns the analysis loop into a chain of already-resolved
    // awaits, which never yields to rendering on its own -- see
    // aggregateAndRank()'s own comment in src/leakAnalysis.js for why).
    const yieldToRender = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    const result = platform === 'chesscom'
      ? await buildLeakAnalysisFromChessCom({
        games: chessComGames,
        username,
        band: state.band,
        pool: state.pool,
        lookupFn: bandLookup,
        identifyFn: identifyOpening,
        yieldFn: yieldToRender,
      })
      : await buildLeakAnalysis({
        ndjsonLines: lines,
        username,
        band: state.band,
        pool: state.pool,
        lookupFn: bandLookup,
        identifyFn: identifyOpening,
        yieldFn: yieldToRender,
      });

    setStatus('');

    if (!result.ok) {
      if (result.gamesFetched === 0) {
        renderDesignedState('no-games', { username, platform });
      } else if (cancelled) {
        renderDesignedState('cancelled', { username, platform });
      } else {
        renderDesignedState('too-few-games', { username, platform, gamesUsable: result.gamesUsable });
      }
      return;
    }

    if (result.gamesInCoverage === 0) {
      renderDesignedState('no-coverage', { username, platform });
      return;
    }

    // Fill in each leak's opening.links.opening (spec 3.6 -- link into the
    // site's own ECO coverage) now that we know which openings identified.
    result.report.leaks.forEach((leak) => {
      if (leak.opening && leak.opening.eco) {
        leak.links.opening = `${ecoVolumeFilename(leak.opening.eco[0])}#${encodeURIComponent(leak.opening.eco)}`;
      }
    });

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result.report));
    } catch (err) {
      // Storage can throw (private browsing, quota) -- the report still
      // renders for this page view even if it can't be remembered.
    }

    const profile = await profilePromise;
    const bandWarning = (() => {
      if (!profile || !profile.perfs) return null;
      const rating = inferRatingForPool(profile.perfs, result.report.pool);
      if (rating == null) return null;
      const range = bandRangeFor(result.report.band);
      if (!range) return null;
      const [min, max] = range;
      if (rating >= min && rating < max) return null; // real match -- no warning
      return { rating, band: result.report.band, pool: result.report.pool };
    })();

    renderSuccessScreen(result.report, result.watchList, { cancelled, bandWarning });
  }

  function loadFromLocalStorage() {
    let raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
    if (!raw) return null;
    const parsed = parseLeakReport(raw);
    return parsed.ok ? parsed.report : null;
  }

  function loadFromShareFragment() {
    if (!window.location.hash || window.location.hash.length < 2) return null;
    const decoded = decodeShareFragment(window.location.hash.slice(1));
    return decoded.ok ? decoded.report : null;
  }

  function init() {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const username = usernameInput.value.trim();
      if (!username) return;
      const platform = currentPlatform();
      const url = new URL(window.location.href);
      url.searchParams.set('username', username);
      url.searchParams.set('platform', platform);
      window.history.replaceState(null, '', url);
      runReport(username, platform);
    });

    const shared = loadFromShareFragment();
    if (shared) {
      usernameInput.value = shared.username;
      renderSuccessScreen(shared, [], { cancelled: false }); // sets the platform select from shared.platform itself
      return;
    }

    const params = new URLSearchParams(window.location.search);
    // Site-audit item 3 (2026-08-26): a `?platform=` value is untrusted the
    // same as `?username=` (spec 3.7 N2's own standing rule) -- only the two
    // real enum values are ever accepted, anything else silently falls back
    // to 'lichess' rather than being trusted or reflected.
    const platformParam = params.get('platform') === 'chesscom' ? 'chesscom' : 'lichess';
    setPlatform(platformParam);

    const prefill = params.get('username');
    const isValid = platformParam === 'chesscom' ? isValidChessComUsername : isValidUsername;
    if (prefill && isValid(prefill)) {
      usernameInput.value = prefill;
      runReport(prefill, platformParam);
      return;
    }
    if (prefill) {
      // Present but invalid (spec 3.7 N2's test case) -- render it back as
      // plain text via the designed error state, never build a request or
      // a DOM write from it first.
      renderDesignedState('invalid-username', { username: prefill, platform: platformParam });
      return;
    }

    const saved = loadFromLocalStorage();
    if (saved) {
      usernameInput.value = saved.username;
      renderSuccessScreen(saved, [], { cancelled: false }); // sets the platform select from saved.platform itself
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
