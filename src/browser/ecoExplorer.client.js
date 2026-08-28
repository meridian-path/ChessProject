'use strict';

/**
 * Page controller for T3, the interactive ECO explorer
 * (dist/eco-explorer.html). esbuild entry point (see
 * src/buildEcoExplorer.js's bundleEcoExplorer(), same
 * bundleBrowserEntry()-into-IIFE strategy as every other browser bundle on
 * this site -- src/buildStatic.js's own header comment explains why: a
 * pre-bundled IIFE has no runtime require() and no bare module resolution,
 * so it works from a file:// URL where native ESM `import` is CORS-blocked).
 *
 * require()s src/boardWidget.js's shared cm-chessboard setup indirectly via
 * src/boardWidgetReplay.js (mountReplayBoard -- manages its own board +
 * controls markup inside whatever single container element it's given) and
 * src/boardWidgetFree.js (mountFreeBoard, needs chess.js) -- both split into
 * their own modules, along with src/pgnWrapper.js (the ONLY place on this entire site
 * untrusted input reaches a chess engine -- see that file's own header
 * comment for the full security rationale) and chess.js directly, same as
 * any other module in this project -- esbuild inlines the whole graph at
 * build time.
 *
 * Two data sources, two different loading strategies (see
 * src/ecoExplorerData.js's header comment for the full reasoning):
 *   - The ~50 KB-gzip search index (craft-audit item 5, 2026-08-28) is
 *     fetched eagerly, once, as soon as this script runs -- search is this
 *     page's primary feature, so the fetch starts immediately rather than
 *     waiting on any user action, and is cached in memory once resolved.
 *   - The ~170 KB-gzip FEN reverse-lookup table is fetched lazily, once,
 *     the first time a visitor actually needs FEN identification (a paste,
 *     or a free-play move) -- deferred because it is used far less often
 *     than search and is over 3x the payload.
 * Both are declared exceptions to this site's file:// invariant (see
 * TESTING.md). Either fetch() failing (e.g. this page opened directly from
 * disk) degrades to a plain, honest status message rather than a silent
 * no-op or a thrown error.
 */

const { mountReplayBoard } = require('../boardWidgetReplay');
const { mountFreeBoard } = require('../boardWidgetFree');
const { parsePgnSafe, parseFenSafe } = require('../pgnWrapper');
const { Chess } = require('chess.js');

const STORAGE_KEY = 'lichess-stats.eco-explorer.v1';
const MAX_RESULTS_SCANNED = 2000; // safety valve: stop scanning a pathological query well before the full 3,810-row index
const MAX_RESULTS_RENDERED = 100; // keep the results DOM small regardless of how many rows match

(function () {
  const app = document.querySelector('[data-explorer-app]');
  if (!app) return; // no explorer markup present -- nothing to wire up (defensive, mirrors drill.client.js's own bail-out pattern)

  const t0MapEl = document.getElementById('explorer-t0-map');
  const configEl = document.getElementById('explorer-config');
  if (!t0MapEl || !configEl) return;

  let t0Map;
  let config;
  try {
    t0Map = JSON.parse(t0MapEl.textContent);
    config = JSON.parse(configEl.textContent);
  } catch (err) {
    return; // corrupt baked data -- leave the server-rendered no-JS content as-is
  }

  const boardMount = document.getElementById('explorer-board-mount');
  const currentLineEl = document.getElementById('explorer-current-line');
  const identifyStatusEl = document.getElementById('explorer-identify-status');
  const searchInput = document.getElementById('explorer-search-input');
  const resultCountEl = document.getElementById('explorer-result-count');
  const resultsEl = document.getElementById('explorer-results');
  const fenInput = document.getElementById('explorer-fen-input');
  const fenSubmit = document.getElementById('explorer-fen-submit');
  const pgnInput = document.getElementById('explorer-pgn-input');
  const pgnSubmit = document.getElementById('explorer-pgn-submit');
  const pasteErrorEl = document.getElementById('explorer-paste-error');
  if (!boardMount || !searchInput || !resultsEl) return;

  // --- search line index: fetched eagerly (this page's primary feature), cached in memory --

  let lineIndexData = null;
  let lineIndexFailed = false;
  const lineIndexPromise = fetch(config.lineIndexUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!Array.isArray(data)) throw new Error('line index is not an array');
      lineIndexData = data;
      return data;
    })
    .catch(() => {
      lineIndexFailed = true;
      return null;
    });

  // --- reverse-lookup: lazy-fetched once, cached in memory -----------------

  let reverseLookupPromise = null;
  function loadReverseLookup() {
    if (reverseLookupPromise) return reverseLookupPromise;
    reverseLookupPromise = fetch(config.reverseLookupUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .catch(() => null); // null = "identification unavailable" (offline, file://, or a bad response) -- callers must handle this honestly, not silently
    return reverseLookupPromise;
  }

  function truncateFenForLookup(fen) {
    return String(fen).split(' ').slice(0, 4).join(' ');
  }

  /** Binary search over reverseIndex (sorted [fen, eco, name] rows). */
  function binarySearchFen(reverseIndex, key) {
    let lo = 0;
    let hi = reverseIndex.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const midKey = reverseIndex[mid][0];
      if (midKey === key) return reverseIndex[mid];
      if (midKey < key) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  async function identifyFen(fen) {
    identifyStatusEl.textContent = 'Identifying position…';
    const reverseIndex = await loadReverseLookup();
    if (!reverseIndex) {
      identifyStatusEl.textContent = 'Position identification needs a network connection (this page was likely opened directly from disk).';
      return;
    }
    const match = binarySearchFen(reverseIndex, truncateFenForLookup(fen));
    identifyStatusEl.textContent = match
      ? `Identified: ${match[2]} (${match[1]})`
      : 'Not a named position in our database.';
  }

  // --- board -----------------------------------------------------------------

  let freeBoardHandle = null;
  let replayHandle = null;

  function teardownBoard() {
    if (freeBoardHandle) { freeBoardHandle.destroy(); freeBoardHandle = null; }
    if (replayHandle) { replayHandle.destroy(); replayHandle = null; }
    boardMount.replaceChildren();
  }

  /** Replays a baked, TRUSTED (build-time-validated) SAN line through chess.js into a FEN array. */
  function replaySanLine(sanTokens) {
    const chess = new Chess();
    const fens = [chess.fen()];
    const labels = ['Starting position'];
    for (const san of sanTokens) {
      const move = chess.move(san, { strict: true });
      if (!move) throw new Error(`ecoExplorer: illegal SAN in trusted baked data: "${san}"`);
      fens.push(move.after);
      labels.push(move.san);
    }
    return { fens, labels, finalFen: chess.fen() };
  }

  function mountLine(row) {
    teardownBoard();
    const [eco, name, , sanText] = row;
    const sanTokens = sanText.split(' ').filter(Boolean);
    const { fens, labels, finalFen } = replaySanLine(sanTokens);
    replayHandle = mountReplayBoard(boardMount, { fens, labels, startIndex: fens.length - 1 });
    currentLineEl.textContent = `${name} (${eco}) - ${sanTokens.join(' ')}`;
    identifyFen(finalFen);
  }

  /**
   * @param {string} [fen]
   * @param {boolean} [autoIdentify] Whether to run the (network-fetching)
   *   identify pass immediately on mount. `false` for the plain default
   *   starting position on first page load -- firing the lazy
   *   reverse-lookup fetch() merely because a visitor landed on the page,
   *   before they've done anything, would defeat the entire point of
   *   making it lazy (see this file's header comment and
   *   src/ecoExplorerData.js's). `true` for a position the visitor (or a
   *   restored localStorage value) actually asked to see.
   */
  function mountFreePlay(fen, autoIdentify = true) {
    teardownBoard();
    freeBoardHandle = mountFreeBoard(boardMount, {
      fen,
      onMove: (info) => {
        currentLineEl.textContent = `Free play - last move ${info.san}`;
        identifyFen(info.fen);
      },
    });
    if (fen) {
      currentLineEl.textContent = 'Free play from a pasted position.';
      if (autoIdentify) identifyFen(freeBoardHandle.chess.fen());
    } else {
      currentLineEl.textContent = 'Free play from the starting position - move a piece to begin.';
      identifyStatusEl.textContent = '';
    }
  }

  /** A validated (parseFenSafe-checked) header FEN, or null if absent/invalid. */
  function mountPgnResult(result) {
    teardownBoard();
    const plyFens = result.moves.map((m) => m.fen);
    const plyLabels = result.moves.map((m) => m.san);
    let startFen;
    if (result.headers.FEN) {
      const validated = parseFenSafe(result.headers.FEN);
      if (validated.ok) startFen = validated.fen;
    }
    const fens = startFen ? [startFen, ...plyFens] : (plyFens.length > 0 ? plyFens : [result.finalFen]);
    const labels = startFen ? ['Starting position', ...plyLabels] : (plyLabels.length > 0 ? plyLabels : ['Position']);
    replayHandle = mountReplayBoard(boardMount, { fens, labels, startIndex: fens.length - 1 });
    const white = result.headers.White || '?';
    const black = result.headers.Black || '?';
    currentLineEl.textContent = `${white} vs ${black}${result.headers.Event ? ` (${result.headers.Event})` : ''}`;
    identifyFen(result.finalFen);
  }

  // --- search / filter ---------------------------------------------------------

  function matchesQuery(row, needle) {
    const [eco, name, family, sanText] = row;
    return (
      eco.toLowerCase().includes(needle)
      || name.toLowerCase().includes(needle)
      || family.toLowerCase().includes(needle)
      || sanText.toLowerCase().includes(needle)
    );
  }

  function renderResults(rows, totalMatched) {
    resultsEl.replaceChildren();
    if (rows.length === 0) {
      resultCountEl.textContent = totalMatched === 0 && searchInput.value.trim() ? 'No matches.' : '';
      return;
    }
    resultCountEl.textContent = totalMatched > rows.length
      ? `Showing ${rows.length} of ${totalMatched} matches - narrow your search to see more.`
      : `${totalMatched} match${totalMatched === 1 ? '' : 'es'}.`;

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['ECO', 'Name', 'Moves']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const [eco, name, , sanText, hubFile] = row;
      const tr = document.createElement('tr');

      const ecoTd = document.createElement('td');
      const chip = document.createElement('span');
      chip.className = 'eco-chip';
      chip.textContent = eco; // textContent throughout -- see this file's header comment
      ecoTd.appendChild(chip);
      tr.appendChild(ecoTd);

      const nameTd = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'explorer-result-name';
      btn.textContent = name;
      btn.addEventListener('click', () => mountLine(row));
      nameTd.appendChild(btn);
      if (t0Map[name]) {
        nameTd.appendChild(document.createTextNode(' '));
        const t0Link = document.createElement('a');
        t0Link.href = t0Map[name];
        t0Link.textContent = 'deep-dive →';
        nameTd.appendChild(t0Link);
      }
      if (hubFile) {
        nameTd.appendChild(document.createTextNode(' '));
        const hubLink = document.createElement('a');
        hubLink.href = hubFile;
        hubLink.textContent = 'family guide →';
        nameTd.appendChild(hubLink);
      }
      tr.appendChild(nameTd);

      const movesTd = document.createElement('td');
      movesTd.className = 'explorer-moves-cell';
      movesTd.textContent = sanText;
      tr.appendChild(movesTd);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    resultsEl.appendChild(table);
  }

  async function runSearch() {
    const needle = searchInput.value.trim().toLowerCase();
    if (needle.length === 0) {
      renderResults([], 0);
      return;
    }
    if (!lineIndexData && !lineIndexFailed) resultCountEl.textContent = 'Loading search index…';
    const lineIndex = lineIndexData || (await lineIndexPromise);
    // The visitor may have kept typing (or cleared the field) while this
    // awaited -- a newer input event already re-triggered runSearch for
    // whatever the field holds now, so a stale resolution here must not
    // clobber that newer render.
    if (searchInput.value.trim().toLowerCase() !== needle) return;
    if (!lineIndex) {
      resultCountEl.textContent = 'Search is unavailable right now (this page was likely opened directly from disk, or the fetch failed) -- try reloading, or browse by family below.';
      return;
    }
    const matched = [];
    let scanned = 0;
    for (const row of lineIndex) {
      scanned += 1;
      if (matchesQuery(row, needle)) matched.push(row);
      if (matched.length >= MAX_RESULTS_RENDERED && scanned >= MAX_RESULTS_SCANNED) break;
    }
    renderResults(matched.slice(0, MAX_RESULTS_RENDERED), matched.length);
  }

  let searchDebounceHandle = null;
  searchInput.addEventListener('input', () => {
    if (searchDebounceHandle) clearTimeout(searchDebounceHandle);
    searchDebounceHandle = setTimeout(runSearch, 80);
  });

  // --- localStorage: last-viewed position (validated on every read, per security-standards.md 4.4) --

  function loadLastFen() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.fen !== 'string') return null;
      // Never trust a stored FEN directly -- re-run the same validation a
      // pasted FEN gets, since a stored value is attacker-writable via any
      // past XSS or a shared machine (security-standards.md 4.4).
      const validated = parseFenSafe(parsed.fen);
      return validated.ok ? validated.fen : null;
    } catch (err) {
      return null;
    }
  }

  function saveLastFen(fen) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ fen }));
    } catch (err) {
      // localStorage unavailable (private mode, quota, disabled) -- fine, just don't persist.
    }
  }

  // --- PGN / FEN paste -----------------------------------------------------------

  function showPasteError(message) {
    pasteErrorEl.textContent = message || '';
  }

  function runFenSubmit() {
    showPasteError('');
    const result = parseFenSafe(fenInput.value);
    if (!result.ok) {
      showPasteError(result.message);
      return;
    }
    mountFreePlay(result.fen);
    saveLastFen(result.fen);
  }

  function runPgnSubmit() {
    showPasteError('');
    // Point 5 of the security spec ("yield to the UI, never freeze the tab
    // on a large-but-under-cap input"): run the actual parse on the next
    // task-queue turn so this click handler returns immediately and the
    // browser can paint a working state first, rather than blocking the
    // main thread synchronously on a worst-case-sized (still under-cap)
    // paste.
    identifyStatusEl.textContent = 'Reading PGN…';
    setTimeout(() => {
      const result = parsePgnSafe(pgnInput.value);
      if (!result.ok) {
        identifyStatusEl.textContent = '';
        showPasteError(result.message);
        return;
      }
      mountPgnResult(result);
      saveLastFen(result.finalFen);
    }, 0);
  }

  if (fenSubmit) fenSubmit.addEventListener('click', runFenSubmit);
  if (pgnSubmit) pgnSubmit.addEventListener('click', runPgnSubmit);

  // --- initial state ---------------------------------------------------------

  const restoredFen = loadLastFen();
  mountFreePlay(restoredFen || undefined);
  renderResults([], 0);
})();
