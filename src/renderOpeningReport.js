'use strict';

/**
 * /opening-report.html -- the Personal Opening Report (WS-1 spec section
 * 3.2). Server-only (may require() render.js/site.js/structuredData.js/
 * boardSvg.js freely -- never bundled into the browser; see
 * src/renderContent.js's own header comment for why that split matters).
 * The interactive half is src/browser/openingReport.client.js, esbuild-
 * bundled by src/buildStatic.js's buildOpeningReportBundle() (unchanged
 * call site -- see that function's own comment).
 *
 * This page fetches nothing itself and computes nothing itself: every byte
 * of the report is built client-side, after a visitor supplies a username,
 * from a request their OWN browser makes directly to lichess.org (spec
 * 3.2.1's "the site never sees a byte of it"). What this file server-
 * renders is the durable page shell: the form, the seven designed empty/
 * failure states (spec 3.2.4) as real, populated (not blank) markup so a
 * crawler and a no-JS visitor both see genuine content, the data-handling
 * statement (WS-3.4), and the mount points
 * src/browser/openingReport.client.js fills in. /player.html (the previous
 * rating-history/recent-games lookup) becomes a redirect stub to this page
 * (src/buildStatic.js) -- that functionality is not deleted, it survives as
 * this page's Screen 3 (spec 3.2.4).
 */

const {
  escapeHtml, formatPct, renderDocumentHead, renderHeader, renderFooter, renderPageHead, renderBreadcrumb,
} = require('./render');
const { SITE_NAME, absoluteUrl, pageTitle } = require('./site');
const { breadcrumbJsonLd } = require('./structuredData');
const { spriteDefsHtml, pieceAttributionHtml } = require('./boardSvg');

const OPENING_REPORT_FILE = 'opening-report.html';
const OPENING_REPORT_LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html', faq: 'chess-opening-faq.html' };

const IS_PLACEHOLDER = false;

/**
 * Page-scoped CSS for the report's own layout, emitted via
 * renderDocumentHead's `extraCss` (same pattern as src/renderDrill.js's
 * DRILL_CSS / src/renderEcoExplorerPage.js's explorer classes -- every
 * other page's `<head>` stays byte-for-byte unchanged). Built ENTIRELY from
 * existing DESIGN_TOKENS/THEME_ROLES values (design-standards.md: "NO NEW
 * TOKENS unless a genuinely new ROLE appears" -- nothing here is a new
 * token, only new component classes assembled from ones that already
 * exist). No new radius, no new elevation, no second accent -- leak
 * severity is carried by rank order and the printed number (spec 3.5),
 * never by a colour ramp.
 */
const OPENING_REPORT_CSS = `
  /* A strong result card, not a mega-display headline (site-audit item:
     this used to share --type-display -- the exact same size as h1.page-
     title -- so a long verdict sentence visibly out-ranked the page's own
     title, failing both design-standards.md's h1-dominance rule and the
     squint test). --type-section-lead is one step down from page-title,
     still bold serif and genuinely emphasized, plus a surface/padding
     treatment (same recipe .fetch-progress below already uses) so it reads
     as a bordered result card rather than a bare oversized paragraph. */
  .report-verdict {
    font: var(--type-section-lead);
    letter-spacing: var(--type-section-lead-tracking);
    background: var(--color-surface-alt);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
    margin: 0 0 var(--space-3);
  }
  .report-band-warning {
    font: var(--type-body);
    letter-spacing: var(--type-body-tracking);
    background: var(--color-surface-alt);
    border: var(--border-hairline) solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    margin: 0 0 var(--space-3);
  }
  .report-provenance {
    font: var(--type-metadata);
    letter-spacing: var(--type-metadata-tracking);
    color: var(--color-muted);
    margin: 0 0 var(--space-6);
  }

  .fetch-progress {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: var(--color-surface-alt);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
    margin: var(--space-3) 0 var(--space-6);
  }
  .fetch-progress progress { flex: 1 1 auto; accent-color: var(--color-accent); height: 10px; }
  .fetch-progress-count { font: var(--type-metadata); letter-spacing: var(--type-metadata-tracking); white-space: nowrap; }
  .fetch-cancel {
    border: var(--border-hairline) solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-4);
    min-height: 44px;
    min-width: 44px;
    cursor: pointer;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .fetch-cancel:hover { background: var(--color-surface-alt); }

  .leak-list { list-style: none; margin: 0 0 var(--space-6); padding: 0; }
  .leak-row {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border: var(--border-hairline) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    margin-bottom: var(--space-3);
  }
  .leak-rank {
    font: var(--type-section);
    letter-spacing: var(--type-section-tracking);
    color: var(--color-muted);
    min-width: 1.5em;
  }
  .leak-cost { font: var(--type-subsection); letter-spacing: var(--type-subsection-tracking); text-align: right; white-space: nowrap; }
  .leak-cost-label { display: block; font: var(--type-metadata); letter-spacing: var(--type-metadata-tracking); color: var(--color-muted); font-weight: var(--weight-regular); }
  .leak-moves { font: var(--type-body); letter-spacing: var(--type-body-tracking); }
  .leak-actions { display: flex; flex-direction: column; gap: var(--space-2); }
  .leak-actions a {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    border: var(--border-hairline) solid var(--color-border);
    text-decoration: none;
    white-space: nowrap;
  }
  .leak-detail {
    grid-column: 1 / -1;
    border-top: var(--border-hairline) solid var(--color-border);
    margin-top: var(--space-4);
    padding-top: var(--space-4);
  }
  .leak-detail[hidden] { display: none; }
  .leak-toggle {
    grid-column: 1 / -1;
    justify-self: start;
    background: none;
    border: none;
    color: var(--color-accent-dark);
    text-decoration: underline;
    cursor: pointer;
    padding: var(--space-2) 0;
    font: var(--type-compact);
    letter-spacing: var(--type-compact-tracking);
  }

  .thumb-board {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    grid-template-rows: repeat(8, 1fr);
    width: 88px;
    height: 88px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: var(--border-hairline) solid var(--color-border);
  }
  .thumb-sq { position: relative; }
  .thumb-sq--light { background: var(--color-board-light); }
  .thumb-sq--dark { background: var(--color-board-dark); }
  .thumb-piece { width: 100%; height: 100%; display: block; }

  .watch-list { padding: 0; list-style: none; }
  .watch-list li {
    padding: var(--space-3) 0;
    border-bottom: var(--border-hairline) solid var(--color-border);
    font: var(--type-compact);
    letter-spacing: var(--type-compact-tracking);
  }
  .watch-list li:last-child { border-bottom: none; }

  .data-handling {
    background: var(--color-surface-alt);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
    margin: var(--space-6) 0;
    font: var(--type-compact);
    letter-spacing: var(--type-compact-tracking);
  }

  @media (max-width: 767px) {
    .leak-row { grid-template-columns: auto 1fr; }
    .leak-cost { grid-column: 2; justify-self: start; text-align: left; }
    .leak-actions { grid-column: 1 / -1; flex-direction: row; }
  }

  /* The platform and username fields each
     wrap a span label plus their own control in one label.report-field, so
     the pair can never separate across a flex-wrap line break the way two
     bare sibling labels did in an earlier version of this markup (a real
     regression caught in visual QA, not a hypothetical). Deliberately its
     OWN small component rather than reusing .compare-picker-field
     (src/renderCompareOpenings.js, same label-wraps-span-plus-select
     shape) -- that class sizes itself via flex-basis, which follows the
     FLEX CONTAINER's main axis: correct as a width in its own row-
     direction home, but render.js's own .lookup-form mobile breakpoint
     (max-width:767px) flips .lookup-form to flex-direction:column, and at
     that point ANY flex-basis on a direct child -- .report-field here,
     exactly as .compare-picker-field did when tried in this same spot --
     is reinterpreted as a HEIGHT instead, producing a tall empty block
     (caught in visual QA at 360px, not hypothetical either). Sizing via a
     real width property instead of flex-basis sidesteps this entirely:
     width always means physical width regardless of flex-direction, so no
     dedicated mobile override is needed here -- render.js's own existing
     .lookup-form label width:100% mobile rule already overrides this
     file's own width:220px on its own (higher specificity: one class plus
     one type beats one class alone), giving the intended fixed-width-on-
     desktop, full-width-on-mobile behavior for free. The nested select and
     input still need their OWN flex:none -- render.js's .lookup-form
     input/select flex:1 1 240px rule still reaches them by plain
     descendant match regardless of which wrapper class contains them, and
     would hit the exact same axis-reinterpretation bug one level deeper
     without this; an explicit width:100% replaces the sizing the flex-
     basis used to provide, filling the wrapper explicitly instead. */
  .report-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-muted);
    flex: 0 1 auto;
    width: 220px;
    max-width: 100%;
  }
  #report-platform, #report-username { flex: none; width: 100%; }
`;

/**
 * @param {{nav: object, legalLinks?: object}} opts
 * @returns {string} a full, standalone HTML document.
 */
function renderOpeningReportPage({ nav, legalLinks = OPENING_REPORT_LEGAL_LINKS }) {
  const title = pageTitle('Your opening leak report');
  const description = 'Enter your Lichess or Chess.com username to see the five biggest gaps between what you play and what wins more at your rating band, ranked by cost per 100 games.';
  const canonical = absoluteUrl(OPENING_REPORT_FILE);

  const breadcrumbItems = [
    { label: 'Home', href: nav.home || nav.builder },
    { label: 'Opening report', href: OPENING_REPORT_FILE },
  ];
  const jsonLd = breadcrumbJsonLd(breadcrumbItems);

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd, extraCss: OPENING_REPORT_CSS })}
<body>
<div class="page">
  ${renderHeader(nav, 'player')}
  <main class="prose" id="main-content">
    ${renderPageHead({
      breadcrumb: renderBreadcrumb(breadcrumbItems),
      title: 'Find your five biggest opening leaks',
      subtitle: 'Enter a Lichess or Chess.com username. We compare what you actually play against what your rating band actually plays, and rank the gaps by how many points per 100 games each one costs.',
    })}

    <form class="lookup-form" id="report-form">
      <label class="report-field">
        <span>Platform</span>
        <select id="report-platform" name="platform">
          <option value="lichess" selected>Lichess</option>
          <option value="chesscom">Chess.com</option>
        </select>
      </label>
      <label class="report-field">
        <span>Username</span>
        <input type="text" id="report-username" name="username" placeholder="e.g. DrNykterstein" autocomplete="off" maxlength="30" required>
      </label>
      <button type="submit">Get my report</button>
    </form>

    <noscript>
      <p class="status-message status-message--error">This report needs JavaScript: it fetches your games directly from
        Lichess in your own browser and does the analysis there, so nothing about it can run without it. Nothing you
        play is ever sent to ${escapeHtml(SITE_NAME)}&rsquo;s servers, because this site has none.</p>
    </noscript>

    <div id="report-status" role="status" aria-live="polite"></div>
    <div id="report-result"></div>

    ${spriteDefsHtml()}

    <section class="data-handling">
      <h2>How this works</h2>
      <p>Your games are fetched by your own browser, directly from Lichess&rsquo;s or Chess.com&rsquo;s public API (whichever
        platform you pick above). Nothing is ever sent to ${escapeHtml(SITE_NAME)}&rsquo;s servers, because this site has no
        servers that could receive it. Your report is stored only in your browser&rsquo;s local storage, and only if you
        choose to save it. A "leak" here means: at a position you&rsquo;ve reached at least three times, the move you
        usually play scores measurably worse, across hundreds of thousands of games at your rating band, than the
        move your band&rsquo;s own data recommends. Your own games only tell us how often you reach a position and which
        move you pick. The band data, not your own small sample, tells us what that move actually scores. Example: a
        player who reaches the position after 1.e4 e5 2.Nf3 Nc6 and answers 3.Bc4 twenty-five times might be shown
        that 3.Bb5 scores several points per 100 games better among their rating band, worth roughly a full point of
        rating over a season of play at that frequency.</p>
      <p>We fetch up to 300 of your most recent rated blitz and rapid games and look only at the first 24 half-moves
        of each, since we&rsquo;re identifying openings, not analysing whole games. On Lichess that&rsquo;s one streamed request
        (about 15 seconds, per Lichess&rsquo;s own published rate limit for this endpoint); on Chess.com, which publishes
        games in monthly archives rather than one combined feed, we walk backward from your most recent month, one
        request per month, stopping once we reach 300 games or 12 months back, whichever comes first. Coverage is
        bounded: our band dataset only reaches as deep as real games commonly go before branching out, so some of
        your games will have no comparison available. That&rsquo;s shown honestly, not hidden.</p>
      <p class="report-provenance">Rating history and recent games (below your report) are Lichess-only for now.</p>
    </section>
  </main>
  ${renderFooter(`Data source: <a href="https://lichess.org/api" rel="noopener noreferrer">lichess.org/api</a>, called directly from your browser. ${escapeHtml(SITE_NAME)} never sees your games. ${pieceAttributionHtml()}`, legalLinks)}
</div>
<script src="opening-report.js" defer></script>
</body>
</html>
`;
}

module.exports = { OPENING_REPORT_FILE, renderOpeningReportPage, IS_PLACEHOLDER };
