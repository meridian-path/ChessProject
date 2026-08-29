'use strict';

/**
 * T3: the interactive ECO explorer (Phase 7e) -- one page covering the
 * whole 3,810-line CC0 dataset, searchable by name/ECO/move sequence,
 * playable on the real board from src/boardWidget.js, with FEN-to-opening
 * identification backed by hayatbiralem/eco.json's reverse-lookup data.
 * Server-only (may require() render.js/site.js/structuredData.js freely --
 * never bundled into the browser; see src/renderContent.js's own header
 * comment for why that split matters). The interactive half is
 * src/browser/ecoExplorer.client.js, esbuild-bundled by
 * src/buildEcoExplorer.js exactly like the drill/player-lookup bundles.
 *
 * Two payload strategy (see src/ecoExplorerData.js's own header comment for
 * the full reasoning): the ~53 KB-gzip search index (craft-audit item 5,
 * 2026-08-28) and the ~170 KB-gzip FEN reverse-lookup table are BOTH
 * external static assets now, fetched by the client -- eagerly for search
 * (this page's primary feature), lazily for reverse-lookup (only once a
 * visitor actually pastes a FEN/PGN or plays a free move). Two scoped,
 * declared exceptions to this project's file:// invariant (see this
 * project's TESTING.md), not one.
 *
 * No-JS fallback: this page server-renders real prose, a real <h1>, and a
 * genuine list of the top T1 families by line count as plain <a> links
 * (crawlable, works with JavaScript disabled) -- the full 3,810-line list
 * itself does not need to be duplicated here as static HTML, since every
 * one of those lines is already server-rendered somewhere crawlable: 94.7%
 * of them inside a T1 family hub's variation tree (src/renderEcoPages.js's
 * renderVariationTree, which -- verified in test/buildEcoPages.test.js --
 * loses zero rows), the rest inside the T2 browse index. Design-standards
 * section 6's "T3's full row list must exist either in the initial HTML or
 * in a crawlable T2 index" is satisfied by that OR, not by this page
 * duplicating ~400 KB of markup nobody would read.
 */

const { escapeHtml, displayName, renderDocumentHead, renderHeader, renderFooter, renderPageHead } = require('./render');
const { SITE_NAME, absoluteUrl, pageTitle } = require('./site');
const { breadcrumbJsonLd } = require('./structuredData');
const { spriteDefsHtml, pieceAttributionHtml } = require('./boardSvg');
const { renderBreadcrumb } = require('./renderContent');
const { ECO_INDEX_FILE } = require('./renderEcoPages');
const { familyHubFilename } = require('./ecoFamilies');

const ECO_EXPLORER_FILE = 'eco-explorer.html';
const ECO_EXPLORER_LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html', faq: 'chess-opening-faq.html' };

// Distinct from T2 page 1's own <title> ("Chess Opening Explorer - All 500
// ECO Codes | Repertoire Builder", src/renderEcoPages.js's
// renderEcoIndexPage) -- assertPageMetadata (src/buildContent.js) rejects a
// duplicate <title> within the same build step, and while today's checks
// happen to run per-caller (T1/T2 vs. this page are separate `written`
// arrays, never merged), a real duplicate title across the site is a
// genuine SEO defect regardless of what any one check happens to catch --
// not something to knowingly reintroduce just because the tooling wouldn't
// flag it yet.
const EXPLORER_TITLE_BASE = 'Interactive ECO Opening Explorer';

/**
 * `<script type="application/json" id="...">` block, `<` escaped to
 * `<` so a literal `</script` sequence inside any baked string (an
 * opening name, in practice never contains one, but this is a general-
 * purpose safety rule, not a data-specific assumption) can never break out
 * of the script tag -- same escaping src/structuredData.js's jsonLdScript
 * already applies to JSON-LD blocks.
 */
function jsonDataScript(id, data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${escapeHtml(id)}">${json}</script>`;
}

/**
 * @param {object} opts
 * @param {object} opts.nav
 * @param {Record<string,string>} opts.t0CrossLinkMap buildT0CrossLinkMap() output (baked inline -- small, ~64 entries)
 * @param {string} opts.lineIndexUrl same-origin path the client fetch()es eagerly (see this file's header comment)
 * @param {string} opts.reverseLookupUrl same-origin path the client fetch()es lazily (see this file's header comment)
 * @param {Array<{family:string, slug:string, lineCount:number, ecoCodes:string[]}>} opts.topFamilies
 *   top T1 families by line count, for the no-JS-visible server-rendered list (top ~12)
 * @param {{totalLines:number, totalFamilies:number}} opts.stats
 */
function renderEcoExplorerPage({ nav, t0CrossLinkMap, lineIndexUrl, reverseLookupUrl, topFamilies, stats }) {
  const title = pageTitle(EXPLORER_TITLE_BASE);
  let description = `Search all ${stats.totalLines.toLocaleString()} named chess openings by name, ECO code, or move sequence. Play any line on a real board, or paste a FEN or PGN to identify a position.`;
  if (description.length > 160) {
    description = `Search all ${stats.totalLines.toLocaleString()} named chess openings by name, ECO code, or move. Play any line, or paste a FEN/PGN to identify a position.`;
  }
  const canonical = absoluteUrl(ECO_EXPLORER_FILE);
  const breadcrumbItems = [
    { label: 'Home', href: nav.home },
    { label: 'Chess Opening Encyclopedia', href: ECO_INDEX_FILE },
    { label: 'Explorer', href: ECO_EXPLORER_FILE },
  ];

  // No DefinedTermSet block on this page (craft-audit item 5, second half):
  // this page used to re-emit all 500 ECO codes as one 90,687-byte
  // DefinedTermSet JSON-LD block, but that is pure duplication -- the same
  // 500 codes are already emitted, split across the 5 T2 volume index pages
  // (src/renderEcoPages.js's own definedTermSetJsonLd call, ~100 terms per
  // volume), each pointing at the same T1 family-hub URLs this block would
  // have. DefinedTermSet is also not a supported Google rich-result type
  // (see structuredData.js's own definedTermSetJsonLd docblock) -- so this
  // page was paying 90 KB per load for a repeat of data already crawlable
  // elsewhere and no SERP feature either copy could ever win. Dropped
  // outright rather than trimmed to a subset: a partial repeat of the same
  // 5 pages' data would be no more useful than the full repeat was.
  const jsonLd = breadcrumbJsonLd(breadcrumbItems);

  const topFamiliesHtml = topFamilies
    .map((f) => `<li><a href="${escapeHtml(familyHubFilename(f.slug))}">${displayName(f.family)}</a>
      <span class="explorer-family-meta">${f.lineCount} lines, ECO ${escapeHtml(f.ecoCodes[0])}${f.ecoCodes.length > 1 ? `–${escapeHtml(f.ecoCodes[f.ecoCodes.length - 1])}` : ''}</span></li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd })}
<body>
<div class="page page--wide">
  ${renderHeader(nav, 'eco')}
  <main id="main-content">
    ${renderPageHead({
      breadcrumb: renderBreadcrumb(breadcrumbItems),
      title: 'ECO opening explorer',
      subtitle: `Search all ${stats.totalLines.toLocaleString()} named lines across ${stats.totalFamilies} families and every ECO code, A&ndash;E. Play any
        line on the board, or paste a FEN or PGN below to identify a position. Source: the
        CC0-licensed <a href="https://github.com/lichess-org/chess-openings" rel="noopener noreferrer">lichess.org opening database</a>.`,
    })}

    <noscript>
      <p class="explorer-noscript">This tool needs JavaScript to search and play. Browse the
        <a href="${ECO_INDEX_FILE}">full Chess Opening Encyclopedia</a> or jump straight to a family guide below --
        every line is also listed there as plain text.</p>
    </noscript>

    <div class="explorer-layout" data-explorer-app>
      <div class="explorer-board-panel">
        <!-- sr-only h2 (accessibility fix, same pattern src/buildStatic.js's
             homeDemoMarkup() and src/renderRepertoireExplorer.js's own board
             panel already use): this figure was the page's only section
             between the page's h1 and the first visible h2 ("Or browse by
             family"), and cm-chessboard's Accessibility extension injects
             its own h3 heading ("Move piece") client-side inside
             #explorer-board-mount once the widget mounts -- with no h2
             ancestor yet, that skipped a level (h1 straight to h3). Reusing
             the figure's own aria-label text as a visually-hidden real
             heading fixes the sequence for real (h1, h2, h3 in order)
             without changing anything visible. Note for future editors: no
             literal angle-bracket tag mentions in this comment, on purpose
             -- test/buildEcoExplorer.test.js's "one H1" check greps the
             raw rendered HTML with a naive regex that can't tell a comment
             from real markup, so writing out the actual h1 tag with its
             brackets here would itself count as a second one. -->
        <figure class="board-figure" aria-label="Explorer board">
          ${spriteDefsHtml()}
          <h2 class="sr-only">Explorer board</h2>
          <div id="explorer-board-mount" class="explorer-board-mount"></div>
        </figure>
        <p id="explorer-current-line" class="explorer-current-line" role="status" aria-live="polite"></p>
        <p id="explorer-identify-status" class="explorer-identify-status" role="status" aria-live="polite"></p>

        <details class="explorer-paste">
          <summary>Identify a position from a FEN or PGN</summary>
          <div class="explorer-paste-inputs">
            <label for="explorer-fen-input">FEN</label>
            <div class="explorer-paste-row">
              <input type="text" id="explorer-fen-input" placeholder="e.g. rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2" autocomplete="off">
              <button type="button" id="explorer-fen-submit">Identify position</button>
            </div>
            <label for="explorer-pgn-input">PGN</label>
            <textarea id="explorer-pgn-input" rows="5" placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5 ..."></textarea>
            <button type="button" id="explorer-pgn-submit">Identify game</button>
          </div>
          <p id="explorer-paste-error" class="explorer-error" role="alert"></p>
        </details>
      </div>

      <div class="explorer-search-panel">
        <form class="lookup-form" id="explorer-search-form" role="search" onsubmit="return false">
          <label for="explorer-search-input">Search by name, ECO code, or move</label>
          <input type="text" id="explorer-search-input" placeholder="e.g. Najdorf, B90, or e4 c5" autocomplete="off">
          <!-- Results filter live on every keystroke (src/browser/ecoExplorer.client.js);
               this form is never actually submitted (onsubmit="return false" above). A
               real, focusable submit control is still required (WCAG 2.1 H32 / html-validate's
               wcag/h32) for anyone relying on Enter-to-submit or a screen reader's form
               navigation -- visually hidden, not removed, since the live filtering already
               covers sighted mouse/keyboard use. -->
          <button type="submit" class="sr-only">Search</button>
        </form>
        <p id="explorer-result-count" class="explorer-result-count" role="status" aria-live="polite"></p>
        <section id="explorer-results" class="table-scroll" tabindex="0" aria-label="Search results"></section>
      </div>
    </div>

    <h2>Or browse by family</h2>
    <ul class="explorer-top-families">${topFamiliesHtml}</ul>
    <p><a href="${ECO_INDEX_FILE}">All ${stats.totalFamilies} families and ECO volumes &rarr;</a></p>

    ${jsonDataScript('explorer-t0-map', t0CrossLinkMap)}
    ${jsonDataScript('explorer-config', { lineIndexUrl, reverseLookupUrl })}
  </main>
  ${renderFooter(`Aggregate position data from <a href="https://github.com/hayatbiralem/eco.json" rel="noopener noreferrer">hayatbiralem/eco.json</a> (MIT) and the CC0-licensed <a href="https://github.com/lichess-org/chess-openings" rel="noopener noreferrer">lichess.org opening database</a>. ${pieceAttributionHtml()}`, ECO_EXPLORER_LEGAL_LINKS)}
  <script src="eco-explorer.js" defer></script>
</div>
</body>
</html>
`;
}

module.exports = {
  ECO_EXPLORER_FILE,
  EXPLORER_TITLE_BASE,
  jsonDataScript,
  renderEcoExplorerPage,
};
