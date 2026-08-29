'use strict';

/**
 * Page controller for /drill.html (the hub + session, WS-1 spec section
 * 3.3). Esbuild entry point, same bundling convention as every other
 * *.client.js file in this project (real require()s, bundled into one
 * self-contained IIFE with no runtime require/module/exports -- see
 * src/buildStatic.js's bundleBrowserEntry()). src/browser/drillHub.client.js
 * is the actual DRILL_HUB_ENTRY buildDrillHubBundle() points at; it just
 * require()s this file (see that file's own two-line body) -- the real
 * controller lives here because this task's file footprint names
 * src/browser/drill.client.js, not drillHub.client.js (that file predates
 * this task as a placeholder -- see its own header comment for why the
 * indirection exists rather than moving the real logic there directly).
 *
 * REWRITE, stated for anyone comparing this to the pre-WS-1 version: the
 * old controller here was a single-opening level/streak state machine with
 * a baked-in tree (drillData read from a #drill-data JSON script tag) and
 * no scheduling. This controller is a spaced-repetition SESSION runner
 * over src/drillDeck.js's Card model: it reads/writes localStorage itself
 * (drillDeck.js stays pure, no DOM/storage), builds a session queue,
 * grades attempts via scheduler.js (through drillDeck.applyGrade), and
 * seeds new cards from a leak report or from live band data.
 *
 * SPOILER RULE (spec 3.3), the binding version -- how this file satisfies
 * it: the current card's `answerUci`/`answerSan` and its full candidate
 * list live ONLY in this closure's `currentCard`/`pendingCandidates`
 * variables, never written to any DOM node, attribute, or embedded JSON
 * until gradeAndAdvance() runs (an attempt or "Show me the answer").
 * pendingCandidates is fetched the moment a card LOADS (not literally
 * deferred to the reveal click) so that ONE fetch serves both grading
 * (gradeMove() needs the real candidate list to distinguish "correct" from
 * "off-meta but real" from "unrecognized") and the reveal-time table --
 * holding fetched-but-unrendered data in a closure is exactly as
 * spoiler-safe as fetching later, since the regression test
 * (test/drillHubClient.test.js) checks DOM content, not fetch timing. The
 * old candidate-table gating mechanism (renderCandidateTable called only
 * from the post-attempt path) is preserved unchanged in shape.
 *
 * Uses src/browser/bandData.client.js's lookup() directly for every real
 * band-data read (candidate loading, band-meta seeding) -- Contract A's
 * single runtime read path (WS-1 spec section 2.1), same as every other
 * WS-1 surface. That module (and its own src/bandShards.js/src/ingest/
 * positionWalk.js dependencies) is genuinely browser-bundle-safe as of the
 * WS-1 Repertoire Builder task's fix (src/buildPackCore.js + src/sha1.js,
 * a pure-JS SHA1 replacing a previous transitive Node `fs`/`crypto`
 * dependency) -- verified directly here too (this file's own esbuild
 * bundle, via buildDrillHubBundle(), resolves and runs cleanly). Before
 * that fix landed, this file carried a local duplicate of bandData.client.js's
 * read path for the same reason; removed once the real fix made it
 * unnecessary.
 */

const { START_BOARD, applyUciMoves, boardFromFen, fenFromBoard } = require('../chessPosition');
const { normalizeMoveInput, gradeMove, advanceDelayMs } = require('../drillLogic');
const drillDeck = require('../drillDeck');
const { parse: parseLeakReport } = require('../leakModel');
const { gradeFromAttempt } = require('../scheduler');
const { mountDrillBoard } = require('../boardWidgetDrill');
const bandData = require('./bandData.client');
const bandState = require('./bandState.client');

const LEAK_REPORT_KEY = 'rb.leakReport.v1';

(function () {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatPct(n) {
    return typeof n === 'number' ? (n * 100).toFixed(1) : '-';
  }

  // ---------------------------------------------------------------------
  // DOM lookups. Every id here matches src/renderDrillHub.js's server-
  // rendered markup exactly.
  // ---------------------------------------------------------------------
  const dueCountEl = document.getElementById('drill-due-count');
  const freshNoteEl = document.getElementById('drill-fresh-note');
  const startSessionBtn = document.getElementById('drill-start-session');
  const sessionLengthGroup = document.getElementById('drill-session-length');
  const decksListEl = document.getElementById('drill-decks-list');
  const stuckListEl = document.getElementById('drill-stuck-list');
  const seedFromReportEl = document.getElementById('drill-seed-from-report');
  const seedForm = document.getElementById('drill-seed-form');
  const seedOpeningSelect = document.getElementById('drill-seed-opening');
  const seedStatusEl = document.getElementById('drill-seed-status');

  const hubSection = document.getElementById('drill-hub');
  const sessionSection = document.getElementById('drill-session');
  const boardMountEl = document.getElementById('drill-board');
  const moveForm = document.getElementById('drill-move-form');
  const moveInput = document.getElementById('drill-move-text');
  const showAnswerBtn = document.getElementById('drill-show-answer');
  const endSessionBtn = document.getElementById('drill-end-session');
  const feedbackEl = document.getElementById('drill-feedback');
  const announceEl = document.getElementById('drill-announce');
  const candidateTableEl = document.getElementById('drill-candidate-table');

  if (!hubSection || !sessionSection || !boardMountEl) return; // markup not present -- nothing to wire up

  // ---------------------------------------------------------------------
  // Interactive board: the
  // real cm-chessboard component, same as every other board on this site,
  // replacing the old 64-unicode-glyph-button paint loop. Mounted lazily
  // (only once a session actually starts, see startSessionBtn's handler
  // below), not at script init -- boardMountEl sits inside <section
  // id="drill-session" hidden>, and cm-chessboard sizes itself off the
  // container's clientWidth at mount time (0 while hidden), the same
  // "mount on first real need" pattern src/browser/repertoireBuilder.client.js's
  // rebuildBoardAtPath() already uses for its own initially-hidden board.
  // ---------------------------------------------------------------------
  let boardHandle = null;

  function ensureBoardMounted() {
    if (boardHandle) return;
    // Discards the server-rendered static diagram (src/renderDrillHub.js) --
    // real content for a no-JS visitor, but cm-chessboard appends its own
    // markup into whatever container it's given rather than replacing it,
    // so this container must be emptied first or the two would render on
    // top of each other.
    boardMountEl.innerHTML = '';
    boardHandle = mountDrillBoard(boardMountEl, {
      fen: fenFromBoard(START_BOARD),
      onMove({ squareFrom, squareTo }) {
        gradeAndAdvance(squareFrom + squareTo, false);
      },
    });
  }

  // ---------------------------------------------------------------------
  // Deck persistence
  // ---------------------------------------------------------------------
  function loadDeck() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(drillDeck.STORAGE_KEY);
    } catch (err) {
      // localStorage unavailable -- degrade to a fresh, unsaved deck.
    }
    return drillDeck.parseDeck(raw);
  }

  function saveDeck(nextDeck) {
    try {
      window.localStorage.setItem(drillDeck.STORAGE_KEY, drillDeck.serializeDeck(nextDeck));
    } catch (err) {
      // Quota exceeded or storage disabled -- the session still works for
      // this page load, it just won't persist. Surfaced to the visitor via
      // the seed-status line if it happens during a seed action.
    }
  }

  let deck = loadDeck();

  // One-way legacy migration (spec 3.3): read the old key once, seed a
  // starter deck from band data, mark migrated, never touch the old key
  // again.
  async function migrateLegacyIfNeeded() {
    if (deck.migratedV1) return;
    let legacyRaw = null;
    try {
      legacyRaw = window.localStorage.getItem(drillDeck.LEGACY_KEY);
    } catch (err) {
      // ignore
    }
    const request = drillDeck.migrationSeedRequest(legacyRaw);
    deck = { ...deck, migratedV1: true };
    if (request) {
      try {
        const cards = await drillDeck.seedFromBandMeta({
          band: request.band,
          pool: 'blitz',
          openingSlug: 'italian-game',
          count: request.count,
          lookupFn: bandData.lookup,
        });
        const result = drillDeck.addCards(deck, cards);
        deck = result.deck;
      } catch (err) {
        // A migration failure (e.g. offline) is not fatal -- the visitor
        // simply starts with an empty deck instead of a migrated one.
      }
    }
    saveDeck(deck);
  }

  // ---------------------------------------------------------------------
  // Hub rendering
  // ---------------------------------------------------------------------
  function renderHub() {
    const now = new Date();
    const { due, fresh } = drillDeck.cardsDue(deck, now);
    if (dueCountEl) dueCountEl.textContent = String(due.length);
    if (startSessionBtn) startSessionBtn.disabled = due.length + fresh.length === 0;

    // UX audit finding: "0 cards due" read as "nothing to do", even though
    // Start Session still pulls in fresh/never-studied cards for the 10/25
    // -card session lengths (drillDeck.buildSessionQueue() concats due then
    // fresh) -- only genuinely nothing to do when both are empty.
    if (freshNoteEl) {
      if (due.length === 0 && fresh.length > 0) {
        freshNoteEl.textContent = `No reviews due, but ${fresh.length} new card${fresh.length === 1 ? '' : 's'} ${fresh.length === 1 ? 'is' : 'are'} ready to learn.`;
        freshNoteEl.hidden = false;
      } else {
        freshNoteEl.textContent = '';
        freshNoteEl.hidden = true;
      }
    }

    if (decksListEl) {
      const groups = drillDeck.decksByOpening(deck, now);
      if (groups.length === 0) {
        decksListEl.innerHTML = '<li class="empty-note">Your deck is empty. Add cards from an opening report or from the band data below.</li>';
      } else {
        decksListEl.innerHTML = groups
          .map((g) => `<li class="drill-deck-row"><span>${escapeHtml(g.openingName)}</span><span>${g.due} due of ${g.total}</span></li>`)
          .join('');
      }
    }

    if (stuckListEl) {
      const stuck = drillDeck.stuckCards(deck);
      if (stuck.length === 0) {
        stuckListEl.innerHTML = '<li class="empty-note">None yet.</li>';
      } else {
        stuckListEl.innerHTML = stuck
          .map((c) => `<li class="drill-stuck-row"><span class="drill-stuck-badge">${escapeHtml(c.openingName)}</span><a href="repertoire-builder.html">Fix it in the Repertoire Builder &rarr;</a></li>`)
          .join('');
      }
    }

    renderSeedFromReport();
  }

  function renderSeedFromReport() {
    if (!seedFromReportEl) return;
    let raw = null;
    try {
      raw = window.localStorage.getItem(LEAK_REPORT_KEY);
    } catch (err) {
      // ignore
    }
    if (!raw) {
      seedFromReportEl.innerHTML = '<h3>Drill your leaks</h3><p class="empty-note" id="drill-seed-report-empty">Get your <a href="opening-report.html">personal opening report</a> first, then come back here to drill exactly the moves it flags.</p>';
      return;
    }
    const parsed = parseLeakReport(raw);
    if (!parsed.ok) {
      seedFromReportEl.innerHTML = '<h3>Drill your leaks</h3><p class="empty-note">Your saved opening report could not be read. Generate a fresh one from <a href="opening-report.html">the opening report page</a>.</p>';
      return;
    }
    seedFromReportEl.innerHTML = `<h3>Drill your leaks</h3><p>Your report found ${parsed.report.leaks.length} leak${parsed.report.leaks.length === 1 ? '' : 's'} in the ${escapeHtml(parsed.report.band)} band.</p><button type="button" id="drill-seed-report-btn">Add ${parsed.report.leaks.length} leak card${parsed.report.leaks.length === 1 ? '' : 's'} to your deck</button>`;
    const btn = document.getElementById('drill-seed-report-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        const cards = drillDeck.seedFromLeakReport(parsed.report);
        const result = drillDeck.addCards(deck, cards);
        deck = result.deck;
        saveDeck(deck);
        renderHub();
        if (seedStatusEl) seedStatusEl.textContent = `Added ${result.addedCount} card${result.addedCount === 1 ? '' : 's'} from your report.`;
      });
    }
  }

  if (seedForm) {
    seedForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const slug = seedOpeningSelect ? seedOpeningSelect.value : null;
      if (!slug) return;
      const state = bandState.readBandState();
      if (seedStatusEl) seedStatusEl.textContent = 'Looking at your rating band’s own data…';
      try {
        const cards = await drillDeck.seedFromBandMeta({
          band: state.band,
          pool: state.pool,
          openingSlug: slug,
          count: 6,
          lookupFn: bandData.lookup,
        });
        const result = drillDeck.addCards(deck, cards);
        deck = result.deck;
        saveDeck(deck);
        renderHub();
        if (seedStatusEl) {
          seedStatusEl.textContent = cards.length === 0
            ? 'No band data is covered deeply enough for that opening yet.'
            : `Added ${result.addedCount} card${result.addedCount === 1 ? '' : 's'} (${result.duplicateCount} already in your deck).`;
        }
      } catch (err) {
        if (seedStatusEl) seedStatusEl.textContent = 'Could not reach the band data. Try again in a moment.';
      }
    });
  }

  // ---------------------------------------------------------------------
  // Session length picker
  // ---------------------------------------------------------------------
  let sessionLimit = 10;
  if (sessionLengthGroup) {
    sessionLengthGroup.addEventListener('click', function (event) {
      const btn = event.target.closest ? event.target.closest('button[data-length]') : null;
      if (!btn) return;
      const raw = btn.getAttribute('data-length');
      sessionLimit = raw === 'all-due' ? 'all-due' : Number(raw);
      const buttons = sessionLengthGroup.querySelectorAll('button[data-length]');
      for (let i = 0; i < buttons.length; i += 1) {
        buttons[i].setAttribute('aria-pressed', buttons[i] === btn ? 'true' : 'false');
      }
    });
  }

  // ---------------------------------------------------------------------
  // Session runner
  // ---------------------------------------------------------------------
  let queue = []; // array of {card, requeued}
  let currentEntry = null;
  let currentCard = null;
  let pendingCandidates = null;
  let cardStartTime = 0;
  let attemptedThisCard = false;
  let correctOnFirstAttempt = false;

  function boardForCard(card) {
    if (card.fen) return boardFromFen(card.fen);
    return applyUciMoves(START_BOARD, card.play || []);
  }

  // Repaints the real board for a new card. No-animate: a card transition
  // is a jump to an unrelated position, not a move, so sliding pieces
  // across the board here would misrepresent it as one (same reasoning
  // src/browser/repertoireBuilder.client.js's rebuildBoardAtPath() already
  // documents for its own reset(fen) call).
  function paintBoard(board) {
    if (boardHandle) boardHandle.setFen(fenFromBoard(board), false);
  }

  function announce(text) {
    if (announceEl) announceEl.textContent = text;
  }

  function setFeedback(verdict, text) {
    if (!feedbackEl) return;
    feedbackEl.className = verdict ? `drill-feedback drill-feedback--${verdict}` : 'drill-feedback';
    feedbackEl.textContent = text;
  }

  function resetCandidateTable() {
    if (!candidateTableEl) return;
    candidateTableEl.innerHTML = '<p class="empty-note">Play a move, or click &ldquo;Show me the answer,&rdquo; to reveal the candidates for this position.</p>';
  }

  /**
   * Renders the real candidate table -- called ONLY after an attempt or an
   * explicit reveal (the SPOILER RULE's gating point, unchanged in shape
   * from the pre-WS-1 pilot).
   */
  function renderCandidateTable(candidates) {
    if (!candidateTableEl) return;
    // data-uci carries the raw UCI alongside the human-readable SAN --
    // genuinely useful (a visitor who types UCI, per spec 3.3's "board
    // click or typed SAN or UCI", can see exactly which string this row
    // corresponds to), not decoration.
    const rows = candidates
      .map((c) => `<tr data-uci="${escapeHtml(c.uci)}"><td>${escapeHtml(c.san)}</td><td>${c.playedPct != null ? escapeHtml(formatPct(c.playedPct)) + '%' : '-'}</td><td>${c.score != null ? escapeHtml(formatPct(c.score)) + '%' : '-'}</td><td>${c.games != null ? escapeHtml(c.games.toLocaleString()) : '-'}</td></tr>`)
      .join('');
    candidateTableEl.innerHTML = `<table><thead><tr><th scope="col">Move</th><th scope="col">Pick %</th><th scope="col">Score %</th><th scope="col">Games</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /**
   * Candidates for grading + eventual reveal. Never rendered here -- see
   * this file's header comment. Falls back to a single-item list (just the
   * known answer) when there's no richer source, so gradeMove() always has
   * something to compare against.
   */
  /**
   * gradeMove() (src/drillLogic.js, reused unchanged per spec 3.3) reads
   * `node.candidates[0]` as THE answer -- it does not itself cross-check
   * against `node.answerUci`. Since a real band shard's move order is
   * "most games first," which is not always the same move as the card's
   * own `answerUci` (band-BEST by confidence-interval lower bound, spec
   * 3.2.3 -- occasionally a different move from the merely most-played
   * one), this re-sorts so the card's actual answer is always index 0
   * before candidates ever reach gradeMove(), regardless of source.
   */
  function withAnswerFirst(candidates, answerUci) {
    const idx = candidates.findIndex((c) => c.uci === answerUci);
    if (idx <= 0) return candidates;
    const reordered = candidates.slice();
    const [answer] = reordered.splice(idx, 1);
    reordered.unshift(answer);
    return reordered;
  }

  async function loadCandidatesForCard(card) {
    if (card.source === 'pack' && card.packStats) {
      return [{ uci: card.answerUci, san: card.answerSan, games: card.packStats.n, playedPct: null, score: card.packStats.score }];
    }
    if (Array.isArray(card.play)) {
      try {
        const result = await bandData.lookup({ play: card.play, band: card.band, pool: card.pool });
        if (result.coverage === 'in' && result.moves.length > 0) {
          const candidates = result.moves.map((m) => ({ uci: m.uci, san: m.san, games: m.games, playedPct: m.playedPct, score: m.score }));
          return withAnswerFirst(candidates, card.answerUci);
        }
      } catch (err) {
        // fall through to the single-item fallback below
      }
    }
    return [{ uci: card.answerUci, san: card.answerSan, games: null, playedPct: null, score: null }];
  }

  function sideAnnounceText(card) {
    return `${card.side === 'white' ? 'White' : 'Black'} to play. Type a move, or tap a piece then a destination square.`;
  }

  async function loadCard(entry) {
    currentEntry = entry;
    currentCard = entry.card;
    attemptedThisCard = false;
    correctOnFirstAttempt = false;
    cardStartTime = Date.now();
    paintBoard(boardForCard(currentCard));
    resetCandidateTable();
    setFeedback('', '');
    announce(sideAnnounceText(currentCard));
    pendingCandidates = await loadCandidatesForCard(currentCard);
  }

  function updateSessionProgress() {
    // no-op placeholder for a future progress readout; announce() already
    // covers the accessible state change per card.
  }

  function finishSession() {
    sessionSection.hidden = true;
    hubSection.hidden = false;
    currentEntry = null;
    currentCard = null;
    pendingCandidates = null;
    renderHub();
  }

  function advance() {
    if (queue.length === 0) {
      finishSession();
      return;
    }
    const next = queue.shift();
    loadCard(next);
  }

  function gradeAndAdvance(rawInput, isReveal) {
    if (!currentCard || !pendingCandidates) return;
    const responseMs = Date.now() - cardStartTime;
    const noAttemptMade = isReveal && !attemptedThisCard;

    let verdict;
    let answer;
    let played = null;
    if (noAttemptMade) {
      const result = gradeMove({ node: { candidates: pendingCandidates, answerUci: currentCard.answerUci }, input: currentCard.answerUci });
      verdict = 'unknown';
      answer = result.answer;
    } else {
      const result = gradeMove({ node: { candidates: pendingCandidates, answerUci: currentCard.answerUci }, input: rawInput });
      verdict = result.verdict;
      played = result.played;
      answer = result.answer;
      attemptedThisCard = true;
      if (verdict === 'correct' && !isReveal) correctOnFirstAttempt = true;
    }

    renderCandidateTable(pendingCandidates);

    let feedbackVerdict;
    let feedbackText;
    if (noAttemptMade) {
      feedbackVerdict = 'unknown';
      feedbackText = `The move is ${answer.san}${answer.playedPct != null ? ` - ${formatPct(answer.playedPct)}% of players at ${currentCard.band} play this here.` : '.'}`;
    } else if (verdict === 'correct') {
      feedbackVerdict = 'correct';
      feedbackText = `${answer.san} - correct.${answer.playedPct != null ? ` ${formatPct(answer.playedPct)}% of players at ${currentCard.band} play this here.` : ''}`;
    } else if (verdict === 'offmeta') {
      feedbackVerdict = 'offmeta';
      feedbackText = `${played.san} - a real move, but not the band-typical one here. The band-typical move is ${answer.san}.`;
    } else {
      feedbackVerdict = 'unknown';
      feedbackText = `That is not a move players make in this position. The band-typical move is ${answer.san}.`;
    }
    setFeedback(feedbackVerdict, feedbackText);

    const grade = gradeFromAttempt({
      noAttemptMade,
      usedReveal: isReveal,
      correctOnFirstAttempt,
      responseMs,
    });

    // Deviation (i), spec 2.3: schedule() is only called once per real
    // attempt sequence for this card -- a re-queued instance (see below)
    // skips it, since it's extra in-session practice, not a second graded
    // event.
    if (!currentEntry.requeued) {
      deck = drillDeck.applyGrade(deck, currentCard.id, grade, new Date());
      saveDeck(deck);
    }

    if (grade < 3 && !currentEntry.requeued) {
      // Re-queue this card once more before the session ends (scheduler.js's
      // documented deviation (i)) -- a few cards later, not immediately
      // next, so it doesn't feel like an instant repeat.
      const insertAt = Math.min(queue.length, 3);
      queue.splice(insertAt, 0, { card: currentCard, requeued: true });
    }

    window.setTimeout(advance, advanceDelayMs(feedbackText));
  }

  // Board click/drag/keyboard/accessibility-form input all reach here via
  // ensureBoardMounted()'s onMove callback (src/boardWidgetDrill.js) --
  // one path for every input method, same shape as the previous
  // handleSquareClick's "any two squares -> gradeAndAdvance" contract.

  if (moveForm) {
    moveForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const value = moveInput ? moveInput.value.trim() : '';
      if (!value) return;
      if (moveInput) moveInput.value = '';
      gradeAndAdvance(value, false);
    });
  }

  if (showAnswerBtn) {
    showAnswerBtn.addEventListener('click', function () {
      gradeAndAdvance(currentCard ? currentCard.answerUci : '', true);
    });
  }

  if (endSessionBtn) {
    endSessionBtn.addEventListener('click', finishSession);
  }

  if (startSessionBtn) {
    startSessionBtn.addEventListener('click', function () {
      const now = new Date();
      const built = drillDeck.buildSessionQueue(deck, now, sessionLimit);
      if (built.length === 0) return;
      queue = built.map((card) => ({ card, requeued: false }));
      hubSection.hidden = true;
      sessionSection.hidden = false;
      ensureBoardMounted();
      advance();
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  migrateLegacyIfNeeded().then(renderHub);
  renderHub();
})();
