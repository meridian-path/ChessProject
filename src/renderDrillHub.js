'use strict';

/**
 * /drill.html (the hub + session, one page) and /drill-reference.html (the
 * full-line reference the SPOILER RULE requires living on its own page --
 * WS-1 spec section 3.3). W0 shipped these as placeholders (this file's
 * previous revision); this is the real Drill Engine v2 implementation.
 *
 * WHY ONE PAGE FOR HUB + SESSION rather than two: the session is entirely
 * personal, localStorage-driven state (due cards, in-progress grading) --
 * there is nothing to route to or deep-link, and splitting it into a
 * second page would mean re-fetching/re-rendering the same nav/head/footer
 * for no benefit. The hub section and the session section are both
 * server-rendered (real, readable, no-JS content in both -- see each
 * section's own comment below); src/browser/drill.client.js toggles which
 * one is visible and populates the session with the real current card.
 *
 * `renderDrillHubPage`/`renderDrillReferencePage` are called from
 * src/buildStatic.js with ONLY `{nav, legalLinks}` (that call site is a
 * FROZEN, shared-file signature per WS-1 spec section 6.2's mitigation --
 * this task does not touch buildStatic.js). The reference page's content
 * is therefore computed INSIDE renderDrillReferencePage itself, via
 * src/buildDrill.js's buildDrillReferenceData() (a build-time read of the
 * committed data/rep/ shards), not passed in as a parameter.
 */

const { escapeHtml, displayName, formatPct, renderDocumentHead, renderHeader, renderFooter, renderPageHead } = require('./render');
const { renderBreadcrumb } = require('./renderContent');
const { DRILL_CSS, CANDIDATE_TABLE_PLACEHOLDER } = require('./renderDrill');
const { START_BOARD } = require('./chessPosition');
const { renderBoardDiagram, spriteDefsHtml } = require('./boardSvg');
const { absoluteUrl, pageTitle } = require('./site');
const { breadcrumbJsonLd, jsonLdScript } = require('./structuredData');
const { OPENINGS } = require('./openings');
const { buildDrillReferenceData, readManifest } = require('./buildDrill');

const IS_PLACEHOLDER = false;

/**
 * @param {{nav: object, legalLinks: object}} opts
 * @returns {string} a full, standalone HTML document.
 */
function renderDrillHubPage({ nav, legalLinks }) {
  const title = pageTitle('Opening drill');
  const description = 'Train the openings your rating band actually plays, spaced-repetition style. Seed a deck from your opening report, a repertoire, or any tracked opening - free, no account, no signup.';
  const canonical = absoluteUrl('drill.html');
  const breadcrumbItems = [
    { label: 'Home', href: nav.home },
    { label: 'Opening drill' },
  ];
  const softwareAppJsonLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Opening Drill',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any (web browser)',
    url: canonical,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  });
  const jsonLd = [breadcrumbJsonLd(breadcrumbItems), softwareAppJsonLd].join('\n  ');

  const openingOptions = OPENINGS
    .map((o) => `<option value="${escapeHtml(o.slug)}">${displayName(o.name)} (${o.side})</option>`)
    .join('');

  // The session board starts painted at the ordinary starting position --
  // never a specific card's position, so there is nothing card-specific
  // (and therefore nothing spoiler-relevant) in this server-rendered
  // markup. Real Cburnett SVG piece artwork (src/boardSvg.js), same
  // component already used for every other board on this site -- this
  // stays a genuinely readable
  // no-JS diagram (matching this page's own "server-rendered, real,
  // readable, no-JS content" header comment above), never an empty mount
  // div: src/browser/drill.client.js clears this container's markup itself,
  // only once a session actually starts and mounts the real interactive
  // cm-chessboard component in its place (see that file's
  // ensureBoardMounted()).
  const startingBoardHtml = renderBoardDiagram(START_BOARD, { flip: false, label: 'Starting position' });

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, ogType: 'website', jsonLd, extraCss: DRILL_CSS })}
<body>
<div class="page page--wide">
  ${renderHeader(nav, 'drill')}
  ${spriteDefsHtml()}
  <main id="main-content">
    ${renderPageHead({
      breadcrumb: renderBreadcrumb(breadcrumbItems),
      eyebrow: 'Drill',
      title: 'Opening drill',
      subtitle: 'Play the move your rating band actually plays. Seed a deck from your opening report, a saved repertoire, or any opening below, then drill it with spaced repetition so due cards come back when you actually need them.',
    })}

    <noscript>
      <p class="empty-note">This drill needs JavaScript: your deck is saved only in your own browser, so there is nothing to fetch or personalize without it. Every opening&rsquo;s full lines are still readable, no script required, at <a href="drill-reference.html">the drill reference page</a>.</p>
    </noscript>

    <section id="drill-hub" aria-labelledby="drill-hub-heading">
      <h2 id="drill-hub-heading" class="sr-only">Your deck</h2>

      <div class="drill-verdict" id="drill-verdict">
        <p class="drill-verdict-count"><span class="n" id="drill-due-count">0</span> cards due</p>
        <p class="drill-verdict-note" id="drill-fresh-note" hidden></p>
        <button type="button" class="drill-primary-action" id="drill-start-session" disabled>Start session</button>
      </div>

      <div class="drill-session-length" role="group" aria-label="Session length" id="drill-session-length">
        <button type="button" data-length="10" aria-pressed="true">10 cards</button>
        <button type="button" data-length="25" aria-pressed="false">25 cards</button>
        <button type="button" data-length="all-due" aria-pressed="false">All due</button>
      </div>

      <h3>Decks by opening</h3>
      <ul class="drill-deck-list" id="drill-decks-list">
        <li class="empty-note">Your deck is empty. Add cards from an opening report or from the band data below.</li>
      </ul>

      <h3 id="drill-stuck-heading">Lines that keep beating you</h3>
      <ul class="drill-stuck-list" id="drill-stuck-list" aria-labelledby="drill-stuck-heading">
        <li class="empty-note">None yet.</li>
      </ul>

      <div class="drill-seed-card" id="drill-seed-from-report">
        <h3>Drill your leaks</h3>
        <p class="empty-note" id="drill-seed-report-empty">Get your <a href="opening-report.html">personal opening report</a> first, then come back here to drill exactly the moves it flags.</p>
      </div>

      <div class="drill-seed-card">
        <h3>Add cards from band data</h3>
        <p>Pick an opening. We will find where your rating band&rsquo;s own most-played lines branch and add a card at each one.</p>
        <form class="drill-seed-form" id="drill-seed-form">
          <label>Opening
            <select id="drill-seed-opening">${openingOptions}</select>
          </label>
          <button type="submit">Add cards</button>
        </form>
        <p class="empty-note" id="drill-seed-status" role="status" aria-live="polite"></p>
      </div>
    </section>

    <section id="drill-session" class="drill-layout" hidden aria-labelledby="drill-session-heading">
      <div class="drill-column-play">
        <h2 id="drill-session-heading">Play the move</h2>
        <p id="drill-announce" role="status" aria-live="polite">Loading your session&hellip;</p>
        <form class="drill-move-input" id="drill-move-form">
          <label class="sr-only" for="drill-move-text">Type your move (SAN or UCI)</label>
          <input type="text" id="drill-move-text" name="move" placeholder="e.g. Bc4 or f1c4" autocomplete="off">
          <button type="submit" id="drill-submit">Play</button>
        </form>
        <figure class="board-figure">
          <div id="drill-board">${startingBoardHtml}</div>
          <figcaption>Tap or drag a piece, or type the move above.</figcaption>
        </figure>
        <button type="button" class="drill-show-answer" id="drill-show-answer">Show me the answer</button>
        <p class="drill-feedback" id="drill-feedback" role="status" aria-live="polite"></p>
        <p><button type="button" id="drill-end-session">End session</button></p>
      </div>
      <div class="drill-column-candidates">
        <h2 id="drill-candidates-heading">Candidates at this position</h2>
        <p class="table-hint">Scroll to see more &rarr;</p>
        <section id="drill-candidate-table" class="table-scroll" tabindex="0" aria-label="Candidate moves at this position">${CANDIDATE_TABLE_PLACEHOLDER}</section>
      </div>
    </section>

    <section>
      <h2>Keep exploring</h2>
      <p><a href="drill-reference.html">See full opening lines for every band &rarr;</a></p>
    </section>

    <script src="drill-hub.js" defer></script>
  </main>
  ${renderFooter('Band data from the <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer</a>. Your deck and progress are saved only in your own browser (local storage) - see the privacy policy.', legalLinks)}
</div>
</body>
</html>
`;
}

/**
 * The reference page's own real content, built once at build time from the
 * committed shards (src/buildDrill.js's buildDrillReferenceData()) -- no
 * request-time computation, no client script needed at all: every line and
 * every number is server-rendered plain text, matching this site's no-JS
 * invariant (src/renderDrill.js's own header comment on why this page
 * exists in the first place).
 */
function renderReferenceBandSection(bandEntry) {
  if (bandEntry.openings.length === 0) return '';
  const openingBlocks = bandEntry.openings
    .map((opening) => {
      const lineItems = opening.lines
        .map((line) => {
          const text = line.plies.map((p) => `${escapeHtml(p.san)} (${formatPct(p.score * 100)}%, n=${p.games.toLocaleString()})`).join(', ');
          return `<li class="drill-reference-line">${text}</li>`;
        })
        .join('');
      return `<h4>${displayName(opening.name)} (${escapeHtml(opening.eco)})</h4><ol>${lineItems}</ol>`;
    })
    .join('');
  return `<h3>${escapeHtml(bandEntry.band)}</h3>${openingBlocks}`;
}

/**
 * @param {{nav: object, legalLinks: object}} opts
 * @returns {string} a full, standalone HTML document.
 */
function renderDrillReferencePage({ nav, legalLinks }) {
  const title = pageTitle('Drill reference');
  const description = 'Full opening lines by rating band, with real Lichess win rates on every move - the answers for the opening drill, listed here so a drill attempt is never spoiled.';
  const canonical = absoluteUrl('drill-reference.html');
  const breadcrumbItems = [
    { label: 'Home', href: nav.home },
    { label: 'Opening drill', href: 'drill.html' },
    { label: 'Reference' },
  ];
  const jsonLd = breadcrumbJsonLd(breadcrumbItems);

  const referenceData = buildDrillReferenceData();
  const bandSections = referenceData.map(renderReferenceBandSection).filter(Boolean).join('');
  const manifest = readManifest();
  const provenance = manifest
    ? `<p>Source: Lichess Opening Explorer, ${escapeHtml(manifest.pool)} games, retrieved ${escapeHtml(manifest.retrieved)}.</p>`
    : '';
  const body = bandSections || '<p class="empty-note">No band data has been crawled yet for these openings. Check back soon.</p>';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, ogType: 'website', jsonLd })}
<body>
<div class="page page--wide">
  ${renderHeader(nav, 'drill')}
  <main id="main-content">
    ${renderPageHead({
      breadcrumb: renderBreadcrumb(breadcrumbItems),
      eyebrow: 'Drill',
      title: 'Drill reference: full opening lines by rating band',
      subtitle: 'Every line here is exactly what the opening drill grades you against, listed in full so you can look one up without spoiling a drill attempt in progress. Each move shows the score for the side to move and the sample size behind it.',
    })}
    ${provenance}
    ${body}
    <section>
      <h2>Keep exploring</h2>
      <p><a href="drill.html">Back to the opening drill &rarr;</a></p>
    </section>
  </main>
  ${renderFooter('Band data from the <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer</a>. Your level and progress in the drill are saved only in your own browser (local storage) - see the privacy policy.', legalLinks)}
</div>
</body>
</html>
`;
}

module.exports = { renderDrillHubPage, renderDrillReferencePage, IS_PLACEHOLDER };
