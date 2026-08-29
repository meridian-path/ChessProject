'use strict';

/**
 * Pure, isomorphic rendering logic for the Compare Openings tool (site-audit
 * item 11) -- no `fs`, no `require('./render')`'s heavy SITE_CSS-bearing
 * module, so this file bundles cleanly into a tiny browser entry the same
 * way src/buildPackCore.js was split out from buildPack.js for the exact
 * same reason (see src/browser/bandData.client.js's own header comment).
 * src/renderCompareOpenings.js (server, Node) and
 * src/browser/compareOpenings.client.js (browser, esbuild) both require()
 * this module so the initial server-rendered comparison and every
 * client-side re-render after a visitor picks a different opening or band
 * produce byte-identical markup -- one rendering rule, not two kept in sync
 * by hand.
 *
 * Every number this renders is already computed by buildOpeningModel()
 * (src/processOpenings.js) and baked into the page's own JSON payload at
 * build time -- this module only ever formats pre-computed numbers, it
 * never invents or recomputes a statistic.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Typographic-apostrophe normalization for opening DISPLAY NAMES rendered
// into visible prose only -- see src/render.js's own displayName() for the
// full rationale (this module stays isomorphic/dependency-free, so it keeps
// its own copy rather than requiring that heavier module).
function displayName(s) {
  return escapeHtml(s).replace(/(\w)&#39;/g, '$1&rsquo;');
}

function formatPct(n) {
  return typeof n === 'number' ? n.toFixed(1) : '-';
}

// Same threshold renderContent.js's own wideIntervalNote() uses (WS-3.3
// spec 3.2) -- duplicated as a plain constant rather than imported, since
// importing renderContent.js here would pull in board-diagram/JSON-LD code
// this isomorphic module has no business depending on.
//
// Site-audit fix (2026-08-29): 1.0pp fired on rows the site's own homepage
// presents with no caveat at all (e.g. n=7,493, +/-1.1pp) -- a half-width
// this small doesn't change the reading, so calling it "wide" was simply
// false, and firing on nearly every row trained readers to ignore the note
// entirely, burying the rows that actually deserve it (e.g. n=192,
// +/-7.0pp). 3.0pp is the real dividing line: at typical opening-page score
// rates (~45-55%), that's roughly where a band's row starts trading places
// with a neighboring band under repeated sampling -- i.e. where the caution
// is factually earned, not just present.
const WIDE_INTERVAL_THRESHOLD_PP = 3.0;

/**
 * @param {number|null} halfWidthPct
 * @param {string} label e.g. "Score for White"
 * @param {number} sampleSize
 * @returns {string} same visual shape as renderContent.js's renderCI() --
 *   a de-emphasized "±X.X" span plus a screen-reader-only sentence -- kept
 *   in sync by eye (both are simple enough that a mismatch would be obvious
 *   in review) rather than importing renderContent.js itself, which is
 *   server-only. Craft-audit fix (item 3): the visible `.ci` span is now
 *   `aria-hidden="true"`, matching renderContent.js's own renderCI() fix --
 *   without it, assistive tech announced both the terse "±X.X" figure and
 *   its own sr-only expansion back to back. Unlike renderContent.js's
 *   card-score line, nothing here continues the sentence after the sr-only
 *   span (the games count and any further note are already separate
 *   sentences/cells), so no sentence-restructuring is needed at this call
 *   site.
 */
function renderCI(halfWidthPct, scorePct, label, sampleSize) {
  if (halfWidthPct == null || scorePct == null) return '';
  const low = Number((scorePct - halfWidthPct).toFixed(1));
  const high = Number((scorePct + halfWidthPct).toFixed(1));
  const srText = `${escapeHtml(label)}: 95 percent confidence interval ${formatPct(low)} to ${formatPct(high)} percent, ${sampleSize.toLocaleString()} games.`;
  return `<span class="ci" aria-hidden="true"> &plusmn;${formatPct(halfWidthPct)}</span><span class="sr-only">${srText}</span>`;
}

function wideIntervalNote(halfWidthPct) {
  if (typeof halfWidthPct !== 'number' || halfWidthPct < WIDE_INTERVAL_THRESHOLD_PP) return '';
  return '<span class="wide-interval-note">Wide interval, small sample: treat this number cautiously.</span>';
}

/**
 * One opening's band-level stats, exactly as buildOpeningModel() computes
 * them (src/processOpenings.js's `bands` array entries) -- passed straight
 * through, not recomputed.
 * @typedef {{band:string, games:number, enoughData:boolean,
 *   scoreForSide:number|null, scoreForSideCI:number|null,
 *   scoreForSideBalanced:number|null, scoreForSideBalancedCI:number|null}} BandRow
 */

/**
 * @param {{slug:string, name:string, side:'white'|'black', bands:BandRow[]}} opening
 * @param {string} band
 * @returns {BandRow|null}
 */
function bandRowFor(opening, band) {
  return (opening.bands || []).find((b) => b.band === band) || null;
}

/**
 * Renders the two-opening, one-band comparison table -- the page's whole
 * reason to exist. Returns '' (never throws) if either opening is unknown,
 * so a caller (client-side, from user-controlled <select> values that can
 * only ever be one of the baked openings' own slugs, but still defensively
 * checked) always has a safe, renderable fallback.
 *
 * @param {{slug:string, name:string, side:string, bands:BandRow[]}} openingA
 * @param {{slug:string, name:string, side:string, bands:BandRow[]}} openingB
 * @param {string} band one of the site's 4 tracked rating bands
 * @returns {string}
 */
function renderComparisonTable(openingA, openingB, band) {
  if (!openingA || !openingB) return '';
  const rowA = bandRowFor(openingA, band);
  const rowB = bandRowFor(openingB, band);

  const scoreCell = (opening, row) => {
    if (!row || !row.enoughData || row.scoreForSide == null) return 'n/a';
    const balanced = row.scoreForSideBalanced != null
      ? ` <span class="rep-pct">(${formatPct(row.scoreForSideBalanced)}% balanced${renderCI(row.scoreForSideBalancedCI, row.scoreForSideBalanced, `Balanced score for ${opening.side}`, row.games)})</span>`
      : '';
    return `${formatPct(row.scoreForSide)}%${renderCI(row.scoreForSideCI, row.scoreForSide, `Score for ${opening.side}`, row.games)}${wideIntervalNote(row.scoreForSideCI)}${balanced}`;
  };

  const gamesCell = (row) => (row ? row.games.toLocaleString() : '0');
  const nameCell = (opening) => `<a href="${escapeHtml(opening.slug)}.html">${displayName(opening.name)}</a> <span class="rep-pct">(${opening.side === 'white' ? 'White' : 'Black'})</span>`;

  return `
    <p class="table-hint">Scroll to see more &rarr;</p>
    <section class="table-scroll" tabindex="0" aria-label="Opening comparison at ${escapeHtml(band)}">
      <table>
        <caption class="sr-only">${displayName(openingA.name)} versus ${displayName(openingB.name)} at ${escapeHtml(band)}</caption>
        <thead>
          <tr><th scope="col">Metric</th><th scope="col">${nameCell(openingA)}</th><th scope="col">${nameCell(openingB)}</th></tr>
        </thead>
        <tbody>
          <tr><td>Games at ${escapeHtml(band)}</td><td class="num">${gamesCell(rowA)}</td><td class="num">${gamesCell(rowB)}</td></tr>
          <tr><td>Score for its own side</td><td class="num">${scoreCell(openingA, rowA)}</td><td class="num">${scoreCell(openingB, rowB)}</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

module.exports = { escapeHtml, formatPct, renderCI, wideIntervalNote, bandRowFor, renderComparisonTable };
