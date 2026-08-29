'use strict';

/**
 * Rendering layer: a pure function that turns already-processed data into an
 * HTML string. No framework, no templating engine -- just template
 * literals. Kept separate from build.js/server.js so it can be reused by
 * both the static generator and the local dev server.
 *
 * This file is also require()'d (transitively, via
 * src/browser/playerLookup.client.js) into the client-side bundle that runs
 * directly in a visitor's browser for the static player-lookup page --
 * bundled with esbuild (see buildStatic.js's bundleBrowserEntry()) into one
 * self-contained IIFE, so ordinary CommonJS module.exports here is exactly
 * what that bundler expects. The shared design system below (SITE_CSS)
 * is defined as plain constants right here, not pulled
 * in from a separate module, so render.js stays the single source of truth
 * for markup AND styling that both server.js and buildStatic.js import
 * from, with nothing to drift.
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes only what's structurally required inside an HTML *text node*
 * (& and < -- > is escaped too, defense-in-depth, though not strictly
 * required outside of closing a comment/CDATA section). Quotes need no
 * escaping there, unlike escapeHtml() above, which also escapes them
 * because most of its call sites interpolate into either a text node or an
 * attribute value and it's simplest to always be safe for both.
 *
 * Used specifically for <title> content: escapeHtml()'s attribute-safe
 * quote-escaping was turning every apostrophe into the 5-character
 * "&#39;" -- inflating an opening/family name's *rendered source* length
 * well past html-validate's long-title 70-char budget (that rule reads
 * node.textContent, i.e. the raw, still-encoded source text, not the
 * decoded string a browser or search result actually shows) even though
 * the real, decoded title text was comfortably under it.
 */
function escapeHtmlText(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Typographic-apostrophe normalization for opening/family DISPLAY NAMES
 * rendered into visible prose -- craft-audit instance 8's fix for the
 * sitewide straight-vs-curly apostrophe mix (433 straight/71 pages).
 *
 * Deliberately NOT a change to escapeHtml() itself: that function's output
 * also feeds attribute values, SVG <title> text, and (via
 * structuredData.js's own decode step) JSON-LD, all of which must keep the
 * plain ASCII apostrophe -- see that file's own comment. Converts an
 * apostrophe immediately preceded by a word character (Queen's, King's,
 * Bird's -- and also a bare trailing possessive like Reynolds', Adams',
 * where nothing follows the apostrophe but a word boundary) from
 * escapeHtml()'s &#39; to the typographic &rsquo; design-standards.md's
 * craft floor requires in prose -- the right single quote glyph is the
 * correct typographic form for both shapes. Call sites for attributes, SVG
 * title text, or non-display-name data keep plain escapeHtml().
 */
function displayName(str) {
  return escapeHtml(str).replace(/(\w)&#39;/g, '$1&rsquo;');
}

/**
 * Same normalization as displayName() above, for the one call site
 * (renderDocumentHead's <title>) that uses escapeHtmlText() instead of
 * escapeHtml() -- escapeHtmlText() never escapes a quote at all (see its
 * own comment), so a straight apostrophe reaches <title> as a literal
 * ASCII character rather than an &#39; entity, and needs the literal-
 * character form of this same swap.
 */
function displayNameText(str) {
  return escapeHtmlText(str).replace(/(\w)'/g, '$1’');
}

/**
 * Render-time formatter for a win/draw/loss (or any other) percentage
 * value. The data layer (src/process.js, src/processOpenings.js,
 * src/processRepertoire.js) stores Number(x.toFixed(1)) so values stay
 * numeric for sorting/comparison -- but that Number() wrapper silently
 * drops a trailing zero (the number 4 prints as "4", not "4.0"), which is
 * why percentages were dropping trailing zeros site-wide. Re-applying
 * toFixed(1) here, once, at the point every percentage is actually printed,
 * is what keeps one consistent decimal precision everywhere without
 * touching how the data layer stores or sorts these values.
 */
function formatPct(n) {
  return typeof n === 'number' ? n.toFixed(1) : '-';
}

/**
 * Single source of truth for every color, size, and spacing value on the
 * site. Nothing below this block may introduce a new hex or raw px value
 * (test/designTokens.test.js enforces this for hex; see that file for the
 * exact allowlist). Kept as a plain JS object (not a CSS string) so it
 * stays independently greppable/inspectable, then interpolated into
 * SITE_CSS's :root block below via designTokensCss(). This can't live in
 * its own module -- render.js is concatenated verbatim into the browser
 * bundle (see this file's header comment) and has no CommonJS loader in
 * that context -- so it stays a same-file constant, same reasoning as
 * SITE_CSS already being defined directly here rather than required() from
 * elsewhere.
 *
 * This is the VALUE layer only -- ramps of perceptual lightness steps, plus
 * every non-color scale (type, space, radius, shadow, motion, grid, focus).
 * The color ROLE layer (which ramp index means "body text" vs "muted", and
 * how that differs light vs dark) is THEME_ROLES below, not here -- same
 * two-layer split lol-practice-system/src/web/tokens.css already uses
 * ("existing semantic names are kept and now assigned FROM the ramps
 * below"), same ladder construction, different hue seeds (this asset keeps
 * its own warm parchment/green identity; see docs/DESIGN_PLAYBOOK.md Part 3
 * Step 4 -- "all three assets run the same generator with different seeds").
 */
const DESIGN_TOKENS = {
  '--font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  // Self-hosted OFL variable display face (see the @font-face block in
  // SITE_CSS below and assets/fonts/), headings only -- Georgia stays as the
  // fallback stack for the brief render before the woff2 loads and for any
  // browser that can't use the webfont at all. Only h1/h2/h3 and the site
  // wordmark (.brand) use this token; body copy, UI chips, table numerals,
  // and stat numbers are pinned to --font-sans directly (not through this
  // token) so reading/data legibility can't regress.
  '--font-serif': '"Fraunces Variable", Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',

  // ---------------------------------------------------------------------
  // Color ramps -- one shared luminance ladder (relative-luminance Y
  // geometric in Y+0.05, ratio 1.365, anchored at index 0 = today's
  // parchment), six hues. Index is the only thing that matters for
  // contrast: any two indices >=5 apart clear 4.74:1, >=4 apart clear
  // 3.47:1, guaranteed across every ramp because they all share one
  // ladder (see test/designTokens.test.js assertion iv, which checks this
  // by construction rather than by eyeballing each pair). oklch() is the
  // source of truth; the hex comment is what a browser actually paints it
  // as (belt-and-braces reference only, not a CSS fallback chain -- same
  // convention as the sibling asset's tokens.css). Where a value is
  // gamut-clamped at a given lightness the requested chroma was reduced;
  // the luminance the contrast guarantee rests on is exact regardless.
  // ---------------------------------------------------------------------
  '--color-ink-0': 'oklch(95.8% 0.015 90)', // #F5F1E6 -- today's parchment bg
  '--color-ink-1': 'oklch(85.8% 0.028 90)', // #D7D0BC
  '--color-ink-2': 'oklch(76.6% 0.032 90)', // #BBB29C
  '--color-ink-3': 'oklch(68.1% 0.030 90)', // #A09884
  '--color-ink-4': 'oklch(60.2% 0.026 90)', // #87806F
  '--color-ink-5': 'oklch(52.7% 0.022 90)', // #706B5D
  '--color-ink-6': 'oklch(45.4% 0.018 90)', // #5A564B
  '--color-ink-7': 'oklch(38.1% 0.014 90)', // #45423A
  '--color-ink-8': 'oklch(30.1% 0.010 90)', // #302E28
  '--color-ink-9': 'oklch(18.7% 0.008 90)', // #14130F -- the dark ground
  '--color-paper-white': '#FFFFFF', // one off-ramp value, strictly lighter
  // than ink-0, so every contrast guarantee holds in the safe direction
  // (documented exemption, same as the sibling's --color-bg-white).
  '--color-ink-black': '#000000', // the paper-white exemption's opposite
  // number: one off-ramp value, strictly darker than ink-9, for the one
  // case (.board-coord below) that needs more margin than the ramp floor
  // gives. ink-9 alone clears every board-square/theme combination except
  // dark theme's darkest square (#8A7B54, ~4.46:1 -- just under the 4.5:1
  // floor); pure black clears all four with real margin (5.04:1 worst
  // case). Not theme-dependent -- like paper-white, emitted once in
  // DESIGN_TOKENS rather than duplicated per THEME_ROLES entry.

  '--color-accent-0': 'oklch(95.6% 0.020 158)', // #E6F5EB
  '--color-accent-1': 'oklch(85.3% 0.045 158)', // #B7D8C3
  '--color-accent-2': 'oklch(75.8% 0.065 158)', // #8EBEA1
  '--color-accent-3': 'oklch(67.1% 0.080 158)', // #6AA583
  '--color-accent-4': 'oklch(59.2% 0.085 158)', // #4F8D6A
  '--color-accent-5': 'oklch(51.7% 0.080 158)', // #3C7656 -- today's --color-accent
  '--color-accent-6': 'oklch(44.6% 0.070 158)', // #2F6045 -- today's --color-accent-dark
  '--color-accent-7': 'oklch(37.5% 0.055 158)', // #254A36
  '--color-accent-8': 'oklch(29.6% 0.040 158)', // #1A3325
  '--color-accent-9': 'oklch(18.4% 0.028 158)', // #07160E

  '--color-win-0': 'oklch(95.6% 0.020 149)', // #E8F5E9
  '--color-win-1': 'oklch(85.2% 0.050 149)', // #B9D8BD
  '--color-win-2': 'oklch(75.7% 0.080 149)', // #8DBF95
  '--color-win-3': 'oklch(67.0% 0.100 149)', // #67A673
  '--color-win-4': 'oklch(58.9% 0.120 149)', // #429054 -- bar fill, both themes
  '--color-win-5': 'oklch(51.5% 0.115 149)', // #2E7941
  '--color-win-6': 'oklch(44.4% 0.100 149)', // #236233 -- light-theme win text
  '--color-win-7': 'oklch(37.2% 0.080 149)', // #1C4C28
  '--color-win-8': 'oklch(29.5% 0.055 149)', // #17341D -- dark-theme win-bg
  '--color-win-9': 'oklch(18.3% 0.035 149)', // #061709

  '--color-draw-0': 'oklch(95.8% 0.020 87)', // #F7F1E2
  '--color-draw-1': 'oklch(85.8% 0.050 87)', // #DECFAC
  '--color-draw-2': 'oklch(76.6% 0.080 87)', // #C9B077
  '--color-draw-3': 'oklch(68.2% 0.100 87)', // #B4954B
  '--color-draw-4': 'oklch(60.4% 0.120 87)', // #A07B0E -- bar fill, both themes
  '--color-draw-5': 'oklch(52.9% 0.109 87)', // #866600 [clamped]
  '--color-draw-6': 'oklch(45.6% 0.094 87)', // #6D5300 [clamped] -- light-theme draw text
  '--color-draw-7': 'oklch(38.2% 0.080 87)', // #553F00
  '--color-draw-8': 'oklch(30.1% 0.055 87)', // #3A2C07 -- dark-theme draw-bg
  '--color-draw-9': 'oklch(18.8% 0.035 87)', // #1A1201

  '--color-loss-0': 'oklch(96.0% 0.018 29)', // #FEEEEB [clamped]
  '--color-loss-1': 'oklch(86.3% 0.050 29)', // #F1C7BF
  '--color-loss-2': 'oklch(77.5% 0.080 29)', // #E4A398
  '--color-loss-3': 'oklch(69.2% 0.100 29)', // #D38478
  '--color-loss-4': 'oklch(61.7% 0.130 29)', // #C76356 -- bar fill, both themes
  '--color-loss-5': 'oklch(54.3% 0.140 29)', // #B2493D
  '--color-loss-6': 'oklch(46.8% 0.120 29)', // #923B31 -- light-theme loss text
  '--color-loss-7': 'oklch(39.1% 0.090 29)', // #6E3028
  '--color-loss-8': 'oklch(30.7% 0.060 29)', // #4A231E -- dark-theme loss-bg
  '--color-loss-9': 'oklch(19.1% 0.038 29)', // #230D0A

  '--color-focus-0': 'oklch(96.0% 0.020 52)', // #FDEEE6
  '--color-focus-1': 'oklch(86.2% 0.050 52)', // #EDC9B4
  '--color-focus-2': 'oklch(77.2% 0.080 52)', // #DFA786
  '--color-focus-3': 'oklch(68.9% 0.100 52)', // #CC8960 -- dark-theme focus ring
  '--color-focus-4': 'oklch(61.3% 0.130 52)', // #C06B30
  '--color-focus-5': 'oklch(53.9% 0.138 52)', // #AA5202 [clamped] -- light-theme focus ring
  '--color-focus-6': 'oklch(46.5% 0.120 52)', // #8C4200
  '--color-focus-7': 'oklch(38.9% 0.090 52)', // #69340D
  '--color-focus-8': 'oklch(30.6% 0.060 52)', // #472610
  '--color-focus-9': 'oklch(19.0% 0.038 52)', // #210E04

  '--text-xs': '0.75rem',
  '--text-sm': '0.875rem',
  '--text-base': '1rem',
  '--text-md': '1.125rem',
  '--text-lg': '1.375rem',
  '--text-xl': '1.75rem',
  '--text-2xl': 'clamp(2rem, 1.55rem + 1.9vw, 2.75rem)',

  '--leading-tight': '1.15',
  '--leading-snug': '1.3',
  '--leading-normal': '1.6',
  '--leading-relaxed': '1.75',

  '--weight-regular': '400',
  '--weight-medium': '600',
  '--weight-bold': '700',

  // Paired type-role tokens (design-standards.md: "each step defining
  // size + line-height + weight + letter-spacing together"). Each is a
  // `font:` CSS shorthand (style variant weight size/line-height family)
  // plus a matching -tracking sibling, built from the SAME --text-*/
  // --leading-*/--weight-* scale above (not new numbers) -- this changes
  // how those values are CONSUMED at a handful of central call sites
  // (body, headings, labels, metadata; see SITE_CSS below), not the scale
  // itself. font: shorthand resets font-variant, so any element that also
  // needs tabular-nums re-declares it explicitly after the shorthand --
  // see th.num/td.num in SITE_CSS, which already do, and
  // test/designTokens.test.js's tabular-nums regression check.
  '--type-display': `${'var(--weight-bold)'} ${'var(--text-2xl)'}/${'var(--leading-tight)'} var(--font-serif)`,
  '--type-display-tracking': '-0.02em',
  '--type-page-title': `${'var(--weight-bold)'} ${'var(--text-2xl)'}/${'var(--leading-tight)'} var(--font-serif)`,
  '--type-page-title-tracking': '-0.02em',
  '--type-section': `${'var(--weight-bold)'} ${'var(--text-lg)'}/${'var(--leading-snug)'} var(--font-serif)`,
  '--type-section-tracking': '0em',
  // A second, larger h2 tier for the 2-3 sections per page that carry that
  // page's actual job, using the --text-xl step that previously had no
  // non-mobile consumer. Same weight/family/leading as --type-section --
  // only the size step changes -- so it reads as "the same kind of
  // heading, emphasized" rather than a new heading style.
  '--type-section-lead': `${'var(--weight-bold)'} ${'var(--text-xl)'}/${'var(--leading-snug)'} var(--font-serif)`,
  '--type-section-lead-tracking': '0em',
  '--type-subsection': `${'var(--weight-bold)'} ${'var(--text-md)'}/${'var(--leading-snug)'} var(--font-serif)`,
  '--type-subsection-tracking': '0em',
  '--type-lede': `${'var(--weight-regular)'} ${'var(--text-md)'}/${'var(--leading-relaxed)'} var(--font-sans)`,
  '--type-lede-tracking': '0em',
  '--type-body': `${'var(--weight-regular)'} ${'var(--text-base)'}/${'var(--leading-normal)'} var(--font-sans)`,
  '--type-body-tracking': '0em',
  '--type-compact': `${'var(--weight-regular)'} ${'var(--text-sm)'}/${'var(--leading-normal)'} var(--font-sans)`,
  '--type-compact-tracking': '0em',
  '--type-label': `${'var(--weight-bold)'} ${'var(--text-xs)'}/${'var(--leading-tight)'} var(--font-sans)`,
  '--type-label-tracking': '0.04em',
  '--type-metadata': `${'var(--weight-regular)'} ${'var(--text-xs)'}/${'var(--leading-snug)'} var(--font-sans)`,
  '--type-metadata-tracking': '0.04em',

  '--measure': '68ch',
  '--width-page': '880px',
  '--width-wide': '1120px',

  '--space-1': '0.25rem',
  '--space-2': '0.5rem',
  '--space-3': '0.75rem',
  '--space-4': '1rem',
  '--space-5': '1.5rem',
  '--space-6': '2rem',
  '--space-7': '3rem',
  '--space-8': '4rem',

  // --radius-lg dropped (design-standards.md: max 3 radii) -- grepped
  // repo-wide for this task, it had zero consumers outside its own
  // definition. sm/md/pill remain.
  '--radius-sm': '6px',
  '--radius-md': '10px',
  '--radius-pill': '999px',

  '--border-hairline': '1px',
  '--border-control': '2px',

  // Data-visualization sub-scale: every value below reuses an existing ramp
  // index or space/color role, per design-standards.md ("a new token
  // duplicating an existing value under a different name is itself a QA
  // failure") -- these are new ROLES (chart heights, chart-specific color
  // assignments), not new underlying values.
  '--chart-h-spark': '24px',
  '--chart-h-inline': '96px',
  '--chart-h-hero': '220px',
  '--chart-grid': 'var(--color-ink-2)',
  '--chart-band': 'var(--color-ink-1)',
  '--chart-mark': 'var(--color-accent-5)',
  '--chart-mark-muted': 'var(--color-ink-3)',
  '--chart-domain-lo': '45',
  '--chart-domain-hi': '57',

  // Focus geometry: the portfolio's one shared interaction signature
  // (design-standards.md). --focus-ring-color aliases the theme-role
  // --color-focus (THEME_ROLES below) rather than repeating a ramp index
  // literal here, so it stays correct across both themes automatically.
  '--focus-ring-width': '3px',
  '--focus-ring-offset': '2px',
  '--focus-ring-color': 'var(--color-focus)',

  // Grid. --grid-max aliases --width-wide (same 1120px value) rather than
  // repeating the literal, so test/designTokens.test.js's "no two tokens
  // share a value under different names" check has nothing to catch here.
  // Column classes are declared for B2/B5 to apply to the two-panel pages
  // (explorer, drill, search, player) -- not retrofit onto every page
  // (design-standards.md: "do not retrofit a grid onto pages that do not
  // need one").
  '--grid-max': 'var(--width-wide)',
  '--grid-gutter': '24px',
  '--grid-gutter-md': '20px',
  '--grid-gutter-sm': '16px',

  // The Explorer synced board panel's tablet/mobile sticky-height clamp
  // (src/renderRepertoireExplorer.js) -- board-above-list stacks below
  // 1024px, and this caps how much of the viewport the sticky board holds
  // onto while the move tree scrolls underneath it, so the tree stays
  // reachable on a short viewport instead of the board eating the screen.
  '--board-sticky-max': '38vh',

  // Motion (design-standards.md: "all durations from motion tokens, none
  // over 400ms"). -fast/-piece predate this task (Phase 7c's piece-move
  // animation); -standard/-entering/-exiting and the ease-* set are new,
  // replacing the never-consumed --motion-easing-standard this task found
  // (only its own definition referenced it -- grepped repo-wide).
  '--motion-duration-fast': '150ms',
  '--motion-duration-standard': '300ms',
  '--motion-duration-entering': '225ms',
  '--motion-duration-exiting': '195ms',
  '--motion-duration-piece': '200ms',
  '--motion-ease-standard': 'cubic-bezier(0.4, 0, 0.2, 1)',
  '--motion-ease-decelerate': 'cubic-bezier(0, 0, 0.2, 1)',
  '--motion-ease-accelerate': 'cubic-bezier(0.4, 0, 1, 1)',
  '--motion-ease-sharp': 'cubic-bezier(0.4, 0, 0.6, 1)',
};

/**
 * Role assignment for every color that differs light vs dark -- kept as one
 * JS object, {light:{...}, dark:{...}}, so the dark role map is written
 * exactly once and interpolated into both the [data-theme="dark"] selector
 * and the prefers-color-scheme media block below (test/designTokens.test.js
 * asserts those two emitted blocks are byte-identical). Every value here is
 * a var() reference into the ramps above (or, for the board/row-tint/hover
 * values the spec hand-tunes per theme rather than deriving from the
 * ladder, a literal already documented as an exemption) -- never a new raw
 * hex. light and dark must define the identical key set (assertion iii).
 */
const THEME_ROLES = {
  light: {
    '--color-bg': 'var(--color-ink-0)',
    '--color-surface': 'var(--color-paper-white)',
    '--color-surface-alt': 'var(--color-ink-1)',
    '--color-text': 'var(--color-ink-8)', // 12.05:1 on bg
    '--color-muted': 'var(--color-ink-6)', // 6.47:1 on bg
    '--color-border': 'var(--color-ink-2)', // hairline, decorative
    '--color-border-strong': 'var(--color-ink-4)', // 3.47:1 on bg -- WCAG 1.4.11
    '--color-accent': 'var(--color-accent-5)',
    '--color-accent-dark': 'var(--color-accent-6)', // 6.47:1 on bg -- links
    '--color-accent-contrast': 'var(--color-ink-0)', // 6.47:1 on an accent-6 fill
    '--color-focus': 'var(--color-focus-5)', // 4.74:1 on bg
    '--color-win': 'var(--color-win-4)', // bar fill -- 3.47:1 vs bg
    '--color-win-text': 'var(--color-win-6)', // 6.47:1
    '--color-win-bg': 'var(--color-win-0)',
    '--color-draw': 'var(--color-draw-4)',
    '--color-draw-text': 'var(--color-draw-6)',
    '--color-draw-bg': 'var(--color-draw-0)',
    '--color-loss': 'var(--color-loss-4)',
    '--color-loss-text': 'var(--color-loss-6)',
    '--color-loss-bg': 'var(--color-loss-0)',
    // WS-1 spec section 3.5's one pre-authorised new role: the drill
    // engine's "due now" state. Assigned from the EXISTING --color-focus-*
    // ramp (no new hue introduced) at the indices the spec names for the
    // light theme -- 4 for the fill, 6 for text, 0 for the tint background.
    '--color-due': 'var(--color-focus-4)',
    '--color-due-text': 'var(--color-focus-6)',
    '--color-due-bg': 'var(--color-focus-0)',
    '--color-board-light': '#ECE3CD',
    '--color-board-dark': '#C2AD82',
    '--color-row-tint': 'rgba(20, 19, 15, 0.035)',
    '--color-hover': 'color-mix(in oklch, var(--color-accent) 8%, transparent)',
    // The selected tree row on the Explorer's synced board panel
    // (src/renderRepertoireExplorer.js) -- deliberately a different
    // percentage than --color-hover (8%/14%) so hover and selected never
    // resolve to the same value under two names (test/designTokens.test.js
    // assertion i's spirit, applied by hand since color-mix() percentages
    // aren't plain ramp values that test can compare).
    '--color-selected-bg': 'color-mix(in oklch, var(--color-accent) 16%, transparent)',
    '--shadow-sm': '0 1px 2px rgba(35, 39, 31, 0.08)',
    '--shadow-md': '0 8px 24px rgba(35, 39, 31, 0.10)',
  },
  dark: {
    '--color-bg': 'var(--color-ink-9)',
    '--color-surface': 'var(--color-ink-8)',
    '--color-surface-alt': 'var(--color-ink-7)',
    '--color-text': 'var(--color-ink-0)', // 16.45:1 on bg, 12.05:1 on surface
    '--color-muted': 'var(--color-ink-3)', // 6.47 on bg / 4.74 on surface
    '--color-border': 'var(--color-ink-6)',
    '--color-border-strong': 'var(--color-ink-4)', // 4.74 on bg / 3.47 on surface
    '--color-accent': 'var(--color-accent-4)',
    // "accent-dark" now means link/emphasis accent -- the name reads
    // backwards in the dark role map (it's lighter than --color-accent
    // here), kept only so every call site that already references
    // var(--color-accent-dark) stays correct without a call-site rename.
    '--color-accent-dark': 'var(--color-accent-3)', // 6.47:1 on bg -- links
    '--color-accent-contrast': 'var(--color-ink-9)', // 6.47:1 on an accent-3 fill
    '--color-focus': 'var(--color-focus-3)', // 6.47:1 on bg
    '--color-win': 'var(--color-win-4)', // bar fill -- 4.74:1 on ink-9, same index works both themes
    '--color-win-text': 'var(--color-win-3)',
    '--color-win-bg': 'var(--color-win-8)',
    '--color-draw': 'var(--color-draw-4)',
    '--color-draw-text': 'var(--color-draw-3)',
    '--color-draw-bg': 'var(--color-draw-8)',
    '--color-loss': 'var(--color-loss-4)',
    '--color-loss-text': 'var(--color-loss-3)',
    '--color-loss-bg': 'var(--color-loss-8)',
    // Dark-theme indices for the same due-state role (spec 3.5: 3 / 1 / 8).
    '--color-due': 'var(--color-focus-3)',
    '--color-due-text': 'var(--color-focus-1)',
    '--color-due-bg': 'var(--color-focus-8)',
    // The board shifts down one step rather than inverting -- the
    // cburnett sprites are outlined light-on-dark/dark-on-light, so
    // mid-lightness squares stay legible (square separation 1.90:1 vs the
    // light theme's 1.71:1); confirmed against a real dark screenshot.
    '--color-board-light': '#C2AD82',
    '--color-board-dark': '#8A7B54',
    '--color-row-tint': 'rgba(245, 241, 230, 0.05)',
    '--color-hover': 'color-mix(in oklch, var(--color-accent) 14%, transparent)',
    // Dark-theme selected-row tint -- one step up from --color-hover's 14%,
    // same reasoning as the light theme's entry above.
    '--color-selected-bg': 'color-mix(in oklch, var(--color-accent) 24%, transparent)',
    // A light-ground shadow (the light-theme rgba above) is invisible on
    // ink-9 -- re-tinted to a hairline (the theme's own border role, so it
    // still reads as a seam rather than a fixed color) plus a much
    // stronger black shadow.
    '--shadow-sm': '0 0 0 1px var(--color-border), 0 1px 2px rgba(0, 0, 0, 0.5)',
    '--shadow-md': '0 0 0 1px var(--color-border), 0 8px 24px rgba(0, 0, 0, 0.5)',
  },
};

/**
 * @param {Record<string,string>} tokens
 * @returns {string} one `    --name: value;` line per token, for
 *   interpolation into a `:root { ... }` block.
 */
function designTokensCss(tokens) {
  return Object.entries(tokens)
    .map(([name, value]) => `    ${name}: ${value};`)
    .join('\n');
}

/**
 * Shared design tokens + component styles, used identically by every page
 * across both the local dev server (src/server.js) and the static build
 * (dist/*.html via src/buildStatic.js). Light is the default theme, honoring
 * the OS preference, with an explicit toggle (see renderHeader() /
 * THEME_TOGGLE_SCRIPT below) that overrides it. Light-by-default is the
 * deliberate choice here (a sibling project in this portfolio defaults
 * dark): this reader is scanning comparative prose and tables for several
 * minutes at a stretch, the case where light-mode legibility matters most.
 */
const SITE_CSS = `
  :root {
    color-scheme: light;
${designTokensCss(DESIGN_TOKENS)}
${designTokensCss(THEME_ROLES.light)}
  }

  /* Explicit override via the toggle (THEME_TOGGLE_SCRIPT persists this to
     localStorage; THEME_PREPAINT_SCRIPT applies it before first paint). */
  :root[data-theme="dark"] {
    color-scheme: dark;
${designTokensCss(THEME_ROLES.dark)}
  }

  /* OS preference, only when the visitor has never overridden it via the
     toggle (:not([data-theme="light"]) -- an explicit light choice always
     wins over the OS, same as an explicit dark choice above). This block
     and the [data-theme="dark"] block above emit THEME_ROLES.dark through
     the exact same designTokensCss() call, so they are byte-identical by
     construction -- test/designTokens.test.js checks this stays true. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
${designTokensCss(THEME_ROLES.dark)}
    }
  }

  /* Self-hosted display face for headings only (--font-serif above). One
     variable woff2, wght+opsz axes, latin subset, ~66KB -- served from this
     same origin (never Google Fonts directly, so there's no third-party
     render-blocking stylesheet and no visitor IP sent off-site), preloaded
     in renderDocumentHead() with crossorigin. font-display: swap means
     headings render in the Georgia fallback immediately and swap in once
     the woff2 arrives, so there's no invisible-text flash. License: SIL OFL
     1.1, assets/fonts/FRAUNCES-OFL-LICENSE.txt. */
  @font-face {
    font-family: 'Fraunces Variable';
    font-style: normal;
    font-display: swap;
    font-weight: 100 900;
    src: url('/fonts/fraunces-variable.woff2') format('woff2-variations');
  }

  * { box-sizing: border-box; }

  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Craft-audit item 4: WCAG 2.2 SC 2.4.1 (Bypass Blocks) -- every one of
     this site's 125+ pages shares the same 9-item main nav (renderHeader()
     below), so a keyboard-only or screen-reader visitor previously had to
     tab through all 9 links on every single page before reaching content.
     Same .sr-only clip technique above for the hidden state, restored to a
     normal visible, positioned control on :focus-visible -- the shared
     :focus-visible rule further down still supplies the outline, so this
     uses the site's one focus language rather than inventing a second. */
  .skip-link {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .skip-link:focus-visible {
    position: fixed;
    top: var(--space-3);
    left: var(--space-3);
    z-index: 100;
    width: auto; height: auto;
    padding: var(--space-2) var(--space-4);
    margin: 0;
    overflow: visible;
    clip: auto;
    white-space: normal;
    background: var(--color-surface);
    color: var(--color-text);
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-md);
  }

  /* boardSvg.js's spriteDefsHtml() wrapper: a fixed, non-dynamic hiding
     style (never varies per-instance), so it's a plain class rather than
     the inline style="..." html-validate's no-inline-style rule flags. */
  .sprite-defs-hidden {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
  }

  /* overflow-x: clip on the ROOT (not on .page -- a clip on a 880px-wide
     ancestor would cut off .zone-full-bleed's escape at that same 880px,
     defeating the whole point). 100vw is very slightly wider than the
     actual viewport in browsers that reserve room for a scrollbar, which
     without this would add a page-level horizontal scrollbar; clipping at
     the root only trims that few-px overshoot, it does not constrain
     .zone-full-bleed's intentional bleed to the real viewport edge. */
  html { background: var(--color-bg); overflow-x: clip; }

  body {
    font: var(--type-body);
    font-family: var(--font-sans); /* re-declared after the shorthand -- see --type-body's comment */
    letter-spacing: var(--type-body-tracking);
    background: var(--color-bg);
    color: var(--color-text);
  }

  /* The width cap lives on this inner wrapper, not on body itself, so a
     .zone-full-bleed descendant of .page can escape to the true viewport
     edge (100vw / calc(50% - 50vw), see below) instead of only recovering
     body's own horizontal padding. */
  .page {
    max-width: var(--width-page);
    margin: 0 auto;
    padding: var(--space-5) var(--space-4) var(--space-7);
  }

  /* Opt-in wide container for the three data-dense page types (repertoire
     band pages, the drill, player lookup) - added at those specific call
     sites only, never as the default. See design-standards.md 4.5. */
  .page--wide { max-width: var(--width-wide); }

  main { display: block; }

  /* Prose measure (design-standards.md 4.5 / P3): caps reading-line length
     to var(--measure) for running text inside main. Tables, boards, and
     .table-scroll are exempt by not matching this selector at all. The
     repertoire tree's <li> rows are data rows (move chips, WDL bars), not
     prose sentences, so they're excluded explicitly below - constraining
     them would fight the wide layout those pages just opted into. */
  main p, main li, main .subtitle, main blockquote {
    max-width: var(--measure);
  }
  main .repertoire-tree li { max-width: none; }

  a { color: var(--color-accent-dark); }
  a:hover { color: var(--color-accent); }

  :focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
    border-radius: var(--radius-sm);
  }

  .site-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    margin-bottom: var(--space-5);
    border-bottom: 2px solid var(--color-border);
  }

  /* Brand + theme toggle share one row so the toggle never adds a fourth
     wrapped nav row on narrow viewports -- same fix the sibling asset
     (lol-practice-system/src/web/screen.css) already made for the same
     header shape. flex-wrap so the band control (WS-1.4, present on some
     pages -- see .band-header-control below) drops to its own line rather
     than overflowing on narrow viewports instead of forcing a fixed
     breakpoint just for it; harmless when the row already fits (the common
     brand+toggle-only case never wraps). */
  .brand-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .brand {
    font-family: var(--font-serif);
    font-weight: var(--weight-bold);
    font-size: var(--text-md);
    color: var(--color-accent-dark);
    letter-spacing: 0.01em;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .brand-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6em;
    height: 1.6em;
    border-radius: var(--radius-pill);
    background: var(--color-accent-dark);
    color: var(--color-accent-contrast);
    font-size: 0.95em;
  }

  /* Theme toggle: display:none until .js proves it can work (set by
     THEME_PREPAINT_SCRIPT before first paint), so a no-JS visitor never
     sees a button that does nothing. 44x44 WCAG 2.5.8 tap target. */
  .theme-toggle {
    display: none;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: var(--border-hairline) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    font-size: var(--text-md);
    cursor: pointer;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .js .theme-toggle { display: inline-flex; }
  .theme-toggle:hover { background: var(--color-hover); border-color: var(--color-accent); }

  /* Site-wide band-persistence control (WS-1 spec 3.4, task W4). Same
     visual weight/proportions as .theme-toggle (44px tap target, hairline
     border, transparent surface) so it reads as header chrome, not a form
     -- deliberately NOT styled with --color-accent (design-standards.md:
     exactly one accent-filled action per view, and this is a utility
     control, not that page's action). */
  .band-header-control { display: inline-flex; align-items: center; }
  .band-header-select {
    min-height: 44px;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
    padding: var(--space-2) var(--space-3);
    border: var(--border-hairline) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .band-header-select:hover { border-color: var(--color-accent); }

  .site-nav { display: flex; gap: var(--space-2); flex-wrap: wrap; }

  .site-nav a {
    color: var(--color-text);
    text-decoration: none;
    font-size: var(--text-sm);
    font-weight: 600;
    padding: var(--space-3) var(--space-3);
    border-radius: var(--radius-sm);
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                color var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .site-nav a:hover { background: var(--color-hover); color: var(--color-accent-dark); }
  .site-nav a[aria-current="page"] { background: var(--color-accent-dark); color: var(--color-accent-contrast); }

  h1, h2, h3 { font-family: var(--font-serif); color: var(--color-accent-dark); line-height: var(--leading-snug); text-wrap: balance; }
  h1.page-title { font: var(--type-page-title); font-family: var(--font-serif); letter-spacing: var(--type-page-title-tracking); margin: 0; }
  h2 { font: var(--type-section); font-family: var(--font-serif); letter-spacing: var(--type-section-tracking); margin: var(--space-6) 0 var(--space-3); }
  h3 { font: var(--type-subsection); font-family: var(--font-serif); letter-spacing: var(--type-subsection-tracking); margin: var(--space-5) 0 var(--space-2); }

  /* A second h2 tier for the 2-3 sections per page that
     carry that page's actual job -- applied deliberately per page (never
     automatically) by adding class="section-lead" to that h2. Larger size
     (--type-section-lead, the previously-unused --text-xl step) plus a
     structurally different opener: a full-content-width hairline rule with
     more space before it than a plain h2 gets, so the "gap between sections
     >= 2x the largest gap inside either section" rule
     (docs/DESIGN_PLAYBOOK.md) is visible, not nominal. */
  h2.section-lead {
    font: var(--type-section-lead);
    font-family: var(--font-serif);
    letter-spacing: var(--type-section-lead-tracking);
    padding-top: var(--space-6);
    margin-top: var(--space-8);
    border-top: 1px solid var(--color-border);
  }

  /* Vertical rhythm (design-standards.md 4.5): section spacing opens up at
     tablet width and above; stays tighter on mobile (the --space-6 default
     set on h2 just above). */
  @media (min-width: 768px) {
    h2 { margin-top: var(--space-8); }
    h2.section-lead { padding-top: var(--space-8); margin-top: var(--space-8); }
  }

  /* Progressive enhancement, zero cost where unsupported: avoids
     single-word orphan lines in body copy. */
  p { text-wrap: pretty; }

  .subtitle { color: var(--color-muted); margin: var(--space-2) 0 0; font-size: var(--text-base); }

  .empty-note {
    color: var(--color-muted);
    background: var(--color-surface-alt);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }

  .table-hint {
    display: none;
    font-size: var(--text-xs);
    color: var(--color-muted);
    margin: 0 0 var(--space-2);
  }

  .table-scroll {
    /* position: relative makes this element the CSS containing block for
       any position: absolute descendant (e.g. renderCI()'s .sr-only span,
       used in nearly every numeric table cell) -- without it, the nearest
       positioned ancestor is the document root (no other ancestor in this
       page sets a position at all except .card), so a .sr-only span deep
       in a table cell escapes THIS element's own overflow-x: auto clip and
       renders at its unclipped flow position out past the visible table,
       inflating the whole document's scrollable width even though the span
       itself is visually a 1x1px invisible box. This was the real cause of
       a page-level mobile horizontal-scroll bug on every data-table page:
       the wrapper's own box was always correctly sized and correctly
       clipping its VISIBLE content -- the escape was this specific
       absolute-positioning containment gap, not a width/min-width issue on
       the wrapper itself. Verified in a real headless-browser check: a
       page with a wide table and a CI column scrolled sideways at a 360px
       viewport before this rule, and stayed put after it. */
    position: relative;
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    margin: var(--space-3) 0 var(--space-6);
    background: var(--color-surface);
  }

  table {
    width: 100%;
    min-width: 480px;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  /* Table header style: a transparent thead with a tracked label over a
     2px accent bottom rule, replacing the old inverted solid
     --color-accent-dark bar, which read as a dated admin-template look. */
  thead th {
    text-align: left;
    padding: var(--space-3) var(--space-4);
    background: transparent;
    color: var(--color-muted);
    font: var(--type-label);
    font-family: var(--font-sans);
    text-transform: uppercase;
    letter-spacing: 0.08em; /* wider than --type-label-tracking -- deliberately, for the uppercase treatment */
    white-space: nowrap;
    border-bottom: 2px solid var(--color-accent);
  }

  tbody td {
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-hairline) solid var(--color-border);
  }

  tbody tr:last-child td { border-bottom: none; }
  /* Zebra striping replaced with the hairline row rule above; a very light
     tint (var(--color-row-tint), not full removal) keeps wide tables
     trackable at 200% zoom, verified manually against a repertoire table. */
  tbody tr:nth-child(even) td { background: var(--color-row-tint); }
  tbody tr:hover td { background: var(--color-hover); }

  /* Right-aligned numeric columns: tabular-nums keeps digits stacked
     instead of jittering column width row to row. Opt-in via class (not
     nth-child) since column layouts differ per table. */
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }

  tr.result-win td:first-child { box-shadow: inset 3px 0 0 var(--color-win); }
  tr.result-loss td:first-child { box-shadow: inset 3px 0 0 var(--color-loss); }
  tr.result-draw td:first-child { box-shadow: inset 3px 0 0 var(--color-draw); }

  .delta { font-weight: var(--weight-bold); }
  .delta--pos { color: var(--color-win-text); }
  .delta--neg { color: var(--color-loss-text); }
  .delta--zero { color: var(--color-muted); }

  .badge {
    display: inline-block;
    padding: 0.15em 0.6em;
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: 0.02em;
  }
  .badge--win { background: var(--color-win-bg); color: var(--color-win-text); }
  .badge--loss { background: var(--color-loss-bg); color: var(--color-loss-text); }
  .badge--draw { background: var(--color-draw-bg); color: var(--color-draw-text); }

  .summary-line {
    color: var(--color-muted);
    margin: var(--space-2) 0 var(--space-4);
  }

  .lookup-form {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-4) 0 var(--space-6);
  }

  .lookup-form label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-muted);
  }

  .lookup-form input,
  .lookup-form select {
    flex: 1 1 240px;
    min-height: 44px;
    font: inherit;
    font-size: var(--text-base);
    padding: var(--space-3) var(--space-4);
    border: var(--border-control) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard), box-shadow var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .lookup-form input:hover,
  .lookup-form select:hover { border-color: var(--color-accent); }
  .lookup-form input:focus-visible,
  .lookup-form select:focus-visible {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 var(--focus-ring-width) var(--focus-ring-color);
    outline: none;
  }

  /* Compare Openings tool (site-audit item 11) -- same field shape as
     .lookup-form above (shared select-styling tokens), a 2-up layout since
     this is always exactly two pickers, never a variable-length form. */
  .compare-picker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-4) 0 var(--space-6);
  }
  .compare-picker-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-muted);
    flex: 1 1 260px;
  }
  .compare-picker-field select {
    min-height: 44px;
    font: inherit;
    font-size: var(--text-base);
    padding: var(--space-3) var(--space-4);
    border: var(--border-control) solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard), box-shadow var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .compare-picker-field select:hover { border-color: var(--color-accent); }
  .compare-picker-field select:focus-visible {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 var(--focus-ring-width) var(--focus-ring-color);
    outline: none;
  }
  .compare-picker-field select:disabled { opacity: 0.6; cursor: not-allowed; }
  /* Craft-audit item 1: same visual language as .explorer-error below
     (color-loss-text, same size/spacing) -- a real, visible failure state
     for compare-openings.client.js's three previously-silent early-exit
     paths, rather than a dead pair of selects with no feedback. */
  .compare-error { color: var(--color-loss-text); font-size: var(--text-sm); margin: var(--space-2) 0 0; }

  .lookup-form button {
    min-height: 44px;
    font: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-bold);
    padding: var(--space-3) var(--space-5);
    border: none;
    border-radius: var(--radius-md);
    background: var(--color-accent-dark);
    color: var(--color-accent-contrast);
    cursor: pointer;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard), transform var(--motion-duration-fast) var(--motion-ease-standard);
  }

  .lookup-form button:hover { background: var(--color-accent); }
  .lookup-form button:active { transform: translateY(1px); }

  .status-message {
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
    margin: var(--space-3) 0 var(--space-6);
    font-size: var(--text-base);
  }

  .status-message--loading {
    background: var(--color-surface-alt);
    color: var(--color-muted);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .status-message--loading::before {
    content: "";
    width: 1.1em;
    height: 1.1em;
    border-radius: var(--radius-pill);
    border: var(--border-control) solid var(--color-border);
    border-top-color: var(--color-accent);
    animation: spin 800ms linear infinite;
  }

  .status-message--error {
    background: var(--color-loss-bg);
    color: var(--color-loss);
    border: 1px solid var(--color-loss);
    font-weight: 600;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .move-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.1em 0.6em;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }

  .move-chip--white {
    background: var(--color-surface);
    border: 1.5px solid var(--color-accent-dark);
    color: var(--color-accent-dark);
  }

  .move-chip--black {
    background: var(--color-accent-dark);
    border: 1.5px solid var(--color-accent-dark);
    color: var(--color-accent-contrast);
  }

  /* Rendered as an <svg> with <rect> segments, not a flex row of styled
     spans -- each segment's width is a per-row data value (a live win/draw/
     loss percentage), and html-validate's no-inline-style rule flags any
     style="..." attribute outright. SVG x/width are geometry attributes,
     not the flagged style attribute, so the same visual (a stacked
     percentage bar) is achievable with zero inline styles; see
     src/renderContent.js's wdlBar(). */
  .wdl-bar {
    display: inline-block;
    width: 110px;
    height: 8px;
    border-radius: var(--radius-pill);
    overflow: hidden;
    background: var(--color-border);
    vertical-align: middle;
  }

  .wdl-seg--win { fill: var(--color-win); }
  .wdl-seg--draw { fill: var(--color-draw); }
  .wdl-seg--loss { fill: var(--color-loss); }

  /* Widened WDL bar for the one hero table per opening page
     (renderBandsTable's "How it scores at your rating"). Percentages stay
     visible alongside it (.wdl-label below), so color is never the sole
     encoding. */
  .wdl-bar--lg { width: 100%; min-width: 160px; height: 12px; }

  .wdl-label { font-size: var(--text-xs); color: var(--color-muted); }

  /* Confidence-interval disclosure (spec WS-3.3 section 3.2): a point value's
     sibling ± half-width, and the visible "wide interval" note for a row
     whose half-width is large enough to change the reading. Zero new
     tokens -- .ci intentionally reuses --color-muted/--text-xs (the exact
     same role .wdl-label already uses for the same kind of secondary,
     de-emphasized number), since a --color-interval token would only
     duplicate --color-muted under a different name (design-standards.md:
     that's a QA failure, not a style choice). */
  .ci { font-size: var(--text-xs); color: var(--color-muted); }
  .wide-interval-note {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-muted);
    margin-top: var(--space-1);
  }

  .repertoire-intro { color: var(--color-muted); margin: 0 0 var(--space-5); }

  /* Explorer synced board panel (src/renderRepertoireExplorer.js) -- board
     column first / above in source order (mobile-first: this is what a
     360px visitor sees without scrolling past the tree), tree column
     second. Same named-two-column-grid technique as .pack-detail (see that
     rule's own comment) rather than a second, differently-shaped grid
     system -- board spans columns 1-5, tree spans columns 7-12, column 6
     stays empty as the deliberate gutter turn spec'd for this panel (wider
     than the standard --grid-gutter alone). Single column below 1024px,
     same convention as .explorer-layout/.pack-detail. */
  .repertoire-explorer-layout { margin: var(--space-4) 0 var(--space-6); }
  .repertoire-board-col { margin: 0 0 var(--space-5); }
  @media (min-width: 1024px) {
    .repertoire-explorer-layout {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: var(--grid-gutter);
      align-items: start;
    }
    .repertoire-board-col { grid-column: 1 / 6; margin: 0; }
    .repertoire-tree-col { grid-column: 7 / 13; }
  }
  main .repertoire-explorer-layout { max-width: none; }

  .repertoire-board-panel {
    position: sticky;
    top: var(--space-6);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    box-shadow: var(--shadow-sm);
  }
  /* aspect-ratio reserves the board's box in the server-rendered HTML so
     mounting it causes zero layout shift (CLS <= 0.1) -- the board itself
     never carries a size token of its own (design-standards.md: no new
     board-size token authorised), it is simply a grid child at 100% width. */
  .repertoire-board-mount { width: 100%; aspect-ratio: 1; }
  .repertoire-board-hint { color: var(--color-muted); font-size: var(--text-sm); margin: var(--space-2) 0 0; min-height: 1.2em; }
  /* Below 1024px the board sits above a scrolling tree rather than beside
     it (category convention -- see this file's design-review notes on why
     board-above-list, not a squeezed side-by-side pair, is the right call
     at tablet/phone widths). cm-chessboard sizes itself from its mount's
     own clientWidth, and the board is always square (aspect-ratio: 1), so
     capping WIDTH to --board-sticky-max (a vh value) is what actually caps
     the rendered board's height to that fraction of the viewport -- the
     min() falls back to the column's own width whenever that is already
     narrower, so a short column never gets artificially widened. This is
     what keeps the tree reachable under a sticky board on a short viewport
     (design-standards.md's "primary value object fully visible without
     scrolling at 360x800"). */
  @media (max-width: 1023px) {
    .repertoire-board-mount { width: min(100%, var(--board-sticky-max)); margin: 0 auto; }
  }

  ul.repertoire-tree, ul.repertoire-tree ul {
    list-style: none;
    margin: 0;
    padding-left: var(--space-5);
    border-left: 2px solid var(--color-border);
  }
  ul.repertoire-tree { padding-left: 0; border-left: none; }

  .repertoire-tree li { margin: var(--space-3) 0; }

  /* A real <button> (see renderRepertoireNode's own comment) styled to look
     exactly like the div it replaces -- these four declarations are the
     whole cost of that swap; everything below was already true of the div. */
  .rep-node-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-4);
    box-shadow: var(--shadow-sm);
    font: inherit;
    text-align: left;
    width: 100%;
    cursor: pointer;
  }
  .rep-node-row:hover { background: var(--color-hover); }
  /* Explorer synced board panel (src/renderRepertoireExplorer.js): selection
     is never carried by color alone (WCAG 1.4.1) -- aria-pressed, this fill,
     AND the 3px accent rule below all co-signal it, plus the board itself. */
  .rep-node-row[aria-pressed="true"] {
    background: var(--color-selected-bg);
    border-left: 3px solid var(--color-accent);
    padding-left: calc(var(--space-4) - 2px); /* the 3px rule replaces 1px of the existing 1px border, so only 2px needs clawing back from the padding */
  }
  /* Every ancestor row of the current selection, so the selected line reads
     as a path through the tree rather than one isolated highlighted row. */
  .rep-node-row.rep-node-row--ancestor { background: var(--color-hover); }

  .rep-node-label {
    font-weight: var(--weight-bold);
    color: var(--color-text);
    white-space: nowrap;
  }

  .rep-games { font-size: var(--text-sm); color: var(--color-text); }
  .rep-pct { color: var(--color-muted); }
  .rep-rating { color: var(--color-muted); font-size: var(--text-xs); }

  /* ECO family/volume index pages (Phase 7d). An ECO code is metadata, not
     a call to action -- bordered, not accent-filled (design-standards.md:
     accent is reserved for the one primary action per view). */
  .eco-chip {
    display: inline-block;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-accent-dark);
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    padding: 2px var(--space-2);
    margin-right: var(--space-2);
    white-space: nowrap;
  }
  .variation-group-label {
    font-weight: var(--weight-bold);
    color: var(--color-text);
    margin: var(--space-3) 0 var(--space-1);
  }
  .eco-index-table td.eco-names span + span::before { content: ", "; }

  .pagination {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    margin: var(--space-6) 0;
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }
  .pagination a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: var(--space-2) var(--space-4);
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    text-decoration: none;
    font-weight: var(--weight-bold);
  }
  .pagination a:hover { background: var(--color-hover); }
  .pagination .pagination-status { color: var(--color-muted); font-size: var(--text-sm); align-self: center; }

  footer.site-footer {
    color: var(--color-muted);
    font-size: var(--text-xs);
    margin-top: var(--space-7);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .newsletter-signup {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    margin-top: var(--space-4);
    max-width: 60ch;
  }
  .newsletter-heading {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-2);
  }
  .newsletter-description {
    color: var(--color-muted);
    font-size: var(--text-xs);
    margin: 0 0 var(--space-3);
  }
  .newsletter-signup--pending .newsletter-description { margin-bottom: 0; }
  .newsletter-embed {
    display: block;
    width: 100%;
    max-width: 480px;
    height: 320px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
  }

  .support-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .support-links a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-accent-dark);
    text-decoration: none;
    background: var(--color-surface);
  }
  .support-links a:hover {
    background: var(--color-hover);
    border-color: var(--color-accent);
  }

  .disclosure-note {
    color: var(--color-muted);
    font-size: var(--text-xs);
    margin: var(--space-3) 0 0;
    max-width: 60ch;
  }

  /* Muted-note treatment for an in-<main> aside, sized to match its sibling
     paragraphs' width exactly -- unlike .disclosure-note above (the
     footer's Ko-fi/affiliate disclosure, deliberately narrower/smaller
     print), which was wrongly reused here originally.
     Confound notes (selectionEffectNote() below and
     best-chess-openings-for-beginners.js) render *inside* <main>, right
     next to sibling paragraphs (.subtitle, .repertoire-intro, plain <p>)
     that all get their box width from the "main p" rule below:
     max-width: var(--measure) (68ch). The first attempt at this fix just
     dropped .disclosure-note's own max-width: 60ch and left that "main p"
     rule to size the note instead -- but that still rendered narrower than
     its siblings, because the ch unit is relative to the CURRENT element's
     own font-size, not a shared page-wide value: var(--measure) resolves to a
     real pixel width computed against whatever font-size is in effect on
     the element it's applied to, and this class was still shrinking that
     to --text-xs. Two paragraphs both honoring the identical "68ch" rule
     end up different pixel widths whenever they resolve it at different
     font sizes (confirmed by measurement: 12px text-xs -> 439.875px vs.
     16px body text -> 586.5px on the real rendered openings hub page,
     nowhere near matching). Dropping font-size here too -- keeping ONLY
     the muted color as this note's visual distinction -- makes it resolve
     "main p"'s var(--measure) at the exact same font-size its siblings
     use, which is what actually makes the two widths come out identical
     rather than merely closer. */
  .confound-note {
    color: var(--color-muted);
    margin: var(--space-3) 0 0;
  }

  .legal-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-3);
    font-size: var(--text-xs);
  }
  .legal-links a { color: var(--color-muted); }
  .legal-links a:hover { color: var(--color-accent-dark); }

  .footer-credit {
    margin: var(--space-3) 0 0;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }
  .footer-credit a { color: var(--color-muted); }
  .footer-credit a:hover { color: var(--color-accent-dark); }
  .footer-social {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .footer-social svg { display: block; }

  .prose { max-width: var(--measure); }
  .prose p { margin: 0 0 var(--space-4); line-height: var(--leading-relaxed); }
  .prose h2 { margin-top: var(--space-6); }
  .prose ul, .prose ol { padding-left: var(--space-5); line-height: var(--leading-relaxed); }
  .prose blockquote {
    border-left: 3px solid var(--color-accent);
    padding-left: var(--space-4);
    color: var(--color-muted);
    font-family: var(--font-sans);
    margin: var(--space-5) 0;
  }

  .breadcrumb { font-size: var(--text-xs); color: var(--color-muted); margin-bottom: var(--space-3); }
  .breadcrumb a { color: var(--color-muted); }
  .breadcrumb ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .breadcrumb li { display: inline; }
  .breadcrumb .breadcrumb-sep { color: var(--color-border); }

  .article-meta {
    font-size: var(--text-xs);
    color: var(--color-muted);
    border-bottom: 1px solid var(--color-border);
    padding-bottom: var(--space-3);
    margin: var(--space-3) 0 var(--space-5);
  }

  .toc {
    background: var(--color-surface-alt);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
    margin: 0 0 var(--space-6);
    font-size: var(--text-sm);
  }

  .card-grid {
    display: grid;
    gap: var(--space-4);
    margin: var(--space-4) 0 var(--space-6);
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }

  /* A single-card section (e.g. one CTA card with nothing to sit beside it)
     stays a single explicit column spanning the full content width, instead
     of rendering at auto-fill's ~264px minimum with a large empty track
     beside it in a wide viewport. */
  .card-grid--single { grid-template-columns: 1fr; }
  .card-grid--single .card { max-width: var(--measure); }

  .card {
    position: relative;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    box-shadow: var(--shadow-sm);
    transition: box-shadow var(--motion-duration-fast) var(--motion-ease-standard), transform var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  .card h3 { margin: 0 0 var(--space-2); font-size: var(--text-base); }
  .card p { margin: 0; font-size: var(--text-sm); color: var(--color-muted); }
  .card a { text-decoration: none; }
  .card a::after { content: ""; position: absolute; inset: 0; }

  /* One primary action per view (design-standards.md hierarchy rule): the
     repertoire-band selector is the homepage's single
     accent-filled primary action. Every other homepage CTA (the drill card,
     the openings cards) is demoted to an outline card - same link targets,
     lower visual weight. Modifier classes only; markup/link targets
     unchanged. */
  .card--primary {
    background: var(--color-accent-dark);
    border-color: var(--color-accent-dark);
  }
  .card--primary h3, .card--primary h3 a { color: var(--color-accent-contrast); }
  .card--primary p, .card--primary p a { color: var(--color-accent-contrast); }
  .card--primary p a:hover { color: var(--color-accent-contrast); text-decoration: underline; }

  .card--outline {
    background: transparent;
    box-shadow: none;
  }
  .card--outline:hover { box-shadow: none; transform: none; border-color: var(--color-accent); }

  /* The single overloaded .card rule split by content shape (orthogonal to
     the primary/outline visual-weight axis above). card--nav is a pure
     navigational link (drill CTA, related openings, guides hub; no data
     carried); card--stat additionally carries inline WDL data on opening
     entry-page cards, so a visitor never has to click through to see
     whether an opening is worth their time. */
  .card--nav p { margin: 0; }

  .card--stat .card-wdl-row { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-2) 0; }
  .card--stat .card-score { margin: 0; font-size: var(--text-sm); font-weight: var(--weight-bold); color: var(--color-accent-dark); }
  .card--stat.card--primary .card-score,
  .card--stat.card--outline .card-score { color: inherit; }

  /* Craft-audit item 2 (band persistence): the homepage's ranked cards bake
     one panel per rating band (src/renderContent.js's renderOpeningStatCard
     bandAware path); only the visitor's actual persisted band is shown,
     via the plain hidden attribute -- no extra CSS needed to hide it, but
     the no-data fallback panel's own paragraph needs the same
     .card--nav p reset applied above so it doesn't inherit .card--stat's
     WDL/score spacing rules it never renders. */
  .card--stat .card-band-panel p { margin: 0; }

  /* Homepage "Start here" section (src/buildStatic.js's startHereSection())
     -- the page's one accent-filled action (design-standards.md's per-page
     hierarchy rule). Site-audit item 2 (2026-08-25) replaced the old plain
     link (.start-here-cta, now removed -- grepped clean, nothing else
     referenced it) with a real lookup form reusing .lookup-form/.lookup-row
     verbatim (renderOpeningReport.js's own already-styled, already-shipped
     pattern -- same accent-filled button treatment, zero new CSS needed). */
  .start-here-alt { color: var(--color-muted); font-size: var(--text-sm); margin: var(--space-3) 0 0; }

  /* The four rating-band pickers as one role=group control with 44px
     pill links, replacing four floating cards that carried the same visual
     weight as unrelated nav cards elsewhere on the page. */
  .band-picker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-4) 0 var(--space-6);
  }
  .band-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 44px;
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-pill);
    background: var(--color-accent-dark);
    color: var(--color-accent-contrast);
    text-decoration: none;
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard), transform var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .band-pill:hover { background: var(--color-accent); color: var(--color-accent-contrast); transform: translateY(-1px); }
  .band-pill-color { font-weight: var(--weight-regular); opacity: 0.85; }
  /* The currently-selected band+color on the collapsed repertoire.html
     (WS-3.2) -- set/cleared client-side by repertoire.client.js, never by
     the server (the server-rendered default is always the one with no
     aria-current attribute, since it needs no visual distinction from
     itself). Reuses the sitewide focus-ring tokens rather than a new one. */
  .band-pill[aria-current="true"] { outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset); background: var(--color-accent); }
  /* Accessibility fix (live Lighthouse audit, 2026-08-25): --color-accent-contrast
     is only guaranteed >=4.5:1 against a fill 5 ramp indices darker (the
     --color-accent-dark fill .band-pill uses by default, 6.47:1, plenty of
     headroom) or against --color-accent itself at FULL opacity (still
     5-apart, 4.74:1 -- see test/designTokens.test.js's own contrast-ladder
     math). .band-pill-color's opacity:0.85 above quietly erodes that
     already-thin 4.74:1 margin below the 4.5 floor specifically on the two
     states whose background is the lighter --color-accent, not
     --color-accent-dark: hover and aria-current (measured live: 3.9:1 on
     the aria-current pill's "as White"/"as Black" label). Restoring full
     opacity on just these two states is the fix -- the de-emphasis effect
     opacity:0.85 provides is cosmetic and unnecessary to preserve on a
     state that's already visually distinct via its own background/outline. */
  .band-pill:hover .band-pill-color,
  .band-pill[aria-current="true"] .band-pill-color { opacity: 1; }

  /* Homepage-only demotion of the shared .band-pill above (src/
     buildStatic.js wraps its own bandPickerHtml() call in this class) --
     .start-here-cta is now this page's one accent-filled action, so the
     band picker can't also be accent-filled without recreating the same
     "which one do I click" problem the Start Here section exists to fix.
     Scoped to this wrapper only: repertoire.html reuses the identical
     .band-pill markup for its own band+color switcher and is untouched --
     that page has no Start Here CTA of its own competing with it. */
  .home-band-picker .band-pill {
    background: none;
    border: 1.5px solid var(--color-border-strong);
    color: var(--color-text);
  }
  .home-band-picker .band-pill:hover { background: var(--color-hover); color: var(--color-text); transform: none; }

  /* Eyebrow label above an h1, shared by renderPageHead(). */
  .page-eyebrow {
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-accent);
    margin: 0 0 var(--space-2);
  }

  .callout {
    background: var(--color-surface-alt);
    border-left: 4px solid var(--color-accent);
    border-radius: var(--radius-sm);
    padding: var(--space-4) var(--space-5);
    margin: var(--space-5) 0;
    font-size: var(--text-sm);
  }

  /* Plain <li class="callout"> list with the browser's default list
     chrome (bullet, indent) stripped -- a static, non-dynamic style, so a
     class rather than the style="..." attribute no-inline-style flags. */
  .callout-list { list-style: none; padding: 0; margin: 0; }

  .stat-row { display: flex; flex-wrap: wrap; gap: var(--space-4); margin: var(--space-4) 0 var(--space-6); }
  .stat {
    flex: 1 1 140px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }
  .stat-value { font-family: var(--font-sans); font-size: var(--text-xl); color: var(--color-accent-dark); line-height: 1.1; }
  .stat-label { font-size: var(--text-xs); color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; }

  .source-list { font-size: var(--text-sm); color: var(--color-muted); }

  .board {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    grid-template-rows: repeat(8, 1fr);
    width: min(100%, 352px);
    aspect-ratio: 1 / 1;
    border: 2px solid var(--color-accent-dark);
    border-radius: var(--radius-sm);
    overflow: hidden;
    margin: 0;
  }
  .board-sq {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: clamp(18px, 5.2vw, 30px);
    line-height: 1;
    font-family: "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", "DejaVu Sans", sans-serif;
    position: relative;
  }
  .board-sq--light { background: var(--color-board-light); }
  .board-sq--dark { background: var(--color-board-dark); }
  /* Rank/file coordinate labels (src/boardSvg.js's renderBoardDiagram) --
     Lichess's own corner-label convention (docs/design/REFERENCE_LIBRARY.md
     entry 3), positioned with no background box needed, same placement the
     interactive board's own cm-chessboard coordinates use (this file's own
     "Coordinate-overprint fix" comment below, ~line 1470). Originally
     colored from the OPPOSITE board-color token (Lichess's own technique),
     but this site's board palette has much lower light/dark square
     separation than Lichess's (~1.7-1.9:1, see --color-board-light/-dark
     above), so that swap put the label at the SAME low ratio against its
     own square -- a real WCAG AA contrast failure against this site's own
     4.5:1 text floor. Fixed with one fixed color (--color-ink-black,
     defined above) instead of the swap -- clears all four
     board-square/theme combinations with real margin (5.04:1 worst case;
     see the design-token test coverage). */
  .board-coord {
    position: absolute;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    line-height: 1;
    color: var(--color-ink-black);
    pointer-events: none;
    user-select: none;
  }
  .board-coord--file { left: var(--space-1); bottom: var(--space-1); }
  .board-coord--rank { left: var(--space-1); top: var(--space-1); }
  /* Phase 7c: real Cburnett SVG piece artwork (src/boardSvg.js), replacing
     the old .board-pc--w/--b Unicode-glyph technique everywhere -- the
     drill session board (its last consumer) was migrated too, so those
     two classes are gone from here too; grep found no remaining reference. */
  .board-piece { width: 84%; height: 84%; display: block; }
  figure.board-figure { margin: var(--space-4) 0 var(--space-6); }
  figcaption { font-size: var(--text-sm); color: var(--color-muted); margin-top: var(--space-2); }

  /* Interactive board component (src/boardWidget.js, Phase 7c) -- a
     tokenised theme for cm-chessboard, replacing its own shipped ".default"
     palette entirely (design-standards.md: "do not ship its palette").
     cm-chessboard has no CSS custom properties of its own (verified by
     reading node_modules/cm-chessboard/assets/chessboard.css -- every rule
     is a hardcoded hex scoped by a .default/.green/etc. theme class), so
     this defines a same-shaped theme class of our own, .repertoire-theme,
     wired to our tokens instead. boardWidget.js sets style.cssClass to
     "repertoire-theme" and never loads cm-chessboard's own chessboard.css. */
  .cm-chessboard.repertoire-theme .board .square.white { fill: var(--color-board-light); }
  .cm-chessboard.repertoire-theme .board .square.black { fill: var(--color-board-dark); }
  /* Coordinate-overprint fix: boardWidget.js used to
     mount with borderType: 'none', which draws the a-h/1-8 coordinate
     labels INSIDE the outer-rank/file squares (cm-chessboard's own inline
     layout, see node_modules/cm-chessboard/src/view/ChessboardView.js
     drawCoordinates()) -- visibly colliding with the pieces standing on
     those squares (confirmed in visual-qa-output/eco-explorer-1440x900.png,
     e.g. the "8"/"1" labels over the corner rooks). borderType: 'frame'
     (now set in boardWidget.js) reserves a dedicated border band OUTSIDE
     the 8x8 grid and draws coordinates there instead -- this is a real
     positioning fix, not a z-order/opacity hack, so it holds regardless of
     which piece occupies the square. In frame mode cm-chessboard emits only
     the base .coordinate class (no .black/.white modifier -- those were an
     inline-mode-only distinction), so a single fill replaces the old
     per-square-color pair. */
  .cm-chessboard.repertoire-theme.border-type-frame .board .border { fill: var(--color-board-light); stroke: none; }
  .cm-chessboard.repertoire-theme.border-type-frame .board .border-inner { fill: var(--color-board-dark); stroke: var(--color-board-dark); stroke-width: 0.7%; }
  .cm-chessboard.repertoire-theme .coordinates .coordinate { font-size: 7px; cursor: default; fill: var(--color-muted); }
  .cm-chessboard .board.input-enabled .square { cursor: pointer; }
  .cm-chessboard .coordinates, .cm-chessboard .markers-layer, .cm-chessboard .pieces-layer, .cm-chessboard .markers-top-layer { pointer-events: none; }
  /* Mobile drag-vs-scroll fix (2026-08-25 site-audit pass): neither
     cm-chessboard's own VisualMoveInput (node_modules/cm-chessboard/src/
     view/VisualMoveInput.js, real touchstart/touchmove/touchend handlers)
     nor its shipped stylesheet sets touch-action anywhere, so a touch-drag
     starting on the board can be intercepted by the browser's native
     touch-scroll on any page the board sits on that also scrolls (every
     page it appears on does). touch-action:none on the SVG root this class
     lives on (ChessboardView.js's createSvgAndGroups()) disables that
     native gesture recognition inside the board's own bounding box only --
     it cannot affect scrolling anywhere else on the page. Applied
     preventively (this session's tooling has no real touch-device access
     to confirm the drag conflict actually reproduces) since the fix itself
     carries zero downside either way. */
  .cm-chessboard { touch-action: none; }
  /* Shared focus-ring language (:focus-visible above), not cm-chessboard's
     own hardcoded #0066cc default. These two rects (drawn by the
     Accessibility extension's keyboardMoveInput -- see
     node_modules/cm-chessboard/src/extensions/accessibility/Accessibility.js's
     showFocusIndicator()) ship with NO fill/stroke of their own, so leaving
     them unstyled renders as a solid black square (found during Phase 7c's
     own visual QA, not a cosmetic nicety -- an unstyled .keyboard-focus
     rect fully occludes the piece under it). */
  .cm-chessboard-widget:focus-within { outline: var(--border-control) solid var(--color-focus); outline-offset: var(--focus-ring-offset); border-radius: var(--radius-sm); }
  .cm-chessboard .keyboard-focus-indicator .keyboard-focus { fill: none; stroke: var(--color-focus); stroke-width: 3px; pointer-events: none; }
  .cm-chessboard .keyboard-focus-indicator .keyboard-from-square { fill: var(--color-hover); stroke: var(--color-focus); stroke-width: 2px; pointer-events: none; }
  .cm-chessboard-accessibility.visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .cm-chessboard-accessibility button:disabled,
  .cm-chessboard-accessibility button:disabled:hover { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
  .board-replay-controls { display: flex; gap: var(--space-2); margin: var(--space-3) 0 0; }
  .board-replay-controls button {
    min-height: 44px; min-width: 44px; font: inherit; font-weight: var(--weight-bold);
    padding: var(--space-2) var(--space-3); border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-md); background: var(--color-surface); cursor: pointer;
  }
  .board-replay-controls button:hover:not(:disabled) { background: var(--color-hover); }
  .board-replay-controls button:disabled { opacity: 0.45; cursor: not-allowed; }

  /* T3: the interactive ECO explorer (Phase 7e). Board + paste tools in a
     fixed-max-width left column, the search/results panel filling the
     remainder -- same two-column pattern as the drill page's
     .drill-layout, reused rather than inventing a second one
     (design-standards.md: conform at the interaction layer). Single
     column below 1024px. */
  .explorer-layout { margin: var(--space-4) 0 var(--space-6); }
  @media (min-width: 1024px) {
    .explorer-layout {
      display: grid;
      grid-template-columns: minmax(0, 420px) 1fr;
      gap: var(--space-6);
      align-items: start;
    }
  }
  main .explorer-layout, main .explorer-top-families { max-width: none; }

  .explorer-board-mount { min-height: 320px; }
  .explorer-current-line { font-weight: var(--weight-bold); margin: var(--space-3) 0 0; min-height: 1.4em; }
  .explorer-identify-status { color: var(--color-muted); font-size: var(--text-sm); margin: var(--space-1) 0 var(--space-3); min-height: 1.2em; }

  .explorer-paste { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); margin-top: var(--space-3); }
  .explorer-paste summary { cursor: pointer; font-weight: var(--weight-bold); min-height: 24px; }
  .explorer-paste-inputs { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-3); }
  .explorer-paste-inputs label { font-size: var(--text-sm); font-weight: var(--weight-bold); }
  .explorer-paste-row { display: flex; gap: var(--space-2); }
  .explorer-paste-inputs input,
  .explorer-paste-inputs textarea {
    font: inherit; padding: var(--space-2) var(--space-3); border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); width: 100%;
  }
  .explorer-paste-inputs input:focus-visible,
  .explorer-paste-inputs textarea:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset); }
  .explorer-paste-inputs textarea { resize: vertical; font-size: var(--text-sm); }
  .explorer-paste-row button,
  .explorer-paste-inputs > button {
    min-height: 44px; font: inherit; font-weight: var(--weight-bold); white-space: nowrap;
    padding: var(--space-2) var(--space-4); border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-md); background: var(--color-surface); cursor: pointer;
  }
  .explorer-paste-row button:hover,
  .explorer-paste-inputs > button:hover { background: var(--color-hover); }
  .explorer-error { color: var(--color-loss-text); font-size: var(--text-sm); min-height: 1.2em; margin: var(--space-2) 0 0; }

  .explorer-search-panel .lookup-form { margin-bottom: var(--space-2); }
  .explorer-result-count { color: var(--color-muted); font-size: var(--text-sm); min-height: 1.2em; margin: 0 0 var(--space-2); }
  .explorer-result-name {
    font: inherit; font-weight: var(--weight-bold); color: var(--color-accent-dark); background: none;
    border: none; padding: 0; min-height: 24px; cursor: pointer; text-decoration: underline;
  }
  .explorer-result-name:hover { color: var(--color-accent); }
  .explorer-moves-cell { font-size: var(--text-sm); color: var(--color-muted); }
  .explorer-top-families { list-style: none; padding: 0; display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .explorer-top-families li { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3); }
  .explorer-family-meta { display: block; color: var(--color-muted); font-size: var(--text-xs); margin-top: var(--space-1); }
  .explorer-noscript { border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); padding: var(--space-4); }

  @media (max-width: 640px) {
    .page { padding: var(--space-4) var(--space-3) var(--space-6); }
    h1.page-title { font-size: var(--text-xl); }
    .table-hint { display: block; }
    .wdl-bar { width: 72px; }
    /* Keep the hero table's widened bar filling its cell even on mobile,
       rather than shrinking to the compact 72px default above; same
       specificity, so declaration order (this rule after .wdl-bar) decides. */
    .wdl-bar--lg { width: 100%; min-width: 0; }
    .rep-node-row { padding: var(--space-2) var(--space-3); }
    .lookup-form { flex-direction: column; align-items: stretch; }
    .lookup-form input, .lookup-form select { flex: 1 1 auto; width: 100%; }
    .lookup-form label { width: 100%; }
    .card-grid { grid-template-columns: 1fr; }
    /* An explicit 2-up grid instead of flex-wrap, so the pill count (8: 4
       bands x 2 colors) ends in one full final row instead of a ragged
       six-full-rows-then-two-then-one shape -- design-standards.md forbids
       a ragged final row in a card/grid layout. */
    .band-picker { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); }
    .band-pill { justify-content: center; }
  }

  /* Grid zone classes (design-standards.md: 12/6/4 column grid at
     >=1024/768-1023/<768). Declared here for B2/B5 to apply to the
     two-panel page types (explorer, drill, search, player) -- not
     retrofit onto every page, per that same rule ("do not retrofit a grid
     onto pages that do not need one"). .zone-measure is usable today: a
     drop-in alternative to the ad hoc "main p, main li, ..." selector
     above for any block that needs the reading measure outside <main>. */
  .zone-measure { max-width: var(--measure); }
  .zone-content { max-width: var(--grid-max); margin: 0 auto; }

  /* True viewport-edge bleed, not just a recovery of .page's own padding.
     100vw/calc(50% - 50vw) is measured from the viewport regardless of
     .page's max-width, so this now actually reaches the screen edge
     instead of stopping at .page's own inner padding. html's
     overflow-x: clip (above) contains this element's sub-pixel
     overshoot without constraining the bleed itself. */
  .zone-full-bleed {
    max-width: none;
    width: 100vw;
    margin-left: calc(50% - 50vw);
    margin-right: calc(50% - 50vw);
  }

  /* Board-visibility work -- the homepage hero demo
     (buildStatic.js's homeDemoMarkup()). Text column first / above in
     source order (mobile-first, same convention as
     .repertoire-explorer-layout above: this is what a 360px visitor sees
     without scrolling past the h1/subtitle), demo column second. Same
     named-two-column-grid technique, adjacent 1-6 / 7-12 spans (no
     dedicated empty gutter-turn column here -- the grid's own gap is
     enough at this narrower two-block layout). Single column below
     1024px. No new tokens (spec section 3: Piece C is authorised zero --
     every value below is one of the existing tokens .repertoire-board-panel
     already uses for the same "self-contained board panel" role). */
  .home-hero-layout { margin: var(--space-2) 0 0; }
  @media (min-width: 1024px) {
    .home-hero-layout {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: var(--grid-gutter);
      align-items: start;
    }
    .home-hero-text { grid-column: 1 / 7; }
    .home-demo { grid-column: 7 / 13; }
  }
  main .home-hero-layout { max-width: none; }

  .home-demo {
    margin: var(--space-5) 0 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    box-shadow: var(--shadow-sm);
  }
  @media (min-width: 1024px) {
    .home-demo { margin-top: 0; }
  }
  .home-demo-caption {
    margin: 0 0 var(--space-3);
    /* Reserves roughly two lines at --text-sm so swapping in a longer
       caption after a move never shifts the board below it (CLS). */
    min-height: calc(1.5 * var(--text-sm) * 2);
    font-size: var(--text-sm);
    color: var(--color-text);
  }
  /* aspect-ratio reserves the board's box in the server-rendered HTML so
     mounting it causes zero layout shift (CLS <= 0.1) -- same technique
     and same reasoning as .repertoire-board-mount, this board never
     carries a size token of its own either (design-standards.md: no new
     board-size token authorised). */
  .home-demo-board-mount { width: 100%; aspect-ratio: 1; }
  .home-demo-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
  }
  /* A plain outline control, not a second accent-filled button -- spec
     section 2.3's one-accent-filled-action rule (design-standards.md: the
     home page's single accent-filled action is the rating-band picker,
     unchanged by this piece). Same rest/hover treatment as .theme-toggle
     above (transparent surface, hover fills --color-hover, hover border
     turns --color-accent) -- the established "secondary interactive
     control" language on this site, not a new pattern. */
  .home-demo-reset {
    background: transparent;
    border: var(--border-hairline) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-4);
    font: inherit;
    color: var(--color-text);
    cursor: pointer;
    transition: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .home-demo-reset:hover { background: var(--color-hover); border-color: var(--color-accent); }

  /* Homepage above-the-fold data strip (buildStatic.js's dataStripHtml):
     a full-bleed band immediately under the h1, so the page opens with a
     real number instead of only a claim about one. The outer element does
     the full-bleed escape; .data-strip-inner re-applies the page's own
     max-width/centering so the four columns line up with everything below
     them rather than spanning the raw viewport edge to edge. */
  .data-strip {
    background: var(--color-surface-alt);
    border-top: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
    /* margin-top/-bottom only -- NOT the margin shorthand, which would
       also set margin-left/-right to 0 and, at equal specificity and later
       source order, silently overwrite .zone-full-bleed's own
       margin-left/-right: calc(50% - 50vw) that this element depends on to
       actually reach the viewport edge. */
    margin-top: var(--space-6);
    margin-bottom: var(--space-6);
  }
  .data-strip-inner {
    max-width: var(--grid-max);
    margin: 0 auto;
    padding: var(--space-5) var(--space-4);
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-5);
  }
  /* min-width: 0 overrides a grid item's default min-width: auto, which
     otherwise sizes the column to its content's max-content width (e.g. an
     unbreakable "X,XXX,XXX games" run) instead of shrinking to its 1fr
     share -- the standard cause of a grid growing past its own container. */
  .data-strip-col { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
  .data-strip-band {
    font: var(--type-label);
    font-family: var(--font-sans);
    letter-spacing: var(--type-label-tracking);
    color: var(--color-muted);
    text-transform: uppercase;
  }
  .data-strip-opening { font-family: var(--font-serif); font-weight: var(--weight-bold); color: var(--color-accent-dark); font-size: var(--text-md); }
  .data-strip-score { font-size: var(--text-sm); font-weight: var(--weight-bold); }
  .data-strip-meta { font-weight: var(--weight-regular); color: var(--color-muted); }
  .data-strip-empty { color: var(--color-muted); font-size: var(--text-sm); }
  .data-strip-bar {
    width: 100%;
    height: var(--chart-h-spark);
    margin-top: var(--space-1);
  }
  .data-strip-bar-track { fill: var(--chart-band); }
  .data-strip-bar-fill { fill: var(--chart-mark); }

  @media (max-width: 1023px) {
    .data-strip-inner { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 639px) {
    .data-strip-inner { grid-template-columns: 1fr; gap: var(--space-3); padding: var(--space-4) var(--space-3); }
  }

  /* AdSense in dark mode: this site runs Google
     Auto Ads (renderDocumentHead's adsbygoogle.js script tag, no manually
     placed <ins> units), which inject their own wrapper elements at
     runtime and render their own light-background creative regardless of
     page theme -- ".adsbygoogle" and Google's own ".google-auto-placed"
     wrapper are the two selectors its generated markup uses. On the dark
     ink-9 ground an unstyled ad reads as a broken white rectangle rather
     than a designed panel, so it gets an explicit light well -- literally
     ramp index 1 (var(--color-ink-1)), not the theme's --color-surface-alt
     role (which in dark mode is still dark, ink-7, and would defeat the
     point).

     Craft-audit item 8 verification (real live site, real Chromium, three
     separate pages, 2026-08-27): this rule DOES apply correctly on the real
     deployed site -- toggling dark mode and reading the live ins.
     adsbygoogle element's computed style confirmed background/border-
     radius/padding all match this rule's declared values, exactly as
     intended. What could NOT be confirmed: every real ins.adsbygoogle
     checked across the homepage, opening-report.html, guides.html, and
     italian-game-variations.html carried data-ad-status="unfilled" (0x0,
     no creative) -- Auto Ads is not currently filling any slot on this
     site for this check to see a real rendered creative against. Real
     measured Cumulative Layout Shift on the homepage was 0 in this same
     check, which is the direct, honest consequence of nothing rendering
     yet, not evidence the eventual real creative will be shift-free. No
     space-reservation CSS was added for this reason: there is no observed
     shift to fix, and reserving space for an ad slot that may render at
     an unknown future size risks its own, different layout problem
     (a permanent gap when no ad fills) without a real creative to size it
     against. Re-run this same check once Auto Ads is confirmed filling on
     this site (.adsbygoogle[data-ad-status] will read "filled") --
     re-measure CLS at that point and add reservation then if it is real. */
  [data-theme="dark"] .adsbygoogle,
  [data-theme="dark"] .google-auto-placed {
    background: var(--color-ink-1);
    border-radius: var(--radius-md);
    padding: var(--space-2);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) .adsbygoogle,
    :root:not([data-theme="light"]) .google-auto-placed {
      background: var(--color-ink-1);
      border-radius: var(--radius-md);
      padding: var(--space-2);
    }
  }

  /* ---------------------------------------------------------------------
     Repertoire Pack sales pages (monetization-layer spec, section 1.6/1.8).
     Every value below is an existing token -- no new custom property is
     introduced (spec 1.8: "NO NEW TOKENS unless a genuinely new role
     appears"). The layout is a data-table-first sales page (spec 2.8), not
     the centered-hero-plus-feature-cards template design-standards.md bans,
     so it gets its own small block here rather than reusing .card-grid. */

  /* Detail page: mobile-first single column (board/price/CTA sidebar shown
     first, per spec 1.6.2's "board first" mobile rule), two 12-col-grid
     panels (content 1-7, sidebar 8-12, sticky) from 1024px up. Achieved with
     named grid areas rather than DOM reordering, so the substantive
     contents table stays first in source/reading order for assistive tech
     and crawlers while sighted mobile users still see the board/CTA first. */
  .pack-detail {
    display: grid;
    gap: var(--space-4);
    grid-template-areas: "sidebar" "content";
    margin: var(--space-3) 0 var(--space-6);
  }
  .pack-detail-content { grid-area: content; }
  .pack-detail-sidebar {
    grid-area: sidebar;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    box-shadow: var(--shadow-sm);
  }
  @media (min-width: 1024px) {
    .pack-detail {
      grid-template-columns: repeat(12, 1fr);
      grid-template-areas: "content content content content content content content sidebar sidebar sidebar sidebar sidebar";
      gap: var(--grid-gutter);
      align-items: start;
      margin-top: var(--space-5);
    }
    .pack-detail-sidebar { position: sticky; top: var(--space-4); padding: var(--space-5); }
  }

  .pack-sidebar-board { margin: 0 auto var(--space-3); }
  /* Below 1024px the board is a supporting identity image, not the reading
     surface the repertoire explorer's own board is -- capped narrower so
     it (spec 1.6.2's "primary value object") actually clears the fold at
     360x800 alongside the header nav above it, instead of the 352px
     default (sized for the explorer's move-by-move board) pushing it
     ~95px past a 360x800 viewport's own bottom edge. */
  @media (max-width: 1023px) {
    .pack-sidebar-board .board, .pack-feature-board .board { width: 190px; }
  }
  .pack-price {
    font-family: var(--font-serif);
    font-weight: var(--weight-bold);
    font-size: var(--text-xl);
    color: var(--color-accent-dark);
    margin: 0 0 var(--space-2);
  }
  .pack-line-count { color: var(--color-muted); font-size: var(--text-sm); margin: 0 0 var(--space-4); }

  /* The one accent-filled action on this page (design-standards.md
     hierarchy rule) -- same visual recipe as .lookup-form button's primary
     submit above, reused rather than re-invented. */
  .pack-cta {
    display: inline-flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: var(--space-3) var(--space-5);
    border: none;
    border-radius: var(--radius-md);
    background: var(--color-accent-dark);
    color: var(--color-accent-contrast);
    font: inherit;
    font-weight: var(--weight-bold);
    font-size: var(--text-base);
    text-decoration: none;
    text-align: center;
    cursor: pointer;
    transition: background-color 120ms ease, transform 120ms ease;
  }
  .pack-cta:hover { background: var(--color-accent); color: var(--color-accent-contrast); }
  .pack-cta:active { transform: translateY(1px); }

  /* Not listed for sale yet (STORE still carries a sentinel not-yet-real
     url) -- an honest inert state, never a broken link and never
     accent-filled (an inert control must not borrow the one accent
     action's own visual weight). See render.js's isPlaceholderStoreUrl(). */
  .pack-cta--pending {
    display: block;
    width: 100%;
    background: none;
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-5);
    color: var(--color-muted);
    font-size: var(--text-sm);
    text-align: center;
  }

  .pack-file-list { list-style: none; padding: 0; margin: var(--space-4) 0; font-size: var(--text-sm); }
  .pack-file-list li { padding: var(--space-1) 0; border-bottom: 1px solid var(--color-border); }
  .pack-file-list li:last-child { border-bottom: none; }
  .pack-file-name { font-weight: var(--weight-bold); color: var(--color-text); }
  .pack-file-desc { color: var(--color-muted); display: block; }
  .pack-sample-link { display: inline-block; margin-top: var(--space-3); font-size: var(--text-sm); }
  .pack-meta-note { color: var(--color-muted); font-size: var(--text-xs); margin-top: var(--space-4); }

  /* Contents table rows -- native <details>/<summary> disclosure (same
     progressive-enhancement element already used by the ECO explorer's
     "Identify a position" panel), never a second bespoke JS interaction.
     No transition/animation on open -- the simplest way to genuinely honor
     prefers-reduced-motion (spec 1.8/WCAG 2.2 SC 2.3.3) is to have no
     motion to disable. */
  .pack-contents-table { list-style: none; padding: 0; margin: var(--space-4) 0; }
  .pack-row {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-2);
    background: var(--color-surface);
  }
  .pack-row-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    min-height: 44px;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    list-style: none;
  }
  .pack-row-summary::-webkit-details-marker { display: none; }
  .pack-row-summary:hover { background: var(--color-hover); }
  .pack-row-summary:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
  }
  .pack-row-arrow { color: var(--color-muted); }
  .pack-row[open] .pack-row-arrow { transform: rotate(90deg); }
  .pack-row-freq { color: var(--color-muted); font-size: var(--text-xs); }
  .pack-row-score { color: var(--color-accent-dark); font-weight: var(--weight-bold); font-size: var(--text-sm); }
  .pack-row-ci { color: var(--color-muted); font-size: var(--text-xs); }
  .pack-row-distribution {
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-top: 1px solid var(--color-border);
  }
  .pack-row-distribution table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
  .pack-row-distribution th, .pack-row-distribution td { text-align: left; padding: var(--space-1) var(--space-2); }
  .pack-row-distribution td.num, .pack-row-distribution th.num { text-align: right; }
  .pack-show-all {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: var(--space-2) var(--space-4);
    border: 1.5px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    font-weight: var(--weight-bold);
    background: none;
    cursor: pointer;
    color: var(--color-text);
    font: inherit;
  }
  .pack-show-all:hover { background: var(--color-hover); }

  /* Free guarantee / non-influence statements (spec 1.6.1/1.6.6) -- a
     hairline separator, never a card or filled background (spec: "no card,
     no background fill"). */
  .pack-statement {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-4);
    margin: var(--space-6) 0;
  }
  .pack-statement h2 { margin-top: 0; }
  .pack-statement p { max-width: var(--measure); }
  .pack-statement a { color: var(--color-accent-dark); font-weight: var(--weight-bold); }

  /* The before/after pitch statement sits directly under the page subtitle,
     not after a pack list like the other two -- no hairline needed there,
     it would just double up against the subtitle's own visual break. */
  .pack-statement--pitch { border-top: none; padding-top: 0; margin-top: 0; }

  /* Leak-report upsell block (spec 1.6.1) -- shares the .pack-statement
     hairline treatment; the CTA here is a plain accent-colored text link,
     never accent-filled (the page's one accent-filled action stays the
     leak report's own "Drill your leaks"). */
  .pack-upsell a.pack-upsell-link { color: var(--color-accent-dark); font-weight: var(--weight-bold); }

  /* Packs index page: asymmetric by construction (spec 1.6.4) -- the
     feature pack is a full-width block with its own accent CTA, the other
     pack(s) are a plain hairline-bordered row with a text link. Never two
     identical cards. */
  .pack-feature {
    display: grid;
    gap: var(--space-5);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    margin: var(--space-4) 0 var(--space-5);
    box-shadow: var(--shadow-sm);
  }
  @media (min-width: 768px) {
    .pack-feature { grid-template-columns: minmax(0, 240px) 1fr; align-items: center; }
  }
  .pack-feature-board { margin: 0 auto; }
  .pack-feature h2 { margin-top: 0; }

  /* Real on-page preview (packs index) -- same chip/score visual language
     as .pack-row-summary on the detail page (src/renderPackPages.js's
     previewRowHtml()), so a visitor who clicks through recognizes it as the
     same real data rather than a different invented component. */
  .pack-preview { margin: var(--space-4) 0; }
  .pack-preview-label { color: var(--color-muted); font-size: var(--text-xs); margin: 0 0 var(--space-2); }
  .pack-preview-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .pack-preview-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }

  .pack-quiet-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    border-top: 1px solid var(--color-border);
    padding: var(--space-4) 0;
  }
  .pack-quiet-row a { font-weight: var(--weight-bold); }
  .pack-quiet-main { display: flex; flex-direction: column; gap: var(--space-2); }
  .pack-quiet-title { font-weight: var(--weight-bold); }
  .pack-quiet-main .pack-preview { margin: 0; }
  .pack-quiet-main .pack-preview-label { display: none; }
  .pack-sample-link--compact { margin-top: 0; }
  /* A quiet row's own direct buy link (packCtaHtml(pack, true) in
     src/renderPackPages.js) -- sits next to "See what's in it", same
     never-accent-filled text-link treatment renderLeakReportUpsell()
     already uses for its own secondary CTA, so the page still has exactly
     one accent-FILLED action (spec 1.6.4) even once more than one pack
     has a real store url. */
  .pack-quiet-actions { display: flex; align-items: center; gap: var(--space-4); }
  .pack-cta--compact {
    display: inline;
    width: auto;
    min-height: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: none;
    color: var(--color-accent-dark);
  }
  .pack-cta--compact:hover { background: none; color: var(--color-accent); }
  .pack-cta--compact:active { transform: none; }

  /* Global honor of the OS-level reduced-motion preference (WCAG 2.2 SC
     2.3.3), site-wide -- this was the one real gap this file's
     component-level transitions left open (theme toggle, nav links, form
     inputs/buttons, band-header-select, pack rows, etc. each declare their
     own hover/focus transition above, but none of them checked the media
     feature). The cm-chessboard piece-movement case is NOT covered here on
     purpose: it's not a CSS transition at all, and is already gated at the
     JS level in src/boardWidget.js's prefersReducedMotion() (sets
     animationDuration to 0, calls board.setPosition() with animate=false)
     -- duplicating that control here would do nothing. renderDrill.js's
     .drill-feedback already had its own scoped override; this block
     subsumes it going forward but that file's own rule is left alone
     (redundant, not wrong). !important is deliberate: every rule above
     this point declares transition/animation directly on its own selector
     (higher specificity than the universal selector below), and per-page
     extraCss blocks (e.g. renderOpeningReport.js's .fetch-cancel) load
     after SITE_CSS in the cascade -- without !important those would win
     over a plain override here. Near-zero duration rather than the literal
     'none' value so any future transitionend-driven behavior degrades
     gracefully instead of silently never firing (no code currently
     listens for it). */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      transition-duration: 0.01ms !important;
      transition-delay: 0ms !important;
      animation-duration: 0.01ms !important;
      animation-delay: 0ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
    }
  }
`;

/**
 * Strips CSS block comments from a CSS string. SITE_CSS's own comments
 * above explain non-obvious token/layout decisions for a future builder
 * reading SOURCE -- real engineering value that has nothing to do with a
 * site visitor, and no reason to pay bytes on every one of 125 pages (or,
 * worse, put engineering shorthand meant for internal readers straight into
 * View Source). Deliberately a plain global block-comment strip, not a real
 * CSS parser: checked by hand that SITE_CSS contains no content:/url()
 * value with a literal comment-delimiter sequence inside it, and no
 * comment a rule depends on being present -- safe for this specific input,
 * not a general-purpose CSS minifier.
 * @param {string} css
 * @returns {string}
 */
function stripCssComments(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // A removed comment that occupied one or more whole lines leaves behind
    // a now-empty (or whitespace-only) line where it used to be -- drop
    // those rather than shipping them: harmless for CSS itself, but this
    // project's own whole-page whitespace-hygiene check (see
    // test/renderPackPages.test.js's NO_BLANK_LINE) flags two consecutive
    // blank/whitespace-only lines anywhere in a rendered page, and the
    // <style> block is part of that same page.
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

// The SHIPPED value -- comment-free -- used everywhere SITE_CSS actually
// reaches a visitor: written once to dist/site.css (src/buildStatic.js) and
// linked by every page's <link rel="stylesheet"> in renderDocumentHead()
// below, plus served at the same path by the local dev server
// (src/server.js's own /site.css route), AND (via bundleBrowserEntry()'s
// own post-bundle strip in src/buildStatic.js) every client-side JS bundle
// that require()s this whole module. The raw, commented SITE_CSS binding
// above stays SOURCE-only and is never itself exported or referenced past
// this line, so there is exactly one place the comment text can leak from
// (a bundler copying this module's source wholesale), not two.
//
// Craft-audit item 6 (external stylesheet, not inlined per page): SITE_CSS
// used to ship as an 86,266-byte <style> block duplicated byte-for-byte
// inside all 125 pages (~10.5 MB of duplicated payload site-wide, none of
// it cacheable across a navigation since a <style> block lives inside its
// own document). It is now written ONCE to dist/site.css and every page
// merely links it, so a repeat visitor's second, third, ... page view pays
// zero bytes for it (a normal browser HTTP cache on a static asset), at the
// real cost of one extra render-blocking request on a page's FIRST load
// this build does not currently mitigate with a critical-CSS inline subset
// (a legitimate, disclosed follow-up, not attempted here -- see this
// change's own commit message for the measured trade-off).
//
// This deliberately does NOT preserve the site's file:// invariant for
// VISUAL STYLING specifically: `/site.css` is a root-relative href (same
// convention already used two lines above by /favicon.svg,
// /apple-touch-icon.png, and /fonts/fraunces-variable.woff2 -- all three
// already failed to resolve under a raw file:// open before this change,
// for the same reason), which does not resolve when a built page is opened
// directly as a file:// URL rather than served from the site root -- a
// visitor opening dist/index.html locally (see README's own file://
// walkthrough) would see the page unstyled. The file:// invariant this
// project's tests actually enforce (test/buildStatic.test.js, "runs with no
// global require/module/exports") is about the JS bundles staying
// self-contained with zero runtime fetch() calls -- that invariant is
// untouched by this change, since a <link rel="stylesheet"> is a normal
// browser-resolved asset reference, not a script-driven fetch.
const SITE_CSS_FILE = 'site.css';
const SITE_CSS_SHIPPED = stripCssComments(SITE_CSS);

// Default social-share image (1200x630, per Open Graph's recommended size).
// Generated locally by scripts/build-og-image.js and committed to
// assets/og-default.png / copied into dist/ -- a separate build step, not
// this file's job. Hardcoded as an absolute URL here rather than built from
// site.js's SITE_ORIGIN because render.js has no CommonJS module loading
// available to it at all (see this file's header comment); same reasoning as
// the KOFI_URL constant below already being a hardcoded absolute URL.
const OG_DEFAULT_IMAGE = 'https://repertoire-builder.com/og-default.png';

// Copied by value from DESIGN_TOKENS/THEME_ROLES' light/dark --color-bg
// (ink-0 / ink-9) -- a <meta name="theme-color"> can't reference a CSS
// custom property, same reasoning /favicon.svg's own colors below are
// hardcoded rather than themed.
const THEME_COLOR_LIGHT = '#F5F1E6';
const THEME_COLOR_DARK = '#14130F';

// Pre-paint script: applies a stored theme choice, and marks the document
// as JS-capable, before the <style> block below is parsed -- so there is no
// flash of the wrong theme, and the theme toggle (display:none by default;
// see .js .theme-toggle in SITE_CSS) only ever appears once JS has actually
// run. Wrapped in try/catch for private-mode storage failures. Same
// localStorage key/values/attribute/hook as lol-practice-system's shell.js
// (design-standards.md: conform at the interaction layer) -- the one
// deliberate difference is this asset defaults LIGHT (no stored value AND
// no OS dark preference leaves <html> with no data-theme attribute, which
// is what SITE_CSS's plain :root values -- already the light role
// assignment -- fall through to; see SITE_CSS's own comment above for why).
const THEME_PREPAINT_SCRIPT = `<script>
(function () {
  try {
    var stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
    document.documentElement.classList.add('js');
  } catch (e) {}
})();
</script>`;

// Theme toggle behavior: reads the EFFECTIVE theme (an explicit
// data-theme attribute, else the OS preference) rather than assuming light,
// since this asset's default honors prefers-color-scheme -- a dark-OS
// visitor's first click must go to light, not dark again. Persists the
// explicit choice, which then always wins over the OS (see SITE_CSS's
// :not([data-theme="light"]) media-query guard). Inline, appended once by
// renderFooter() below (every page calls it), so a single script node
// exists no matter how many boards/other scripts a given page also loads.
const THEME_TOGGLE_SCRIPT = `<script>
(function () {
  var btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;
  function effectiveTheme() {
    return document.documentElement.dataset.theme
      || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function label(theme) {
    btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  }
  label(effectiveTheme());
  btn.addEventListener('click', function () {
    var next = effectiveTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    label(next);
  });
})();
</script>`;

/**
 * @param {string|{title:string, description?:string, canonical?:string,
 *   ogType?:'website'|'article', jsonLd?:string, noindex?:boolean,
 *   extraCss?:string, ogImage?:string}} arg
 *   Back-compat: a plain string is treated exactly as before (just a
 *   <title>). An object form additionally emits a meta description and a
 *   canonical link when given. OpenGraph/Twitter tags are ALWAYS emitted
 *   (title/type/site_name/image unconditionally; description/url only when
 *   given) -- every page gets a usable social-share card, even ones with no
 *   canonical or description yet. `jsonLd` (a pre-serialized <script type=
 *   "application/ld+json"> block or blocks) is phase-3 scope; content pages
 *   in this build pass no jsonLd, so nothing changes for them yet. `extraCss`
 *   emits a page-specific <style> block after the shared SITE_CSS
 *   `<link rel="stylesheet">` (see SITE_CSS_FILE's own comment above for why
 *   that shared CSS is now a link, not an inline block) -- only the drill
 *   page (src/renderDrill.js) passes it, so every other page's output is
 *   unaffected. `ogImage` overrides the sitewide
 *   OG_DEFAULT_IMAGE with a page-specific absolute image URL (only the
 *   Repertoire Pack pages pass this today -- src/renderPackPages.js -- every
 *   other page keeps the shared default unchanged).
 * @returns {string} a full <head>...</head> block shared by every page.
 */
function renderDocumentHead(arg) {
  const opts = typeof arg === 'string' ? { title: arg } : (arg || {});
  const { title, description, canonical, ogType = 'website', jsonLd, noindex, extraCss, feedUrl, ogImage } = opts;

  const metaDescription = description
    ? `\n  <meta name="description" content="${escapeHtml(description)}">`
    : '';
  const canonicalLink = canonical
    ? `\n  <link rel="canonical" href="${escapeHtml(canonical)}">`
    : '';
  const robotsMeta = noindex ? '\n  <meta name="robots" content="noindex">' : '';
  const og = `\n  <meta property="og:title" content="${escapeHtml(title)}">` +
    (description ? `\n  <meta property="og:description" content="${escapeHtml(description)}">` : '') +
    (canonical ? `\n  <meta property="og:url" content="${escapeHtml(canonical)}">` : '') +
    `\n  <meta property="og:type" content="${escapeHtml(ogType)}">` +
    `\n  <meta property="og:site_name" content="Repertoire Builder">` +
    `\n  <meta property="og:image" content="${escapeHtml(ogImage || OG_DEFAULT_IMAGE)}">` +
    `\n  <meta property="og:image:width" content="1200">` +
    `\n  <meta property="og:image:height" content="630">` +
    `\n  <meta name="twitter:card" content="summary_large_image">`;
  const jsonLdBlock = jsonLd ? `\n  ${jsonLd}` : '';
  const extraStyleBlock = extraCss ? `\n  <style>${extraCss}</style>` : '';
  // RSS discovery link: only emitted on pages that pass feedUrl explicitly
  // (the home page -- see buildStatic.js) rather than every single page,
  // since every page already links "RSS feed" visibly in the shared footer
  // below.
  const feedLink = feedUrl
    ? `\n  <link rel="alternate" type="application/rss+xml" title="Repertoire Builder - new opening guides and articles" href="${escapeHtml(feedUrl)}">`
    : '';

  return `<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'none'">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="${THEME_COLOR_LIGHT}" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="${THEME_COLOR_DARK}" media="(prefers-color-scheme: dark)">
  <title>${displayNameText(title)}</title>${metaDescription}${canonicalLink}${robotsMeta}${og}${feedLink}
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preload" href="/fonts/fraunces-variable.woff2" as="font" type="font/woff2" crossorigin>
  ${THEME_PREPAINT_SCRIPT}
  <link rel="stylesheet" href="/${SITE_CSS_FILE}">${extraStyleBlock}${jsonLdBlock}
  <script data-goatcounter="https://dylangerrrr.goatcounter.com/count" data-goatcounter-settings='{"allow_query":["utm_source","utm_medium","utm_campaign","utm_content","utm_term","ref"]}' async src="https://gc.zgo.at/count.js"></script>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9767914878112531" crossorigin="anonymous"></script>
</head>`;
}

// Fixed nav order for every page that has more than the original two links.
// renderHeader() below renders only the keys actually PRESENT in the `nav`
// object it's given, in this order -- so server.js's existing 2-key nav
// (player/openings) renders identically to before, while the static build
// can pass additional keys as those pages come online without editing
// server.js at all.
//
// Site-audit backlog item 1 (2026-08-26): collapsed
// from 9 top-level items (Repertoire builder, Repertoire explorer, Packs,
// Openings, ECO index, Opening drill, Guides, FAQ, Opening report) down to
// these 5. 'openings' (now labeled "Explore") absorbs Repertoire explorer,
// ECO index, and Compare Openings (PR #82, which shipped after the
// original 9-item nav and was deliberately left out of it pending this
// restructure) -- all three are real content-browsing surfaces, not
// separate destinations, so they're one nav item that lands on the
// openings.html hub, which itself now links out to each (see
// renderOpeningsHub()'s "Explore the data" section in src/renderContent.js).
// 'player' keeps its own key (unchanged from before) but is now labeled
// "My report" for top billing, per the task's own wording -- it is the
// site's single most useful personalized surface, not an equal peer of
// the ECO index it used to sit next to.
//
// 'builder' and 'faq' are deliberately NOT in this list -- dropping them
// from NAV_ORDER would silently orphan their pages (repertoire-builder.html
// had no OTHER inbound link anywhere on the site), so this task also adds a
// homepage CTA for the builder tool (buildStatic.js's indexPage(), "Build
// your own repertoire" card) and moves the FAQ link into the footer's
// legal-links row (renderFooter() below), the same "reachable from every
// page, just not the top nav" treatment this site already gives Privacy/
// About/Contact/Methodology.
const NAV_ORDER = ['openings', 'player', 'drill', 'guides', 'packs'];
const NAV_LABELS = {
  // Kept (unused by NAV_ORDER above, but still real page destinations other
  // code links to directly): builder, repertoire, eco, faq. Not deleted --
  // see the site-audit item 1 comment above for where each is still reachable.
  builder: 'Repertoire builder',
  repertoire: 'Repertoire explorer',
  packs: 'Packs',
  openings: 'Explore',
  eco: 'Chess Opening Encyclopedia',
  // Relabeled from "Italian Game Drill" -- WS-1's Drill Engine v2 (spec
  // section 3.3) generalizes this from one hardcoded opening to any
  // opening in the band data, so the nav label no longer needs the
  // "rename back once it generalizes" caveat this used to carry.
  drill: 'Drill',
  guides: 'Guides',
  faq: 'FAQ',
  // Relabeled "Opening report" -> "My report" per site-audit item 1: top
  // billing now that it shares the nav with only 4 siblings instead of 8.
  player: 'My report',
};

// WS-1 spec section 3.4 (task W4, band persistence). The four rating bands
// this SITE-WIDE header control offers -- MUST match processRepertoire.js's
// RATING_BANDS keys (the bands the site's data actually covers) and
// src/browser/bandState.client.js's BANDS enum minus its 'u1200'/
// '1200-1400' entries. Duplicated here as a plain literal, not a require(),
// because render.js is deliberately a leaf module with zero requires (see
// this file's own top-of-file comment -- it's bundled into the browser via
// playerLookup.client.js, so pulling in a Node module here would break that
// bundle); test/render.test.js asserts this list stays in sync with both of
// those other two sources so drift is still caught by CI.
//
// Scope boundary (spec 3.4, stated plainly there): the WS-1 directive also
// asks for a below-1400 band. That is NOT buildable yet -- the Opening
// Explorer API has no sub-1400 ratings bucket to crawl, and
// processRepertoire.js's RATING_BANDS has no such keys either (only
// src/ingest/gameFilter.js's dump-pipeline BANDS does, and that pipeline
// hasn't produced a dataset). Note this reads as a mild disagreement with
// bandState.client.js's own header comment, which describes a *future*
// header control exposing the full 6-band enum -- that comment predates
// this spec's explicit scope boundary and is superseded by it here, per
// Non-Negotiable 4 ("locked content that pretends to exist" is forbidden:
// shipping an empty sub-1400 option would be exactly that).
const HEADER_BAND_OPTIONS = ['1400-1600', '1600-1800', '1800-2000', '2000+'];

// Matches src/browser/bandState.client.js's DEFAULT_STATE.band -- the
// option this control pre-selects server-side (a static build has no way
// to know a returning visitor's saved band before their own JS runs;
// src/browser/bandHeaderControl.client.js re-syncs the <select> to their
// actual saved state on load, same "server default, client corrects"
// pattern src/browser/repertoire.client.js already uses).
const HEADER_BAND_DEFAULT = '1600-1800';

// Which `active` pages get the band control: every page WS-1 (or its
// WS-3.2 predecessor) shows band-dependent numbers on. 'builder'/'player'/
// 'drill' are currently placeholders (W1a/W2/W3, not yet real) but already
// pass these exact `active` values (see src/renderRepertoireBuilder.js,
// src/renderOpeningReport.js, src/renderDrillHub.js/renderDrill.js) --
// this set doesn't need to change again when those land for real, keeping
// W4 file-disjoint from that follow-on work. 'repertoire' is the existing
// WS-3.2 page, which already has its own richer in-page band+color picker
// (buildStatic.js's renderBandPicker) -- this header control is an
// additional, smaller, always-visible affordance, not a replacement; both
// read/write the same src/browser/bandState.client.js state and stay in
// sync via its onBandStateChange() subscription. 'home' added by the
// craft-audit fix (item 2): the homepage's ranked opening cards and hero
// demo both show band-dependent numbers (previously hardcoded to
// 1600-1800 with no control at all, a real gap against this set's own
// stated criterion) -- src/browser/homeDemo.client.js reads/writes the
// same shared band state as every other page here.
const BAND_CONTROL_PAGES = new Set(['builder', 'player', 'drill', 'repertoire', 'compare', 'home']);

// Site-audit item 1's nav collapse (2026-08-26) folded
// 'repertoire'/'eco'/'compare' into the single 'openings' ("Explore") nav
// item, but those three pages' OWN `active` value must stay unaliased for
// BAND_CONTROL_PAGES above -- 'compare'/'repertoire' show the band control,
// 'eco' deliberately never has (ECO browsing isn't band-filtered), and
// aliasing at the BAND_CONTROL_PAGES check too would silently turn the band
// control on for eco-openings.html/eco-explorer.html, which never had it.
// This map exists ONLY for nav-highlighting (which link gets aria-current),
// applied below, never for the band-control check above.
const NAV_HIGHLIGHT_ALIAS = { repertoire: 'openings', eco: 'openings', compare: 'openings' };

/**
 * The <select> markup for the site-wide band-persistence control (WS-1
 * spec 3.4). Server-rendered with HEADER_BAND_DEFAULT selected;
 * src/browser/bandHeaderControl.client.js re-syncs it to the visitor's
 * actual saved band (fragment > localStorage > default) once its bundle
 * loads. Band-only (not pool/color) -- see that file's own header comment
 * for why.
 */
function renderBandHeaderControl() {
  const options = HEADER_BAND_OPTIONS
    .map((band) => `<option value="${escapeHtml(band)}"${band === HEADER_BAND_DEFAULT ? ' selected' : ''}>${escapeHtml(band)}</option>`)
    .join('');
  // Leading "\n      " is deliberate: the caller (renderHeader() below)
  // concatenates this directly onto the end of the brand <a>'s line rather
  // than giving it its own template-literal line, so an ABSENT control (the
  // empty string this function's caller substitutes when
  // BAND_CONTROL_PAGES doesn't include the current page) leaves no
  // whitespace-only line behind -- same "no blank line for an omitted
  // optional field" technique renderFooter()'s legalRow already uses (see
  // that function's own comment for the html-validate rule this avoids).
  return `
      <div class="band-header-control">
        <label class="sr-only" for="site-band-select">Rating band</label>
        <select id="site-band-select" class="band-header-select" data-band-header-control aria-label="Rating band, remembered for your next visit">${options}</select>
      </div>`;
}

/**
 * Normalizes an internal href to a root-relative absolute path (leading
 * '/') at the point it's actually rendered into an <a href>. Every nav/
 * legal-link filename constant this site builds (STATIC_NAV/LEGAL_LINKS in
 * buildStatic.js, and their per-page-type siblings CONTENT_LEGAL_LINKS/
 * ECO_LEGAL_LINKS/ECO_EXPLORER_LEGAL_LINKS) is a bare, page-relative
 * filename with no leading slash, e.g. 'eco-openings.html' -- correct only
 * for a page living at the site root. That was every page until the
 * Repertoire Pack detail pages (src/renderPackPages.js) shipped as the
 * first pages nested one directory deep (/repertoire-packs/<id>.html),
 * where every one of those bare filenames resolved to a doubled,
 * nonexistent path instead. Several of those same constants are ALSO used
 * as fs.writeFileSync() output paths elsewhere in the build (path.join
 * tolerates a leading slash fine, but there's no reason to touch working
 * file-path code) -- so this normalization happens only here, at
 * href-render time, never to the constants themselves.
 *
 * Left unchanged (safe no-op) for: an already root-relative path ('/',
 * '/repertoire' -- e.g. src/server.js's SERVER_NAV, which already uses real
 * absolute dev-server routes), a full http(s)/protocol-relative URL, a
 * fragment-only link (#foo), and an empty/falsy value. This is what keeps
 * call sites that already manually prepend '/' (e.g. buildStatic.js's
 * redirect-stub targetPath values) from ever seeing this function and
 * risking a double slash -- they don't go through renderHeader()/
 * renderFooter() at all.
 *
 * @param {string} href
 * @returns {string}
 */
function siteRelativeHref(href) {
  if (!href) return href;
  if (/^(https?:)?\/\//.test(href) || href.startsWith('/') || href.startsWith('#')) return href;
  return `/${href}`;
}

/**
 * @param {{builder?: string, player?: string, repertoire?: string, packs?: string,
 *   openings?: string, eco?: string, drill?: string, guides?: string, faq?: string}} nav
 *   link targets for whichever pages currently exist -- either the dynamic
 *   dev-server routes (server.js's default, 2 keys) or flat static
 *   filenames (buildStatic.js, up to 9 keys). Only keys present in this
 *   object are rendered.
 * @param {'builder'|'player'|'repertoire'|'packs'|'openings'|'eco'|'drill'|'guides'|'faq'|'compare'|null} [active]
 *   which nav link, if any, represents the current page. 'repertoire'/'eco'/
 *   'compare' have no `nav` key of their own in NAV_ORDER any more (site-
 *   audit item 1's nav collapse folded them into 'openings'/"Explore") --
 *   NAV_HIGHLIGHT_ALIAS above maps them to 'openings' for the purpose of
 *   which link gets aria-current, while `active` itself stays unaliased for
 *   the BAND_CONTROL_PAGES check below.
 * @returns {string} the shared header/nav markup used on every page.
 */
function renderHeader(nav, active = null) {
  const highlightKey = NAV_HIGHLIGHT_ALIAS[active] || active;
  const links = NAV_ORDER.filter((key) => nav[key] != null)
    .map((key) => `<a href="${escapeHtml(siteRelativeHref(nav[key]))}"${highlightKey === key ? ' aria-current="page"' : ''}>${escapeHtml(NAV_LABELS[key])}</a>`)
    .join('\n      ');

  const showBandControl = BAND_CONTROL_PAGES.has(active);
  const bandControl = showBandControl ? renderBandHeaderControl() : '';
  // Loaded only on the pages that actually render the control -- see
  // src/buildStatic.js's buildBandHeaderControlBundle() for how
  // dist/band-header.js is produced (same esbuild pipeline as every other
  // browser entry point here). `defer` so it never blocks first paint;
  // the <select> works as an inert, server-rendered default with no JS at
  // all, same progressive-enhancement shape as every other control on
  // this site.
  const bandControlScript = showBandControl ? '<script src="band-header.js" defer></script>' : '';

  // Brand + theme toggle share one row (.brand-row) so the toggle never
  // adds a fourth wrapped nav row on narrow viewports -- same fix the
  // sibling asset already made for the same header shape (see SITE_CSS's
  // .brand-row comment). The button's server-rendered label always assumes
  // light (this asset's default); THEME_TOGGLE_SCRIPT re-syncs it to
  // whatever theme is actually in effect on load. The band control (when
  // present) sits between them -- same row, wraps onto its own line first
  // on narrow viewports since it's the widest of the three (.brand-row's
  // flex-wrap, see SITE_CSS).
  return `<a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="site-header">
    <div class="brand-row">
      <a class="brand" href="${escapeHtml(siteRelativeHref(nav.home || nav.openings || nav.repertoire || '/'))}"><span class="brand-mark" aria-hidden="true">&#9822;</span>Repertoire Builder</a>${bandControl}
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme">
        <span aria-hidden="true">&#9789;</span>
      </button>
    </div>
    <nav class="site-nav" aria-label="Main">
      ${links}
    </nav>
  </header>${bandControlScript}`;
}

// Support-link URL, added once here so every page picks it up from this
// single shared footer instead of being pasted into each render*.js call
// site. Real account created by the human -- do not modify this string.
// The disclosure copy required alongside this link lives in
// renderDisclosure() below; this constant is just the link/button itself.
//
// The site used to also link a Buy Me a Coffee account under a different
// handle ("dylanger254") than Ko-fi's ("flavaa") -- two donation
// identities under two different names reads as a trust seam (which one is
// the "real" one?), so Ko-fi is now the only linked donation platform.
// The Buy Me a Coffee account itself stays open and untouched -- this is a
// content-only change, the site simply stops linking it.
const KOFI_URL = 'https://ko-fi.com/flavaa';

// Repertoire Pack store links (monetization-layer spec 1.4). Swapping
// merchants is a one-line edit here -- everything downstream (the pack
// pages, Product JSON-LD, GoatCounter click paths) reads through this one
// constant and never assembles a store URL any other way. These are now the
// real, human-approved Gumroad listing URLs --
// isPlaceholderStoreUrl() returns false for both, so the pack pages render
// live CTAs, real Product JSON-LD Offers, and are no longer noindexed. Every
// caller still MUST check isPlaceholderStoreUrl() before rendering a URL
// here as an actual <a href> or emitting it into Product JSON-LD -- see
// renderPackPages.js's renderPackCta()/renderPackDetailPage() for the one
// place that check happens, so a future placeholder swap (a new pack, a
// merchant change) stays covered by the same honest fallback. A literal
// "PLACEHOLDER" string must never reach rendered HTML
// (test/buildStatic.test.js's assertNoPlaceholderLeak checks this against
// the real built dist/ output).
const STORE = {
  vendor: 'gumroad', // or 'ko-fi' -- see the monetization spec's section 1.4/2.5
  packs: {
    'white-1400-1600': 'https://repertoirebuilder.gumroad.com/l/blzarx',
    'black-vs-e4-1400-1600': 'https://repertoirebuilder.gumroad.com/l/lyjgj',
  },
};

/** @param {string} url a STORE.packs[...] value. */
function isPlaceholderStoreUrl(url) {
  return typeof url !== 'string' || url.includes('PLACEHOLDER');
}

/**
 * Shared social-link mark (a ring, a jagged upward line, a dot at the tip)
 * recreated as inline SVG from the operator's own profile picture. Colors
 * are the artist's fixed brand colors, not derived from this site's own
 * token ramp, so the mark stays recognizable and identical across every
 * property and the social profile itself -- same self-contained-asset
 * exemption from the tokens-only rule /favicon.svg's own colors carry,
 * hardcoded for the same reason (a favicon/shared mark is its own
 * standalone resource, not themed per-site).
 */
const SOCIAL_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><circle cx="50" cy="50" r="47" fill="#0f2233"/><circle cx="50" cy="50" r="35" fill="none" stroke="#6f95a1" stroke-width="3"/><path d="M16 74 L38 58 L50 66 L83 27" fill="none" stroke="#c99a44" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="83" cy="27" r="9" fill="#f2e0a8"/></svg>';

/**
 * Portfolio-wide footer credit line -- identical wording/type role on all
 * three properties, naming the operator and linking to the other two. See
 * docs/DESIGN_PLAYBOOK.md's "What stays shared across the portfolio".
 */
function renderFooterCredit() {
  return `<p class="footer-credit">Built by Dylan, who also makes <a href="https://usefiletools.com" rel="noopener noreferrer">filetools</a> and <a href="https://lol-practice-system.com" rel="noopener noreferrer">Solo Queue Practice</a>. <a class="footer-social" href="https://x.com/builtittheycome" rel="noopener noreferrer">${SOCIAL_ICON_SVG}Follow @builtittheycome</a></p>`;
}

// Newsletter signup: wired to the project's Substack publication
// (builtittheycome.substack.com -- the same portfolio-wide publication
// filetools and lol-practice-system already wired, per Substack's own
// "embed a subscribe widget" panel for that publication). This constant is
// the ONE place that switches capture on/off: left null it renders an
// honest "not live yet" placeholder; set to the embed URL it renders the
// real widget. Defined as a literal constant here (not pulled in from
// site.js) for the same reason KOFI_URL above is: this file is
// concatenated verbatim into the browser bundle (see this file's header
// comment) and cannot use CommonJS module loading at module scope.
const NEWSLETTER_FORM_ACTION = 'https://builtittheycome.substack.com/embed';
const SUBSTACK_PUBLICATION_URL = 'https://builtittheycome.substack.com';

/**
 * Sitewide newsletter signup, rendered inside the shared footer so it
 * appears on every page. See NEWSLETTER_FORM_ACTION's comment above for how
 * this switches from the placeholder state to the real embed.
 *
 * Renders an iframe embed (Substack has no plain-HTML form-post endpoint --
 * a <form action> posting to the /embed URL, which is what this function
 * did before this content was real, does not actually subscribe anyone).
 * The iframe itself is only created client-side once its footer slot nears
 * the viewport (see the inline script below), not unconditionally on every
 * page load -- an eagerly-loaded third-party iframe in a sitewide footer
 * cost the whole Lighthouse Performance budget on this same Substack
 * publication's other two embeds (filetools, lol-practice-system); this
 * keeps the signup box fully functional while keeping it off the
 * initial-load critical path. Kept as one small inline script (rather than
 * a separate src/browser/*.client.js file copied by build.js/buildStatic.js
 * and referenced from every render*.js page template) so this remains the
 * one place in the codebase that needs to change to wire this up, matching
 * every other page template's existing renderFooter() call unchanged.
 */
function renderNewsletterSignup() {
  if (!NEWSLETTER_FORM_ACTION) {
    return `<div class="newsletter-signup newsletter-signup--pending">
    <h2 class="newsletter-heading">Get new openings and guides by email</h2>
    <p class="newsletter-description">Email sign-up isn&rsquo;t live yet - check back soon, or follow the <a href="feed.xml">RSS feed</a> in the meantime.</p>
  </div>`;
  }
  return `<div class="newsletter-signup">
    <h2 class="newsletter-heading">Get new openings and guides by email</h2>
    <p class="newsletter-description">One email when a new opening page or guide ships. No spam, unsubscribe anytime.</p>
    <div class="newsletter-embed" data-newsletter-slot data-newsletter-src="${escapeHtml(NEWSLETTER_FORM_ACTION)}" data-newsletter-title="Email signup for Repertoire Builder updates"></div>
    <noscript><p class="newsletter-description"><a href="${escapeHtml(SUBSTACK_PUBLICATION_URL)}" target="_blank" rel="noopener noreferrer">Subscribe on Substack</a></p></noscript>
    <script>(function(){var slots=document.querySelectorAll('[data-newsletter-slot]');if(!slots.length)return;function loadEmbed(slot){var src=slot.getAttribute('data-newsletter-src');var title=slot.getAttribute('data-newsletter-title')||'Email signup form';if(!src||!/^https:\\/\\//.test(src))return;var iframe=document.createElement('iframe');iframe.src=src;iframe.width='480';iframe.height='320';iframe.loading='lazy';iframe.title=title;iframe.className='newsletter-embed';iframe.setAttribute('frameborder','0');iframe.setAttribute('scrolling','no');slot.replaceWith(iframe);}if(!('IntersectionObserver' in window)){slots.forEach(loadEmbed);return;}var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){observer.unobserve(entry.target);loadEmbed(entry.target);}});},{rootMargin:'200px 0px'});slots.forEach(function(slot){observer.observe(slot);});})();</script>
  </div>`;
}

/**
 * Affiliate/support-link disclosure. Exported as its own function -- not
 * just inlined into renderFooter() below -- so it's a genuine standalone
 * snippet/component, reusable on any future page that carries affiliate or
 * support links even outside the shared footer (e.g. a future dedicated
 * review/comparison page). renderFooter() also calls this unconditionally
 * (see below) because every page's footer already renders the Ko-fi
 * support link (KOFI_URL above) -- the disclosure that covers it has to
 * appear everywhere it does.
 */
function renderDisclosure() {
  return `<p class="disclosure-note">Disclosure: this site includes a voluntary support link (Ko-fi) and may in the future include affiliate links that earn a small commission on qualifying purchases at no extra cost to you. Support and affiliate links never influence the win-rate data, rankings, or analysis shown on this site. All of that comes directly from Lichess&rsquo;s public API and Opening Explorer, unaffected by any link on this page.</p>`;
}

/**
 * @param {string} innerHtml page-specific footer copy (data-source credit,
 *   etc). Callers should NOT claim the site is only local/unpublished --
 *   this app is deployed to GitHub Pages.
 * @param {{privacy?: string, about?: string, contact?: string, methodology?: string, faq?: string}} [legalLinks]
 *   Optional footer link targets for the compliance pages implemented in
 *   src/renderCompliance.js, plus `methodology` (spec WS-3.3 section 3.5 --
 *   every page carrying an interval links to /methodology.html; the shared
 *   footer is the mechanism that makes that "every page" rather than a
 *   per-template link a future page can forget to add). Only callers that
 *   know those pages actually exist at those paths should pass this -- the
 *   local-only dev server (src/server.js) has no routes for them and
 *   deliberately omits it, so its footer renders with no legal-links row
 *   rather than a broken link. The disclosure paragraph above, by contrast,
 *   is unconditional (see renderDisclosure()'s own comment).
 */
function renderFooter(innerHtml, legalLinks) {
  // Built as a list of only the PRESENT links, joined -- same "no blank
  // line for an omitted optional field" technique as renderPageHead() above
  // (see that function's own doc comment for exactly which html-validate
  // rule a naive per-line ternary trips). `methodology` was the first key
  // here that isn't present on every legalLinks object a caller passes
  // (some ECO-page callers -- src/renderEcoPages.js's ECO_LEGAL_LINKS,
  // src/renderEcoExplorerPage.js's ECO_EXPLORER_LEGAL_LINKS -- don't carry
  // it), which is what exposed this: a fixed 4-line template with a falsy
  // 4th line leaves a whitespace-only text node exactly like the bug
  // renderPageHead already documents.
  let legalRow = '';
  if (legalLinks) {
    const links = [];
    if (legalLinks.privacy) links.push(`<a href="${escapeHtml(siteRelativeHref(legalLinks.privacy))}">Privacy policy</a>`);
    if (legalLinks.about) links.push(`<a href="${escapeHtml(siteRelativeHref(legalLinks.about))}">About</a>`);
    if (legalLinks.contact) links.push(`<a href="${escapeHtml(siteRelativeHref(legalLinks.contact))}">Contact</a>`);
    if (legalLinks.methodology) links.push(`<a href="${escapeHtml(siteRelativeHref(legalLinks.methodology))}">Methodology</a>`);
    // Site-audit item 1: FAQ dropped out of the top nav (see NAV_ORDER's own
    // comment above) but must stay reachable from every page -- same
    // footer-only treatment as the other four.
    if (legalLinks.faq) links.push(`<a href="${escapeHtml(siteRelativeHref(legalLinks.faq))}">FAQ</a>`);
    legalRow = `
  <nav class="legal-links" aria-label="Legal">
    ${links.join('\n    ')}
  </nav>`;
  }
  // THEME_TOGGLE_SCRIPT is appended here (not in the header, where the
  // toggle button itself lives) because renderFooter() is the one function
  // every page template already calls unconditionally -- it queries
  // [data-theme-toggle] globally, so its position in the DOM relative to
  // the button doesn't matter, only that it runs once per page.
  return `<footer class="site-footer">${innerHtml}
  ${renderFooterCredit()}
  ${renderNewsletterSignup()}
  <div class="support-links">
    <a href="${KOFI_URL}" target="_blank" rel="noopener noreferrer">&#9749; Support on Ko-fi</a>
  </div>
  ${renderDisclosure()}${legalRow}</footer>
  ${THEME_TOGGLE_SCRIPT}`;
}

/**
 * One shared page-head component used by every template that has a
 * breadcrumb/eyebrow/h1/subtitle -- so the four page types (homepage,
 * opening guide, drill, repertoire) all open the same way instead of each
 * hand-rolling its own markup order. Deliberately dumb: `breadcrumb` is
 * passed through UNCHANGED (built by renderContent.js's renderBreadcrumb()
 * from the same `items` array a caller also feeds to structuredData.js's
 * breadcrumbJsonLd()), so the visible trail and the BreadcrumbList JSON-LD
 * can never drift out of sync just because this function exists.
 * `eyebrow`/`title`/`subtitle`/`meta` are pre-built HTML/text fragments the
 * caller is responsible for escaping, same convention every other
 * render*.js function already uses for h1/subtitle content -- this
 * function does not call escapeHtml() itself. `eyebrow` is on-page text
 * ONLY: it is never concatenated into a caller's <title>, since callers set
 * that separately via renderDocumentHead's own `title` option (the value
 * buildContent.js's assertPageMetadata length-checks) -- this function
 * never touches <head> at all. Fixed eyebrow vocabulary across the site:
 * "Opening guide" / "Repertoire" / "Drill" / "Guide" / "FAQ" /
 * "Player lookup" / "Not found".
 * @param {{breadcrumb?: string, eyebrow?: string, title: string,
 *   subtitle?: string, meta?: string}} opts
 * @returns {string}
 */
function renderPageHead({ breadcrumb = '', eyebrow = '', title, subtitle = '', meta = '' }) {
  // Built as a list of only the PRESENT blocks, joined with '\n    ' --
  // never a leading or trailing newline, and never a blank/whitespace-only
  // line for an omitted optional field. The previous version always
  // emitted "    ${eyebrow ? ... : ''}" etc. as its own template line
  // (and, whenever `breadcrumb` was also falsy, started its whole return
  // value with a bare newline), so any omitted breadcrumb/eyebrow/subtitle/
  // meta left a line containing only the 4-space indent -- exactly what
  // html-validate's no-trailing-whitespace rule flags (a text node matching
  // /^[\t ]+\r?\n$/). `meta` in particular defaults to '' and most callers
  // never pass it, so this was the single largest source of that gate's
  // ~2270 total errors.
  const parts = [];
  if (breadcrumb) parts.push(breadcrumb);
  if (eyebrow) parts.push(`<p class="page-eyebrow">${eyebrow}</p>`);
  parts.push(`<h1 class="page-title">${title}</h1>`);
  if (subtitle) parts.push(`<p class="subtitle">${subtitle}</p>`);
  if (meta) parts.push(meta);
  return parts.join('\n    ');
}

/**
 * Wraps a `<table>...</table>` string in a horizontally-scrollable
 * container with a visible "there's more, scroll" affordance on narrow
 * viewports, instead of letting the table silently overflow the page.
 *
 * `label` is required (no default) and must be unique among any other
 * table-scroll regions on the SAME page -- a page with more than one
 * wrapped table needs a real per-table name (its own caption text is
 * always a good choice; see callers) or html-validate's unique-landmark
 * rule correctly flags the collision. Renders as a native <section> with
 * an accessible name rather than `<div role="region">` (prefer-native-element).
 */
function wrapTable(tableHtml, label) {
  return `<p class="table-hint">Scroll to see more &rarr;</p>
    <section class="table-scroll" tabindex="0" aria-label="${escapeHtml(label)}">${tableHtml}</section>`;
}

function deltaClassFor(change) {
  if (change == null) return 'delta--zero';
  if (change > 0) return 'delta--pos';
  if (change < 0) return 'delta--neg';
  return 'delta--zero';
}

function renderRatingTable(ratingRows) {
  if (ratingRows.length === 0) {
    return '<p class="empty-note">No rating history found.</p>';
  }
  const rows = ratingRows
    .map((row) => {
      const deltaText = row.change == null ? '-' : `${row.change >= 0 ? '+' : ''}${row.change}`;
      return `
      <tr>
        <td>${escapeHtml(row.variant)}</td>
        <td class="num">${row.current ?? '-'}</td>
        <td class="num">${row.peak ?? '-'}</td>
        <td class="num">${row.low ?? '-'}</td>
        <td class="delta num ${deltaClassFor(row.change)}">${deltaText}</td>
        <td class="num">${row.gamesRecorded}</td>
      </tr>`;
    })
    .join('');

  return wrapTable(`
    <table>
      <thead>
        <tr><th>Variant</th><th class="num">Current</th><th class="num">Peak</th><th class="num">Low</th><th class="num">Change</th><th class="num">Data points</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`, 'Ratings by variant');
}

function resultBadge(result) {
  const label = result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Draw';
  return `<span class="badge badge--${escapeHtml(result)}">${label}</span>`;
}

function renderGamesTable(gameSummary) {
  if (gameSummary.totalGames === 0) {
    return '<p class="empty-note">No recent games found.</p>';
  }
  const rows = gameSummary.results
    .map(
      (r) => `
      <tr class="result-${escapeHtml(r.result)}">
        <td>${escapeHtml(r.date || '-')}</td>
        <td>${escapeHtml(r.opponent)}</td>
        <td class="num">${escapeHtml(r.opponentRating ?? '-')}</td>
        <td>${escapeHtml(r.color)}</td>
        <td>${escapeHtml(r.variant)} / ${escapeHtml(r.speed)}</td>
        <td>${resultBadge(r.result)}</td>
      </tr>`
    )
    .join('');

  return `<p class="summary-line">${gameSummary.wins}W / ${gameSummary.losses}L / ${gameSummary.draws}D
       out of ${gameSummary.totalGames} games (win rate ${formatPct(gameSummary.winRate)}%,
       avg opponent rating ${gameSummary.avgOpponentRating ?? 'n/a'})</p>` +
    wrapTable(`
    <table>
      <thead>
        <tr><th>Date</th><th>Opponent</th><th class="num">Opp. rating</th><th>Color</th><th>Variant/Speed</th><th>Result</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`, 'Recent games');
}

/**
 * @param {{username: string, ratingRows: Array, gameSummary: object,
 *   nav?: {player: string, repertoire: string}}} data
 * @returns {string} a full standalone HTML document
 */
function renderPlayerPage({ username, ratingRows, gameSummary, nav = { player: '/', repertoire: '/repertoire' } }) {
  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead(`${username} | Repertoire Builder`)}
<body>
<div class="page page--wide">
  ${renderHeader(nav, 'player')}
  <main id="main-content">
    <h1 class="page-title">${escapeHtml(username)}</h1>
    <p class="subtitle">Lichess rating history and recent games</p>

    <h2>Ratings by variant</h2>
    ${renderRatingTable(ratingRows)}

    <h2>Recent games</h2>
    ${renderGamesTable(gameSummary)}
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api" rel="noopener noreferrer">lichess.org/api</a>.')}
</div>
</body>
</html>
`;
}

/**
 * @param {object} node a repertoire-tree node (uci/san/games/... -- see
 *   src/processRepertoire.js's own doc comment for the full shape).
 * @param {string[]} [path] UCI moves from the tree root down to (but not
 *   including) this node -- threaded through the recursion so every row can
 *   emit its own full `data-uci-path` (this node's move appended) without
 *   any caller needing to walk the DOM back up to reconstruct it. Added for
 *   the Explorer synced board panel (src/renderRepertoireExplorer.js): the
 *   panel replays `data-uci-path` through chessPosition.js's
 *   applyUciMoves()/fenFromBoard() to show the position after the selected
 *   line with no chess engine and no build-time FEN precomputation, since
 *   every node already carries the `uci` that reached it.
 */
function renderRepertoireNode(node, path = []) {
  const winPct = typeof node.winPct === 'number' ? node.winPct : null;
  const drawPct = typeof node.drawPct === 'number' ? node.drawPct : null;
  const lossPct = typeof node.lossPct === 'number' ? node.lossPct : null;
  const ratingNote = node.averageRating ? `<span class="rep-rating">avg rating ${node.averageRating}</span>` : '';
  const nodePath = [...path, node.uci];
  const children = node.children && node.children.length > 0
    ? `<ul>${node.children.map((child) => renderRepertoireNode(child, nodePath)).join('')}</ul>`
    : '';
  const wdlTitle = `${node.mover} win/draw/loss: ${formatPct(winPct)}% / ${formatPct(drawPct)}% / ${formatPct(lossPct)}%`;
  // Same SVG-rect technique as src/renderContent.js's wdlBar() -- see that
  // function's doc comment. Kept in sync here rather than shared because
  // this file may not require() renderContent.js (this file is also
  // concatenated verbatim into the browser bundle; see the header comment).
  const wdlBar = winPct == null
    ? ''
    : `<svg class="wdl-bar" viewBox="0 0 100 12" preserveAspectRatio="none" role="img"><title>${escapeHtml(wdlTitle)}</title><rect class="wdl-seg--win" x="0" y="0" width="${winPct}" height="12"></rect><rect class="wdl-seg--draw" x="${winPct}" y="0" width="${drawPct}" height="12"></rect><rect class="wdl-seg--loss" x="${winPct + drawPct}" y="0" width="${lossPct}" height="12"></rect></svg>
      <span class="wdl-label">${formatPct(winPct)}% / ${formatPct(drawPct)}% / ${formatPct(lossPct)}%</span>`;

  // Built the same "only the present blocks, joined" way as
  // src/render.js's renderPageHead (see that function's doc comment) --
  // `wdlBar`/`ratingNote`/`children` are all legitimately '' for a leaf
  // node/no-rating-data node, and interpolating any of them at their own
  // indented template line would leave a whitespace-only line for exactly
  // that (very common, one per leaf) case.
  const rowParts = [
    `<span class="move-chip move-chip--${escapeHtml(node.mover)}">${escapeHtml(node.san)}</span>`,
    `<span class="rep-games">${node.games.toLocaleString()} games <span class="rep-pct">(${formatPct(node.playedPct)}% of this position)</span></span>`,
  ];
  if (wdlBar) rowParts.push(wdlBar);
  if (ratingNote) rowParts.push(ratingNote);

  // A real <button>, not a div with a click handler (design-standards.md
  // WCAG 2.1.1/4.1.2 -- an unreachable-by-keyboard div fails both). Gets
  // Enter/Space/focus for free; the four extra style resets this costs live
  // in SITE_CSS's .rep-node-row rule. data-uci-path/data-san/data-ply feed
  // the Explorer synced board panel's selection handler
  // (src/browser/repertoire.client.js) -- data-uci-path is validated
  // against a strict UCI-shape regex there before ever being replayed
  // (security-standards.md's untrusted-DOM-readback rule), even though this
  // value only ever originates from this project's own build-time payload.
  const dataUciPath = escapeHtml(nodePath.join(' '));
  const liParts = [`<button type="button" class="rep-node-row" aria-pressed="false" data-uci-path="${dataUciPath}" data-san="${escapeHtml(node.san)}" data-ply="${node.ply}">\n        ${rowParts.join('\n        ')}\n      </button>`];
  if (children) liParts.push(children);

  return `
    <li>
      ${liParts.join('\n      ')}
    </li>`;
}

function renderRepertoireTree(tree) {
  if (!Array.isArray(tree) || tree.length === 0) {
    return '<p class="empty-note">No repertoire data found for this rating band and color.</p>';
  }
  return `<ul class="repertoire-tree">${tree.map((node) => renderRepertoireNode(node, [])).join('')}</ul>`;
}

/**
 * @param {{ratingBand: string, color: string, opening: {eco:string,name:string}|null,
 *   totals: {white:number,draws:number,black:number}|null, tree: Array,
 *   nav?: {player: string, repertoire: string},
 *   legalLinks?: {privacy?: string, about?: string, contact?: string},
 *   canonical?: string, description?: string}} data
 *   `nav` lets callers point the top-of-page links at either the dynamic
 *   dev-server routes (the default, used by server.js) or flat static
 *   filenames (used by the static build, e.g. {player: 'player.html',
 *   repertoire: '/'}). `legalLinks` is forwarded to renderFooter()
 *   -- see that function's own doc comment; only the static build passes it.
 *   `canonical`/`description` are optional and forwarded to
 *   renderDocumentHead -- only the static build (src/buildStatic.js) passes
 *   them, since only its output is a real, indexable URL; the dev server's
 *   per-request page has no stable canonical URL to declare.
 * @returns {string} a full standalone HTML document
 */
function renderRepertoirePage({ ratingBand, color, opening, totals, tree, nav = { player: '/', repertoire: '/repertoire' }, legalLinks, canonical, description }) {
  const totalGames = totals ? totals.white + totals.draws + totals.black : null;
  const openingNote = opening ? ` - starting from ${displayName(opening.name)} (${escapeHtml(opening.eco)})` : '';
  const totalsNote = totals
    ? `<p class="summary-line">${totalGames.toLocaleString()} games played from the starting position in this rating band
        (${totals.white.toLocaleString()}W / ${totals.draws.toLocaleString()}D / ${totals.black.toLocaleString()}L).</p>`
    : '';
  const title = `Opening repertoire explorer (${ratingBand}, ${color}) | Repertoire Builder`;

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
      subtitle: `Rating band ${escapeHtml(ratingBand)}, playing as ${escapeHtml(color)}${openingNote}`,
      meta: totalsNote,
    })}
    <p class="repertoire-intro">Most-played moves at each ply for players in this rating band, with win/draw/loss rates per move.
       Your color&rsquo;s plies show the top choices actually played at this rating; the opponent&rsquo;s replies show
       only their single most common response, to keep the tree readable.</p>
    ${renderRepertoireTree(tree)}
  </main>
  ${renderFooter('Data source: <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer API</a> (explorer.lichess.ovh, keyless, no account required).', legalLinks)}
</div>
</body>
</html>
`;
}

/**
 * A redirect stub for one of the 8 old repertoire-<band>-<color>.html URLs
 * (spec WS-3.2 section 2.2), now that their content lives at one collapsed
 * repertoire.html with band+color in the URL FRAGMENT. GitHub Pages cannot
 * emit a real HTTP 301 (no server config, _redirects/jekyll-redirect-from
 * both unavailable -- see that spec section for the full reasoning); an
 * instant meta refresh is the strongest signal actually available, and
 * Google's own redirect documentation says it interprets one as a
 * permanent redirect: https://developers.google.com/search/docs/crawling-indexing/301-redirects
 *
 * Deliberately NOT built from renderDocumentHead()/renderHeader()/
 * renderFooter() -- those pull in the full site stylesheet, GoatCounter,
 * and AdSense scripts, which would make an intended-to-be-instant,
 * ~1&nbsp;KB redirect page dozens of KB for no reader who is meant to see
 * it for more than an instant. Ships only the 5 things spec 2.2 calls for,
 * plus this site's baseline CSP/referrer meta (security-standards.md).
 *
 * @param {object} data
 * @param {string} data.band
 * @param {string} data.color 'white'|'black'
 * @param {string} data.targetPath site-relative path to redirect to, e.g.
 *   "/repertoire.html#band=1600-1800&color=white" (a root-relative path,
 *   not a query string -- band/color travel in the fragment, per spec 2.2).
 * @param {string} data.canonicalUrl absolute canonical URL, e.g.
 *   "https://repertoire-builder.com/repertoire.html".
 * @returns {string} a full, minimal standalone HTML document
 */
function renderRedirectStubPage({ band, color, targetPath, canonicalUrl }) {
  const colorLabel = color === 'white' ? 'White' : 'Black';
  const linkText = `Continue to the Repertoire explorer (${band}, ${colorLabel}) &rarr;`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta http-equiv="refresh" content="0; url=${escapeHtml(targetPath)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<meta name="robots" content="noindex, follow">
<title>Redirecting&hellip; | Repertoire Builder</title>
</head>
<body>
<p>This page has moved. <a href="${escapeHtml(targetPath)}">${linkText}</a></p>
<script>location.replace(${JSON.stringify(targetPath)});</script>
</body>
</html>
`;
}

/**
 * A generic version of renderRedirectStubPage above, for a redirect stub
 * whose target isn't a band/color repertoire URL -- WS-1's
 * player.html -> opening-report.html and italian-game-drill.html ->
 * drill.html stubs (the WS-1 spec sections 3.2/3.3)
 * use this one; the band/color-specific renderer above is unchanged and
 * still used for the 8 repertoire-<band>-<color>.html stubs. Same minimal
 * shape and same 5 spec-2.2 elements (instant meta refresh, canonical,
 * noindex/follow, a visible link, a location.replace fallback).
 *
 * @param {object} data
 * @param {string} data.linkText visible link text, e.g. "Continue to the
 *   opening report".
 * @param {string} data.targetPath site-relative path to redirect to.
 * @param {string} data.canonicalUrl absolute canonical URL of the target.
 * @returns {string} a full, minimal standalone HTML document
 */
function renderGenericRedirectStub({ linkText, targetPath, canonicalUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta http-equiv="refresh" content="0; url=${escapeHtml(targetPath)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<meta name="robots" content="noindex, follow">
<title>Redirecting&hellip; | Repertoire Builder</title>
</head>
<body>
<p>This page has moved. <a href="${escapeHtml(targetPath)}">${escapeHtml(linkText)} &rarr;</a></p>
<script>location.replace(${JSON.stringify(targetPath)});</script>
</body>
</html>
`;
}

module.exports = {
  renderPlayerPage,
  renderRepertoireTree,
  renderRepertoirePage,
  renderRedirectStubPage,
  renderGenericRedirectStub,
  renderGamesTable,
  renderRatingTable,
  escapeHtml,
  escapeHtmlText,
  displayName,
  displayNameText,
  formatPct,
  SITE_CSS,
  SITE_CSS_SHIPPED,
  SITE_CSS_FILE,
  stripCssComments,
  DESIGN_TOKENS,
  THEME_ROLES,
  designTokensCss,
  renderDocumentHead,
  renderHeader,
  renderFooter,
  siteRelativeHref,
  renderDisclosure,
  renderNewsletterSignup,
  renderPageHead,
  wrapTable,
  NAV_ORDER,
  NAV_LABELS,
  STORE,
  isPlaceholderStoreUrl,
  HEADER_BAND_OPTIONS,
  HEADER_BAND_DEFAULT,
  BAND_CONTROL_PAGES,
};
