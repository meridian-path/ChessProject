'use strict';

/**
 * Markup for the content layer: board diagrams, opening pages, the openings
 * hub, editorial guide articles, the guides hub, and the FAQ page.
 * Deliberately a SEPARATE module from render.js (which is concatenated
 * verbatim into the browser bundle -- see that file's own header comment) --
 * this module MAY require() render.js/site.js/chessPosition.js because it is
 * never bundled into anything that runs in a visitor's browser; every
 * content page is fully pre-rendered static HTML with zero client-side JS.
 *
 * Titles, meta descriptions, and canonical links are in scope on every page
 * type here -- they were never treated as optional, since a page without
 * them isn't a finished page. JSON-LD structured data (BreadcrumbList on
 * every page below that renders a visible breadcrumb, Article on guide
 * pages, FAQPage on the FAQ page) is built via src/structuredData.js and
 * passed through renderDocumentHead's `jsonLd` param -- each block mirrors
 * only what that same page already renders visibly, never anything extra.
 */

const { escapeHtml, displayName, formatPct, renderDocumentHead, renderHeader, renderFooter, wrapTable, renderPageHead, renderBreadcrumb, HEADER_BAND_OPTIONS, HEADER_BAND_DEFAULT } = require('./render');
const { START_BOARD, applyUciMoves } = require('./chessPosition');
const { SITE_NAME, SITE_AUTHOR, BUILD_DATE, absoluteUrl, pageTitle } = require('./site');
const { breadcrumbJsonLd, articleJsonLd, faqPageJsonLd, datasetJsonLd } = require('./structuredData');
const { spriteDefsHtml, renderBoardDiagram, pieceAttributionHtml } = require('./boardSvg');
const { formatInterval } = require('./stats');

// Half-width (percentage points) at or above which a confidence interval is
// wide enough to change the reading, per spec WS-3.3 section 3.2 -- the
// row also gets a visible "wide interval, small sample" note, not just the
// .ci figure, since a technically-present-but-visually-ignorable interval
// is disclosure theatre (the spec's own words).
//
// Site-audit fix (2026-08-29): 1.0pp fired on rows the site's own homepage
// presents with no caveat at all (e.g. n=7,493, +/-1.1pp) -- a half-width
// this small doesn't change the reading, so calling it "wide" was simply
// false, and firing on nearly every row trained readers to ignore the note
// entirely, burying the rows that actually deserve it (e.g. n=192,
// +/-7.0pp). 3.0pp is the real dividing line: at typical opening-page score
// rates (~45-55%), that's roughly where a band's row starts trading places
// with a neighboring band under repeated sampling -- i.e. where the caution
// is factually earned, not just present. Keep this in sync with
// compareOpeningsShared.js's own copy of the same constant.
const WIDE_INTERVAL_THRESHOLD_PP = 3.0;

/**
 * The exact markup spec section 3.2 requires for a rate/score with a
 * confidence interval: the point value's sibling `.ci` span (a de-
 * emphasized "±0.4"), and a `.sr-only` span spelling out the full interval
 * and sample size for assistive tech -- never `title=`, which design-
 * standards.md notes isn't reliably exposed to screen readers. Returns ''
 * when there's no interval to show (a suppressed/missing number), so a
 * caller can always concatenate this right after its own point-value markup
 * with no extra branching.
 *
 * Split into renderCIVisible/renderCISr (craft-audit fix, item 3): the
 * visible `.ci` span is now `aria-hidden="true"`, since its own sr-only
 * sibling already speaks the same number in full -- without aria-hidden,
 * assistive tech announced BOTH the terse "±X.X" figure and its own
 * expansion back to back, which is what the audit flagged. renderCI() below
 * still concatenates both pieces immediately (unchanged output for every
 * existing caller); a caller that needs the sr-only sentence to land at the
 * END of a longer sentence instead (renderOpeningStatCard's card-score line,
 * the second audit defect: the sentence used to continue mid-clause right
 * after the sr-only span) calls renderCIVisible()/renderCISr() separately.
 *
 * @param {object} opts
 * @param {number|null} halfWidthPct half-width in PERCENTAGE POINTS (not a
 *   fraction) -- every caller in this codebase already computes this shape
 *   (processRepertoire.js's winCI/drawCI/lossCI, processOpenings.js's
 *   scoreForSideCI/scoreCI), so this function multiplies nothing itself.
 * @param {string} srLabel e.g. "White win rate" -- prefixed onto the
 *   sr-only sentence so a screen-reader user knows which figure this
 *   interval belongs to.
 * @param {number|null} lowPct
 * @param {number|null} highPct
 * @param {number} sampleSize
 */
function renderCIVisible({ halfWidthPct, lowPct, highPct }) {
  if (halfWidthPct == null || lowPct == null || highPct == null) return '';
  return `<span class="ci" aria-hidden="true"> ${escapeHtml(formatInterval(halfWidthPct / 100))}</span>`;
}

function renderCISr({ halfWidthPct, srLabel, lowPct, highPct, sampleSize }) {
  if (halfWidthPct == null || lowPct == null || highPct == null) return '';
  const srText = `${escapeHtml(srLabel)}: 95 percent confidence interval ${formatPct(lowPct)} to ${formatPct(highPct)} percent, ${sampleSize.toLocaleString()} games.`;
  return `<span class="sr-only">${srText}</span>`;
}

function renderCI(opts) {
  return renderCIVisible(opts) + renderCISr(opts);
}

/**
 * The visible "wide interval, small sample" note spec section 3.2 requires
 * whenever a displayed interval's half-width is >= WIDE_INTERVAL_THRESHOLD_PP
 * -- a disclosure a caller can drop right after its own table row/figure.
 * Returns '' below the threshold (or with no interval at all), so it's
 * always safe to concatenate unconditionally.
 */
function wideIntervalNote(halfWidthPct) {
  if (typeof halfWidthPct !== 'number' || halfWidthPct < WIDE_INTERVAL_THRESHOLD_PP) return '';
  return '<span class="wide-interval-note">Wide interval, small sample: treat this number cautiously.</span>';
}

// PIECE_GLYPH removed: its one
// remaining consumer was the Italian Game drill's own unicode-glyph board
// (src/renderDrill.js's now-removed renderDrillBoard/pieceSpanHtml). Grep
// confirmed zero remaining requires of this export before deleting it.

// This module's pages are always part of the static build (never dynamic
// dev-server routes -- see this file's own header comment), so unlike
// render.js's renderRepertoirePage(), these footer links can be hardcoded to
// the static compliance-page filenames directly rather than threaded
// through as a parameter. Keep in sync with buildStatic.js's LEGAL_LINKS,
// which points at the same three flat filenames.
const CONTENT_LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html', faq: 'chess-opening-faq.html' };

/**
 * @param {Record<string,string>} board square -> FEN piece letter (see chessPosition.js)
 * @param {{flip?: boolean, label: string}} opts `label` becomes both the
 *   aria-label and the visible figcaption text -- nothing on this page is
 *   diagram-only, so a missing piece render degrades to "diagram missing",
 *   never "content missing".
 *
 * Phase 7c: renders real Cburnett SVG piece artwork (src/boardSvg.js)
 * instead of the old per-platform Unicode glyph + text-shadow hack this
 * function used before -- same `.board`/`.board-sq` markup and
 * `--color-board-light`/`--color-board-dark` tokens, so no other CSS
 * changed. Includes the page-level sprite-definitions block (spriteDefsHtml())
 * inline since exactly one board renders per content page today; a future
 * page with more than one board must call spriteDefsHtml() itself, once,
 * and pass a board-only render instead (see boardSvg.js's own header
 * comment).
 */
function renderBoard(board, opts = {}) {
  return `${spriteDefsHtml()}${renderBoardDiagram(board, opts)}`;
}


/**
 * @param {Array<{label:string, href:string, note?:string}>} items
 */
function renderRelated(items, heading = 'Related') {
  if (!items || items.length === 0) return '';
  const cards = items
    .map(
      (i) => `<div class="card card--nav"><h3><a href="${escapeHtml(i.href)}">${displayName(i.label)}</a></h3>${
        i.note ? `<p>${displayName(i.note)}</p>` : ''
      }</div>`
    )
    .join('');
  return `<section><h2>${escapeHtml(heading)}</h2><div class="card-grid">${cards}</div></section>`;
}

/**
 * An opening card for an entry page (homepage "Openings by real win
 * rate" list, the openings hub) that carries the WDL bar + score number for
 * the site's default 1600-1800 band inline, so a visitor never has to click
 * through two pages to see whether an opening is worth their time. Reads
 * the exact same `model.bands` array renderBandsTable() already consumes
 * for the opening's own page -- no separate fetch, no separate model.
 * Falls back to a plain nav-style card (no bar, no number) whenever that
 * band isn't populated/doesn't have enough games -- this NEVER approximates
 * or invents a score.
 * @param {{slug: string}} openingConfig
 * @param {{name: string, eco: string, side: string, bands?: Array}} model
 * @param {string} [extraClass] e.g. 'card--outline' for a demoted homepage card
 * @param {object} [opts]
 * @param {boolean} [opts.showScoreLine] Set false to omit the `card-score`
 *   paragraph (the exact "Scores X% ... (N games)" figure) when this card
 *   renders directly alongside a table that already states that same
 *   number -- see renderOpeningsHub's card grid, which sits right below a
 *   ranked comparison table carrying the identical score+games figures per
 *   row. Restating them a second time per card is redundant; the WDL
 *   bar's own win/draw/loss split stays because it's a genuinely
 *   different presentation of the underlying result, not a repeat of the
 *   table's single combined "score for its side" number. Defaults true so
 *   every other caller (the homepage's demoted outline cards, which have
 *   no adjacent table) renders unchanged.
 * @param {boolean} [opts.bandAware] Craft-audit fix (item 2): when true,
 *   renders ONE panel per HEADER_BAND_OPTIONS band (each independently
 *   deciding its own hasData/no-data shape), wrapped in
 *   `.card-band-panel[data-band-variant]`, with every band except
 *   HEADER_BAND_DEFAULT starting `hidden` -- the homepage's own
 *   band-toggle client script (src/browser/homeDemo.client.js) reveals the
 *   visitor's actual persisted band on load and on every band change,
 *   instead of this card being permanently locked to a hardcoded 1600-1800
 *   figure regardless of the site-wide band control's own state. Defaults
 *   false so every other caller (the openings hub, which has no band
 *   toggle on the page) renders exactly as before, unchanged.
 * @returns {string}
 */
function renderOpeningStatCard(openingConfig, model, extraClass = '', { showScoreLine = true, bandAware = false } = {}) {
  const href = `${escapeHtml(openingConfig.slug)}.html`;

  const scoreLineFor = (band, bandLabel) => {
    if (!showScoreLine) return '';
    const scoreCIVisible = renderCIVisible({
      halfWidthPct: band.scoreForSideCI,
      lowPct: band.scoreForSideCI != null ? Number((band.scoreForSide - band.scoreForSideCI).toFixed(1)) : null,
      highPct: band.scoreForSideCI != null ? Number((band.scoreForSide + band.scoreForSideCI).toFixed(1)) : null,
    });
    // Craft-audit fix (item 3): the sr-only expansion now lands at the END
    // of the full sentence (after "games)"), not immediately after the
    // visible "±X.X" figure -- previously the announced sentence broke off
    // mid-clause right after the sr-only span, then continued with a second,
    // redundant statement of the games count. renderCIVisible()'s own `.ci`
    // span is also now aria-hidden, so a screen reader hears this sentence
    // exactly once.
    const scoreCISr = renderCISr({
      halfWidthPct: band.scoreForSideCI, srLabel: `Score for ${model.side}`,
      lowPct: band.scoreForSideCI != null ? Number((band.scoreForSide - band.scoreForSideCI).toFixed(1)) : null,
      highPct: band.scoreForSideCI != null ? Number((band.scoreForSide + band.scoreForSideCI).toFixed(1)) : null,
      sampleSize: band.games,
    });
    // Same reasoning as drillCtaHtml/relatedSection elsewhere in this file:
    // showScoreLine: false legitimately produces '', and interpolating that
    // at its own indented template line would leave a whitespace-only line
    // that html-validate's no-trailing-whitespace rule flags -- so the
    // newline + indent are only added when there's a real line to attach
    // them to.
    return `\n    <p class="card-score">Scores ${formatPct(band.scoreForSide)}%${scoreCIVisible} for ${escapeHtml(model.side)} at ${escapeHtml(bandLabel)} (${band.games.toLocaleString()} games)${scoreCISr}</p>`;
  };

  if (!bandAware) {
    const band = (model.bands || []).find((b) => b.band === '1600-1800') || null;
    const hasData = band && band.enoughData && band.scoreForSide != null && band.whitePct != null;
    const classes = ['card', hasData ? 'card--stat' : 'card--nav', extraClass].filter(Boolean).join(' ');
    if (!hasData) {
      return `<div class="${classes}"><h3><a href="${href}">${displayName(model.name)}</a></h3><p>${escapeHtml(model.eco)}, playing as ${escapeHtml(model.side)}</p></div>`;
    }
    const scoreLine = scoreLineFor(band, '1600-1800');
    return `<div class="${classes}">
    <h3><a href="${href}">${displayName(model.name)}</a></h3>
    <div class="card-wdl-row">${wdlBar(band.whitePct, band.drawPct, band.blackPct, `White/draw/black at 1600-1800: ${formatPct(band.whitePct)}% / ${formatPct(band.drawPct)}% / ${formatPct(band.blackPct)}%`)}</div>${scoreLine}
  </div>`;
  }

  // Band-aware path (homepage ranked cards, craft-audit item 2). Every
  // HEADER_BAND_OPTIONS band gets its own panel: real data when this
  // opening has enough games at that band, an honest "not enough games at
  // this band yet" note otherwise -- this never approximates or invents a
  // number, the same discipline the single-band path above already applies.
  // An opening with NO qualifying band at all (no `bands` field, or every
  // band under-sampled) falls back to the exact same plain nav-style card
  // the non-bandAware path above renders -- there is nothing for a band
  // switch to ever reveal on this card, so four identical "not enough
  // games" panels would be pure noise rather than genuine band-awareness.
  const anyBandHasData = (model.bands || []).some((b) => b.enoughData && b.scoreForSide != null && b.whitePct != null);
  if (!anyBandHasData) {
    const classes = ['card', 'card--nav', extraClass].filter(Boolean).join(' ');
    return `<div class="${classes}"><h3><a href="${href}">${displayName(model.name)}</a></h3><p>${escapeHtml(model.eco)}, playing as ${escapeHtml(model.side)}</p></div>`;
  }
  const classes = ['card', 'card--stat', extraClass].filter(Boolean).join(' ');
  const panels = HEADER_BAND_OPTIONS.map((bandName) => {
    const band = (model.bands || []).find((b) => b.band === bandName) || null;
    const hasData = band && band.enoughData && band.scoreForSide != null && band.whitePct != null;
    const hiddenAttr = bandName === HEADER_BAND_DEFAULT ? '' : ' hidden';
    if (!hasData) {
      return `<div class="card-band-panel" data-band-variant="${escapeHtml(bandName)}"${hiddenAttr}><p>${escapeHtml(model.eco)}, playing as ${escapeHtml(model.side)}. Not enough games at ${escapeHtml(bandName)} yet.</p></div>`;
    }
    const scoreLine = scoreLineFor(band, bandName);
    return `<div class="card-band-panel" data-band-variant="${escapeHtml(bandName)}"${hiddenAttr}>
      <div class="card-wdl-row">${wdlBar(band.whitePct, band.drawPct, band.blackPct, `White/draw/black at ${bandName}: ${formatPct(band.whitePct)}% / ${formatPct(band.drawPct)}% / ${formatPct(band.blackPct)}%`)}</div>${scoreLine}
    </div>`;
  }).join('\n    ');
  return `<div class="${classes}" data-stat-card="${escapeHtml(openingConfig.slug)}">
    <h3><a href="${href}">${displayName(model.name)}</a></h3>
    ${panels}
  </div>`;
}

function formatGamesAbbrev(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/** "1.e4 e5 2.Nf3 Nc6 3.Bc4" style move text from an openings.js `line` array. */
function formatSanLine(line) {
  return line
    .map((ply, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}.${ply.san}` : ply.san))
    .join(' ');
}

function lichessAnalysisUrl(line) {
  return `https://lichess.org/analysis/pgn/${encodeURIComponent(formatSanLine(line))}`;
}

function lichessOpeningUrl(name) {
  return `https://lichess.org/opening/${encodeURIComponent(name.replace(/\s+/g, '_'))}`;
}

/**
 * @param {{large?: boolean, ci?: {games:number, winCI:number|null, drawCI:number|null,
 *   lossCI:number|null, winLow:number|null, winHigh:number|null, drawLow:number|null,
 *   drawHigh:number|null, lossLow:number|null, lossHigh:number|null}}} [opts]
 *   `large` widens the bar to fill its cell (`.wdl-bar--lg`, render.js),
 *   used only for the one hero table per opening page (renderBandsTable
 *   below). The adjacent percentages (.wdl-label) always render too, so
 *   color is never the sole encoding. `ci`, when given (spec WS-3.3
 *   section 3.2), adds a `.ci` half-width span plus a `.sr-only` full-
 *   interval sentence after EACH of win/draw/loss, and a visible
 *   "wide interval" note when any of the three is wide enough to matter --
 *   see renderCI()/wideIntervalNote() above. Omitted entirely (undefined)
 *   is a fully backward-compatible no-CI render, unchanged from before this
 *   field existed.
 *
 * Rendered as an inline <svg> with three <rect> segments on a 0-100 viewBox
 * (x/width map directly to the percentages), not <span style="width:X%">.
 * Each segment's width is a real per-row data value, and there is no way to
 * express that as a static CSS class -- but html-validate's no-inline-style
 * rule flags any `style` attribute outright, on any element. SVG rect x/
 * width are geometry attributes, not the flagged `style` attribute, so this
 * keeps the exact same stacked-percentage-bar visual with zero inline
 * styles. The <svg><title> child (not the HTML `title` attribute, which
 * `aria-label-misuse` would flag on a non-widget/landmark element) is both
 * the accessible name and the native hover tooltip.
 */
function wdlBar(winPct, drawPct, lossPct, title, opts = {}) {
  if (winPct == null) return '<span class="wdl-label">not enough games</span>';
  const barClass = opts.large ? 'wdl-bar wdl-bar--lg' : 'wdl-bar';
  const drawX = winPct;
  const lossX = winPct + drawPct;
  const c = opts.ci;
  const winCI = c ? renderCI({ halfWidthPct: c.winCI, srLabel: 'Win rate', lowPct: c.winLow, highPct: c.winHigh, sampleSize: c.games }) : '';
  const drawCI = c ? renderCI({ halfWidthPct: c.drawCI, srLabel: 'Draw rate', lowPct: c.drawLow, highPct: c.drawHigh, sampleSize: c.games }) : '';
  const lossCI = c ? renderCI({ halfWidthPct: c.lossCI, srLabel: 'Loss rate', lowPct: c.lossLow, highPct: c.lossHigh, sampleSize: c.games }) : '';
  // suppressWideNote: renderBandsTable's row has a SECOND CI figure
  // (scoreForSide, not part of win/draw/loss) and needs to fold both into
  // one combined once-per-row note rather than this bar rendering its own
  // -- see that function's own comment. Every other caller (e.g.
  // renderTopRepliesTable) has no second figure, so leaves this default.
  const wideNote = c && !opts.suppressWideNote ? wideIntervalNote(Math.max(c.winCI || 0, c.drawCI || 0, c.lossCI || 0)) : '';
  return `<svg class="${barClass}" viewBox="0 0 100 12" preserveAspectRatio="none" role="img"><title>${escapeHtml(title)}</title><rect class="wdl-seg--win" x="0" y="0" width="${winPct}" height="12"></rect><rect class="wdl-seg--draw" x="${drawX}" y="0" width="${drawPct}" height="12"></rect><rect class="wdl-seg--loss" x="${lossX}" y="0" width="${lossPct}" height="12"></rect></svg>
    <span class="wdl-label">${formatPct(winPct)}%${winCI} / ${formatPct(drawPct)}%${drawCI} / ${formatPct(lossPct)}%${lossCI}</span>${wideNote}`;
}

function renderBandsTable(model) {
  const rows = model.bands
    .map((b) => {
      if (!b.enoughData) {
        return `<tr><td>${escapeHtml(b.band)}</td><td class="num">${b.games.toLocaleString()}</td><td colspan="4" class="rep-pct">Not enough games at this band yet.</td></tr>`;
      }
      // buildOpeningModel only stores the Wilson HALF-WIDTH per band rate
      // (whiteCI/drawCI/blackCI), not the exact (slightly asymmetric) low/
      // high bounds moveStatsFromExplorerResponse computes per-move -- a
      // symmetric pct+/-half reconstruction here is a disclosed, minor
      // approximation for the sr-only sentence's "X to Y" wording only; the
      // displayed +/-half figure itself (what a sighted reader actually
      // sees) is always the exact Wilson value.
      const bandLowHigh = (pct, half) => (half == null ? { low: null, high: null } : { low: Number((pct - half).toFixed(1)), high: Number((pct + half).toFixed(1)) });
      const whiteLH = bandLowHigh(b.whitePct, b.whiteCI);
      const drawLH = bandLowHigh(b.drawPct, b.drawCI);
      const blackLH = bandLowHigh(b.blackPct, b.blackCI);
      const bar = wdlBar(b.whitePct, b.drawPct, b.blackPct, `White/draw/black: ${formatPct(b.whitePct)}% / ${formatPct(b.drawPct)}% / ${formatPct(b.blackPct)}%`, {
        large: true,
        suppressWideNote: true,
        ci: {
          games: b.games, winCI: b.whiteCI, drawCI: b.drawCI, lossCI: b.blackCI,
          winLow: whiteLH.low, winHigh: whiteLH.high, drawLow: drawLH.low, drawHigh: drawLH.high, lossLow: blackLH.low, lossHigh: blackLH.high,
        },
      });
      const scoreCI = renderCI({
        halfWidthPct: b.scoreForSideCI, srLabel: `Score for ${b.games ? model.side : ''}`.trim(),
        lowPct: b.scoreForSideCI != null ? Number((b.scoreForSide - b.scoreForSideCI).toFixed(1)) : null,
        highPct: b.scoreForSideCI != null ? Number((b.scoreForSide + b.scoreForSideCI).toFixed(1)) : null,
        sampleSize: b.games,
      });
      // One combined note per row (site-audit fix, 2026-08-29), not one
      // under the bar AND another under the score -- folds in every CI this
      // row displays (white/draw/black from the bar, plus scoreForSide),
      // so the row is flagged if ANY of its own figures is genuinely wide.
      const wideNote = wideIntervalNote(Math.max(b.whiteCI || 0, b.drawCI || 0, b.blackCI || 0, b.scoreForSideCI || 0));
      return `<tr>
        <td>${escapeHtml(b.band)}</td>
        <td class="num">${b.games.toLocaleString()}</td>
        <td>${bar}</td>
        <td class="num">${formatPct(b.scoreForSide)}%${scoreCI}${wideNote}</td>
      </tr>`;
    })
    .join('');
  return wrapTable(`
    <table>
      <caption class="sr-only">Win/draw/loss rate by rating band</caption>
      <thead>
        <tr><th scope="col">Rating band</th><th scope="col" class="num">Games</th><th scope="col">White / draw / Black</th><th scope="col" class="num">Score for ${escapeHtml(model.side)}</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`, 'Win/draw/loss rate by rating band');
}

function renderTopRepliesTable(model) {
  if (model.topReplies.length === 0) {
    return '<p class="empty-note">No reply data available for this band yet.</p>';
  }
  const rows = model.topReplies
    .map((m) => {
      const label = m.opening ? ` <span class="rep-pct">(${displayName(m.opening.name)})</span>` : '';
      const bar = wdlBar(m.winPct, m.drawPct, m.lossPct, `${m.san} win/draw/loss`, {
        ci: {
          games: m.games, winCI: m.winCI, drawCI: m.drawCI, lossCI: m.lossCI,
          winLow: m.winLow, winHigh: m.winHigh, drawLow: m.drawLow, drawHigh: m.drawHigh, lossLow: m.lossLow, lossHigh: m.lossHigh,
        },
      });
      return `<tr>
        <td><a href="https://lichess.org/analysis/pgn/${encodeURIComponent(m.san)}" rel="noopener noreferrer">${escapeHtml(m.san)}</a>${label}</td>
        <td class="num">${m.games.toLocaleString()}</td>
        <td class="num">${formatPct(m.playedPct)}%</td>
        <td>${bar}</td>
      </tr>`;
    })
    .join('');
  return wrapTable(`
    <table>
      <caption class="sr-only">Most common replies at ${escapeHtml(model.defaultBand)}</caption>
      <thead><tr><th scope="col">Move</th><th scope="col" class="num">Games</th><th scope="col" class="num">Played</th><th scope="col">Win / draw / loss</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`, `Most common replies at ${model.defaultBand}`);
}

function renderMistakesSection(model) {
  if (model.mistakes.length === 0) {
    return '<p class="empty-note">No move at this band is both common and clearly low-scoring, controlling for rating gap. Players at this rating aren&rsquo;t making an obvious mistake here.</p>';
  }
  const items = model.mistakes
    .map((m) => {
      const ci = renderCI({
        halfWidthPct: m.scoreCI, srLabel: `Score for ${model.opponentColor}, rating-gap-controlled`,
        lowPct: m.scoreCI != null ? Number((m.score - m.scoreCI).toFixed(1)) : null,
        highPct: m.scoreCI != null ? Number((m.score + m.scoreCI).toFixed(1)) : null,
        sampleSize: m.balancedGames,
      });
      const base = `<strong>${escapeHtml(m.san)}</strong> is played in ${formatPct(m.playedPct)}% of games here but scores only ${formatPct(m.score)}%${ci} for ${escapeHtml(model.opponentColor)} among games between similarly-rated opponents (rating gap &le;50).`;
      const follow = m.punishingReply
        ? ` After ${escapeHtml(m.san)}, <strong>${escapeHtml(m.punishingReply.san)}</strong> is the most common answer and scores ${m.punishingReply.winPct != null ? formatPct(m.punishingReply.winPct + m.punishingReply.drawPct / 2) : '?'}% for ${escapeHtml(model.side)}.`
        : '';
      return `<li class="callout">${base}${follow}</li>`;
    })
    .join('');
  return `<ul class="callout-list">${items}</ul>`;
}

/**
 * The Lichess Masters DB's own `name` field is inconsistently formatted
 * across games -- the SAME player appears as "Carlsen, Magnus" in one row
 * and "Carlsen, M." in another (a real, live-observed inconsistency, not a
 * hypothetical). Rather than guess a missing first name from an initial
 * (which would occasionally be wrong for a less-famous player), this keeps
 * only the one thing every variant already agrees on: the surname before
 * the first comma. A name with no comma at all (already just a surname, or
 * a single-word handle) passes through unchanged.
 */
function normalizeMasterName(name) {
  const commaIndex = name.indexOf(',');
  return commaIndex === -1 ? name : name.slice(0, commaIndex).trim();
}

function renderGameRows(games, { asMaster = false } = {}) {
  if (!games || games.length === 0) return null;
  return games
    .map((g) => {
      const white = g.white ? `${escapeHtml(asMaster ? normalizeMasterName(g.white.name) : g.white.name)} (${g.white.rating ?? '?'})` : 'White';
      const black = g.black ? `${escapeHtml(asMaster ? normalizeMasterName(g.black.name) : g.black.name)} (${g.black.rating ?? '?'})` : 'Black';
      const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '½-½';
      const link = g.id ? `https://lichess.org/${escapeHtml(g.id)}` : null;
      const dateNote = g.year ? `${g.year}` : '';
      return `<tr>
        <td>${white}</td>
        <td>${black}</td>
        <td>${result}</td>
        <td>${dateNote}</td>
        <td>${link ? `<a href="${link}" rel="noopener noreferrer">View game</a>` : '–'}</td>
      </tr>`;
    })
    .join('');
}

function renderGamesTable(games, caption, { asMaster = false } = {}) {
  const rows = renderGameRows(games, { asMaster });
  if (!rows) return '<p class="empty-note">No games available for this section yet.</p>';
  return wrapTable(`
    <table>
      <caption class="sr-only">${escapeHtml(caption)}</caption>
      <thead><tr><th scope="col">White</th><th scope="col">Black</th><th scope="col">Result</th><th scope="col">Year</th><th scope="col">Game</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`, caption);
}

/**
 * @param {object} opts
 * @param {object} opts.model output of processOpenings.buildOpeningModel
 * @param {object} opts.openingConfig the matching openings.js entry (for line/slug)
 * @param {object} opts.nav nav object for renderHeader (STATIC_NAV plus `openings`)
 * @param {Array<{label,href,note}>} [opts.related]
 * @param {{white:string, black:string}} [opts.repertoireLinks] filenames of
 *   the matching repertoire-<band>-<color>.html pages for "Build a
 *   repertoire from here"
 * @param {string} [opts.drillFile] filename of the matching opening-drill
 *   page (single-opening drill pilot). When present, a "Drill this opening"
 *   CTA section is emitted right after "The position"; when absent (every
 *   opening page except the pilot's), this function's output is byte-for-byte
 *   identical to before the drill pilot existed.
 * @param {object|null} [opts.manifest] same manifest object renderMethodologyPage
 *   takes (src/buildStatic.js: `aggregatesAvailable(dir) ? loadAggregates({dir}).manifest
 *   : null`) -- truthy iff THIS build actually ran on dump-sourced aggregates
 *   (src/explorerSource.js's DEFAULT_POOL = 'blitz', blitz only), falsy iff
 *   it's on the live-Explorer-API fallback (src/processRepertoire.js's
 *   DEFAULT_SPEEDS = ['blitz', 'rapid'], blended). Drives the data-source
 *   pool label below so it never claims a pool this build didn't actually
 *   use -- see the "blitz & rapid" label bug this param exists to fix
 *   (site-wide false claim on every opening page when aggregates data.json
 *   is present, since the deployed build always is).
 */
function renderOpeningPage({ model, openingConfig, nav, related = [], repertoireLinks = {}, drillFile = null, manifest = null }) {
  const line = openingConfig.line;
  const board = applyUciMoves(START_BOARD, line.map((p) => p.uci));
  const flip = openingConfig.side === 'black';
  const sanLine = formatSanLine(line);
  const mainBand = model.bands.find((b) => b.band === model.defaultBand) || model.bands[0];
  // Source-aware pool label, same branch renderMethodologyPage already uses
  // (this function's `manifest` param doc comment above). Literal &amp;
  // (not a raw &) in the blended-fallback case -- this string is
  // interpolated directly into the page subtitle below with no further
  // escaping pass (unlike sanLine/model.side right next to it, which go
  // through escapeHtml() at the call site), matching how every other static
  // entity in this codebase's templates (&mdash;, &rarr;, etc.) is written
  // pre-escaped inline.
  const poolLabel = manifest ? 'Lichess blitz games' : 'Lichess blitz &amp; rapid games';
  const totalGamesNote = mainBand && mainBand.games
    ? `data from ${mainBand.games.toLocaleString()} ${poolLabel} at ${escapeHtml(model.defaultBand)}`
    : `data from ${poolLabel}`;

  const title = pageTitle(`${model.name} (${model.eco}): Win Rates by Rating`);
  let description = mainBand && mainBand.scoreForSide != null
    ? `${model.name} (${sanLine}) scores ${formatPct(mainBand.scoreForSide)}% for ${model.side} across ${formatGamesAbbrev(mainBand.games)} Lichess games. Win rates, replies, and master games by rating.`
    : `${model.name} (${model.eco}): win rates, replies, and master games by rating band, from real Lichess data.`;
  // Meta descriptions must stay <=160 chars (spec 2.2) -- fall back to a
  // shorter form rather than truncate mid-sentence for the handful of
  // longer opening names/lines (e.g. "King's Indian Defense").
  if (description.length > 160) {
    description = mainBand && mainBand.scoreForSide != null
      ? `${model.name} scores ${formatPct(mainBand.scoreForSide)}% for ${model.side} across ${formatGamesAbbrev(mainBand.games)} Lichess games. Win rates, replies, and master games by rating.`
      : `${model.name} (${model.eco}): win rates and master games by rating band, from real Lichess data.`;
  }
  const canonical = absoluteUrl(`${openingConfig.slug}.html`);
  const openingFile = `${openingConfig.slug}.html`;
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'Openings', href: nav.openings }, { label: model.name, href: openingFile }];

  const repFile = repertoireLinks[openingConfig.side];

  // Computed as a variable (not an inline `${drillFile ? ... : ''}` in the
  // template below) specifically so the "no drill on this page" case
  // contributes NOTHING -- an inline empty ternary at an indented call
  // site, immediately followed by a blank template line for readability,
  // leaves a text node that is only whitespace before the next real line;
  // html-validate's no-trailing-whitespace flags exactly that. See
  // src/render.js's renderPageHead doc comment for the general form of
  // this same bug.
  const drillCtaHtml = drillFile
    ? `<section class="drill-cta">
      <h2>Drill this opening</h2>
      <p>Play the position out move by move and find out instantly whether you picked what players at your rating
        actually pick, and what that move scores.</p>
      <p><a href="${escapeHtml(drillFile)}">Open the Italian Game drill &rarr;</a></p>
    </section>

    `
    : '';

  // Same reasoning as drillCtaHtml just above: renderRelated() legitimately
  // returns '' when there's nothing related to show, and interpolating
  // that at an indented "    ${...}" template line -- immediately followed
  // by more literal content on the next line -- would leave a whitespace-
  // only line when it's empty.
  const relatedSection = renderRelated(related, 'Related openings');
  const relatedHtml = relatedSection ? `\n\n    ${relatedSection}` : '';

  // Site-audit fix: "Recent club games in this line" shipped as a
  // permanently-empty section on every page this build's own data pipeline
  // runs on -- model.recentGames flows through the aggregate-shaped
  // fetchMoves() (src/explorerSource.js), whose own doc comment discloses
  // that the dump aggregate stores position/move counts only, never
  // individual game records, so recentGames is always [] there (unlike
  // model.masterGames, a genuinely separate always-live masters-DB call
  // that does carry real per-game data). Hide the whole section rather
  // than show an empty table with a permanent "no games yet" note -- it
  // graduates back automatically the moment a live-Explorer-API build (no
  // aggregates on disk) or a future per-game aggregate ever populates it,
  // no further code change needed here.
  const recentGamesHtml = model.recentGames.length > 0
    ? `\n\n    <h2>Recent club games in this line</h2>
    <p>Recent rated games at ${escapeHtml(model.defaultBand)}: not model games, just what actually happens at that rating.</p>
    ${renderGamesTable(model.recentGames, 'Recent games in this line')}`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, ogType: 'article', jsonLd: breadcrumbJsonLd(breadcrumbItems) })}
<body>
<div class="page">
  ${renderHeader(nav, 'openings')}
  <main id="main-content">
    ${renderPageHead({
      breadcrumb: renderBreadcrumb(breadcrumbItems),
      title: `${displayName(model.name)} (${escapeHtml(model.eco)}): win rates at club level`,
      subtitle: `${escapeHtml(sanLine)}, playing as ${escapeHtml(model.side)}. ${totalGamesNote[0].toUpperCase()}${totalGamesNote.slice(1)}.`,
    })}

    <h2>The position</h2>
    <figure class="board-figure">
      ${renderBoard(board, { flip, label: `Position after ${sanLine}` })}
      <figcaption>Position after ${escapeHtml(sanLine)}.
        <a href="${lichessAnalysisUrl(line)}" rel="noopener noreferrer">Open this line on Lichess &rarr;</a> &middot;
        <a href="${lichessOpeningUrl(model.name)}" rel="noopener noreferrer">${displayName(model.name)} on Lichess</a>
      </figcaption>
    </figure>

    <h2>The idea</h2>
    <p>${displayName(openingConfig.strategy)}</p>

    ${drillCtaHtml}<h2>How it scores at your rating</h2>
    ${renderBandsTable(model)}

    <h2>What ${escapeHtml(model.opponentColor)} actually plays next</h2>
    <p>Top replies at ${escapeHtml(model.defaultBand)}:</p>
    ${renderTopRepliesTable(model)}

    <h2>Common mistakes at ${escapeHtml(model.defaultBand)}</h2>
    ${renderMistakesSection(model)}

    <h2>Model games</h2>
    <p>Real games from the Lichess masters database.</p>
    ${renderGamesTable(model.masterGames, 'Master games in this line', { asMaster: true })}${recentGamesHtml}

    <h2>Build a repertoire from here</h2>
    <p>See the full move tree for players in your rating band:
      ${repFile ? `<a href="${escapeHtml(repFile)}">${escapeHtml(model.defaultBand)} repertoire explorer (${escapeHtml(openingConfig.side)}) &rarr;</a>` : 'no repertoire explorer is published for this opening.'}
    </p>${relatedHtml}
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer</a> (lichess database, ${manifest ? 'blitz' : 'blitz + rapid'}), retrieved ${BUILD_DATE}. Master games from the Lichess masters database. ${pieceAttributionHtml()}`, CONTENT_LEGAL_LINKS)}
</div>
</body>
</html>
`;
}

/**
 * The confound-disclosure note spec WS-3.3 section 3.3 requires directly
 * adjacent to (never a footer/tooltip on) any cross-opening ranking table.
 * Written honestly against what's ACTUALLY controlled for today (Non-
 * Negotiable 5: never claim a control that wasn't applied) -- `usedBalanced`
 * (from processOpenings.js's rankOpeningsByScore) tells this function
 * whether ranking really did happen on the rating-gap-controlled subset, or
 * fell back to the uncontrolled all-games score because balanced data
 * wasn't available for this build (true of every ranking today, since real
 * balanced counts only exist once this site is sourced from
 * src/aggregateSource.js -- WS-3 B2's live ingest, not yet run).
 */
function selectionEffectNote(usedBalanced) {
  // class="confound-note", not "disclosure-note" -- this note renders
  // inside <main>, next to sibling paragraphs that all get their width
  // from the "main p" prose-measure rule (src/render.js). "disclosure-note"
  // carries its own, smaller max-width sized for the footer disclosure it
  // was originally written for; reusing it here squeezed this note into a
  // much narrower column than every other paragraph on the page. See
  // .confound-note's own comment in src/render.js for the full mechanism.
  return usedBalanced
    ? '<p class="confound-note">Ranked by score among games between similarly-rated opponents (rating gap &le;50), which removes the biggest confound in a raw comparison like this: players who choose one opening are not the same players who choose another, so a raw score difference partly reflects who tends to play each opening, not just how it performs. This ranking does not control for anything beyond that rating gap; time-control mix and how each player group prepares are still unmeasured. Rows too close to call given their own sample sizes share a rank.</p>'
    : '<p class="confound-note">This ranking uses each opening&rsquo;s all-games score. It does NOT control for who tends to choose each opening, which is a real confound in any cross-opening comparison like this one (players who pick one opening are not the same players who pick another). A rating-gap-controlled version of this ranking will replace it once this site is built from its own aggregate dataset rather than the live Lichess Explorer API. Rows too close to call given their own sample sizes share a rank.</p>';
}

/**
 * @param {Array<{openingConfig:object, model:object}>} entries
 * @param {object} opts
 * @param {object} opts.nav
 * @param {{href:string, familyCount:number, lineCount:number}} [opts.ecoIndexLink]
 *   Phase 7d: when given, adds a "Browse the full ECO index" card linking to
 *   the T2 family/ECO-code browse index -- optional and defaulted to
 *   nothing so a caller that hasn't built that index yet (or a test that
 *   doesn't pass it) renders byte-identical output to before Phase 7d.
 * @param {Array} [opts.ranked] processOpenings.js's rankOpeningsByScore(entries,
 *   '1600-1800') output -- when given, the compare table is sorted into
 *   real rank order (spec WS-3.3 section 3.3: rank on the balanced-subset
 *   score when available, all-games score alongside, ties sharing a rank,
 *   an inline confound note) instead of plain declaration order. Optional
 *   so a caller/test that predates this feature still renders.
 */
function renderOpeningsHub(entries, { nav, ecoIndexLink = null, ranked = null }) {
  const title = `Chess Openings by Real Win Rate | ${SITE_NAME}`;
  const description = `${entries.length} chess openings compared by real Lichess win rate, move-by-move, across four rating bands from 1400 to 2000+.`;
  const canonical = absoluteUrl('openings.html');
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'Openings', href: 'openings.html' }];

  const byslug = {};
  for (const e of entries) byslug[e.openingConfig.slug] = e;

  // rankOpeningsByScore() (src/processOpenings.js) deliberately drops any
  // opening whose band doesn't have enough games to print a confident
  // percentage (see that function's own doc comment) -- correct for the
  // ranking itself, but `ranked` is not the full opening list. Building
  // orderedEntries from `ranked` alone silently drops an under-sampled
  // opening from the table AND the card grid below, while the "Compare all
  // N openings" heading (which counts unfiltered `entries.length`) keeps
  // claiming the true total -- a real bug found in production (2026-08-16):
  // King's Indian Defense has genuinely too few games at every rating band
  // in this site's aggregate dataset, so it vanished from both, though
  // kings-indian-defense.html itself stayed live and linked from nowhere.
  // Fix: every entry appears -- ranked entries first, in rank order, then
  // any entry rankOpeningsByScore left out, in declaration order -- so an
  // under-sampled opening still gets a genuine, honestly-labeled row
  // ('n/a' score, real game count, real link; see the rankCell/scoreDisplay
  // fallback below, which already handled `r` being falsy before this fix)
  // instead of disappearing.
  const rankedSlugs = new Set((ranked || []).map((r) => r.slug));
  const orderedEntries = ranked
    ? [
        ...ranked.map((r) => byslug[r.slug]).filter(Boolean),
        ...entries.filter((e) => !rankedSlugs.has(e.openingConfig.slug)),
      ]
    : entries;

  const rankBySlug = {};
  if (ranked) for (const r of ranked) rankBySlug[r.slug] = r;

  // Site-audit item 8 (2026-08-26): the exact same per-row 1600-1800 game
  // counts the table below already shows, summed -- never a separate,
  // invented "X million games" headline figure. This is this specific
  // table's own real total, not a sitewide claim.
  const rankingsGamesTotal = orderedEntries.reduce((sum, { model }) => {
    const band = model.bands.find((b) => b.band === '1600-1800') || model.bands[0];
    return sum + (band ? band.games : 0);
  }, 0);

  const rows = orderedEntries
    .map(({ openingConfig, model }) => {
      const band = model.bands.find((b) => b.band === '1600-1800') || model.bands[0];
      const r = rankBySlug[openingConfig.slug];
      // Whether this ROW gets a rank cell (`r` truthy) is a different
      // question from whether the TABLE has a rank COLUMN at all (`ranked`
      // truthy -- see the header's own `ranked ? '<th ... class="num">#</th>'
      // : ''` a few lines below). Before this fix these were conflated: an
      // entry appended past the end of `ranked` (this fix's own
      // insufficient-data fallback, or any future caller) rendered zero
      // <td> for that column while the header still had one, silently
      // shifting every later cell in that row one column left. Emitting an
      // empty <td> here (rather than omitting the cell) keeps every row's
      // column count matching the header whenever the table has a rank
      // column at all.
      const rankCell = ranked ? `<td class="num">${r ? r.rank : ''}</td>` : '';
      const scoreDisplay = r && r.usedBalanced && r.scoreForSideBalanced != null
        ? `${formatPct(r.scoreForSideBalanced)}%${renderCI({ halfWidthPct: r.scoreForSideBalancedCI, srLabel: 'Rating-gap-controlled score', lowPct: r.scoreForSideBalancedCI != null ? Number((r.scoreForSideBalanced - r.scoreForSideBalancedCI).toFixed(1)) : null, highPct: r.scoreForSideBalancedCI != null ? Number((r.scoreForSideBalanced + r.scoreForSideBalancedCI).toFixed(1)) : null, sampleSize: band ? band.balancedGames || 0 : 0 })} <span class="rep-pct">(${formatPct(band ? band.scoreForSide : null)}% all games)</span>`
        : band && band.scoreForSide != null
          ? `${formatPct(band.scoreForSide)}%${renderCI({ halfWidthPct: band.scoreForSideCI, srLabel: 'Score', lowPct: band.scoreForSideCI != null ? Number((band.scoreForSide - band.scoreForSideCI).toFixed(1)) : null, highPct: band.scoreForSideCI != null ? Number((band.scoreForSide + band.scoreForSideCI).toFixed(1)) : null, sampleSize: band.games })}`
          : 'n/a';
      return `<tr>
        ${rankCell}
        <td><a href="${escapeHtml(openingConfig.slug)}.html">${displayName(model.name)}</a></td>
        <td>${escapeHtml(model.eco)}</td>
        <td>${escapeHtml(formatSanLine(openingConfig.line))}</td>
        <td class="num">${band ? band.games.toLocaleString() : '–'}</td>
        <td class="num">${scoreDisplay}</td>
      </tr>`;
    })
    .join('');

  const usedBalanced = !!(ranked && ranked.length > 0 && ranked[0].usedBalanced);
  const confoundNote = ranked ? selectionEffectNote(usedBalanced) : '';

  // Same reasoning as drillCtaHtml/relatedSection and renderOpeningStatCard's
  // scoreLine above: ecoIndexLink is legitimately null for a caller/test
  // that predates Phase 7d, and interpolating '' at its own indented
  // template line below would leave a whitespace-only line that
  // html-validate's no-trailing-whitespace rule flags -- pre-existing gap,
  // not reachable from the real production build (buildStatic.js always
  // passes a real ecoIndexLink), but worth closing while this exact
  // function is already being edited.
  const ecoIndexSection = ecoIndexLink
    ? `\n\n    <h2>Browse the Chess Opening Encyclopedia</h2>
    <p class="repertoire-intro">Every one of the ${ecoIndexLink.lineCount.toLocaleString()} named lines in the standard Encyclopaedia of Chess Openings
       classification, grouped into ${ecoIndexLink.familyCount} opening families.
       <a href="${escapeHtml(ecoIndexLink.href)}">Browse the Chess Opening Encyclopedia &rarr;</a></p>`
    : '';

  // Every card below carries its 1600-1800 WDL bar (renderOpeningStatCard,
  // defined above) -- same fallback-to-plain-card rule as the homepage's
  // equivalent list, never an approximated number. showScoreLine: false
  // because this grid sits directly under the ranked table above, which
  // already states each opening's exact score and game count -- see the
  // showScoreLine doc comment for why the WDL bar itself stays (a
  // genuinely different win/draw/loss presentation, not a repeat).
  const cards = orderedEntries
    .map(({ openingConfig, model }) => renderOpeningStatCard(openingConfig, model, '', { showScoreLine: false }))
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd: breadcrumbJsonLd(breadcrumbItems) })}
<body>
<div class="page">
  ${renderHeader(nav, 'openings')}
  <main id="main-content">
    ${renderBreadcrumb(breadcrumbItems)}
    <h1 class="page-title">Chess openings by real win rate</h1>
    <p class="subtitle">Ranked by the score each opening actually gets for its own side in real Lichess games at
      1600-1800. Sample size is shown for every row: a rate over a small sample is not a signal. Want just two side
      by side? Try the <a href="compare-openings.html">Compare Openings tool &rarr;</a>. Want the full move tree
      for your own rating band instead? Try the <a href="${escapeHtml(nav.repertoire)}">Repertoire Explorer &rarr;</a>.</p>
    <p class="article-meta">Data last updated ${BUILD_DATE}, sourced from ${rankingsGamesTotal.toLocaleString()} real Lichess games (1600-1800).</p>

    <h2>Compare all ${entries.length} openings</h2>
    ${confoundNote}
    ${wrapTable(`
      <table>
        <caption class="sr-only">Opening comparison at 1600-1800</caption>
        <thead>
          <tr>${ranked ? '<th scope="col" class="num">#</th>' : ''}<th scope="col">Opening</th><th scope="col">ECO</th><th scope="col">First moves</th><th scope="col" class="num">Games (1600-1800)</th><th scope="col" class="num">Score for its side</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`, 'Opening comparison at 1600-1800')}

    <h2>Browse by opening</h2>
    <p class="repertoire-intro">The same openings, as their win / draw / loss split at 1600-1800. Open a card to see the full move-by-move breakdown.</p>
    <div class="card-grid">${cards}</div>${ecoIndexSection}
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer</a>, retrieved ${BUILD_DATE}.`, CONTENT_LEGAL_LINKS)}
</div>
</body>
</html>
`;
}

/**
 * Full page wrapper for one editorial guide/article (phase 2). The article's
 * OWN markup (headings, tables, callouts -- all built from real computed
 * data, see src/content/*.js) is passed in pre-rendered as `bodyHtml`; this
 * function only owns the shared document chrome (head/nav/breadcrumb/
 * dateline/footer), same division of labor as renderOpeningPage.
 *
 * Emits BreadcrumbList and Article JSON-LD (phase 3). Article's `author`
 * comes from src/site.js's SITE_AUTHOR, which is the site name as an
 * Organization -- never an invented person (see that file's own comment).
 * `meta.datePublished`/BUILD_DATE map to Article's datePublished/dateModified.
 *
 * @param {object} opts
 * @param {{slug:string, title:string, description:string, datePublished:string}} opts.meta
 * @param {string} opts.bodyHtml pre-rendered article content (inside <article class="prose">)
 * @param {object} opts.nav nav object for renderHeader (STATIC_NAV plus `guides`/`faq`)
 * @param {Array<{label,href,note}>} [opts.related]
 */
function renderArticlePage({ meta, bodyHtml, nav, related = [] }) {
  const title = pageTitle(meta.title);
  const canonical = absoluteUrl(`${meta.slug}.html`);
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'Guides', href: nav.guides }, { label: meta.title, href: `${meta.slug}.html` }];
  const jsonLd = [
    breadcrumbJsonLd(breadcrumbItems),
    articleJsonLd({
      headline: meta.title,
      description: meta.description,
      datePublished: meta.datePublished,
      dateModified: BUILD_DATE,
      url: canonical,
      authorName: SITE_AUTHOR,
      publisherName: SITE_NAME,
    }),
  ].join('\n  ');

  // See renderOpeningPage's relatedHtml (above) for why this is precomputed
  // rather than interpolated inline: renderRelated() can legitimately
  // return '', and this function's own leading indentation carries the
  // "\n    " prefix instead of the template site, so an empty result
  // contributes nothing (not a whitespace-only line).
  const relatedSection = renderRelated(related, 'Related');
  const relatedHtml = relatedSection ? `\n    ${relatedSection}` : '';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description: meta.description, canonical, ogType: 'article', jsonLd })}
<body>
<div class="page">
  ${renderHeader(nav, 'guides')}
  <main id="main-content">
    ${renderBreadcrumb(breadcrumbItems)}
    <article class="prose">
      <h1 class="page-title">${escapeHtml(meta.title)}</h1>
      <p class="article-meta">Published ${escapeHtml(meta.datePublished)} &middot; data refreshed ${BUILD_DATE}.</p>
      ${bodyHtml.trim()}
    </article>${relatedHtml}
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer</a>, retrieved ${BUILD_DATE}. This article is written to reflect that data, not as a substitute for a coach&rsquo;s judgment about your own games.`, CONTENT_LEGAL_LINKS)}
</div>
</body>
</html>
`;
}

/**
 * Site-audit item 6 (2026-08-26): pure routing, no new
 * content -- every linked guide below is already one of the GUIDES entries
 * src/buildContent.js always builds (best-chess-openings-for-beginners and
 * most-common-opening-mistakes-1400-1600 come from that file's own factory
 * calls; aggressive-vs-positional-openings and rapid-chess-opening-prep are
 * two of its hand-authored entries), so this never links a page that
 * doesn't exist. 1400-1600 gets the beginner/mistake-analysis pair per the
 * task's own wording; 1800+ gets the style-matching (aggressive vs.
 * positional) and prep-budgeting (rapid-chess-opening-prep's own
 * description literally says "a practical prep budget") pair.
 */
function startHereForRatingBanner() {
  return `<div class="callout" id="start-here-for-your-rating">
    <h2>Start here for your rating</h2>
    <p>New or under 1600? <a href="best-chess-openings-for-beginners.html">Best chess openings for beginners &rarr;</a> &middot; <a href="most-common-opening-mistakes-1400-1600.html">The most common opening mistakes at 1400-1600 &rarr;</a></p>
    <p>1800 and up? <a href="aggressive-vs-positional-openings.html">Aggressive vs. positional openings &rarr;</a> &middot; <a href="rapid-chess-opening-prep.html">Rapid chess opening prep &rarr;</a></p>
  </div>`;
}

/**
 * @param {Array<{slug:string, title:string, description:string}>} articles
 * @param {object} opts
 * @param {object} opts.nav
 */
function renderGuidesHub(articles, { nav }) {
  const title = `Chess Opening Guides, Backed by Real Data | ${SITE_NAME}`;
  const description = `${articles.length} data-grounded guides on opening choice, common mistakes, and rating-band trends, backed by real Lichess Opening Explorer numbers.`;
  const canonical = absoluteUrl('guides.html');
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'Guides', href: 'guides.html' }];

  const cards = articles
    .map(
      (a) => `<div class="card card--nav"><h3><a href="${escapeHtml(a.slug)}.html">${escapeHtml(a.title)}</a></h3><p>${escapeHtml(a.description)}</p></div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd: breadcrumbJsonLd(breadcrumbItems) })}
<body>
<div class="page">
  ${renderHeader(nav, 'guides')}
  <main id="main-content">
    ${renderBreadcrumb(breadcrumbItems)}
    <h1 class="page-title">Chess opening guides</h1>
    <p class="subtitle">${articles.length} articles, each grounded in this site&rsquo;s own Lichess Opening Explorer data.</p>
    ${startHereForRatingBanner()}
    <h2>Every guide</h2>
    <div class="card-grid">${cards}</div>
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer</a>, retrieved ${BUILD_DATE}.`, CONTENT_LEGAL_LINKS)}
</div>
</body>
</html>
`;
}

/**
 * @param {object} opts
 * @param {Array<{question:string, answerHtml:string}>} opts.faqs `answerHtml`
 *   is already-escaped/pre-built markup (may include internal links), never
 *   raw user input.
 * @param {object} opts.nav
 */
function renderFaqPage({ faqs, nav }) {
  const title = `Chess Opening FAQ: Data-Backed Answers | ${SITE_NAME}`;
  const description = 'Plain-language answers about chess openings, ECO codes, and how to read Lichess Opening Explorer data - grounded in this site\'s own numbers where possible.';
  const canonical = absoluteUrl('chess-opening-faq.html');
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'FAQ', href: 'chess-opening-faq.html' }];
  // FAQPage JSON-LD lives ONLY on this page, never bolted onto any other --
  // FAQ rich results were removed by Google on 2026-05-07, so this is for
  // parsing value only, not a SERP-feature bet.
  const jsonLd = [breadcrumbJsonLd(breadcrumbItems), faqPageJsonLd(faqs)].join('\n  ');

  const items = faqs.map((f) => `<h2>${escapeHtml(f.question)}</h2>${f.answerHtml}`).join('');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd })}
<body>
<div class="page">
  ${renderHeader(nav, 'faq')}
  <main id="main-content">
    ${renderBreadcrumb(breadcrumbItems)}
    <h1 class="page-title">Chess opening FAQ</h1>
    <p class="subtitle">Plain answers, most of them backed directly by this site&rsquo;s own Lichess data.</p>
    <div class="prose">${items}</div>
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer</a>, retrieved ${BUILD_DATE}.`, CONTENT_LEGAL_LINKS)}
</div>
</body>
</html>
`;
}

/**
 * /methodology.html -- the public page documenting exactly how every
 * displayed rate on this site is computed (spec WS-3.3 section 3.5, all 7
 * required sections). Renders from LIVE values (the manifest, when this
 * build is sourced from src/aggregateSource.js; MISTAKE_THRESHOLDS'
 * actual numbers either way) rather than retyping a number into prose, per
 * the spec's explicit instruction -- and is honest about which data source
 * this SPECIFIC build actually used (Non-Negotiable 1/5): describing an
 * aspirational dump pipeline as live when a build is still running on the
 * live Explorer-API fallback would itself be exactly the false-precision
 * problem this page exists to prevent.
 *
 * @param {object} opts
 * @param {object} opts.nav
 * @param {object|null} [opts.manifest] data/aggregates/manifest.json's
 *   parsed contents, when this build is sourced from the dump pipeline --
 *   null when it isn't (today's actual production state, pending WS-3 B2's
 *   human-gated first live ingest).
 * @param {{minPlayedPct:number, minBalancedN:number, limit:number}} opts.thresholds
 *   processOpenings.js's MISTAKE_THRESHOLDS, passed in rather than imported
 *   here to keep this module's existing "renderContent.js doesn't import
 *   processOpenings.js" boundary (buildContent.js orchestrates, this module
 *   only renders what it's handed).
 * @param {number} [opts.minGamesForPct] processOpenings.js's minGamesForPct
 *   default (1000) -- the number every band-level percentage is suppressed
 *   below.
 * @param {number} [opts.balancedEloWindow] src/ingest/gameFilter.js's
 *   BALANCED_ELO_WINDOW (50) -- the rating-gap cutoff for the "balanced"
 *   subset every rating-diff control on this site uses.
 */
function renderMethodologyPage({ nav, manifest = null, thresholds, minGamesForPct = 1000, balancedEloWindow = 50 }) {
  const title = pageTitle('Methodology: How Opening Stats Are Computed');
  const description = 'How Repertoire Builder computes opening win rates: sample sizes, confidence intervals, rating-diff controls, and what is not controlled for.';
  const canonical = absoluteUrl('methodology.html');
  const breadcrumbItems = [{ label: 'Home', href: nav.home }, { label: 'Methodology', href: 'methodology.html' }];

  const datasetName = 'Repertoire Builder opening aggregate dataset';
  const datasetDescription = manifest
    ? `Position and move aggregates computed from Lichess database dump(s) ${(manifest.dumpMonths || []).join(', ')}, ${(manifest.gamesUsed || 0).toLocaleString()} games used.`
    : 'Position and move aggregates computed from the live Lichess Opening Explorer API (blitz + rapid, keyless).';
  const jsonLd = [
    breadcrumbJsonLd(breadcrumbItems),
    articleJsonLd({
      headline: 'How Repertoire Builder computes its numbers',
      description,
      datePublished: manifest && manifest.retrievedAt ? manifest.retrievedAt.slice(0, 10) : BUILD_DATE,
      dateModified: BUILD_DATE,
      url: canonical,
      authorName: SITE_AUTHOR,
      publisherName: SITE_NAME,
    }),
    datasetJsonLd({
      name: datasetName,
      description: datasetDescription,
      url: canonical,
      license: 'http://creativecommons.org/publicdomain/zero/1.0/',
      temporalCoverage: manifest && manifest.observedGameDateRange ? manifest.observedGameDateRange : undefined,
    }),
  ].join('\n  ');

  // Section 1: where the numbers come from -- branches honestly on whether
  // THIS build actually ran on dump-sourced aggregates or is still on the
  // live-Explorer-API fallback (see this function's own doc comment).
  const sourceSection = manifest
    ? `<p>Every win/draw/loss number on this site is computed from Lichess&rsquo;s own published database dumps (<a href="https://database.lichess.org" rel="noopener noreferrer">database.lichess.org</a>), released under a CC0 public-domain dedication, free to use for any purpose. Attribution here is included as a courtesy.</p>
      <p>This build used ${escapeHtml((manifest.dumpMonths || []).join(', ') || 'an unspecified month')}. A full month&rsquo;s dump is tens of gigabytes; this pipeline reads a BOUNDED PREFIX of it (not the whole month) to stay within GitHub Actions&rsquo; free runner limits and to keep bandwidth use to the Lichess database modest. The games actually observed in this build span ${manifest.observedGameDateRange ? `${escapeHtml(manifest.observedGameDateRange[0])} to ${escapeHtml(manifest.observedGameDateRange[1])}` : 'a date range not recorded in this build'}: the start of the month, not the whole month, which is a real bias this page states outright rather than hiding. Games later in the month are systematically absent from this sample.</p>
      <p>${(manifest.gamesScanned || 0).toLocaleString()} games were scanned; ${(manifest.gamesUsed || 0).toLocaleString()} were used after filtering. Retrieved ${escapeHtml((manifest.retrievedAt || '').slice(0, 10) || BUILD_DATE)}.</p>`
    : `<p>This build&rsquo;s numbers are computed from the live <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer API</a> (the same public, keyless database Lichess itself exposes), retrieved at build time on ${escapeHtml(BUILD_DATE)}. Lichess&rsquo;s underlying game data is released under a CC0 public-domain dedication (<a href="https://database.lichess.org" rel="noopener noreferrer">database.lichess.org</a>); attribution here is included as a courtesy.</p>
      <p>This site is migrating to compute the same numbers directly from Lichess&rsquo;s own published monthly database dumps instead of live API calls, which will additionally unlock the rating-gap-controlled (&ldquo;balanced&rdquo;) figures described in this page&rsquo;s later sections. That migration&rsquo;s first live data run has not happened yet as of this build. This page will update to name the exact month(s) and observed date range once it has.</p>`;

  const bucketingSection = `<p>Games are grouped by <strong>rating band</strong>, using the average of both players&rsquo; ratings at the time of the game. That is the same bucketing the Lichess Opening Explorer itself uses, which keeps this site&rsquo;s numbers comparable to it. Bands shown on this site run 1400-1600 through 2000+.</p>
    <p>Games are also grouped by <strong>time-control pool</strong>: this site&rsquo;s default, and the number shown unless you pick another, is blitz. Correspondence games are excluded outright: a correspondence game (played over days, often with opening-book assistance) is a genuinely different population from a live blitz or rapid game, and folding it into &ldquo;what players at your rating play&rdquo; would misstate what the number means.</p>
    <p>A second, narrower subset, <strong>balanced</strong> games, where both players&rsquo; ratings are within ${balancedEloWindow} points of each other, powers every rating-gap-controlled figure on this site (see &ldquo;What we do not control for&rdquo; and &ldquo;How &lsquo;common mistake&rsquo; is defined&rdquo; below). A lopsided-rating game tells you less about how an opening performs between evenly-matched opponents, which is the comparison a &ldquo;common mistake&rdquo; claim actually needs.</p>`;

  const computationSection = `<p>Two different quantities are shown on this site, and they use two different formulas because they measure genuinely different things:</p>
    <ul>
      <li><strong>Win / draw / loss rate</strong> is a proportion (how many of these games ended this way), shown with a <a href="https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval" rel="noopener noreferrer">Wilson score interval</a>, which stays accurate at small sample sizes and near 0% or 100%, unlike the naive normal-approximation interval most simple stats tools use.</li>
      <li><strong>Score</strong> (the standard chess-scoring convention: a win counts 1, a draw counts 0.5) is the MEAN of a value that can be 0, 0.5, or 1 for each game. It is not a proportion, so it uses a different formula (a trinomial-variance confidence interval), not the Wilson interval. Applying the Wilson formula to a mean would produce a confidence interval that looks precise but is mathematically wrong for this quantity.</li>
    </ul>
    <p>Every rate and score on this site that has enough games to trust carries its 95% confidence interval as a small &ldquo;&plusmn;&rdquo; figure next to the number, and a screen-reader-only sentence spelling out the full interval and sample size. A row whose interval half-width is 1.0 percentage point or wider, wide enough that it could change how you&rsquo;d read the number, carries a visible &ldquo;wide interval, small sample&rdquo; note as well.</p>
    <p>Below ${minGamesForPct.toLocaleString()} games at a given rating band, this site shows no percentage at all for that band, rather than a number computed from too small a sample to mean anything.</p>`;

  const uncontrolledSection = `<p>Stated plainly:</p>
    <ul>
      <li><strong>Selection effects on cross-opening comparisons.</strong> When two different openings are compared by score, the players who choose each one are not the same players. A raw score difference partly reflects who tends to play each opening, not just how the opening performs. This site&rsquo;s cross-opening rankings rank on the ${balancedEloWindow}-rating-point-gap-controlled subset where that data is available, which removes the largest single confound, but does not remove every one (see below).</li>
      <li><strong>Time-control mix within a pool.</strong> &ldquo;Blitz&rdquo; on Lichess spans a range of actual time controls; this site does not further split by exact clock setting.</li>
      <li><strong>The prefix-sampling date window</strong> (see &ldquo;Where the numbers come from&rdquo; above), on any build sourced from a dump rather than the live API.</li>
      <li><strong>A rating band is not a skill band.</strong> Two players with the same rating can have very different actual chess understanding; rating is a real, useful, but imperfect proxy.</li>
    </ul>`;

  const mistakeSection = `<p>A move is flagged as a &ldquo;common mistake&rdquo; only when ALL FOUR of these hold, using this build&rsquo;s live threshold values:</p>
    <ol>
      <li><strong>Frequency:</strong> played in at least ${thresholds.minPlayedPct}% of games at the displayed band.</li>
      <li><strong>Rating-diff control:</strong> scored on the balanced (rating gap &le;${balancedEloWindow}) subset, not all games, and only when that subset has at least ${thresholds.minBalancedN} games. Below that, the move isn&rsquo;t flagged at all, rather than falling back to an uncontrolled number.</li>
      <li><strong>Statistical significance:</strong> the move&rsquo;s own confidence interval must sit entirely below the surrounding position&rsquo;s confidence interval. A move that merely scores a little lower than average is not flagged; one whose deficit survives its own error bar is.</li>
      <li><strong>Transposition check:</strong> the position the move leads to, merged across every move order that reaches it, since this site keys its data by chess position rather than by move sequence, must ALSO score below the surrounding position&rsquo;s confidence interval. This stops a move from being flagged just because it reaches a perfectly healthy position by an unusual order.</li>
    </ol>
    <p>This is deliberately conservative: it flags fewer moves than a simpler &ldquo;plays often, low score&rdquo; rule would, and an opening with no qualifying mistake shows an honest empty state rather than a loosened threshold to fill space.</p>`;

  const changeSection = `<p>This site is rebuilt periodically from fresh data, not updated in real time between rebuilds. Once this site is sourced from Lichess&rsquo;s database dumps, the refresh cadence is monthly, and any page displaying a number reads it from this build&rsquo;s manifest. A build fails outright rather than shipping a number whose source data is more than 100 days old, so a number on this site is never silently stale past that point.</p>`;

  const correctionsSection = `<p>If you find a number on this site that looks wrong, the <a href="contact.html">contact page</a> is the way to reach us. A confirmed error is corrected in the next rebuild, and a materially wrong published figure is noted rather than silently replaced.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, ogType: 'article', jsonLd })}
<body>
<div class="page">
  ${renderHeader(nav, null)}
  <main id="main-content">
    ${renderBreadcrumb(breadcrumbItems)}
    <article class="prose">
      <h1 class="page-title">How Repertoire Builder computes its numbers</h1>
      <p class="subtitle">Every number on this site links here. This page is the full, honest account, including what it does not control for.</p>

      <section>
        <h2>Where the numbers come from</h2>
        ${sourceSection}
      </section>

      <section>
        <h2>How games are bucketed</h2>
        ${bucketingSection}
      </section>

      <section>
        <h2>How rates are computed</h2>
        ${computationSection}
      </section>

      <section>
        <h2>What we do not control for</h2>
        ${uncontrolledSection}
      </section>

      <section>
        <h2>How &ldquo;common mistake&rdquo; is defined</h2>
        ${mistakeSection}
      </section>

      <section>
        <h2>What would change a number</h2>
        ${changeSection}
      </section>

      <section>
        <h2>Corrections policy</h2>
        ${correctionsSection}
      </section>
    </article>
  </main>
  ${renderFooter(`Methodology retrieved ${BUILD_DATE}. ${pieceAttributionHtml()}`, CONTENT_LEGAL_LINKS)}
</div>
</body>
</html>
`;
}

module.exports = {
  renderBoard,
  renderBreadcrumb,
  renderRelated,
  renderOpeningStatCard,
  renderOpeningPage,
  renderOpeningsHub,
  renderArticlePage,
  renderGuidesHub,
  renderFaqPage,
  renderMethodologyPage,
  formatSanLine,
  formatGamesAbbrev,
  lichessAnalysisUrl,
  lichessOpeningUrl,
  // Exported for src/renderEcoPages.js (Phase 7d family hub pages), which
  // needs the exact same win/draw/loss-bar and 4-band table markup this
  // module already builds for a T0 opening page -- previously private to
  // this file, now shared so the two tiers can never render that number
  // two different ways.
  wdlBar,
  renderBandsTable,
  // Exported for direct unit tests (site-audit fix, 2026-08-29): both were
  // previously private-to-this-file, only exercised indirectly through a
  // full renderOpeningPage() call, which made it easy for the
  // once-per-row/real-threshold regression this fix corrects to go
  // unnoticed by the test suite in the first place.
  renderTopRepliesTable,
  wideIntervalNote,
};
