'use strict';

/**
 * Repertoire Pack build script -- orchestrates src/buildPack.js's pure tree
 * builder against live Opening Explorer data (or data/aggregates/ once it
 * exists -- same automatic source-swap every other builder in this repo
 * already gets from src/explorerSource.js), then writes the four sellable
 * files plus a free sample.pgn for each pack in the launch catalogue
 * (Repertoire Pack build plan, section 1.1: exactly two
 * packs -- white-1400-1600, black-vs-e4-1400-1600).
 *
 * Like scripts/build-og-image.js, this is a LOCAL, run-by-hand generator,
 * NOT part of `npm run build:static` -- the main static build must not
 * depend on a browser (Playwright) being available, and pack generation
 * hits the live Explorer API (through the same on-disk cache every other
 * builder uses -- Non-Negotiable 3, "not a fresh live burst") which the
 * CI build environment has no token for anyway:
 *
 *   node scripts/buildPacks.js [pack-id ...]
 *
 * Output goes to packs/<id>/ at the repo root -- gitignored (see
 * .gitignore's new "Generated Repertoire Pack artifacts" section): these
 * are the $9 sellable product, not site content, so they must never land
 * in the public repo the way assets/og-default.png (free site artwork)
 * does. The human copies packs/<id>/* by hand into the merchant listing
 * once one exists (ALWAYS ESCALATE -- account/ToS creation is not this
 * script's job, see the spec's section 5).
 *
 * sample.pgn is the ONE file in each pack directory that's free-tier
 * content per spec 1.6.3 (a real, complete, independently-useful excerpt,
 * not a teaser) -- a future M2 build step re-runs this script or copies
 * packs/<id>/sample.pgn into dist/ to actually serve it publicly; that
 * wiring is out of this script's scope (M1 is the generator only).
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const {
  buildPackTree,
  pgnFromTree,
  packJsonFromResult,
  readmeText,
  pruneToTopLines,
} = require('../src/buildPack');
const { withExplorerCache } = require('../src/explorerCache');
const { actualPoolSpeeds, poolDisclosure } = require('../src/explorerSource');
const { DESIGN_TOKENS, THEME_ROLES, designTokensCss } = require('../src/render');
const { renderBoardDiagram, spriteDefsHtml } = require('../src/boardSvg');
const { SITE_ORIGIN, SITE_NAME } = require('../src/site');

const PACKS_DIR = path.join(__dirname, '..', 'packs');
const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'fraunces-variable.woff2');

const CATALOGUE = [
  {
    id: 'white-1400-1600',
    title: 'White at 1400-1600',
    color: 'white',
    band: '1400-1600',
    firstMoveUci: 'e2e4',
  },
  {
    id: 'black-vs-e4-1400-1600',
    title: 'Black vs 1.e4 at 1400-1600',
    color: 'black',
    band: '1400-1600',
    firstMoveUci: 'e2e4',
  },
];

const SAMPLE_LINE_COUNT = 47; // spec 1.6.3
const PDF_BRANCH_POINTS = 16; // spec 1.2 item 3: "the ~14-20 nodes with the highest reach"

// Same shape as buildStatic.js's politeFetch (retry-on-429), but this
// script's request pattern is bursty in a way buildStatic.js's isn't --
// buildPackTree's tie-break lookahead and size-cap retries can fire many
// requests back-to-back with zero natural pacing between them, which
// tripped Lichess's rate limiter hard enough that even 6 retries at a
// flat 5s backoff still exhausted (observed directly running this
// script). Two changes from buildStatic.js's version: (1) a fixed
// minimum gap between every request, successful or not, so this script
// is a better citizen instead of only slowing down after it's already
// been throttled; (2) more attempts with real exponential backoff, since
// a single missed pack-generation position means a wrong or incomplete
// pack, not a merely-slower page build.
const MIN_REQUEST_GAP_MS = 400;
let lastRequestAt = 0;

async function politeFetch(url, options) {
  const sinceLast = Date.now() - lastRequestAt;
  if (sinceLast < MIN_REQUEST_GAP_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_GAP_MS - sinceLast));
  }

  const MAX_ATTEMPTS = 10;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    lastRequestAt = Date.now();
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt === MAX_ATTEMPTS) return response;
    const retryAfterHeader = response.headers && typeof response.headers.get === 'function'
      ? Number(response.headers.get('retry-after'))
      : NaN;
    const backoffMs = Math.min(60000, 2 ** attempt * 1000); // 2s, 4s, 8s, ... capped at 60s
    const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : backoffMs;
    console.log(`  rate-limited, waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return fetch(url, options);
}

/** Plain {square: FEN-piece-letter} board object from a FEN's placement field. */
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

function pctText(fraction) {
  return typeof fraction === 'number' ? `${(fraction * 100).toFixed(1)}%` : '?';
}

/** Every OUR-move node in the tree, flattened, sorted by reach descending. */
function ourMoveNodesByReach(root) {
  const out = [];
  function visit(node) {
    if (node.isOurMove && node.n != null) out.push(node);
    for (const child of node.children || []) visit(child);
  }
  visit(root);
  return out.sort((a, b) => (b.reach || 0) - (a.reach || 0));
}

/**
 * WDL stacked-bar SVG for one move's own w/d/l counts -- same viewBox/rect
 * technique as src/render.js's renderRepertoireNode() (documented there as
 * kept independently in sync rather than shared, since that file is also
 * concatenated into the browser bundle and can't pull in a Node-only PDF
 * helper). Percentages are of THIS move's own n (win/draw/loss for the
 * mover), not of the position total.
 */
function wdlBarHtml(node) {
  const n = node.n || 0;
  const winPct = n > 0 ? (node.w / n) * 100 : 0;
  const drawPct = n > 0 ? (node.d / n) * 100 : 0;
  const lossPct = n > 0 ? (node.l / n) * 100 : 0;
  // fill set via style="" (CSS-parsed), not a plain fill="" XML attribute
  // (which does not reliably resolve var() references) -- same reasoning
  // src/render.js's renderRepertoireNode() documents for its own wdl bar.
  return `<svg class="wdl-bar" viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label="${node.side} win/draw/loss for this move: ${winPct.toFixed(1)}% / ${drawPct.toFixed(1)}% / ${lossPct.toFixed(1)}%">
    <rect x="0" y="0" width="${winPct}" height="12" style="fill:var(--color-win)"></rect>
    <rect x="${winPct}" y="0" width="${drawPct}" height="12" style="fill:var(--color-draw)"></rect>
    <rect x="${winPct + drawPct}" y="0" width="${lossPct}" height="12" style="fill:var(--color-loss)"></rect>
  </svg>`;
}

/**
 * `:root { ... }` block plus page rules, all consuming CSS custom
 * properties -- never a JS-side DESIGN_TOKENS[...] lookup for a token that
 * only exists as a THEME_ROLES semantic alias (--color-win, --color-bg,
 * --color-muted, --color-accent-dark, --color-board-light/-dark, etc. are
 * NOT in DESIGN_TOKENS itself -- see that object's own module doc: it's
 * the ramp + type/spacing/motion primitives only. THEME_ROLES.light is the
 * light-theme semantic layer on top, which is what a printed PDF should
 * use -- there's no dark-mode toggle on paper). Light theme only, by the
 * same reasoning.
 */
function pdfStylesheet(fontDataUri) {
  const rootCss = `${designTokensCss(DESIGN_TOKENS)}\n${designTokensCss(THEME_ROLES.light)}`;
  return `
    :root { ${rootCss} }
    @font-face {
      font-family: 'Fraunces Variable';
      font-style: normal;
      font-weight: 100 900;
      src: url('${fontDataUri}') format('woff2-variations');
    }
    * { box-sizing: border-box; }
    body {
      font-family: var(--font-sans);
      color: var(--color-text);
      background: var(--color-bg);
      margin: 0;
    }
    h1, h2, h3 { font-family: var(--font-serif); color: var(--color-accent-dark); margin: 0 0 8px; }
    .page { page-break-after: always; padding: 32px 40px; min-height: 90vh; }
    .page:last-child { page-break-after: auto; }
    .cover h1 { font-size: 32px; }
    .cover .subtitle { font-size: 15px; color: var(--color-muted); margin-bottom: 24px; max-width: 68ch; }
    .cover .meta { font-size: 12px; color: var(--color-muted); margin-top: 24px; }
    .cover .statement { font-size: 13px; margin: 16px 0; padding: 12px 0; border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); }
    .cover ul.limits { font-size: 12px; color: var(--color-muted); padding-left: 18px; }
    .branch-header { font-size: 12px; color: var(--color-muted); margin-bottom: 12px; }
    .board { display: grid; grid-template-columns: repeat(8, 44px); grid-template-rows: repeat(8, 44px); width: 352px; border: 1px solid var(--color-border); }
    .board-sq { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; }
    .board-sq--light { background: var(--color-board-light); }
    .board-sq--dark { background: var(--color-board-dark); }
    .board-piece { width: 36px; height: 36px; }
    .branch-move { font-family: var(--font-serif); font-size: 20px; margin: 16px 0 6px; }
    .wdl-bar { width: 300px; height: 14px; display: block; margin: 6px 0; }
    .justification { font-size: 13px; max-width: 60ch; }
    table.appendix { border-collapse: collapse; font-size: 11px; width: 100%; }
    table.appendix th, table.appendix td { border-bottom: 1px solid var(--color-border); padding: 4px 6px; text-align: left; }
    .footer-note { position: absolute; bottom: 16px; font-size: 9px; color: var(--color-muted); }
  `;
}

function coverPageHtml(packJson) {
  return `<section class="page cover">
    <h1>${packJson.title}</h1>
    <p class="subtitle">Every move picked by one rule, printed below, from Lichess games in your band. Sample size and score range next to each one. ${packJson.line_count} lines, ${packJson.position_count} annotated positions.</p>
    <p class="statement">Buying this pack changes nothing on the site it came from. No opening is ranked higher, recommended, or featured because this pack exists for it. The rankings come from the same query whether you buy it or not, and the rule that picked these moves is printed below in full.</p>
    <h3>How this pack was built</h3>
    <p class="justification">Rule version ${packJson.rule_version}. Data: Lichess Opening Explorer, database "lichess", speeds ${packJson.speeds.join('/')}, rating band ${packJson.band}, retrieved ${packJson.retrieved}. At each of our own decision points, the pack plays the candidate move (n &gt;= 300) with the highest confidence-interval lower bound on score (wins plus half of draws, divided by games). At each opponent decision point, the pack includes replies in descending frequency until they cover at least 90% of games at that position, dropping any reply below 1.5% frequency or below 300 games (this run used a ${(packJson.threshold_used * 100).toFixed(1)}% floor).</p>
    <h3>Disclosed limitations</h3>
    <ul class="limits">
      <li>Score is a sample mean (wins + 0.5 &times; draws / games), not a win/loss proportion; its confidence interval uses a normal approximation, not a binomial Wilson interval.</li>
      <li>Not transposition-aware: the same position reached by a different move order may be counted separately. Pack size is stated in "lines," not "positions covered."</li>
      <li>Data pool is ${poolDisclosure(packJson.speeds)}.</li>
      <li>The chosen move is the highest lower-bound scorer among moves with enough games in this band -- not a claim it is objectively best.</li>
    </ul>
    <p class="meta">Data source: Lichess (database.lichess.org), released under CC0. This pack is a derived work; it is not affiliated with or endorsed by Lichess. Not affiliated with ${SITE_NAME}'s upstream data provider beyond that license.</p>
  </section>`;
}

function branchPageHtml(node, index) {
  const board = boardFromFen(node.fen);
  const label = `Position before ${node.side}'s move ${Math.floor(node.ply / 2) + 1}`;
  const [low, high] = node.wilson || [null, null];
  return `<section class="page branch">
    <div class="branch-header">Branch point ${index + 1} -- ply ${node.ply}</div>
    ${renderBoardDiagram(board, { flip: node.side === 'black', label })}
    <div class="branch-move">${node.side === 'white' ? 'White' : 'Black'} plays ${node.san}</div>
    ${wdlBarHtml(node)}
    <p class="justification">In ${node.n.toLocaleString()} games in this band, ${node.san} scores ${pctText(node.score)} for ${node.side} (confidence-interval lower bound ${pctText(low)}, upper bound ${pctText(high)}). Reach: ${pctText(node.reach)} of games following this repertoire arrive at this position.</p>
  </section>`;
}

function appendixPageHtml(packJson) {
  const ourMoves = packJson.positions.filter((p) => p.isOurMove && p.n != null);
  const rows = ourMoves
    .map((p) => `<tr><td>${p.ply}</td><td>${p.side}</td><td>${p.san}</td><td>${p.n.toLocaleString()}</td><td>${pctText(p.score)}</td><td>${pctText(p.reach)}</td></tr>`)
    .join('');
  return `<section class="page appendix">
    <h2>Full move list</h2>
    <table class="appendix">
      <thead><tr><th>Ply</th><th>Side</th><th>Move</th><th>Games (n)</th><th>Score</th><th>Reach</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function studyGuideHtml({ packJson, branchNodes, fontDataUri }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${pdfStylesheet(fontDataUri)}</style></head>
<body>
  ${spriteDefsHtml()}
  ${coverPageHtml(packJson)}
  ${branchNodes.map((node, i) => branchPageHtml(node, i)).join('\n')}
  ${appendixPageHtml(packJson)}
</body></html>`;
}

async function generatePdf(browser, html, outFile) {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({ path: outFile, format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  } finally {
    await page.close();
  }
}

async function buildOnePack(def, { browser, fetchImpl, retrieved }) {
  console.log(`Building pack "${def.id}"...`);
  // Which pool THIS run actually draws from -- see src/explorerSource.js's
  // actualPoolSpeeds() doc. No aggregatesDir override here, matching
  // buildPackTree()'s own default below.
  const speeds = actualPoolSpeeds();
  const result = await buildPackTree({
    ratingBand: def.band,
    color: def.color,
    firstMoveUci: def.firstMoveUci,
    speeds,
    fetchImpl,
  });

  const packJson = packJsonFromResult(result, { id: def.id, title: def.title, speeds, retrieved });
  const pgn = pgnFromTree(result.tree, {
    Event: `${SITE_NAME} Repertoire Pack`,
    Site: SITE_ORIGIN,
    Date: retrieved.replace(/-/g, '.'),
    Round: '-',
    White: def.color === 'white' ? def.title : '?',
    Black: def.color === 'black' ? def.title : '?',
    Result: '*',
  });

  const sampleTree = pruneToTopLines(result.tree, SAMPLE_LINE_COUNT);
  const samplePgn = pgnFromTree(sampleTree, {
    Event: `${SITE_NAME} Repertoire Pack (free sample)`,
    Site: SITE_ORIGIN,
    Date: retrieved.replace(/-/g, '.'),
    Round: '-',
    White: def.color === 'white' ? def.title : '?',
    Black: def.color === 'black' ? def.title : '?',
    Result: '*',
  });

  // refreshPromiseVerified stays false: no merchant is chosen yet (spec
  // 1.4 -- the human's choice), so no refresh mechanism has been verified
  // to actually exist. Do not promise it here (spec 1.2 item 4).
  const readme = readmeText(packJson, { siteUrl: SITE_ORIGIN, refreshPromiseVerified: false });

  const outDir = path.join(PACKS_DIR, def.id);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'repertoire.pgn'), pgn, 'utf8');
  fs.writeFileSync(path.join(outDir, 'pack.json'), JSON.stringify(packJson, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'README.txt'), readme, 'utf8');
  fs.writeFileSync(path.join(outDir, 'sample.pgn'), samplePgn, 'utf8');

  const fontDataUri = `data:font/woff2;base64,${fs.readFileSync(FONT_PATH).toString('base64')}`;
  const branchNodes = ourMoveNodesByReach(result.tree).slice(0, PDF_BRANCH_POINTS);
  const html = studyGuideHtml({ packJson, branchNodes, fontDataUri });
  await generatePdf(browser, html, path.join(outDir, 'study-guide.pdf'));

  console.log(`  ${packJson.line_count} lines, ${packJson.position_count} positions, threshold used ${(packJson.threshold_used * 100).toFixed(1)}%.`);
  console.log(`  Wrote ${outDir}/{repertoire.pgn, pack.json, README.txt, sample.pgn, study-guide.pdf}`);
  return { def, packJson };
}

async function main() {
  const requestedIds = process.argv.slice(2);
  const packs = requestedIds.length > 0 ? CATALOGUE.filter((p) => requestedIds.includes(p.id)) : CATALOGUE;
  if (packs.length === 0) {
    console.error(`No matching pack id(s). Known ids: ${CATALOGUE.map((p) => p.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const retrieved = new Date().toISOString().slice(0, 10);
  const fetchImpl = withExplorerCache(politeFetch); // Non-Negotiable 3: cached, not a fresh live burst
  const browser = await chromium.launch();
  try {
    for (const def of packs) {
      await buildOnePack(def, { browser, fetchImpl, retrieved });
    }
  } finally {
    await browser.close();
  }
  console.log('Done. packs/ is gitignored -- hand these files to the chosen merchant listing once one exists (human action, see spec section 5).');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('buildPacks failed:', err.stack || err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  CATALOGUE,
  boardFromFen,
  ourMoveNodesByReach,
  wdlBarHtml,
  studyGuideHtml,
  buildOnePack,
};
