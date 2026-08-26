'use strict';

/**
 * /repertoire-builder.html -- the Repertoire Builder v1 (spec section 3.1).
 * This file's whole reason to exist as its own module is unchanged from the
 * placeholder it replaces (see git history / WS-1 spec section 6.2): src/
 * buildStatic.js requires `renderRepertoireBuilderPage` and reads
 * `IS_PLACEHOLDER` from HERE -- neither buildStatic.js nor src/render.js
 * change as part of this task.
 *
 * This module is NEVER bundled into the browser (same discipline
 * src/renderContent.js/src/boardSvg.js document for themselves) -- it may
 * freely require() render.js, site.js, structuredData.js, boardSvg.js, and
 * (read-only, build-time) fs. The interactive client is entirely
 * src/browser/repertoireBuilder.client.js; this file only emits the
 * server-rendered shell that client mounts into.
 *
 * NO-JS INVARIANT (this site's standing rule -- see src/renderDrill.js's own
 * header comment for the precedent): a crawler or a visitor with JS
 * disabled must see a complete, honest description of the tool, never a
 * blank app div. Since the actual repertoire-building loop genuinely
 * requires script (live band data, a stateful tree, localStorage), the
 * real-content half of that promise here is a substantive "how this works"
 * section citing the site's own committed band-shard manifest (real
 * position counts, real retrieval date -- Non-Negotiable 1: no number
 * without a sample size, source, and date) plus a `<noscript>` notice next
 * to every interactive mount point.
 */

const fs = require('fs');
const path = require('path');
const { escapeHtml, renderDocumentHead, renderHeader, renderFooter } = require('./render');
const { SITE_NAME, absoluteUrl, pageTitle } = require('./site');
const { breadcrumbJsonLd, jsonLdScript } = require('./structuredData');
const { spriteDefsHtml } = require('./boardSvg');
const { RATING_BANDS } = require('./processRepertoire');

const IS_PLACEHOLDER = false;

const CANONICAL_FILE = 'repertoire-builder.html';

/**
 * Reads the committed band-shard manifest (data/rep/manifest.json --
 * scripts/buildBandShards.js's output, W0 spec section 2.1) for the real
 * numbers this page's no-JS copy cites. Read-only, build-time only; this
 * module never writes here. Falls back to a null summary (copy below
 * degrades to a still-true, just less specific sentence) rather than
 * failing the build if the manifest is ever absent from a given checkout --
 * a defensive fallback, not an expected state on the real committed repo.
 */
function readManifestSummary() {
  const manifestPath = path.join(__dirname, '..', 'data', 'rep', 'manifest.json');
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    const totalPositions = (manifest.bands || []).reduce((sum, b) => sum + (b.positions || 0), 0);
    return {
      totalPositions,
      bandCount: (manifest.bands || []).length,
      retrieved: manifest.retrieved,
      pool: manifest.pool,
    };
  } catch (err) {
    return null;
  }
}

/**
 * The rating-band choices this page offers at repertoire creation --
 * RATING_BANDS' own keys, in that module's own order, so this page and the
 * repertoire explorer (src/buildStatic.js's bandPickerHtml) never drift
 * into offering a different band set. Pool is fixed to 'blitz' here (not
 * offered as a choice): the committed shard crawl (data/rep/manifest.json)
 * only covers the blitz pool today -- offering bullet/rapid_classical
 * picker options with no data behind them would be exactly the "locked
 * content that pretends to exist" Non-Negotiable 4 forbids. Widening the
 * picker is a data-availability change (a future crawl), not a UI change.
 */
const BAND_CHOICES = Object.keys(RATING_BANDS);
const FIXED_POOL = 'blitz';

/**
 * Reused, minimal design system additions this page needs -- zero new
 * design tokens (design-standards.md), every value below a `var(--...)`
 * reference. Emitted via renderDocumentHead's `extraCss` param (the same
 * mechanism src/renderDrill.js already uses) so no other page's <head>
 * changes by one byte.
 */
const BUILDER_CSS = `
  .rb-create-panel, .rb-saved-panel {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    margin: var(--space-4) 0 var(--space-6);
    background: var(--color-surface);
  }
  .rb-create-panel h2, .rb-saved-panel h2 { margin-top: 0; }
  .rb-field { display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4); max-width: 40ch; }
  .rb-field label { font-weight: var(--weight-bold); font-size: var(--text-sm); }
  .rb-field input[type="text"] {
    font: inherit; padding: var(--space-2) var(--space-3);
    border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md);
    background: var(--color-bg); color: var(--color-text);
  }
  .rb-radio-group { display: flex; gap: var(--space-4); }
  .rb-radio-group label { display: flex; align-items: center; gap: var(--space-2); font-weight: var(--weight-regular); }
  fieldset.rb-fieldset { border: none; padding: 0; margin: 0 0 var(--space-4); }
  fieldset.rb-fieldset legend { font-weight: var(--weight-bold); font-size: var(--text-sm); padding: 0 0 var(--space-2); }

  .rb-band-choice-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); max-width: 40ch; }
  @media (min-width: 480px) { .rb-band-choice-grid { grid-template-columns: repeat(4, 1fr); } }
  .rb-band-choice {
    min-height: 44px; font: inherit; padding: var(--space-2) var(--space-3);
    border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md);
    background: var(--color-surface); cursor: pointer; text-align: center;
  }
  .rb-band-choice[aria-pressed="true"] {
    background: var(--color-accent); border-color: var(--color-accent-dark); color: var(--color-accent-contrast);
    outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset);
  }

  .btn-primary {
    min-height: 44px; font: inherit; font-weight: var(--weight-bold);
    padding: var(--space-3) var(--space-5); border: none; border-radius: var(--radius-md);
    background: var(--color-accent-dark); color: var(--color-accent-contrast); cursor: pointer;
  }
  .btn-secondary {
    min-height: 44px; font: inherit; padding: var(--space-2) var(--space-4);
    border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md);
    background: var(--color-surface); color: var(--color-text); cursor: pointer;
  }
  .btn-secondary:hover, .btn-primary:hover { filter: brightness(0.96); }

  .rb-saved-items { list-style: none; padding: 0; margin: 0 0 var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
  .rb-saved-item {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3);
    border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4);
  }
  .rb-saved-item-meta { color: var(--color-muted); font-size: var(--text-xs); }
  .rb-saved-item-actions { display: flex; gap: var(--space-2); }

  .rb-workspace-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); }
  .rb-workspace-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .rb-saved-note { min-height: 1.4em; font-size: var(--text-sm); color: var(--color-muted); }
  .rb-saved-note[data-state="saved"] { color: var(--color-win-text); }
  .rb-saved-note[data-state="error"] { color: var(--color-loss-text); }

  .rb-segmented { display: flex; gap: var(--space-2); margin: var(--space-4) 0; border-bottom: 1px solid var(--color-border); }
  .rb-segmented button {
    min-height: 44px; font: inherit; font-weight: var(--weight-bold); padding: var(--space-2) var(--space-4);
    border: none; border-bottom: 3px solid transparent; background: none; color: var(--color-muted); cursor: pointer;
  }
  .rb-segmented button[aria-selected="true"] { color: var(--color-text); border-bottom-color: var(--color-accent-dark); }
  @media (min-width: 768px) { .rb-segmented { display: none; } }

  .rb-layout { display: block; }
  @media (min-width: 1024px) {
    .rb-layout {
      display: grid;
      grid-template-columns: minmax(0, 420px) 1fr;
      grid-template-areas: "board band" "tree tree";
      gap: var(--space-6);
      align-items: start;
    }
    .rb-board-col { grid-area: board; }
    .rb-band-col { grid-area: band; }
    .rb-tree-col { grid-area: tree; margin-top: var(--space-6); }
  }

  .rb-band-col.rb-panel-hidden, .rb-tree-col.rb-panel-hidden { display: none; }
  @media (min-width: 768px) {
    .rb-band-col.rb-panel-hidden, .rb-tree-col.rb-panel-hidden { display: block; }
  }

  .rb-board-wrapper { width: 100%; max-width: 420px; margin: 0 auto var(--space-3); }
  .rb-board-controls { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4); }
  .rb-move-path { min-height: 1.4em; }
  .rb-crumb-link {
    font: inherit; font-size: var(--text-xs); color: var(--color-muted); background: none; border: none;
    padding: 0; text-decoration: underline; cursor: pointer; min-height: 24px;
  }
  .rb-crumb-link:hover { color: var(--color-accent-dark); }

  table.rb-band-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
  table.rb-band-table th, table.rb-band-table td { text-align: left; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-border); }
  table.rb-band-table th.num, table.rb-band-table td.num { text-align: right; }
  table.rb-band-table tr.rb-band-row--yours { background: var(--color-win-bg); }
  .rb-play-btn {
    min-height: 44px; min-width: 44px; font: inherit; font-size: var(--text-xs); font-weight: var(--weight-bold);
    padding: var(--space-2) var(--space-3); border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md);
    background: var(--color-surface); cursor: pointer;
  }
  .rb-play-btn[aria-pressed="true"] { background: var(--color-accent); border-color: var(--color-accent-dark); color: var(--color-accent-contrast); }

  .rb-out-of-book { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-4); }
  .rb-out-of-book h4 { margin-top: 0; }

  ul.rb-tree, ul.rb-tree ul { list-style: none; margin: 0; padding-left: var(--space-5); border-left: 2px solid var(--color-border); }
  ul.rb-tree { padding-left: 0; border-left: none; }
  ul.rb-tree li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: var(--space-2) 0; }
  ul.rb-tree li > ul.rb-tree { flex-basis: 100%; margin-top: var(--space-2); }
  .rb-tree-node-row {
    display: inline-flex; align-items: center; gap: var(--space-2);
    background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3); cursor: pointer; font: inherit;
  }
  .rb-tree-node-row[aria-current="true"] {
    border-color: var(--color-accent-dark); outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset);
  }
  .rb-tree-delete {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 24px; min-width: 24px; padding: 0 var(--space-1);
    border: none; background: none; color: var(--color-muted); cursor: pointer;
    font: inherit; font-size: var(--text-base); line-height: 1;
  }
  .rb-tree-delete:hover { color: var(--color-loss-text); }

  .rb-provenance { color: var(--color-muted); font-size: var(--text-xs); margin: var(--space-3) 0; }
  .rb-empty-note { color: var(--color-muted); }

  .rb-import-toggle-wrapper { margin: var(--space-4) 0; }
  .rb-import-panel {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    margin: var(--space-4) 0 var(--space-6);
    background: var(--color-surface);
  }
  .rb-import-panel h2, .rb-import-panel h3 { margin-top: 0; }
  .rb-import-panel textarea {
    font: inherit; font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3); width: 100%; box-sizing: border-box;
    border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md);
    background: var(--color-bg); color: var(--color-text); resize: vertical;
  }
  .rb-import-panel input[type="file"] { font: inherit; }
  .rb-import-confirm { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--color-border); }
  .rb-import-confirm select {
    font: inherit; min-height: 44px; padding: var(--space-2) var(--space-3);
    border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-md);
    background: var(--color-bg); color: var(--color-text); max-width: 40ch;
  }
`;

/**
 * @param {{nav: object, legalLinks: object}} opts
 * @returns {string} the full document.
 */
function renderRepertoireBuilderPage({ nav, legalLinks }) {
  // Base title kept under buildContent.js's assertPageMetadata 70-char cap
  // once site.js's pageTitle() suffix (" | Repertoire Builder", 21 chars) is
  // added -- the spec's own longer phrasing ("Chess Repertoire Builder:
  // build and export your opening repertoire") is 87 chars combined, over
  // the hard build-failing cap; shortened here while keeping the same verb
  // and object the spec asked for.
  const title = pageTitle('Build and export your opening repertoire');
  const description = 'Build a chess opening repertoire against real Lichess rating-band data. See what your band plays at every position, then export a real PGN. Free, no signup.';
  const canonical = absoluteUrl(CANONICAL_FILE);
  const manifest = readManifestSummary();

  const breadcrumbItems = [
    { label: 'Home', href: nav.home },
    { label: 'Repertoire builder' },
  ];
  const softwareApplicationJsonLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Repertoire Builder',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any (web browser)',
    url: canonical,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  });
  const jsonLd = [breadcrumbJsonLd(breadcrumbItems), softwareApplicationJsonLd].join('\n  ');

  const bandChoiceButtons = BAND_CHOICES
    .map((band, i) => `<button type="button" class="rb-band-choice" data-band="${escapeHtml(band)}" aria-pressed="${i === 1 ? 'true' : 'false'}">${escapeHtml(band)}</button>`)
    .join('\n          ');

  const manifestSentence = manifest && manifest.totalPositions > 0
    ? `Band data comes from ${manifest.totalPositions.toLocaleString()} real positions across ${manifest.bandCount} rating bands (${BAND_CHOICES.join(', ')}), crawled from Lichess&rsquo;s Opening Explorer (${escapeHtml(manifest.pool)} games) and last retrieved ${escapeHtml(manifest.retrieved)}.`
    : 'Band data comes from real games crawled from Lichess&rsquo;s Opening Explorer, rating band by rating band.';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, ogType: 'website', jsonLd, extraCss: BUILDER_CSS })}
<body>
<div class="page page--wide">
  ${renderHeader(nav, 'builder')}
  ${spriteDefsHtml()}
  <main id="main-content">
    <nav class="breadcrumb" aria-label="Breadcrumb"><ol><li aria-current="page">Repertoire builder</li></ol></nav>
    <h1 class="page-title">Repertoire builder</h1>
    <p class="subtitle">Play out an opening and see, at every move, what players at your rating band actually play and how it scores. Save the moves you want, and export a real PGN when you are done.</p>

    <p class="rb-provenance">${manifestSentence}</p>

    <noscript>
      <p class="rb-empty-note">The Repertoire Builder needs JavaScript: it looks up live rating-band data as you play moves on the board, and saves your work to this browser. With JavaScript on, everything below runs entirely in your browser - nothing you build here is sent to any server.</p>
    </noscript>

    <section id="rb-library" aria-label="Your repertoires">
      <div class="rb-create-panel" id="rb-create-panel">
        <h2>Start a new repertoire</h2>
        <form id="rb-create-form">
          <div class="rb-field">
            <label for="rb-name-input">Name</label>
            <input type="text" id="rb-name-input" maxlength="80" placeholder="e.g. My Italian Game" autocomplete="off">
          </div>
          <fieldset class="rb-fieldset">
            <legend>Play as</legend>
            <div class="rb-radio-group">
              <label><input type="radio" name="rb-side" value="white" checked> White</label>
              <label><input type="radio" name="rb-side" value="black"> Black</label>
            </div>
          </fieldset>
          <fieldset class="rb-fieldset">
            <legend>Rating band</legend>
            <div class="rb-band-choice-grid" role="group" aria-label="Rating band" id="rb-band-choice-group">
          ${bandChoiceButtons}
            </div>
          </fieldset>
          <button type="submit" class="btn-primary">Create repertoire</button>
        </form>
      </div>

      <div class="rb-saved-panel" id="rb-saved-panel" hidden>
        <h2>Your saved repertoires</h2>
        <ul class="rb-saved-items" id="rb-saved-items"></ul>
        <button type="button" class="btn-secondary" id="rb-new-btn">Start another repertoire</button>
      </div>

      <div class="rb-import-toggle-wrapper">
        <button type="button" class="btn-secondary" id="rb-import-toggle-btn" aria-expanded="false" aria-controls="rb-import-panel">Import a repertoire</button>
      </div>

      <div class="rb-import-panel" id="rb-import-panel" hidden>
        <h2>Import a repertoire</h2>
        <p class="rb-empty-note">Import a .pgn file (including variations) or a Repertoire Pack&rsquo;s pack.json file. Paste the text below, or choose a file. Nothing you import is sent anywhere; it is read entirely in your browser.</p>
        <div class="rb-field">
          <label for="rb-import-file">Choose a file (.pgn or .json)</label>
          <input type="file" id="rb-import-file" accept=".pgn,.json,application/json,text/plain">
        </div>
        <div class="rb-field">
          <label for="rb-import-paste">Or paste PGN or pack.json text</label>
          <textarea id="rb-import-paste" rows="6" placeholder="[Event &quot;My repertoire&quot;]&#10;&#10;1. e4 e5 2. Nf3 ..."></textarea>
        </div>
        <button type="button" class="btn-primary" id="rb-import-parse-btn">Read import</button>
        <p class="rb-saved-note" id="rb-import-status" role="status" aria-live="polite"></p>

        <div class="rb-import-confirm" id="rb-import-confirm" hidden>
          <h3>Ready to import</h3>
          <p id="rb-import-summary"></p>
          <div class="rb-field">
            <label for="rb-import-name-input">Name (only used if creating a new repertoire)</label>
            <input type="text" id="rb-import-name-input" maxlength="80" autocomplete="off">
          </div>
          <fieldset class="rb-fieldset" id="rb-import-side-fieldset">
            <legend>Side</legend>
            <div class="rb-radio-group">
              <label><input type="radio" name="rb-import-side" value="white" checked> White</label>
              <label><input type="radio" name="rb-import-side" value="black"> Black</label>
            </div>
          </fieldset>
          <fieldset class="rb-fieldset" id="rb-import-band-fieldset">
            <legend>Rating band (only used if creating a new repertoire)</legend>
            <div class="rb-band-choice-grid" role="group" aria-label="Rating band" id="rb-import-band-choice-group">
          ${bandChoiceButtons}
            </div>
          </fieldset>
          <div class="rb-field">
            <label for="rb-import-target-select">Add to</label>
            <select id="rb-import-target-select">
              <option value="__new__">A new repertoire</option>
            </select>
          </div>
          <div class="rb-workspace-actions">
            <button type="button" class="btn-primary" id="rb-import-confirm-btn">Import</button>
            <button type="button" class="btn-secondary" id="rb-import-cancel-btn">Cancel</button>
          </div>
        </div>
      </div>
    </section>

    <section id="rb-workspace" hidden aria-label="Repertoire workspace">
      <div class="rb-workspace-header">
        <div>
          <h2 id="rb-current-name">Your repertoire</h2>
          <p class="rb-saved-note" id="rb-saved-note" role="status" aria-live="polite"></p>
        </div>
        <div class="rb-workspace-actions">
          <button type="button" class="btn-secondary" id="rb-export-btn">Export PGN</button>
          <button type="button" class="btn-secondary" id="rb-rename-btn">Rename</button>
          <button type="button" class="btn-secondary" id="rb-close-btn">Back to my repertoires</button>
        </div>
      </div>

      <div class="rb-segmented" role="tablist" aria-label="View">
        <button type="button" role="tab" id="rb-tab-band" aria-selected="true" data-panel="band">Band replies</button>
        <button type="button" role="tab" id="rb-tab-tree" aria-selected="false" data-panel="tree">My repertoire</button>
      </div>

      <div class="rb-layout">
        <div class="rb-board-col">
          <nav class="breadcrumb rb-move-path" id="rb-move-path" aria-label="Current line"><ol><li aria-current="page">Starting position</li></ol></nav>
          <div class="rb-board-wrapper">
            <div id="rb-board"></div>
          </div>
          <div class="rb-board-controls">
            <button type="button" class="btn-secondary" id="rb-flip-btn">Flip board</button>
            <button type="button" class="btn-secondary" id="rb-reset-btn">Back to start</button>
            <button type="button" class="btn-secondary" id="rb-undo-btn" disabled>Undo last move</button>
          </div>
        </div>

        <div class="rb-band-col" id="rb-band-panel">
          <h3>What your band plays here</h3>
          <div id="rb-band-table-wrapper"><p class="rb-empty-note">Loading band data&hellip;</p></div>
        </div>

        <div class="rb-tree-col rb-panel-hidden" id="rb-tree-panel">
          <div class="rb-workspace-header">
            <h3>Your repertoire</h3>
            <span class="rep-games" id="rb-node-count"></span>
          </div>
          <ul class="rb-tree" id="rb-tree-root" role="tree" aria-label="Your repertoire moves"></ul>
        </div>
      </div>
    </section>
  </main>
  ${renderFooter('Band data source: <a href="https://lichess.org/api" rel="noopener noreferrer">lichess.org/api</a>.', legalLinks)}
</div>
<script src="repertoire-builder.js" defer></script>
</body>
</html>
`;
}

module.exports = { renderRepertoireBuilderPage, IS_PLACEHOLDER };
