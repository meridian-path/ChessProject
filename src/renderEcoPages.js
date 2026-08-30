'use strict';

/**
 * Markup for the ECO-coded content tiers: T1 family hub pages (one per
 * opening family with >=8 lines, ~64 of them) and T2 ECO volume/browse
 * index pages. Same
 * server-only division of labor as src/renderContent.js (may require()
 * Node/site modules freely -- never bundled into the browser).
 *
 * Deliberately reuses src/renderContent.js's existing document chrome
 * (renderBreadcrumb/renderRelated/renderBandsTable/wdlBar/renderBoard) and
 * src/render.js's shared header/footer/table helpers rather than
 * reinventing them -- one visual language across T0/T1/T2, per
 * design-standards.md's "conform at the interaction layer" rule.
 */

const { escapeHtml, displayName, renderDocumentHead, renderHeader, renderFooter, renderPageHead, wrapTable } = require('./render');
const { START_BOARD, applyUciMoves } = require('./chessPosition');
const { SITE_NAME, BUILD_DATE, absoluteUrl, pageTitle } = require('./site');
const { breadcrumbJsonLd, itemListJsonLd, definedTermSetJsonLd } = require('./structuredData');
const { pieceAttributionHtml } = require('./boardSvg');
const {
  renderBoard,
  renderBreadcrumb,
  renderRelated,
  renderBandsTable,
  formatSanLine,
  lichessAnalysisUrl,
  lichessOpeningUrl,
} = require('./renderContent');
const { buildVariationTree, familyHubFilename } = require('./ecoFamilies');

// Standard ECO (Encyclopaedia of Chess Openings) volume descriptions -- the
// same five-way split the classification itself has used since its first
// print edition; not this project's own invention. Source A's own
// data (data/eco/lichess-chess-openings/{a..e}.tsv) is already split along
// exactly this boundary, one file per volume.
const VOLUME_LABELS = {
  A: 'Flank Openings',
  B: 'Semi-Open Games (other than the French Defense)',
  C: 'Open Games and the French Defense',
  D: 'Closed Games and Semi-Closed Games',
  E: 'Indian Defenses',
};

// Short form of VOLUME_LABELS, <title> only (buildContent.js's
// assertPageMetadata enforces a 70-char decoded-title cap, and volume B/C/D's
// full descriptive labels above don't fit alongside "ECO Volume X: " and the
// " | Repertoire Builder" suffix). On-page prose (h1, subtitle, table
// captions) always uses the full VOLUME_LABELS text -- only <title>/breadcrumb
// use this shortened form.
const VOLUME_LABELS_SHORT = {
  A: 'Flank Openings',
  B: 'Semi-Open Games',
  C: 'Open Games & French Defense',
  D: 'Closed & Semi-Closed Games',
  E: 'Indian Defenses',
};

const ECO_INDEX_FILE = 'eco-openings.html';

// Must match src/renderEcoExplorerPage.js's own ECO_EXPLORER_FILE constant
// exactly -- not imported directly to avoid a circular require (that module
// already requires THIS one, for ecoVolumeFilename/ECO_INDEX_FILE), same
// "kept in sync by comment" precedent as src/renderContent.js's
// CONTENT_LEGAL_LINKS / src/buildStatic.js's LEGAL_LINKS.
const ECO_EXPLORER_FILE = 'eco-explorer.html';
const ECO_LEGAL_LINKS = { privacy: 'privacy.html', about: 'about.html', contact: 'contact.html', methodology: 'methodology.html', faq: 'chess-opening-faq.html' };

function ecoVolumeFilename(volume) {
  return `eco-volume-${volume.toLowerCase()}.html`;
}

function ecoIndexPageFilename(pageNum) {
  return pageNum <= 1 ? ECO_INDEX_FILE : `eco-openings-${pageNum}.html`;
}

/** ECO code range label, e.g. "B20" for one code or "B20–B99" for a span. */
function ecoRangeLabel(ecoCodes) {
  if (ecoCodes.length === 1) return ecoCodes[0];
  return `${ecoCodes[0]}–${ecoCodes[ecoCodes.length - 1]}`;
}

/**
 * One dataset row's own row markup: an ECO chip + full SAN move text,
 * optionally prefixed with a label (used when more than one line shares a
 * node -- see renderVariationTreeNode below -- so each transposition is
 * still individually identifiable by its own move order).
 *
 * The label and move text are separate flex children (`.rep-node-row` is
 * `display: flex` with its own `gap`, src/render.js) rather than one span
 * joined by a text separator -- a family with hundreds of named lines (e.g.
 * Sicilian Defense, 391 rows) repeated a textual "label -- moves" em-dash
 * separator once per row, which was the single largest source of
 * scripts/emDashDensity.js's site-wide failures: not prose style, a UI
 * separator character reused at row-per-line scale. No separator character
 * is needed at all once label/moves are distinct elements -- same
 * convention this row already uses for the eco-chip span.
 */
function renderLineRow(line, label) {
  const labelHtml = label ? `<span class="rep-node-label">${displayName(label)}</span>` : '';
  return `<div class="rep-node-row"><span class="eco-chip">${escapeHtml(line.eco)}</span>${labelHtml}<span>${escapeHtml(formatSanLine(line.plies))}</span></div>`;
}

/**
 * Recursively renders one ecoFamilies.buildVariationTree() node: one row
 * per line in `node.lines` (a node can carry more than one -- the vendored
 * dataset documents that "multiple entries may exist for one opening so
 * common transpositions resolve", e.g. two different move orders both
 * named "Sicilian Defense: Smith-Morra Gambit"), or a plain group label
 * when it's a pure grouping node with no line of its own -- plus a nested
 * <ul class="repertoire-tree"> for its children. Extends the site's
 * existing repertoire-tree markup/CSS (src/render.js) rather than
 * inventing a second tree component (design-standards.md 5.2.2). No link
 * on any row: no per-line page exists yet (that's a future interactive ECO
 * explorer, not yet built), so this never renders a link to a page that
 * doesn't exist.
 */
function renderVariationTreeNode(node) {
  const rowsHtml = node.lines.length > 0
    ? node.lines.map((line) => renderLineRow(line, node.label)).join('')
    : `<p class="variation-group-label">${displayName(node.label)}</p>`;
  const children = [...node.children.values()];
  const childrenHtml = children.length > 0
    ? `<ul class="repertoire-tree">${children.map((c) => `<li>${renderVariationTreeNode(c)}</li>`).join('')}</ul>`
    : '';
  return `${rowsHtml}${childrenHtml}`;
}

/**
 * @param {object} familyEntry ecoFamilies.buildFamilyIndex() entry
 * @returns {string} `<ul class="repertoire-tree">...</ul>` covering every
 *   one of the family's lines -- the family's own root-level line(s) (if
 *   any) first, un-indented, then every deeper variation group.
 */
function renderVariationTree(familyEntry) {
  const tree = buildVariationTree(familyEntry.lines);
  const rootItems = tree.lines
    .map((line) => `<li>${renderLineRow(line, `${familyEntry.family} (main line)`)}</li>`)
    .join('');
  const children = [...tree.children.values()];
  const childItems = children.map((c) => `<li>${renderVariationTreeNode(c)}</li>`).join('');
  return `<ul class="repertoire-tree">${rootItems}${childItems}</ul>`;
}

/**
 * T1: one family hub page. Board diagram + 4-band stats are for the
 * family's MAIN LINE ONLY -- the full variation tree below it is built
 * entirely from the CC0 vendored dataset, zero additional Explorer
 * requests per variation.
 *
 * @param {object} opts
 * @param {object} opts.familyEntry ecoFamilies.buildFamilyIndex() entry
 * @param {{side:string, bands:Array}} opts.bandStats processEcoFamilies.buildFamilyBandStats() output
 * @param {object} opts.nav
 * @param {{label:string, href:string}|null} [opts.t0CrossLink] this family's
 *   matching T0 deep-dive opening page, when one exists by exact name match
 *   (src/openings.js) -- omitted (no section rendered) otherwise.
 * @param {{label:string, href:string, note:string}|null} [opts.drillCrossLink]
 *   this family's matching opening drill, when one exists (site-audit item 5,
 *   2026-08-26) -- omitted otherwise, never a fabricated link.
 * @param {Array<{label:string, href:string}>} [opts.relatedFamilies] up to 3
 *   sibling T1 family hubs.
 * @param {string} [opts.mainLineSide] overrides familyEntry.mainLineSide --
 *   src/buildEcoPages.js's resolveMainLineSide() passes openings.js's own
 *   curated `side` here for the 8 T0-overlapping families (see that
 *   function's own comment for why the raw heuristic needs one override).
 * @param {boolean} [opts.noindex] set by src/buildEcoPages.js when this
 *   family's main line has too few games at every rating band -- see that
 *   call site's own comment for why.
 */
function renderFamilyHubPage({ familyEntry, bandStats, nav, t0CrossLink = null, drillCrossLink = null, relatedFamilies = [], mainLineSide = familyEntry.mainLineSide, noindex = false, strategy = '' }) {
  const { family, mainLine, ecoCodes, lineCount, volumes } = familyEntry;
  const filename = familyHubFilename(familyEntry.slug);
  const primaryVolume = mainLine.eco[0];
  const board = applyUciMoves(START_BOARD, mainLine.plies.map((p) => p.uci));
  const flip = mainLineSide === 'black';
  const sanLine = formatSanLine(mainLine.plies);

  // Three-tier fallback, same reasoning as src/renderContent.js's
  // renderOpeningPage: the 70-char cap (buildContent.js's
  // assertPageMetadata) is enforced on the DECODED title text, and this
  // tier's family names run up to 37 chars ("Vienna Gambit, with Max Lange
  // Defense") -- long enough that the first, most descriptive form doesn't
  // always fit. The bare-family fallback is guaranteed to fit (37 + the " |
  // Repertoire Builder" suffix's own ~22 chars is well under 70).
  // "and", not "&", in the tier-2 fallback specifically: a raw "&" here
  // renders as the 5-character entity "&amp;" (escapeHtmlText(), used for
  // <title> content, still escapes a genuine "&"), which was pushing a
  // handful of longer family names' encoded <title> text back over
  // html-validate's 70-char long-title budget even though the DECODED
  // text (what assertPageMetadata below actually checks, and what a
  // browser/search result actually shows) was comfortably under it.
  let title = pageTitle(`${family} - All Variations and ECO Codes`);
  if (title.length > 70) title = pageTitle(`${family} Variations and ECO Codes`);
  if (title.length > 70) title = pageTitle(family);

  let description = `${lineCount} named ${family} lines across ${ecoCodes.length} ECO code${ecoCodes.length === 1 ? '' : 's'} (${ecoRangeLabel(ecoCodes)}), with real Lichess win rates for the main line.`;
  if (description.length > 160) {
    description = `${lineCount} named ${family} lines (ECO ${ecoRangeLabel(ecoCodes)}), with real Lichess win rates for the main line by rating band.`;
  }
  if (description.length > 160) {
    description = `${lineCount} ${family} lines, ECO ${ecoRangeLabel(ecoCodes)}, with real Lichess win rates by rating band.`;
  }

  const canonical = absoluteUrl(filename);
  const volumeFile = ecoVolumeFilename(primaryVolume);
  const breadcrumbItems = [
    { label: 'Home', href: nav.home },
    { label: 'Chess Opening Encyclopedia', href: ECO_INDEX_FILE },
    { label: `Volume ${primaryVolume}`, href: volumeFile },
    { label: family, href: filename },
  ];

  const jsonLd = [
    breadcrumbJsonLd(breadcrumbItems),
    itemListJsonLd({
      name: `${family} variations`,
      items: familyEntry.lines.map((l) => ({ name: l.name })),
    }),
  ].join('\n  ');

  const related = [
    ...(t0CrossLink ? [{ label: `${t0CrossLink.label} (full deep-dive)`, href: t0CrossLink.href, note: 'Real replies, common mistakes, and master games for one curated line.' }] : []),
    ...(drillCrossLink ? [drillCrossLink] : []),
    ...relatedFamilies,
  ];
  // See src/renderContent.js's renderOpeningPage/renderArticlePage for why
  // this is precomputed rather than interpolated inline as
  // "    ${renderRelated(...)}" -- renderRelated() legitimately returns ''
  // for the (common, for a family with no curated cross-link or related
  // families) case, and that pattern leaves a whitespace-only line.
  const relatedSection = renderRelated(related, 'Related');
  const relatedHtml = relatedSection ? `\n\n    ${relatedSection}` : '';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, ogType: 'article', jsonLd, noindex })}
<body>
<div class="page">
  ${renderHeader(nav, 'eco')}
  <main id="main-content">
    ${renderPageHead({
      breadcrumb: renderBreadcrumb(breadcrumbItems),
      title: `${displayName(family)}: all variations and ECO codes`,
      subtitle: `${lineCount} named lines across ${ecoCodes.length} ECO code${ecoCodes.length === 1 ? '' : 's'}
        (${escapeHtml(ecoRangeLabel(ecoCodes))})${volumes.length > 1 ? `, spanning ECO volumes ${volumes.join(', ')}` : ''}.
        Source: the CC0-licensed <a href="https://github.com/lichess-org/chess-openings" rel="noopener noreferrer">lichess.org opening database</a>.`,
    })}

    <h2>The idea</h2>
    <p>${displayName(strategy)}</p>

    <h2>The main line</h2>
    <figure class="board-figure">
      ${renderBoard(board, { flip, label: `Position after ${sanLine}` })}
      <figcaption>Position after ${escapeHtml(sanLine)} (${escapeHtml(mainLine.eco)}).
        <a href="${lichessAnalysisUrl(mainLine.plies)}" rel="noopener noreferrer">Open this line on Lichess &rarr;</a> &middot;
        <a href="${lichessOpeningUrl(mainLine.name)}" rel="noopener noreferrer">${displayName(mainLine.name)} on Lichess</a>
      </figcaption>
    </figure>

    <h2>How the main line scores at your rating</h2>
    <p>Real Lichess win rates for ${escapeHtml(sanLine)}, playing as ${escapeHtml(mainLineSide)}: the family&rsquo;s
       ${ecoCodes.length > 1 || lineCount > 1 ? 'other variations are not separately tracked for win rate yet, ' : ''}main line only.</p>
    ${renderBandsTable({ side: mainLineSide, bands: bandStats.bands })}

    <h2>All ${lineCount} named variations</h2>
    <p class="repertoire-intro">Every named line in the ${displayName(family)} family, from the CC0-licensed ECO
       classification: not separately tracked for win rate, but every ECO code and move sequence is real,
       sourced data.</p>
    ${renderVariationTree(familyEntry)}

    <h2>Browse more</h2>
    <p><a href="${escapeHtml(volumeFile)}">ECO Volume ${escapeHtml(primaryVolume)}: ${escapeHtml(VOLUME_LABELS[primaryVolume])} &rarr;</a> &middot;
       <a href="${ECO_INDEX_FILE}">All ECO families &rarr;</a> &middot;
       <a href="${ECO_EXPLORER_FILE}">Search and play every line in the interactive explorer &rarr;</a></p>${relatedHtml}
  </main>
  ${renderFooter(`Aggregate data from the <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer</a> (main line only, retrieved ${BUILD_DATE}) and the CC0-licensed <a href="https://github.com/lichess-org/chess-openings" rel="noopener noreferrer">lichess.org opening database</a> (all variations). ${pieceAttributionHtml()}`, ECO_LEGAL_LINKS)}
</div>
</body>
</html>
`;
}

/**
 * T2: one ECO volume index page (A-E). Pure navigation over that volume's
 * 100 ECO codes -- zero Explorer requests. `codeRows` groups the vendored
 * dataset by code (not family), since a single ECO code can carry more than
 * one distinct family/name (spec 3.2's own measured example: A00 alone
 * covers 144 differently-named "Uncommon Openings" lines).
 *
 * @param {object} opts
 * @param {string} opts.volume 'A'..'E'
 * @param {Array<{eco:string, names:Array<{name:string, href:string|null}>, lineCount:number}>} opts.codeRows sorted by eco code
 * @param {object} opts.nav
 */
function renderEcoVolumeIndexPage({ volume, codeRows, nav, strategy = '' }) {
  const label = VOLUME_LABELS[volume];
  const filename = ecoVolumeFilename(volume);
  const totalLines = codeRows.reduce((sum, r) => sum + r.lineCount, 0);
  const title = pageTitle(`ECO Volume ${volume}: ${VOLUME_LABELS_SHORT[volume]}`);
  let description = `All ${codeRows.length} ECO codes in Volume ${volume} (${label}), Encyclopaedia of Chess Openings, with links to the openings tracked on this site.`;
  if (description.length > 160) {
    description = `All ${codeRows.length} ECO codes in Volume ${volume}: ${VOLUME_LABELS_SHORT[volume]}, with links to the openings tracked on this site.`;
  }
  const canonical = absoluteUrl(filename);
  const breadcrumbItems = [
    { label: 'Home', href: nav.home },
    { label: 'Chess Opening Encyclopedia', href: ECO_INDEX_FILE },
    { label: `Volume ${volume}`, href: filename },
  ];

  const terms = codeRows.map((r) => ({
    termCode: r.eco,
    name: r.names.map((n) => n.name).join(', '),
    url: r.names.find((n) => n.href) ? absoluteUrl(r.names.find((n) => n.href).href) : undefined,
  }));
  const jsonLd = [
    breadcrumbJsonLd(breadcrumbItems),
    definedTermSetJsonLd({ name: `ECO Volume ${volume}: ${label}`, url: canonical, terms }),
  ].join('\n  ');

  const rows = codeRows
    .map((r) => {
      const names = r.names
        .map((n) => {
          const label = n.variation ? `${displayName(n.name)}: ${displayName(n.variation)}` : displayName(n.name);
          return n.href ? `<span><a href="${escapeHtml(n.href)}">${label}</a></span>` : `<span>${label}</span>`;
        })
        .join('');
      return `<tr><td><span class="eco-chip">${escapeHtml(r.eco)}</span></td><td class="eco-names">${names}</td><td class="num">${r.lineCount}</td></tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd })}
<body>
<div class="page">
  ${renderHeader(nav, 'eco')}
  <main id="main-content">
    ${renderBreadcrumb(breadcrumbItems)}
    <h1 class="page-title">ECO Volume ${escapeHtml(volume)}: ${escapeHtml(label)}</h1>
    <p class="subtitle">${codeRows.length} ECO codes, ${totalLines.toLocaleString()} named lines. Linked names have
       their own family guide on this site; unlinked names are listed for reference only.</p>

    <h2>What sets this volume apart</h2>
    <p>${displayName(strategy)}</p>

    <h2>All codes in Volume ${escapeHtml(volume)}</h2>
    ${wrapTable(`
      <table class="eco-index-table">
        <caption class="sr-only">ECO Volume ${escapeHtml(volume)} codes</caption>
        <thead><tr><th scope="col">Code</th><th scope="col">Name(s)</th><th scope="col" class="num">Lines</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`, `ECO Volume ${volume} codes`)}

    <h2>Other volumes</h2>
    <p>${Object.keys(VOLUME_LABELS).filter((v) => v !== volume).map((v) => `<a href="${ecoVolumeFilename(v)}">Volume ${v}</a>`).join(' &middot; ')}
       &middot; <a href="${ECO_INDEX_FILE}">All ECO families &rarr;</a></p>
  </main>
  ${renderFooter(`ECO classification data from the CC0-licensed <a href="https://github.com/lichess-org/chess-openings" rel="noopener noreferrer">lichess.org opening database</a>.`, ECO_LEGAL_LINKS)}
</div>
</body>
</html>
`;
}

/**
 * T2: one page of the paginated all-families browse index -- every one of
 * the dataset's 149 families (not just the 64 T1 families), alphabetical,
 * a different traversal than the volume pages above (which are code-order
 * and therefore volume-bound by construction). Families under the T1
 * threshold (ecoFamilies.MIN_T1_LINES) render as plain text, honestly, with
 * no link to a page that doesn't exist.
 *
 * @param {object} opts
 * @param {Array<object>} opts.pageFamilies this page's slice of the full,
 *   sorted family index (ecoFamilies.buildFamilyIndex() entries)
 * @param {number} opts.pageNum 1-based
 * @param {number} opts.totalPages
 * @param {{totalFamilies:number, t1Count:number, totalLines:number}} opts.stats
 * @param {object} opts.nav
 */
function renderEcoIndexPage({ pageFamilies, pageNum, totalPages, stats, nav }) {
  const filename = ecoIndexPageFilename(pageNum);
  const title = pageNum === 1
    ? pageTitle('Chess Opening Explorer - All 500 ECO Codes')
    : pageTitle(`Chess Opening Families, Page ${pageNum} of ${totalPages}`);
  const description = pageNum === 1
    ? `Browse all ${stats.totalFamilies} named chess opening families across all 500 ECO codes, from the standard Encyclopaedia of Chess Openings classification.`
    : `Chess opening families ${pageFamilies[0].family}–${pageFamilies[pageFamilies.length - 1].family}, page ${pageNum} of ${totalPages}.`;
  const canonical = absoluteUrl(filename);
  const breadcrumbItems = [
    { label: 'Home', href: nav.home },
    { label: 'Chess Opening Encyclopedia', href: ECO_INDEX_FILE },
    ...(pageNum > 1 ? [{ label: `Page ${pageNum}`, href: filename }] : []),
  ];

  const jsonLd = [
    breadcrumbJsonLd(breadcrumbItems),
    itemListJsonLd({
      name: 'Chess opening families',
      items: pageFamilies.map((f) => ({
        name: f.family,
        url: f.lineCount >= 8 ? absoluteUrl(familyHubFilename(f.slug)) : undefined,
      })),
    }),
  ].join('\n  ');

  const rows = pageFamilies
    .map((f) => {
      const isT1 = f.lineCount >= 8;
      const nameCell = isT1
        ? `<a href="${escapeHtml(familyHubFilename(f.slug))}">${displayName(f.family)}</a>`
        : displayName(f.family);
      return `<tr><td>${nameCell}</td><td><span class="eco-chip">${escapeHtml(ecoRangeLabel(f.ecoCodes))}</span></td><td class="num">${f.lineCount}</td></tr>`;
    })
    .join('');

  const pagination = totalPages > 1
    ? `<nav class="pagination" aria-label="Chess Opening Encyclopedia pages">
      ${pageNum > 1 ? `<a href="${escapeHtml(ecoIndexPageFilename(pageNum - 1))}" rel="prev">&larr; Previous page</a>` : '<span></span>'}
      <span class="pagination-status">Page ${pageNum} of ${totalPages}</span>
      ${pageNum < totalPages ? `<a href="${escapeHtml(ecoIndexPageFilename(pageNum + 1))}" rel="next">Next page &rarr;</a>` : '<span></span>'}
    </nav>`
    : '';

  // '' on every page after the first (see the template below) --
  // precomputed with its own leading "\n    " so the call site can
  // interpolate it directly against the preceding tag with no separate
  // indented template line, same reasoning as renderOpeningPage's
  // drillCtaHtml (src/renderContent.js): an indented "    ${introSection}"
  // line would be a whitespace-only line on every page but the first.
  const introSection = pageNum === 1
    ? `\n    <p class="subtitle">The Encyclopaedia of Chess Openings (ECO) classifies every recognized opening into
       500 codes across 5 volumes (A&ndash;E). This site tracks ${stats.totalLines.toLocaleString()} named lines
       across ${stats.totalFamilies} opening families; ${stats.t1Count} families with 8 or more named lines have
       their own guide (linked below).</p>
    <p><a href="${ECO_EXPLORER_FILE}">Or search and play all ${stats.totalLines.toLocaleString()} lines in the interactive ECO explorer &rarr;</a></p>
    <h2>Browse by ECO volume</h2>
    <p>${Object.keys(VOLUME_LABELS).map((v) => `<a href="${ecoVolumeFilename(v)}">Volume ${v}: ${escapeHtml(VOLUME_LABELS[v])}</a>`).join(' &middot; ')}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title, description, canonical, jsonLd })}
<body>
<div class="page">
  ${renderHeader(nav, 'eco')}
  <main id="main-content">
    ${renderBreadcrumb(breadcrumbItems)}
    <h1 class="page-title">${pageNum === 1 ? 'Chess opening families, A–Z' : `Chess opening families, page ${pageNum} of ${totalPages}`}</h1>${introSection}

    <h2>Families ${escapeHtml(pageFamilies[0].family)}&ndash;${escapeHtml(pageFamilies[pageFamilies.length - 1].family)}</h2>
    ${wrapTable(`
      <table>
        <caption class="sr-only">Chess opening families, page ${pageNum}</caption>
        <thead><tr><th scope="col">Family</th><th scope="col">ECO codes</th><th scope="col" class="num">Lines</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`, `Chess opening families, page ${pageNum}`)}
    ${pagination}
  </main>
  ${renderFooter(`ECO classification data from the CC0-licensed <a href="https://github.com/lichess-org/chess-openings" rel="noopener noreferrer">lichess.org opening database</a>.`, ECO_LEGAL_LINKS)}
</div>
</body>
</html>
`;
}

module.exports = {
  VOLUME_LABELS,
  ECO_INDEX_FILE,
  ecoVolumeFilename,
  ecoIndexPageFilename,
  ecoRangeLabel,
  renderVariationTree,
  renderFamilyHubPage,
  renderEcoVolumeIndexPage,
  renderEcoIndexPage,
};
