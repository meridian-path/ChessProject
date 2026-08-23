'use strict';

/**
 * Shared "board" building blocks for both the static (no-JS) SSR diagram
 * used on content pages and, eventually, the interactive component
 * (src/boardWidget.js) a later build's live pages will mount: one visual
 * component, three modes (static/replay/free), same markup and tokens in
 * all three -- only the controller differs. This module owns the markup
 * and the piece-sprite provenance; boardWidget.js owns the
 * cm-chessboard-driven controller for the replay/free modes.
 *
 * Server-only (reads a file from disk with `fs`) -- like renderContent.js,
 * this module is NEVER require()'d into anything esbuild bundles for the
 * browser (see renderContent.js's own header comment for why that
 * separation matters: render.js/renderContent.js's browser-bundled
 * siblings can't use Node's `fs`). Do not import this file from
 * src/browser/*.client.js or from src/boardWidget.js.
 *
 * Piece artwork: assets/pieces/cburnett-standard.svg, vendored verbatim
 * from cm-chessboard 8.13.0's assets/pieces/standard.svg (itself the
 * Cburnett/Rfc1394 Wikimedia Commons originals, modified by shaack for
 * cm-chessboard) -- CC BY-SA 3.0, commercial use permitted, attribution
 * required. See assets/pieces/CBURNETT-LICENSE.txt. Deliberately NOT
 * cm-chessboard's default "staunty.svg" set, which is CC BY-NC-SA 4.0
 * (NonCommercial) and therefore unusable on this AdSense-monetised site --
 * verified by reading both files' own license headers, not the README.
 */

const fs = require('fs');
const path = require('path');
const { FILES, RANKS } = require('./chessPosition');

const SPRITE_PATH = path.join(__dirname, '..', 'assets', 'pieces', 'cburnett-standard.svg');

// cm-chessboard's own runtime (ChessboardView.js#cacheSpriteToDiv) looks for
// an element with this exact id before issuing an XMLHttpRequest for the
// sprite file. By pre-embedding the sprite under this id at SSR/build time
// (see spriteDefsHtml() below), any page -- static diagram or a future
// interactive board -- resolves every `<use href="#wp">` from the DOM with
// zero network requests, which is what keeps the file:// invariant intact
// (a runtime fetch of a local file is blocked by CORS in some browsers) and
// avoids a duplicate request when a page carries more than one board.
const SPRITE_WRAPPER_ID = 'cm-chessboard-sprite';

const PIECE_NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

let cachedSpriteInner = null;

/**
 * Reads assets/pieces/cburnett-standard.svg once (cached for the life of
 * the process -- this runs at build time, never per-request) and returns
 * just the inner markup of its root <svg> element (the twelve <g id="wp">
 * .. <g id="bp"> piece groups), with the XML declaration and the license
 * comment stripped so it isn't duplicated as an HTML comment on every page
 * that embeds it. The license text itself lives in
 * assets/pieces/CBURNETT-LICENSE.txt and the file on disk keeps its header
 * intact -- only this in-memory, per-page copy is trimmed.
 */
function readSpriteInner() {
  if (cachedSpriteInner !== null) return cachedSpriteInner;
  const raw = fs.readFileSync(SPRITE_PATH, 'utf8');
  const svgStart = raw.indexOf('<svg');
  const svgEnd = raw.lastIndexOf('</svg>');
  if (svgStart === -1 || svgEnd === -1) {
    throw new Error(`boardSvg: could not find an <svg>...</svg> root element in ${SPRITE_PATH}`);
  }
  const openTagEnd = raw.indexOf('>', svgStart);
  cachedSpriteInner = raw.slice(openTagEnd + 1, svgEnd).trim();
  return cachedSpriteInner;
}

/**
 * Returns the hidden, page-level sprite-definitions block. A caller
 * includes this HTML fragment exactly ONCE per page (anywhere inside
 * <body> -- position doesn't matter, SVG `<use href="#id">` resolves by id
 * against the whole document) before rendering any board on that page.
 * Hidden with `position:absolute` + zero size rather than `display:none`,
 * matching cm-chessboard's own technique -- `display:none` on an ancestor
 * can stop a browser from resolving a `<use>` reference to a descendant,
 * this combination does not.
 */
function spriteDefsHtml() {
  // `.sprite-defs-hidden` (src/render.js's SITE_CSS) carries the exact same
  // position:absolute;width:0;height:0;overflow:hidden rule this used to
  // set inline -- moved to a class so no page ships a style="..." attribute
  // (html-validate's no-inline-style rule), with byte-identical CSS applied.
  return `<div id="${SPRITE_WRAPPER_ID}" class="sprite-defs-hidden" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg">${readSpriteInner()}</svg></div>`;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One square's piece as an inline SVG referencing the shared sprite (see
 * spriteDefsHtml() above) via `<use>` -- deterministic vector artwork,
 * replacing the old per-platform Unicode glyph + text-shadow hack this
 * function's callers used to render. `viewBox="0 0 40 40"` matches the
 * sprite's own coordinate space (cburnett-standard.svg's tileSize), so the
 * piece scales to fill whatever CSS size its containing square gives it.
 */
function pieceMarkupHtml(piece) {
  if (!piece) return '';
  const isWhite = piece === piece.toUpperCase();
  const id = `${isWhite ? 'w' : 'b'}${piece.toLowerCase()}`;
  return `<svg class="board-piece" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`;
}

/**
 * One square's rank/file coordinate label(s), matching Lichess's own
 * placement convention (docs/design/REFERENCE_LIBRARY.md entry 3: "conform
 * to its interaction conventions... board orientation" -- coordinates are
 * part of that same orientation convention this audience reads daily):
 * the file letter (a-h) sits in the bottom-left corner of each square in
 * the board's bottom row, the rank number (1-8) sits in the top-left
 * corner of each square in the board's left column -- the corner square
 * gets both. Neither label is added anywhere else, matching Lichess's own
 * restraint (no repeated labels on every square).
 *
 * @param {boolean} isBottomRow this square is in the row nearest the
 *   viewer (rank 1 in the normal orientation, rank 8 when `flip` is set).
 * @param {boolean} isLeftColumn this square is in the column nearest the
 *   viewer's left edge (file a normally, file h when `flip` is set).
 */
function coordLabelsHtml(file, rank, isBottomRow, isLeftColumn) {
  if (!isBottomRow && !isLeftColumn) return '';
  const fileLabel = isBottomRow ? `<span class="board-coord board-coord--file" aria-hidden="true">${escapeAttr(file)}</span>` : '';
  const rankLabel = isLeftColumn ? `<span class="board-coord board-coord--rank" aria-hidden="true">${escapeAttr(rank)}</span>` : '';
  return fileLabel + rankLabel;
}

/**
 * Static (no-JS) board diagram: the same `.board`/`.board-sq` grid and
 * `--color-board-light`/`--color-board-dark` tokens the site already used
 * for its Unicode diagrams (src/render.js's SITE_CSS, unchanged), with SVG
 * piece artwork instead of glyphs. `label` becomes the whole board's
 * aria-label (role="img") -- there is no per-square interaction here, so a
 * single sentence describing the position is the right amount of
 * assistive-tech detail, same as the diagram this replaces. Rank/file
 * coordinate labels (a-h, 1-8) are decorative and aria-hidden -- the
 * board's own aria-label already names the position in words, so a screen
 * reader gains nothing from also announcing 64 individual square labels.
 *
 * @param {Record<string,string>} board square -> FEN piece letter
 * @param {{flip?: boolean, label?: string}} opts
 */
function renderBoardDiagram(board, { flip = false, label = '' } = {}) {
  const fileOrder = flip ? [...FILES].reverse() : FILES;
  const rankOrder = flip ? RANKS : [...RANKS].reverse();
  const bottomRank = rankOrder[rankOrder.length - 1];
  const leftFile = fileOrder[0];
  const squares = [];
  for (const rank of rankOrder) {
    for (const file of fileOrder) {
      const square = `${file}${rank}`;
      const isDark = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 0;
      const coords = coordLabelsHtml(file, rank, rank === bottomRank, file === leftFile);
      squares.push(
        `<span class="board-sq board-sq--${isDark ? 'dark' : 'light'}">${coords}${pieceMarkupHtml(board[square])}</span>`
      );
    }
  }
  return `<div class="board" role="img" aria-label="${escapeAttr(label)}">${squares.join('')}</div>`;
}

/**
 * Required CC BY-SA 3.0 attribution line for the piece artwork -- a real
 * credit, not a disclaimer. Callers append this to whatever footer copy a
 * page already builds (see renderContent.js's renderOpeningPage), never as
 * a standalone page.
 */
function pieceAttributionHtml() {
  return 'Board pieces: the Cburnett chess set from <a href="https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces/Standard" rel="noopener noreferrer">Wikimedia Commons</a>, licensed <a href="https://creativecommons.org/licenses/by-sa/3.0/" rel="noopener noreferrer">CC BY-SA 3.0</a>.';
}

module.exports = {
  SPRITE_WRAPPER_ID,
  PIECE_NAMES,
  spriteDefsHtml,
  pieceMarkupHtml,
  renderBoardDiagram,
  pieceAttributionHtml,
  // exported for tests only (avoids re-reading the file / re-deriving the
  // strip logic in test/boardSvg.test.js)
  readSpriteInner,
};
