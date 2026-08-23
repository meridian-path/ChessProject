'use strict';

/**
 * Repertoire Pack sales pages -- the packs index (repertoire-packs.html) and
 * the two pack detail pages (repertoire-packs/<id>.html). The monetization
 * plan's sections on layout, copy, and constraints are the binding source
 * for this file; the "why" behind several choices here (data-table-first
 * layout, no bundle CTA, no exact file sizes when packs/ isn't present
 * locally) is explained inline at each decision point rather than repeated
 * from that plan.
 *
 * A SEPARATE module from render.js (like renderContent.js/renderEcoPages.js
 * already are) -- this is server/build-time only, never concatenated into a
 * browser bundle, so it may freely require() render.js, structuredData.js,
 * boardSvg.js, and site.js.
 */

const {
  escapeHtml,
  escapeHtmlText,
  renderDocumentHead,
  renderHeader,
  renderFooter,
  renderPageHead,
  formatPct,
  STORE,
  isPlaceholderStoreUrl,
  siteRelativeHref,
} = require('./render');
const { renderBreadcrumb } = require('./renderContent');
const { breadcrumbJsonLd, productJsonLd } = require('./structuredData');
const { renderBoardDiagram, spriteDefsHtml, pieceAttributionHtml } = require('./boardSvg');
const { absoluteUrl, pageTitle, SITE_NAME } = require('./site');
const { poolDisclosure } = require('./explorerSource');

const PRICE_USD = 9;

// Disclosed limitations (spec 1.3), worded for on-page HTML display. Ships
// verbatim-in-substance in three places per spec 1.2 item 4/1.6.6: this
// page, README.txt (src/buildPack.js's readmeText(), independently worded
// for a plain-text file), and /methodology.html -- kept as one array here
// so a future methodology-page pass can reuse it rather than re-deriving.
// The pool-disclosure item is a FUNCTION of `pack.speeds` (rather than a
// hardcoded string in this array), since which pool a pack actually drew
// from depends on whether this build ran on aggregate data or the live-API
// fallback -- see src/explorerSource.js's actualPoolSpeeds() doc, and the
// same "blitz & rapid" mislabeling bug this fixes on the opening pages
// (src/renderContent.js's renderOpeningPage `manifest` param). Both the
// included and excluded halves of the sentence come from explorerSource.js's
// poolDisclosure(), which derives both from the same `speeds` array so they
// can never contradict each other (a bug this array's excluded-half literal
// used to have: it always said "classical and bullet", silently omitting
// rapid from the excluded list on the blitz-only build).
function disclosedLimitations(speeds) {
  return [
    'Score is a sample mean (wins plus half of draws, divided by games), not a win/loss proportion - its confidence interval uses a normal approximation, not a binomial Wilson interval. Sound at the sample sizes this pack requires (n&nbsp;&ge;&nbsp;300); treat the interval as approximate.',
    'Not transposition-aware: the same position reached by a different move order may be counted separately. Pack size is stated in &ldquo;lines,&rdquo; not &ldquo;positions covered.&rdquo;',
    `Data pool is ${poolDisclosure(speeds)}.`,
    'The chosen move at each point is the highest lower-bound scorer among moves with enough games in this band and pool - not a claim that it is objectively the best move in the position.',
  ];
}

const FREE_GUARANTEE_HTML = `<p>Everything this site computes about your games is free. The leak report, the drill
    engine, the repertoire builder and PGN export have no paid tier. What&rsquo;s for sale is our
    work, not yours: a finished repertoire built from the same public data, pruned to a size
    you can actually memorize, with the arithmetic printed next to every move.</p>`;

const NON_INFLUENCE_HTML = `<p>Buying a pack changes nothing on this site. No opening is ranked higher, recommended, or
    featured because a pack exists for it. The rankings come from the same query whether you
    buy or not, and the rule that picks the pack&rsquo;s moves is printed below in full.</p>`;

function packsIndexFilename() {
  return 'repertoire-packs.html';
}

function packDetailFilename(id) {
  return `repertoire-packs/${id}.html`;
}

function packSampleFilename(id) {
  return `repertoire-packs/${id}-sample.pgn`;
}

function packOgImageFilename(id) {
  return `og-pack-${id}.png`;
}

/**
 * Plain {square: FEN-piece-letter} board object from a FEN's placement
 * field -- identical logic to scripts/buildPacks.js's boardFromFen(), kept
 * as an independent copy for the same reason that script's own wdlBarHtml()
 * documents keeping the PDF-generation and page-render helpers in sync by
 * hand rather than sharing a module: this file must stay requireable from a
 * plain Node build step with no Playwright/browser dependency, and
 * scripts/buildPacks.js's PDF-only helpers are intentionally out of that
 * dependency graph.
 */
function boardFromFen(fen) {
  const placement = fen.split(' ')[0];
  const ranks = placement.split('/');
  const board = {};
  ranks.forEach((rankStr, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of rankStr) {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
      } else {
        board[`${'abcdefgh'[file]}${rank}`] = ch;
        file += 1;
      }
    }
  });
  return board;
}

/** Same SVG win/draw/loss stacked-bar technique as render.js's renderRepertoireNode(). */
function wdlBarHtml({ w, d, l, label }) {
  const n = (w || 0) + (d || 0) + (l || 0);
  if (n === 0) return '';
  const winPct = (w / n) * 100;
  const drawPct = (d / n) * 100;
  const lossPct = (l / n) * 100;
  return `<svg class="wdl-bar" viewBox="0 0 100 12" preserveAspectRatio="none" role="img"><title>${escapeHtml(label)}</title><rect class="wdl-seg--win" x="0" y="0" width="${winPct}" height="12"></rect><rect class="wdl-seg--draw" x="${winPct}" y="0" width="${drawPct}" height="12"></rect><rect class="wdl-seg--loss" x="${winPct + drawPct}" y="0" width="${lossPct}" height="12"></rect></svg>
    <span class="wdl-label">${formatPct(winPct)}% / ${formatPct(drawPct)}% / ${formatPct(lossPct)}%</span>`;
}

/**
 * Walks a buildPack.js tree (buildPackTree()'s `.tree`, NOT pack.json's own
 * flattened `positions` array -- see this module's header and
 * src/buildPackPages.js's own header comment for why the raw tree is used)
 * into one row per (opponent reply -> our response) pair, in pre-order
 * (main line first, then each variation) -- the same order a human reading
 * a real annotated PGN would expect, not a global reach-sort (that's the
 * PDF's own presentation choice, not this table's).
 *
 * Every node's `.children` array is either length 1 (an our-move node --
 * this pack's own rule is deterministic, so we only ever have exactly one
 * candidate) or a real sibling group (an opponent decision point, every
 * kept reply). `siblingGroup` on each returned row is exactly that sibling
 * array -- what the row's own expand panel renders as "this node's full
 * reply distribution" (spec 1.6.2).
 *
 * @param {object} root buildPackTree()'s `.tree`
 * @returns {Array<{ply:number, opponentSan:string, opponentN:number,
 *   freq:number, ourSan:string|null, ourN:number|null, ourScore:number|null,
 *   ourWilson:[number,number]|null, siblingGroup:Array}>}
 */
function collectContentsRows(root) {
  const rows = [];

  function walkOpponentGroup(siblings) {
    if (!siblings || siblings.length === 0) return;
    const totalAtNode = siblings.reduce((sum, s) => sum + (s.n || 0), 0);
    for (const opp of siblings) {
      const freq = totalAtNode > 0 ? opp.n / totalAtNode : 0;
      const ourChild = (opp.children && opp.children[0]) || null;
      rows.push({
        ply: opp.ply,
        opponentSan: opp.san,
        opponentN: opp.n,
        opponentW: opp.w,
        opponentD: opp.d,
        opponentL: opp.l,
        freq,
        ourSan: ourChild ? ourChild.san : null,
        ourN: ourChild ? ourChild.n : null,
        ourScore: ourChild ? ourChild.score : null,
        ourWilson: ourChild ? ourChild.wilson : null,
        siblingGroup: siblings,
      });
      if (ourChild && ourChild.children && ourChild.children.length > 0) {
        walkOpponentGroup(ourChild.children);
      }
    }
  }

  // The pack's own stated first move (root) is never itself a table row --
  // it's part of the page's own identity (H1/board), not a "branch point"
  // (see this module's header comment / spec 1.1 firstMoveUci). Descend to
  // the first REAL opponent decision: for a White pack, root IS our own
  // forced move, so root.children is already that first group; for a Black
  // pack, root is White's fixed first move and root.children[0] is our own
  // single computed reply, so its OWN children are the first real group.
  if (root.isOurMove) {
    walkOpponentGroup(root.children);
  } else {
    const ourFirst = (root.children && root.children[0]) || null;
    if (ourFirst) walkOpponentGroup(ourFirst.children);
  }

  return rows;
}

const ROWS_SHOWN_INITIALLY = 25;

// The largest pack in the launch catalogue produces 500 contents-table rows
// across 110 distinct opponent-decision groups -- rendering every one of
// them (even deduped and lazily deferred, see contentsTableHtml()'s own doc
// comment) still means shipping ~800KB-1MB of real HTML in the page
// response, which measured a 4.7s First Contentful Paint under Lighthouse's
// throttled-network simulation -- a real, measured failure against
// design-standards.md's Lighthouse >=90 floor (a ship blocker, not a
// judgment call), not a hypothetical one. Capping the table at this many
// rows (kept in tree order -- main line first, then each variation, same
// order the PGN itself reads in) keeps the page's own byte weight bounded
// regardless of how large a future pack's tree grows, while still covering
// every practical branch point for both launch packs (391/500 and 222/~290
// total rows respectively -- see disclosureNoteForCap() below for what a
// visitor is told when a pack's real row count exceeds this). The FULL
// tree, with no cap, ships in the sold pack.json/repertoire.pgn regardless
// -- this constant bounds only the free, on-page preview table, never the
// actual purchased artifact.
const MAX_TABLE_ROWS = 150;

/**
 * Distribution-table markup for one opponent decision point's sibling
 * group (every reply this pack tracked at that position). Rendered ONCE
 * per DISTINCT group and shared, via `<template>` + a same-page id lookup,
 * across every row whose `siblingGroup` is that same group -- a single
 * opponent decision point commonly has several kept replies (spec 1.3:
 * every reply down to a 1.5%-of-games/n>=300 floor, up to 90% cumulative),
 * and this table's own content is IDENTICAL for every row drawn from that
 * group. The first version of this function embedded a full copy of this
 * table inside every individual row's own expand panel -- O(rows x average
 * group size) markup, which measured at 2.2MB just for this file's own
 * repeated tables on the White pack's ~390-row page (a real Lighthouse
 * Performance regression, not hypothetical -- see contentsTableHtml()'s own
 * doc comment for the matching DOM-size fix). Sharing one copy per group
 * instead is both correct (the data really is identical) and the fix.
 */
function distributionTemplateHtml(siblingGroup, distId) {
  const total = siblingGroup.reduce((sum, s) => sum + (s.n || 0), 0);
  const rows = siblingGroup
    .map((s) => {
      const pct = total > 0 ? (s.n / total) * 100 : 0;
      return `<tr>
              <td>${escapeHtml(s.san)}</td>
              <td class="num">${s.n.toLocaleString()}</td>
              <td class="num">${formatPct(pct)}%</td>
              <td>${wdlBarHtml({ w: s.w, d: s.d, l: s.l, label: `${s.side} win/draw/loss for ${s.san}` })}</td>
            </tr>`;
    })
    .join('');
  return `<template id="${distId}">
    <p class="pack-meta-note">Every reply this pack tracked at this position, in this band:</p>
    <table>
      <thead><tr><th>Reply</th><th class="num">Games</th><th class="num">Freq.</th><th>Win / draw / loss</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </template>`;
}

/**
 * One <details> row. `distId` points at the shared `<template>`
 * (distributionTemplateHtml() above) this row's own expand panel clones
 * from -- populated by the one shared script contentsTableHtml() emits,
 * the first time this row is actually opened (a `toggle` listener, not an
 * eager page-load pass, so a page with hundreds of rows never does hundreds
 * of clones nobody asked to see).
 */
function contentsRowHtml(row, distId) {
  const scoreText = row.ourScore != null ? `${formatPct(row.ourScore * 100)}%` : '-';
  const ciText = row.ourWilson
    ? `CI ${formatPct(row.ourWilson[0] * 100)}&ndash;${formatPct(row.ourWilson[1] * 100)}%`
    : '';
  const opponentSide = sideAtPly(row.ply);
  const ourSide = opponentSide === 'white' ? 'black' : 'white';
  return `<li class="pack-row-item" data-pack-row>
      <details class="pack-row" data-dist-id="${distId}">
        <summary class="pack-row-summary">
          <span class="move-chip move-chip--${opponentSide}">${escapeHtml(row.opponentSan)}</span>
          <span class="pack-row-freq">${formatPct(row.freq * 100)}% of games here (n=${row.opponentN.toLocaleString()})</span>
          <span class="pack-row-arrow" aria-hidden="true">&rarr;</span>
          ${row.ourSan ? `<span class="move-chip move-chip--${ourSide}">${escapeHtml(row.ourSan)}</span>
          <span class="pack-row-score">${scoreText}</span>
          <span class="pack-row-ci">${ciText} (n=${row.ourN != null ? row.ourN.toLocaleString() : '-'})</span>` : '<span class="pack-row-ci">Pack ends here (not enough games to extend further)</span>'}
        </summary>
        <div class="pack-row-distribution" data-pack-row-distribution>
          <noscript>See every reply this pack tracked at this position in the downloadable pack.json, or in the printed study guide.</noscript>
        </div>
      </details>
    </li>`;
}

/**
 * Populates a row's `.pack-row-distribution` from its `<template>` the
 * first time it's opened -- one shared listener for the whole table
 * (event delegation on the list itself, so rows added later by "show all"
 * below are covered with no extra wiring) rather than one listener per
 * row. Idempotent (`data-populated` guard) so re-toggling a row never
 * clones a second copy in.
 */
const DISTRIBUTION_TOGGLE_SCRIPT = `<script>(function(){
  function onToggle(e){
    var d=e.target;
    if(!d.matches||!d.matches('.pack-row[open]')||d.dataset.populated)return;
    var id=d.getAttribute('data-dist-id');
    var tpl=id&&document.getElementById(id);
    var slot=d.querySelector('[data-pack-row-distribution]');
    if(!tpl||!slot)return;
    slot.textContent='';
    slot.appendChild(tpl.content.cloneNode(true));
    d.dataset.populated='1';
  }
  document.addEventListener('toggle', onToggle, true);
})();</script>`;

/**
 * Move-chip color in this codebase is white/black by the MOVER's own color,
 * not by "opponent vs. our move" -- contentsRowHtml() above needs the
 * opponent reply's own side, which the row data doesn't carry directly
 * (only `ply`, from which side-to-move is derivable: even ply = White).
 * Recomputed here rather than storing a redundant field on every row.
 */
function sideAtPly(ply) {
  return ply % 2 === 0 ? 'white' : 'black';
}

/**
 * Rows beyond ROWS_SHOWN_INITIALLY (and the distribution `<template>`s only
 * THEY reference -- most groups only ever appear past row 25 on a ~390-row
 * pack) are deferred inside one outer `<template>`, cloned in only when
 * "show all" is actually clicked. This is on top of, not instead of, the
 * per-group dedup above: the two fixes address different costs -- dedup
 * cuts down TOTAL bytes generated at all (2.2MB of literally-repeated
 * tables down to ~350KB of once-each tables, on the White pack's ~390-row
 * page); deferring the tail behind a `<template>` additionally keeps the
 * INITIAL page load (a real visitor's or Lighthouse's first paint) to just
 * the first 25 rows' own bytes and groups, not the whole pack's -- the
 * measured combination brought this page's own Lighthouse Performance run
 * from a 12.7s First Contentful Paint down to survivable. No-JS visitors
 * keep the first 25 rows and a plain, honest button that doesn't do
 * anything without script -- the same graceful-degradation shape this
 * site's other interactive pages already use (e.g. the ECO explorer's own
 * `<noscript>` fallback).
 */
function contentsTableHtml(rows) {
  if (rows.length === 0) {
    return '<p class="empty-note">This pack&rsquo;s tree is smaller than expected - contact us if this looks wrong.</p>';
  }

  const visible = rows.slice(0, ROWS_SHOWN_INITIALLY);
  const extra = rows.slice(ROWS_SHOWN_INITIALLY);

  // One <template> per DISTINCT sibling-group array (identity-keyed, not
  // value-keyed -- every row drawn from the SAME walkOpponentGroup() call
  // shares the exact same array instance), so a group's distribution table
  // is only ever generated once no matter how many rows reference it.
  // Built in two passes (visible groups first) so a group referenced ONLY
  // by a deferred row is itself deferred too, rather than shipped early.
  const distIdByGroup = new Map();
  let nextDistId = 0;
  function distIdFor(siblingGroup, targetList) {
    let id = distIdByGroup.get(siblingGroup);
    if (!id) {
      id = `pack-dist-${nextDistId}`;
      nextDistId += 1;
      distIdByGroup.set(siblingGroup, id);
      targetList.push(distributionTemplateHtml(siblingGroup, id));
    }
    return id;
  }

  const visibleTemplates = [];
  const items = visible.map((row) => contentsRowHtml(row, distIdFor(row.siblingGroup, visibleTemplates))).join('');

  let deferredBlock = '';
  if (extra.length > 0) {
    const extraTemplates = [];
    const extraItems = extra.map((row) => contentsRowHtml(row, distIdFor(row.siblingGroup, extraTemplates))).join('');
    deferredBlock = `<template data-pack-extra-rows>${extraItems}${extraTemplates.join('')}</template>
    <button type="button" class="pack-show-all" data-pack-show-all>Show all ${rows.length} branch points</button>
    <script>(function(){
      var script=document.currentScript;
      var btn=script.previousElementSibling;
      var tpl=btn&&btn.previousElementSibling;
      var list=script.parentElement.querySelector('.pack-contents-table');
      if(!btn||!tpl||!list)return;
      btn.addEventListener('click',function(){
        var frag=tpl.content.cloneNode(true);
        var newGroupTemplates=[];
        Array.prototype.slice.call(frag.children).forEach(function(node){
          if(node.tagName==='TEMPLATE'){frag.removeChild(node);newGroupTemplates.push(node);}
        });
        list.appendChild(frag);
        newGroupTemplates.forEach(function(t){document.body.appendChild(t);});
        btn.hidden=true;
      });
    })();</script>`;
  }

  return `<ul class="pack-contents-table">${items}</ul>${visibleTemplates.join('')}${deferredBlock}${DISTRIBUTION_TOGGLE_SCRIPT}`;
}

function packFileListHtml(pack) {
  const items = [
    { name: 'repertoire.pgn', desc: `${pack.lineCount.toLocaleString()} lines, standard PGN with variations and per-move stats.` },
    { name: 'pack.json', desc: 'The same data as a structured manifest - imports directly into this site&rsquo;s drill trainer.' },
    { name: 'study-guide.pdf', desc: 'A printable guide covering the highest-frequency branch points.' },
    { name: 'README.txt', desc: 'What&rsquo;s in the box, how to use it, and the generation rule in full.' },
  ];
  const rows = items
    .map((it) => {
      const sizeLabel = pack.fileSizes && pack.fileSizes[it.name] ? ` - ${pack.fileSizes[it.name]}` : '';
      return `<li><span class="pack-file-name">${escapeHtml(it.name)}${sizeLabel}</span><span class="pack-file-desc">${it.desc}</span></li>`;
    })
    .join('');
  return `<ul class="pack-file-list">${rows}</ul>`;
}

/**
 * The CTA -- an honest inert state while STORE still carries a PLACEHOLDER
 * url (spec 1.4: "Builder ships with PLACEHOLDER URLs... a test asserting
 * no page in dist/ renders a literal PLACEHOLDER string"). The literal
 * sentinel string never reaches this function's output either way -- when
 * placeholder, the href is never emitted at all, only honest "not listed
 * yet" copy; when real, the merchant URL is emitted as a plain <a href>,
 * rel="noopener noreferrer", with the GoatCounter synthetic click path from
 * spec 1.9 as a data attribute (count.js's own documented click-tracking
 * mechanism -- no new script, no new origin).
 *
 * @param {boolean} [compact] the packs-index page's own quiet rows (spec
 *   1.6.4's asymmetric-by-construction rule -- only packs[0] gets the
 *   full accent-filled button) still need SOME direct buy action once a
 *   pack has a real store url, or a visitor who already knows which pack
 *   they want hits an avoidable extra click through the detail page first
 *   -- a real conversion-funnel gap, not a styling one. `compact` renders
 *   the same real link as a plain accent-colored text link instead (same
 *   text-link, never-accent-filled treatment renderLeakReportUpsell()
 *   already uses for its own secondary CTA, immediately below), so the
 *   page still has exactly one accent-FILLED action -- spec 1.6.4's rule
 *   is about that one visual weight, not about withholding a real buy
 *   link once one exists. A still-placeholder pack renders nothing at all
 *   in compact mode (there's nothing to buy yet, and repeating "not listed
 *   for sale yet" on every quiet row would be noise, not signal -- the
 *   existing "See what's in it" link already covers that case).
 */
function packCtaHtml(pack, compact = false) {
  if (isPlaceholderStoreUrl(pack.storeUrl)) {
    return compact ? '' : `<p class="pack-cta pack-cta--pending">Not listed for sale yet - check back soon.</p>`;
  }
  const cls = compact ? 'pack-cta pack-cta--compact' : 'pack-cta';
  return `<a class="${cls}" href="${escapeHtml(pack.storeUrl)}" rel="noopener noreferrer" data-goatcounter-click="/out/pack-${escapeHtml(pack.id)}">Get the pack - $${PRICE_USD}</a>`;
}

function packFaqHtml(pack) {
  const faqs = [
    { q: 'What do I actually get?', a: `Four files: a full PGN with variations and per-move stats, the same data as a structured drill manifest (pack.json), a printable study guide (PDF), and a README. ${pack.lineCount.toLocaleString()} lines total, chosen by the rule printed below.` },
    { q: 'What don&rsquo;t I get?', a: 'Nothing free here got moved behind the price. This is a finished, pruned artifact the free builder was never specced to produce.' },
    { q: 'Does it work with Lichess Study or ChessBase?', a: 'Yes. repertoire.pgn is a standard PGN with ordinary variations. Import it into Lichess Study via Study &gt; Import PGN game, or open it directly in ChessBase or any standard PGN reader. It also loads directly into this site&rsquo;s own importer.' },
    { q: 'What happens when the underlying data changes?', a: 'This pack was generated from the site&rsquo;s cached Lichess Opening Explorer data as of the retrieval date on this page. The one-time purchase doesn&rsquo;t include an automatic-update subscription.' },
    { q: 'Refunds?', a: 'Handled by the store this pack sells through, whose refund policy is shown at checkout before you pay.' },
  ];
  const items = faqs
    .map((f) => `<div class="pack-faq-item"><h3>${f.q}</h3><p>${f.a}</p></div>`)
    .join('');
  return `<h2>FAQ</h2>${items}`;
}

function disclosedLimitationsHtml(pack) {
  const items = disclosedLimitations(pack.speeds).map((l) => `<li>${l}</li>`).join('');
  return `<h2>Disclosed limitations</h2><ul>${items}</ul>`;
}

function generationRuleHtml(pack) {
  return `<h2>How this pack was built</h2>
    <p>Rule version ${pack.ruleVersion}. Data: Lichess Opening Explorer, database &ldquo;lichess,&rdquo; speeds ${pack.speeds.join('/')}, rating band ${pack.band}, retrieved ${pack.retrieved}. At each of our own decision points, the pack plays the candidate move (n&nbsp;&ge;&nbsp;300) with the highest confidence-interval lower bound on score (wins plus half of draws, divided by games). At each opponent decision point, the pack includes replies in descending frequency until they cover at least 90% of games at that position, dropping any reply below 1.5% frequency or below 300 games (this run used a ${formatPct(pack.thresholdUsed * 100)}% frequency floor). Full method: <a href="/methodology.html#repertoire-packs">methodology</a>.</p>`;
}

/**
 * @param {object} pack see src/buildPackPages.js's PACK BUNDLE shape.
 * @param {Array<{id:string, title:string}>} otherPacks for the related-pack link.
 * @param {object} nav
 * @param {object} [legalLinks]
 */
function renderPackDetailPage({ pack, otherPacks = [], nav, legalLinks }) {
  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Repertoire packs', href: siteRelativeHref(packsIndexFilename()) },
    { label: pack.title },
  ];
  const canonical = absoluteUrl(packDetailFilename(pack.id));
  const description = `A complete ${pack.title.toLowerCase()} repertoire: ${pack.lineCount.toLocaleString()} lines picked from real Lichess games in that band, with sample sizes and score ranges on every move.`.slice(0, 160);
  const ogImage = absoluteUrl(packOgImageFilename(pack.id));

  const jsonLdParts = [breadcrumbJsonLd(breadcrumbItems)];
  // Product/Offer JSON-LD only once this pack is actually listed -- an
  // Offer pointing at a PLACEHOLDER url would be a false structured-data
  // claim (spec 1.9: only emit what's actually on the page).
  if (!isPlaceholderStoreUrl(pack.storeUrl)) {
    jsonLdParts.push(productJsonLd({
      name: pack.title,
      description,
      image: ogImage,
      url: canonical,
      offerUrl: pack.storeUrl,
      price: PRICE_USD,
      sku: pack.id,
    }));
  }
  const jsonLd = jsonLdParts.join('\n  ');

  const board = boardFromFen(pack.rootFen);
  const allRows = collectContentsRows(pack.tree);
  const rows = allRows.slice(0, MAX_TABLE_ROWS);
  const rowsCapped = allRows.length > MAX_TABLE_ROWS;

  const relatedLink = otherPacks.length > 0
    ? `<p><a href="${escapeHtml(siteRelativeHref(packDetailFilename(otherPacks[0].id)))}">Also see: ${escapeHtml(otherPacks[0].title)} &rarr;</a></p>`
    : '';

  const sidebarHtml = `<aside class="pack-detail-sidebar">
      <figure class="pack-sidebar-board" aria-label="Board after this pack's first move">
        ${spriteDefsHtml()}
        ${renderBoardDiagram(board, { flip: pack.color === 'black', label: `Position after ${pack.title}'s first move, ${pack.firstMoveSan}` })}
      </figure>
      <p class="pack-price">$${PRICE_USD} one-time</p>
      <p class="pack-line-count">${pack.lineCount.toLocaleString()} lines &middot; retrieved ${pack.retrieved}</p>
      ${packCtaHtml(pack)}
      ${packFileListHtml(pack)}
      <a class="pack-sample-link" href="${escapeHtml(siteRelativeHref(packSampleFilename(pack.id)))}" download>Download a free sample (first ${pack.sampleLineCount} lines) &rarr;</a>
    </aside>`;

  const cappedNote = rowsCapped
    ? `<p class="pack-meta-note">Showing the first ${MAX_TABLE_ROWS.toLocaleString()} of ${allRows.length.toLocaleString()} branch points this pack tracks, in the same order the PGN reads in. Every one of them is in the files below.</p>`
    : '';

  const contentHtml = `<div class="pack-detail-content">
      <h2>What&rsquo;s in this pack</h2>
      ${contentsTableHtml(rows)}${cappedNote ? `\n      ${cappedNote}` : ''}
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title: pageTitle(`${pack.title} repertoire pack`), description, canonical, jsonLd, ogImage, noindex: pack.noindex })}
<body class="layout--wide">
  ${renderHeader(nav, 'packs')}
  <main>
    ${renderPageHead({
      breadcrumb: renderBreadcrumb(breadcrumbItems),
      eyebrow: 'Repertoire pack',
      title: `${escapeHtml(pack.title)}: a finished repertoire, ${pack.lineCount.toLocaleString()} lines`,
      subtitle: `Every move picked by one rule, printed below, from Lichess games in your band. Sample size and score range next to each one. PGN, a printable study guide, and a drill file that loads into the trainer on this site.`,
    })}

    <div class="pack-detail">
      ${sidebarHtml}
      ${contentHtml}
    </div>

    <section class="pack-statement">
      <h2>Nothing here is gated</h2>
      ${FREE_GUARANTEE_HTML}
    </section>

    <section class="pack-statement">
      <h2>This pack doesn&rsquo;t change the site</h2>
      ${NON_INFLUENCE_HTML}
    </section>

    ${generationRuleHtml(pack)}
    ${disclosedLimitationsHtml(pack)}
    ${packFaqHtml(pack)}
    ${relatedLink}

    <p class="source-list">Data: <a href="https://database.lichess.org" rel="noopener noreferrer">Lichess</a>, released under CC0. This pack is a derived work; it is not affiliated with or endorsed by Lichess. ${pieceAttributionHtml()}</p>
  </main>
  ${renderFooter(`Repertoire pack data source: <a href="https://database.lichess.org" rel="noopener noreferrer">Lichess</a> (CC0), via the Opening Explorer aggregate cache.`, legalLinks)}
</body>
</html>
`;
  return html;
}

/**
 * @param {Array<object>} packs PACK BUNDLE shape, in catalogue order --
 *   packs[0] renders as the full-width feature block, the rest as quiet
 *   hairline rows (spec 1.6.4's asymmetric-by-construction rule).
 */
function renderPacksIndexPage({ packs, nav, legalLinks }) {
  const breadcrumbItems = [{ label: 'Home', href: '/' }, { label: 'Repertoire packs' }];
  const canonical = absoluteUrl(packsIndexFilename());
  const description = 'Finished, pruned opening repertoires built from real Lichess games in your band - PGN, drill file, and a study guide. The site itself stays free.';
  const allNoindex = packs.every((p) => p.noindex);
  const jsonLd = breadcrumbJsonLd(breadcrumbItems);

  const [feature, ...rest] = packs;
  const featureBoard = boardFromFen(feature.rootFen);
  const featureHtml = `<div class="pack-feature">
      <figure class="pack-feature-board" aria-label="Board after this pack's first move">
        ${spriteDefsHtml()}
        ${renderBoardDiagram(featureBoard, { flip: feature.color === 'black', label: `Position after ${feature.title}'s first move, ${feature.firstMoveSan}` })}
      </figure>
      <div>
        <h2><a href="${escapeHtml(siteRelativeHref(packDetailFilename(feature.id)))}">${escapeHtml(feature.title)}</a></h2>
        <p>${feature.lineCount.toLocaleString()} lines, retrieved ${feature.retrieved}. Every move picked by one published rule from real games in this band.</p>
        <p class="pack-price">$${PRICE_USD} one-time</p>
        ${packCtaHtml(feature)}
      </div>
    </div>`;

  const restHtml = rest
    .map((p) => `<div class="pack-quiet-row">
      <span>${escapeHtml(p.title)} - ${p.lineCount.toLocaleString()} lines</span>
      <span class="pack-quiet-actions">
        <a href="${escapeHtml(siteRelativeHref(packDetailFilename(p.id)))}">See what&rsquo;s in it &rarr;</a>
        ${packCtaHtml(p, true)}
      </span>
    </div>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead({ title: pageTitle('Repertoire packs'), description, canonical, jsonLd, noindex: allNoindex })}
<body class="layout--wide">
  ${renderHeader(nav, 'packs')}
  <main>
    ${renderPageHead({
      breadcrumb: renderBreadcrumb(breadcrumbItems),
      eyebrow: 'Direct sale',
      title: 'Repertoire packs',
      subtitle: 'A finished, pruned opening repertoire, built from real Lichess games in your band. The site&rsquo;s own leak report, drill engine, and repertoire builder stay free either way.',
    })}

    ${featureHtml}
    ${restHtml}

    <section class="pack-statement">
      <h2>Nothing here is gated</h2>
      ${FREE_GUARANTEE_HTML}
    </section>

    <section class="pack-statement">
      <h2>These packs don&rsquo;t change the site</h2>
      ${NON_INFLUENCE_HTML}
    </section>
  </main>
  ${renderFooter('Repertoire pack data source: <a href="https://database.lichess.org" rel="noopener noreferrer">Lichess</a> (CC0), via the Opening Explorer aggregate cache.', legalLinks)}
</body>
</html>
`;
  return html;
}

/**
 * Free-tier leak-report upsell block (spec 1.6.1) -- rendered by
 * src/buildContent.js or wherever the leak report result view lives, not
 * this file, since this file only owns the pack pages themselves. Exported
 * here (rather than duplicated) since it needs pack metadata (id/title/
 * lineCount) this module already types.
 *
 * @param {object} pack the matching pack for the user's detected band+color
 *   (spec: "Shown only when a pack exists ... Otherwise the block is
 *   omitted entirely").
 */
function renderLeakReportUpsell(pack) {
  if (!pack) return '';
  return `<div class="pack-upsell pack-statement">
    <h2>${escapeHtml(pack.upsellHeadline || `The ${escapeHtml(pack.title)} pack covers this.`)}</h2>
    <p>${pack.upsellBody || ''} <a class="pack-upsell-link" href="${escapeHtml(siteRelativeHref(packDetailFilename(pack.id)))}">See what&rsquo;s in it &rarr;</a></p>
  </div>`;
}

module.exports = {
  PRICE_USD,
  disclosedLimitations,
  packsIndexFilename,
  packDetailFilename,
  packSampleFilename,
  packOgImageFilename,
  boardFromFen,
  collectContentsRows,
  renderPacksIndexPage,
  renderPackDetailPage,
  renderLeakReportUpsell,
};
