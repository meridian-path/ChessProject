'use strict';

/**
 * Page controller for dist/compare-openings.html (site-audit item 11).
 * esbuild entry point (src/buildStatic.js's buildCompareOpeningsBundle()),
 * same bundleBrowserEntry()-into-IIFE strategy as every other browser
 * bundle on this site.
 *
 * Deliberately tiny: no chess.js, no cm-chessboard -- this tool only ever
 * picks from a fixed, baked list of openings and formats already-computed
 * numbers, so it needs none of the chess-logic dependencies the board-based
 * tools (ECO explorer, repertoire builder, drill) require.
 *
 * Reads the site-wide rating-band state via bandState.client.js (the same
 * module the header's own band control and repertoire.client.js use) so
 * this page always reflects whichever band a visitor already picked
 * elsewhere, and reacts live if they change it from this page's own header
 * control without a reload.
 *
 * Craft-audit fix (item 1): every early-exit path below used to be a bare
 * `return` with no user-visible state at all -- if the embedded data blob
 * were ever malformed, or this script loaded against changed markup, the
 * two <select> elements rendered and sat completely inert: no error, no
 * message, nothing happened on change. Every path now renders a real,
 * human-readable failure state into the results container (when that
 * container itself is reachable) and disables whichever selects exist,
 * rather than leaving a visitor staring at a dead control with zero
 * feedback -- the same "edge states designed, not defaulted" bar
 * opening-report.js and drill.html already meet.
 */

const { readBandState, onBandStateChange } = require('./bandState.client');
const { renderComparisonTable } = require('../compareOpeningsShared');

(function () {
  const app = document.querySelector('[data-compare-app]');
  const resultsEl = document.getElementById('compare-results');
  const dataEl = document.getElementById('compare-openings-data');
  const selectA = document.getElementById('compare-opening-a');
  const selectB = document.getElementById('compare-opening-b');

  function showError(message) {
    if (selectA) selectA.disabled = true;
    if (selectB) selectB.disabled = true;
    if (resultsEl) {
      resultsEl.innerHTML = `<p class="compare-error" role="alert">${message}</p>`;
    }
  }

  if (!app || !resultsEl || !dataEl) {
    showError('This tool could not load. Try refreshing the page.');
    return; // no compare markup present (or the results container itself is missing) -- nothing further to wire up
  }

  let openings;
  try {
    openings = JSON.parse(dataEl.textContent);
    if (!Array.isArray(openings)) throw new Error('compare-openings-data is not an array');
  } catch (err) {
    showError('This tool could not load its opening data. Try refreshing the page.');
    return; // corrupt baked data -- error shown, selects disabled, rather than leaving the server-rendered default table silently stale
  }

  const bySlug = {};
  for (const o of openings) bySlug[o.slug] = o;

  if (!selectA || !selectB) {
    showError('This tool could not load. Try refreshing the page.');
    return;
  }

  // The 4 real bands this page's baked data actually has -- matches
  // src/render.js's HEADER_BAND_OPTIONS. A band outside this set (this
  // page's data has none) is defensively treated as "no data for this
  // band" by renderComparisonTable() itself (bandRowFor returns null),
  // never a crash.
  function currentBand() {
    return readBandState().band;
  }

  function rerender() {
    const openingA = bySlug[selectA.value];
    const openingB = bySlug[selectB.value];
    if (!openingA || !openingB) return; // defensive -- every <option> value is server-rendered from this same openings list
    resultsEl.innerHTML = renderComparisonTable(openingA, openingB, currentBand());
  }

  selectA.addEventListener('change', rerender);
  selectB.addEventListener('change', rerender);
  onBandStateChange(rerender);

  // Re-render once on load too: the shared header band control's own
  // server-rendered default (HEADER_BAND_DEFAULT) might not match whatever
  // band this visitor actually has stored (URL fragment/localStorage), the
  // same "hydrate to the real client state" step
  // bandHeaderControl.client.js's own init() does for its own <select>.
  rerender();
})();
