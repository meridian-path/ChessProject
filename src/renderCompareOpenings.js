'use strict';

/**
 * The "Compare Openings" tool (site-audit item 11, 2026-08-25 pass): pick
 * any two tracked openings and a rating band, see games/score/confidence
 * interval side by side. Every number is already computed by
 * buildOpeningModel() (src/processOpenings.js) for the existing opening
 * pages and openings.html hub -- this page adds no new data pipeline, only
 * a focused, two-at-a-time view of data the site already has.
 *
 * Server-rendered with a real, meaningful default pair/band (progressive
 * enhancement, same convention as every other interactive tool on this
 * site -- the page is fully useful with JavaScript disabled or on a
 * file:// open, it just can't be re-picked). src/browser/
 * compareOpenings.client.js re-renders the same markup client-side via
 * src/compareOpeningsShared.js's renderComparisonTable() -- one rendering
 * rule shared by both, not two kept in sync by hand.
 *
 * Shares the site-wide rating-band control (src/browser/bandState.client.js,
 * the same one repertoire.html/drill.html/opening-report.html use) rather
 * than inventing its own band picker -- a visitor who already picked a band
 * elsewhere on the site sees this page open on that same band.
 *
 * Deliberately NOT added to the top nav (STATIC_NAV) by this task: the
 * site-audit's own item 1 (still unbuilt as of this pass) collapses the
 * current 9-item nav down to 5 grouped items, and adding a 10th top-level
 * link now just to move it again during that restructure is pure churn.
 * Reachable today via the "Go deeper" link this task adds to openings.html,
 * and by the sitemap (auto-discovered, src/sitemap.js walks every .html
 * file in the output dir). Item 1's own build should fold this page into
 * whichever group it lands in (most naturally "Explore", alongside
 * Explorer/Openings/ECO Index).
 */

const { escapeHtml, renderDocumentHead, renderHeader, renderFooter } = require('./render');
const { renderBreadcrumb } = require('./renderContent');
const { SITE_NAME, BUILD_DATE, absoluteUrl } = require('./site');
const { breadcrumbJsonLd } = require('./structuredData');
const { renderComparisonTable } = require('./compareOpeningsShared');

const CONTENT_LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html' };
const DEFAULT_BAND = '1600-1800';

/**
 * @param {Array<{openingConfig:object, model:object}>} entries this build's
 *   own already-fetched opening data (same `entries` every other content
 *   page in src/buildContent.js already receives).
 * @param {object} opts
 * @param {object} opts.nav
 */
function renderCompareOpeningsPage(entries, { nav }) {
  const title = `Compare Openings, Side by Side | ${SITE_NAME}`;
  const description = 'Pick any two tracked openings and a rating band to compare real win rate, sample size, and confidence interval side by side.';
  const canonical = absoluteUrl('compare-openings.html');
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'Compare openings', href: 'compare-openings.html' }];

  // The baked payload every re-render (server default below, and every
  // client-side pick after) draws from -- a plain array of
  // {slug, name, side, bands}, exactly renderComparisonTable()'s own input
  // shape, so the client bundle never needs a second data transform.
  const openings = entries.map(({ openingConfig, model }) => ({
    slug: openingConfig.slug,
    name: model.name,
    side: model.side,
    bands: model.bands,
  }));

  // Default pair: the first tracked White opening and the first tracked
  // Black opening (declaration order in src/openings.js) -- deterministic,
  // never the same opening against itself, and meaningful without
  // requiring a visitor to pick anything first.
  const defaultA = openings.find((o) => o.side === 'white') || openings[0];
  const defaultB = openings.find((o) => o.side === 'black' && o.slug !== defaultA.slug) || openings.find((o) => o.slug !== defaultA.slug) || openings[0];

  const optionsHtml = (selectedSlug) =>
    openings
      .map((o) => `<option value="${escapeHtml(o.slug)}"${o.slug === selectedSlug ? ' selected' : ''}>${escapeHtml(o.name)} (${o.side === 'white' ? 'White' : 'Black'})</option>`)
      .join('');

  const resultsHtml = renderComparisonTable(defaultA, defaultB, DEFAULT_BAND);

  const dataScriptHtml = `<script type="application/json" id="compare-openings-data">${JSON.stringify(openings)}</script>
  <script src="compare-openings.js" defer></script>`;

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd: breadcrumbJsonLd(breadcrumbItems) })}
<body>
<div class="page">
  ${renderHeader(nav, 'compare')}
  <main id="main-content">
    ${renderBreadcrumb(breadcrumbItems)}
    <h1 class="page-title">Compare two openings</h1>
    <p class="subtitle">Pick any two openings this site tracks to see their real games, score, and confidence interval side by side at your rating band. Change the rating band from the picker in the header above.</p>

    <div class="compare-picker" data-compare-app>
      <label class="compare-picker-field">
        <span>Opening A</span>
        <select id="compare-opening-a" data-compare-select-a>${optionsHtml(defaultA.slug)}</select>
      </label>
      <label class="compare-picker-field">
        <span>Opening B</span>
        <select id="compare-opening-b" data-compare-select-b>${optionsHtml(defaultB.slug)}</select>
      </label>
    </div>

    <div id="compare-results" data-compare-results>${resultsHtml}</div>

    <h2>How to read this</h2>
    <p>&ldquo;Score for its own side&rdquo; uses standard chess scoring (a win counts 1, a draw counts 0.5) as a percentage, computed from real Lichess games at the selected rating band. The &plusmn; figure is a 95% confidence interval - a wide one next to a small games count means treat the number cautiously, not as a precise measurement. &ldquo;Balanced&rdquo; (shown when available) restricts to games between similarly-rated opponents (rating gap &le;50), removing the biggest confound in a raw comparison like this: players who choose one opening are not the same players who choose another.</p>

    <h2>Go deeper</h2>
    <p>See any opening&rsquo;s own page for its full band-by-band breakdown and recent games, or the <a href="openings.html">full openings comparison &rarr;</a> to see every tracked opening ranked at once.</p>
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer</a>, retrieved ${BUILD_DATE}.`, CONTENT_LEGAL_LINKS)}
</div>
${dataScriptHtml}
</body>
</html>
`;
}

module.exports = { renderCompareOpeningsPage };
