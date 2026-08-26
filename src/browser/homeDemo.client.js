'use strict';

/**
 * Homepage hero live demo (part of the board-visibility work). Bundled by
 * src/buildStatic.js's buildHomeDemoBundle() into dist/home-demo.js, loaded
 * `defer` from index.html -- the homepage's first first-party JS bundle
 * (spec section 2.3 calls this out explicitly as the real risk of this
 * piece: everything else about the page stays working with JS disabled,
 * this one small panel does not).
 *
 * Move input is a small allowlist-only handler, NOT
 * src/boardWidgetFree.js's mountFreeBoard (chess.js-backed full legality).
 * Measured directly before writing this file: createBoard() +
 * boardWidgetFree.js's chess.js dependency together already bundle to
 * ~120.7KB uncompressed, over spec section 2.3's <=120KB budget before a
 * single byte of this page's own code. That section names the exact
 * fallback for this situation -- "restrict input to the three
 * pre-authored replies via a UCI allowlist and drop chess.js entirely" --
 * so this file does that: it accepts ONLY the from/to square pairs listed
 * in the build-time #home-demo-data block below, and rejects everything
 * else via cm-chessboard's own input state machine (the same
 * moveInputStarted/validateMoveInput mechanism mountFreeBoard uses for
 * real chess.js legality -- just checked against a fixed allowlist here
 * instead of a rules engine). This is a real, disclosed narrowing from the
 * spec's stated ideal ("never refuse a legal move") -- an arbitrary legal
 * Black reply that is not one of the three baked-in moves is rejected the
 * same as an illegal one would be, because there is no rules engine here
 * to tell the two apart. Interaction mechanics (click-to-move, drag) are
 * unaffected -- cm-chessboard drives those regardless of which handler
 * validates a proposed move.
 *
 * Data comes from the #home-demo-data JSON block src/buildStatic.js's
 * indexPage() bakes at build time (real per-band/Black Opening Explorer
 * numbers, same pipeline repertoire.html's own combos use) -- never a
 * runtime fetch, per spec section 2.3's "build-time constants" rule.
 *
 * Craft-audit fix (item 2): this demo used to be permanently locked to
 * whichever band the build baked as its default (1600-1800), regardless of
 * the site-wide band control's own state (this page is now one of
 * BAND_CONTROL_PAGES, src/render.js). The baked #home-demo-data payload now
 * carries a `byBand` map (every band's own replies/opening data, from
 * src/buildStatic.js's buildHomeDemoDataAllBands()) alongside the original
 * flat `replies`/`band` fields (kept for exact backward compatibility with
 * older builds/tests); this file reads the visitor's actual persisted band
 * via bandState.client.js (the same shared module every other band-aware
 * page/control on this site reads/writes) and re-mounts the board plus
 * updates every band-dependent string when it changes. A band with no
 * qualifying entry in `byBand` (buildHomeDemoData's own data-drift guard --
 * see that function's doc comment) is skipped: the demo stays on whichever
 * band it was last showing rather than breaking or showing empty data.
 */
const { createBoard, COLOR } = require('../boardWidget');
const { INPUT_EVENT_TYPE } = require('cm-chessboard/src/Chessboard.js');
const { readBandState, onBandStateChange } = require('./bandState.client');

// The position after 1. e4 -- a fixed, well-known FEN, not derived from the
// fetched tree data (cm-chessboard's setPosition only ever needs the
// piece-placement field, so a build-time-derived FEN would have worked
// here too, but a literal constant is simpler and needs no
// src/chessPosition.js dependency for a single fixed opening move).
var START_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

function readData() {
  var el = document.getElementById('home-demo-data');
  if (!el) return null;
  try {
    var parsed = JSON.parse(el.textContent);
    return parsed && parsed.replies && typeof parsed.replies === 'object' ? parsed : null;
  } catch (err) {
    return null; // corrupt/missing data -- leave the reserved box unmounted rather than guess
  }
}

/**
 * Picks the entry to show for `band` out of the baked `byBand` map
 * (src/buildStatic.js's buildHomeDemoDataAllBands()), falling back to the
 * data's own default band when `band` has no qualifying entry (a band
 * whose top White move isn't 1. e4 -- see buildHomeDemoData's own doc
 * comment for the data-drift guard this reflects), and finally to the flat
 * top-level fields for a build old enough not to carry `byBand` at all.
 * Never returns null when `data` itself passed readData()'s own check.
 */
function entryForBand(data, band) {
  var byBand = data.byBand || {};
  if (byBand[band]) return byBand[band];
  if (data.band && byBand[data.band]) return byBand[data.band];
  return { openingPlayedPct: data.openingPlayedPct, replies: data.replies };
}

function replyCaption(reply, band) {
  return reply.san + ' - played by ' + reply.playedPct + '% of Black at ' + band + ', scoring ' + reply.score + '% for Black.';
}

// Matches src/render.js's formatPct() exactly (n.toFixed(1)) -- duplicated
// as a plain one-liner rather than imported, same "kept in sync by eye"
// reasoning src/compareOpeningsShared.js's own header comment already
// states for this codebase's isomorphic-render modules; render.js itself
// isn't requireable here without pulling in its Node-only SITE_CSS/
// document-head machinery this tiny bundle has no business depending on.
function formatPct1(n) {
  return typeof n === 'number' ? n.toFixed(1) : String(n);
}

function introCaptionFor(entry, band) {
  return band + ' plays 1. e4 ' + formatPct1(entry.openingPlayedPct) + '% of the time. Your move.';
}

/**
 * Allowlist-only move-input mount (see this file's header comment for why
 * this exists instead of src/boardWidgetFree.js's mountFreeBoard). Accepts
 * exactly the UCI moves that are keys of `replies`; every other attempted
 * move is declined by cm-chessboard's own input handling (the piece
 * returns to its square, nothing commits).
 *
 * @param {HTMLElement} container
 * @param {{fen: string, orientation: string, replies: Object<string, object>, onMove: (uci: string) => void}} opts
 */
function mountAllowlistBoard(container, opts) {
  var board = createBoard(container, { position: opts.fen, orientation: opts.orientation, inputEnabled: true });
  var replies = opts.replies;

  function findUci(from, to) {
    var keys = Object.keys(replies);
    for (var i = 0; i < keys.length; i += 1) {
      var uci = keys[i];
      if (uci.slice(0, 2) === from && uci.slice(2, 4) === to) return uci;
    }
    return null;
  }

  board.enableMoveInput(function (event) {
    switch (event.type) {
      case INPUT_EVENT_TYPE.moveInputStarted: {
        var keys = Object.keys(replies);
        for (var i = 0; i < keys.length; i += 1) {
          if (keys[i].slice(0, 2) === event.squareFrom) return true;
        }
        return false;
      }
      case INPUT_EVENT_TYPE.validateMoveInput:
        return findUci(event.squareFrom, event.squareTo) !== null;
      case INPUT_EVENT_TYPE.moveInputFinished: {
        if (event.legalMove) {
          var uci = findUci(event.squareFrom, event.squareTo);
          if (uci && typeof opts.onMove === 'function') opts.onMove(uci);
        }
        return undefined;
      }
      default:
        return undefined;
    }
  });

  return {
    board: board,
    reset: function (fen) {
      board.setPosition(fen, false);
    },
  };
}

// Replaces `target`'s own keys/values with `source`'s in place (never
// reassigns the reference) -- mountAllowlistBoard()'s move-input handler
// closes over the SAME object passed as its `replies` option, and reads it
// fresh via Object.keys() on every event rather than caching a snapshot at
// mount time, so mutating its contents in place is what lets a band switch
// update which moves the board accepts without remounting the whole board.
function replaceContents(target, source) {
  var key;
  for (key in target) {
    if (Object.prototype.hasOwnProperty.call(target, key)) delete target[key];
  }
  for (key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
  }
}

// Toggles every homepage ranked-card's baked-per-band panel
// (src/renderContent.js's renderOpeningStatCard `bandAware` path) to show
// only the one matching `band`, hiding the rest via the plain `hidden`
// attribute -- no extra CSS needed. A no-op (empty NodeList) on any page
// without band-aware cards (every page but the homepage), so this is safe
// to call unconditionally from init() below rather than gating it on which
// page loaded this bundle.
function switchStatCardBands(band) {
  var panels = document.querySelectorAll('.card-band-panel[data-band-variant]');
  for (var i = 0; i < panels.length; i += 1) {
    var panel = panels[i];
    if (panel.getAttribute('data-band-variant') === band) {
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  }
}

function init() {
  // Band-aware ranked cards (craft-audit item 2) have no dependency on the
  // hero-demo board mount below -- wire them up unconditionally so they
  // still work on a build/page where the board itself didn't mount (no
  // heroDemo, no #home-demo-board) but the ranked cards did.
  switchStatCardBands(readBandState().band);
  onBandStateChange(function (state) {
    switchStatCardBands(state.band);
  });

  var mount = document.getElementById('home-demo-board');
  if (!mount) return; // no reserved box on this build/page -- nothing more to do

  var data = readData();
  if (!data) return; // no baked data -- leave the empty reserved box (no layout shift either way, it's aspect-ratio boxed)

  var captionEl = document.getElementById('home-demo-caption');
  var resetBtn = document.getElementById('home-demo-reset');
  var linkEl = document.getElementById('home-demo-repertoire-link');

  var currentBand = readBandState().band;
  var currentEntry = entryForBand(data, currentBand);
  // The band actually shown may differ from `currentBand` itself when the
  // visitor's persisted band has no qualifying 1. e4 entry (see
  // entryForBand's own comment) -- track it separately so captions/links
  // always name the band whose data is really on screen, never a band that
  // silently fell back to different numbers.
  var shownBand = (data.byBand && data.byBand[currentBand]) ? currentBand : (data.band || currentBand);

  // `replies` is a stable, mutable object handed to mountAllowlistBoard()
  // once below; every subsequent band switch mutates its CONTENTS (via
  // replaceContents), never reassigns this variable, so the board's own
  // move-input closure keeps seeing the current band's allowed moves.
  var replies = {};
  replaceContents(replies, currentEntry.replies);

  var initialCaption = introCaptionFor(currentEntry, shownBand);
  if (captionEl) captionEl.textContent = initialCaption;
  if (linkEl) {
    linkEl.setAttribute('href', 'repertoire.html#band=' + encodeURIComponent(shownBand) + '&color=black');
    linkEl.textContent = 'See the full ' + shownBand + ' repertoire →';
  }

  var handle = mountAllowlistBoard(mount, {
    fen: START_FEN,
    orientation: COLOR.black,
    replies: replies,
    onMove: function (uci) {
      if (!captionEl) return;
      var reply = replies[uci];
      if (reply) captionEl.textContent = replyCaption(reply, shownBand);
    },
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      handle.reset(START_FEN);
      if (captionEl) captionEl.textContent = initialCaption;
    });
  }

  onBandStateChange(function (state) {
    var entry = entryForBand(data, state.band);
    shownBand = (data.byBand && data.byBand[state.band]) ? state.band : (data.band || state.band);
    replaceContents(replies, entry.replies);
    initialCaption = introCaptionFor(entry, shownBand);
    handle.reset(START_FEN);
    if (captionEl) captionEl.textContent = initialCaption;
    if (linkEl) {
      linkEl.setAttribute('href', 'repertoire.html#band=' + encodeURIComponent(shownBand) + '&color=black');
      linkEl.textContent = 'See the full ' + shownBand + ' repertoire →';
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
