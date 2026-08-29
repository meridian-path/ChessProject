'use strict';

/**
 * The collapsed static repertoire explorer (spec WS-3.2 section 2 -- one
 * repertoire.html replacing the 8 old repertoire-<band>-<color>.html
 * files), plus its synced board panel (added for the Board Visibility spec,
 * task B1 -- repertoire.html previously had zero board visualization
 * anywhere).
 *
 * This function used to live in src/render.js itself. It moved here for the
 * same reason src/renderEcoExplorerPage.js/renderOpeningReport.js/
 * renderRepertoireBuilder.js already live outside render.js: this page now
 * needs src/boardSvg.js's spriteDefsHtml() (embeds the piece-sprite `<svg>`
 * once so the board renders with zero network requests -- see
 * src/boardWidget.js's own header comment for the file:// invariant this
 * protects), and boardSvg.js uses Node's `fs` to read that sprite off disk.
 * render.js is bundled verbatim into the browser by esbuild (several
 * src/browser/*.client.js entry points require() it directly for
 * escapeHtml/renderRepertoireTree/etc, repertoire.client.js among them) --
 * requiring an `fs`-using module from render.js would break that bundle
 * under esbuild's platform:'browser' target. Server-only page-assembly
 * modules like this one may require() render.js's other helpers freely;
 * render.js itself must never require() this file or boardSvg.js.
 */

const { escapeHtml, displayName, renderDocumentHead, renderHeader, renderFooter, renderPageHead, renderRepertoireTree } = require('./render');
const { spriteDefsHtml, pieceAttributionHtml } = require('./boardSvg');

/**
 * @param {object} data
 * @param {Object<string, {ratingBand:string, color:string,
 *   opening:{eco:string,name:string}|null,
 *   totals:{white:number,draws:number,black:number}|null, tree:Array}>}
 *   data.combos keyed "<band>|<color>" -- every combo this build fetched.
 * @param {string} data.defaultBand a key present in data.combos.
 * @param {string} data.defaultColor 'white'|'black', a key present in data.combos.
 * @param {string} data.bandPickerHtml pre-built band+color picker markup
 *   (src/buildStatic.js's bandPickerHtml()) -- built by the caller so this
 *   function doesn't need to know the picker's own pill-generation details,
 *   same division of labor indexPage() already uses for the home page's
 *   copy of the same picker.
 * @param {object} [data.nav]
 * @param {object} [data.legalLinks]
 * @param {string} [data.canonical]
 * @param {string} [data.description]
 * @returns {string} a full standalone HTML document
 */
function renderRepertoireExplorerPage({ combos, defaultBand, defaultColor, bandPickerHtml, nav = { player: '/', repertoire: '/repertoire.html' }, legalLinks, canonical, description }) {
  const defaultKey = `${defaultBand}|${defaultColor}`;
  const defaultCombo = combos[defaultKey];
  if (!defaultCombo) {
    throw new Error(`renderRepertoireExplorerPage: no combo found for default "${defaultKey}"`);
  }

  const totalGames = defaultCombo.totals ? defaultCombo.totals.white + defaultCombo.totals.draws + defaultCombo.totals.black : null;
  const openingNote = defaultCombo.opening ? ` - starting from ${displayName(defaultCombo.opening.name)} (${escapeHtml(defaultCombo.opening.eco)})` : '';
  const totalsNote = defaultCombo.totals
    ? `<p id="repertoire-totals" class="summary-line">${totalGames.toLocaleString()} games played from the starting position in this rating band
        (${defaultCombo.totals.white.toLocaleString()}W / ${defaultCombo.totals.draws.toLocaleString()}D / ${defaultCombo.totals.black.toLocaleString()}L).</p>`
    : '<p id="repertoire-totals" class="summary-line" hidden></p>';
  const title = 'Opening repertoire explorer, by rating band | Repertoire Builder';

  const payload = { default: { band: defaultBand, color: defaultColor }, combos };

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical })}
<body>
<div class="page page--wide">
  ${renderHeader(nav, 'repertoire')}
  <main id="main-content">
    ${renderPageHead({
      eyebrow: 'Repertoire',
      title: 'Opening repertoire explorer',
      subtitle: `<span id="repertoire-subtitle-text">Rating band ${escapeHtml(defaultCombo.ratingBand)}, playing as ${escapeHtml(defaultCombo.color)}${openingNote}</span>`,
      meta: totalsNote,
    })}
    ${bandPickerHtml}
    <div class="repertoire-explorer-layout">
      <div class="repertoire-board-col">
        <p class="repertoire-intro">Most-played moves at each ply for players in this rating band, with win/draw/loss rates per move.
           Your color&rsquo;s plies show the top choices actually played at this rating; the opponent&rsquo;s replies show
           only their single most common response, to keep the tree readable. Pick a different rating band or
           color above - the whole tree updates without leaving this page.</p>
        <!-- sr-only h2 (accessibility fix, same pattern src/buildStatic.js's
             homeDemoMarkup() already established for the homepage's own hero
             demo board): this aside was the page's only section between
             the page's h1 and the first visible h2 (the footer's newsletter
             heading), and cm-chessboard's Accessibility extension
             (node_modules/cm-chessboard/src/extensions/accessibility/
             Accessibility.js, hardcoded, not configurable) injects its own
             h3 heading ("Move piece") client-side inside
             #repertoire-board-mount once the widget mounts -- with no h2
             ancestor yet, that skipped a level (h1 straight to h3). Reusing
             the aside's own aria-label text as a visually-hidden real
             heading fixes the sequence for real (h1, h2, h3 in order)
             without changing anything visible. Note for future editors: no
             literal angle-bracket tag mentions in this comment, on purpose
             -- a heading-count test elsewhere greps the raw rendered HTML
             with a naive regex that can't tell a comment from real markup,
             so writing out the actual h1 tag with its brackets here would
             itself count as a second one. -->
        <aside class="repertoire-board-panel" aria-label="Board for the selected line">
          ${spriteDefsHtml()}
          <h2 class="sr-only">Board for the selected line</h2>
          <div id="repertoire-board-mount" class="repertoire-board-mount"></div>
          <p id="repertoire-board-hint" class="repertoire-board-hint">Pick a move to see the position.</p>
          <p id="repertoire-board-status" class="sr-only" role="status" aria-live="polite"></p>
        </aside>
      </div>
      <div class="repertoire-tree-col">
        <div id="repertoire-tree">${renderRepertoireTree(defaultCombo.tree)}</div>
      </div>
    </div>
  </main>
  ${renderFooter(`Data source: <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer API</a> (explorer.lichess.ovh, keyless, no account required). ${pieceAttributionHtml()}`, legalLinks)}
  <script type="application/json" id="repertoire-data">${JSON.stringify(payload)}</script>
  <script src="repertoire.js" defer></script>
</div>
</body>
</html>
`;
}

module.exports = {
  renderRepertoireExplorerPage,
};
