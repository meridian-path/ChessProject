'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SITE_CSS, DESIGN_TOKENS, THEME_ROLES, designTokensCss } = require('../src/render');

// Four required assertions for the token system this project's design
// system introduced (perceptual color ramps + light/dark role maps). See
// each test's own comment for exactly what it checks and, where a literal
// reading would otherwise produce a false positive against the design
// system's OWN stated values, how this file scopes it -- documented
// rather than silently narrowed.

// -----------------------------------------------------------------------
// (i) No two tokens share a value under different names.
//
// Scoped to the RAMP value layer (DESIGN_TOKENS' --color-ink/accent/win/
// draw/loss/focus-N entries + --color-paper-white) rather than every
// DESIGN_TOKENS entry or THEME_ROLES: role aliases are EXPECTED to reuse a
// ramp index across more than one semantic name (this design system
// deliberately assigns light-theme --color-accent-contrast and --color-bg
// to the same ink-0 index), and small scalar tokens (motion easings, 0em
// tracking) are also expected to repeat a handful of practical values
// across independently-named roles. The one thing that must never
// silently collide is two DIFFERENT ramp indices resolving to the
// identical color -- that would break the "index is the only thing that
// matters for contrast" invariant the whole system rests on.
// -----------------------------------------------------------------------
test('designTokens: no two ramp entries share the same color value', () => {
  const rampKeyPattern = /^--color-(ink|accent|win|draw|loss|focus)-\d$/;
  const seen = new Map();
  for (const [name, value] of Object.entries(DESIGN_TOKENS)) {
    if (!rampKeyPattern.test(name) && name !== '--color-paper-white') continue;
    if (seen.has(value)) {
      assert.fail(`${name} duplicates ${seen.get(value)}'s ramp value (${value})`);
    }
    seen.set(value, name);
  }
  assert.ok(seen.size >= 61, 'expected 60 ramp entries (6 ramps x 10) plus --color-paper-white');
});

// -----------------------------------------------------------------------
// (ii) No hex color outside DESIGN_TOKENS/THEME_ROLES anywhere in
// SITE_CSS (allowlist: 0, 1px hairlines, 100%).
//
// Implemented as: every hex literal that appears anywhere in the rendered
// SITE_CSS text (CSS comments stripped first, so a hex mentioned only in
// an explanatory comment -- e.g. cm-chessboard's own hardcoded #0066cc
// default, documented but never applied -- doesn't false-positive) must be
// a value that actually came from DESIGN_TOKENS or THEME_ROLES. This is
// the real, checkable half of the spec's "no hex or raw px outside
// DESIGN_TOKENS" line. The "raw px" half is not enforced as a blanket
// site-wide sweep here: SITE_CSS predates this task with dozens of
// legitimate literal-px values (media query breakpoints, the 44px tap
// target floor, the 352px board, cm-chessboard SVG percentages) that
// predate this token system and are out of scope to retroactively
// tokenize in one pass.
// -----------------------------------------------------------------------
test('designTokens: every hex color literal in SITE_CSS traces back to a token value', () => {
  const hexAllowlist = new Set();
  const collectHex = (value) => {
    const matches = String(value).match(/#[0-9a-fA-F]{3,8}/g);
    if (matches) matches.forEach((h) => hexAllowlist.add(h.toUpperCase()));
  };
  Object.values(DESIGN_TOKENS).forEach(collectHex);
  Object.values(THEME_ROLES.light).forEach(collectHex);
  Object.values(THEME_ROLES.dark).forEach(collectHex);

  const withoutComments = SITE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = withoutComments.match(/#[0-9a-fA-F]{3,8}/g) || [];
  const stray = found.map((h) => h.toUpperCase()).filter((h) => !hexAllowlist.has(h));
  assert.deepEqual([...new Set(stray)], [], 'found hex color(s) in SITE_CSS that do not trace back to a DESIGN_TOKENS/THEME_ROLES value');
});

// -----------------------------------------------------------------------
// (iii) Light and dark role maps define the identical key set.
// -----------------------------------------------------------------------
test('designTokens: THEME_ROLES.light and THEME_ROLES.dark define the same set of role names', () => {
  const lightKeys = Object.keys(THEME_ROLES.light).sort();
  const darkKeys = Object.keys(THEME_ROLES.dark).sort();
  assert.deepEqual(darkKeys, lightKeys);
});

// -----------------------------------------------------------------------
// (iv) Every role's assigned ramp index satisfies the >=5-apart (text) /
// >=4-apart (non-text, e.g. borders) contrast rule against its stated
// background, checked by luminance index rather than by eye. RAMP_Y is
// the same relative-luminance ladder (geometric in Y+0.05, ratio 1.365)
// every one of this asset's six color ramps was derived from -- see
// DESIGN_TOKENS' own comment in src/render.js for the derivation.
// Index 0 = lightest.
// -----------------------------------------------------------------------
const RAMP_Y = [0.8804, 0.6316, 0.4493, 0.3158, 0.2180, 0.1463, 0.0938, 0.0554, 0.0272, 0.0066];
const PAPER_WHITE_Y = 1.0;

function resolveY(varRef) {
  if (varRef === '#FFFFFF' || varRef === 'var(--color-paper-white)') return PAPER_WHITE_Y;
  const m = /^var\(--color-(?:ink|accent|win|draw|loss|focus)-(\d)\)$/.exec(varRef);
  if (!m) return null; // not a plain ramp-index role (e.g. a literal board hex, rgba, color-mix) -- not checked here
  return RAMP_Y[Number(m[1])];
}

function contrastRatio(yA, yB) {
  const lighter = Math.max(yA, yB);
  const darker = Math.min(yA, yB);
  return (lighter + 0.05) / (darker + 0.05);
}

// role -> [backgroundRole, minimumContrast]. Text-bearing roles need
// >=4.5:1 (the >=5-index-apart guarantee, 4.74:1); border-strong is a
// non-text UI-component boundary, so >=3:1 (the >=4-index-apart guarantee,
// 3.47:1) per WCAG 1.4.11.
const CONTRAST_PAIRS = [
  ['--color-text', '--color-bg', 4.5],
  ['--color-muted', '--color-bg', 4.5],
  ['--color-accent-dark', '--color-bg', 4.5],
  ['--color-win-text', '--color-bg', 4.5],
  ['--color-draw-text', '--color-bg', 4.5],
  ['--color-loss-text', '--color-bg', 4.5],
  ['--color-focus', '--color-bg', 4.5],
  ['--color-border-strong', '--color-bg', 3.0],
];

for (const theme of ['light', 'dark']) {
  test(`designTokens: ${theme} theme role contrast meets the ramp-index guarantee (assertion iv)`, () => {
    const roles = THEME_ROLES[theme];
    for (const [roleName, bgName, minRatio] of CONTRAST_PAIRS) {
      const roleY = resolveY(roles[roleName]);
      const bgY = resolveY(roles[bgName]);
      assert.ok(roleY !== null, `${theme} ${roleName} (${roles[roleName]}) did not resolve to a plain ramp index`);
      assert.ok(bgY !== null, `${theme} ${bgName} (${roles[bgName]}) did not resolve to a plain ramp index`);
      const ratio = contrastRatio(roleY, bgY);
      assert.ok(
        ratio >= minRatio - 0.01,
        `${theme} ${roleName} vs ${bgName}: computed ${ratio.toFixed(2)}:1, need >=${minRatio}:1`
      );
    }
  });
}

// -----------------------------------------------------------------------
// Extra regression coverage (beyond the 4 required assertions, same file):
// -----------------------------------------------------------------------

test('designTokens: the [data-theme="dark"] block and the prefers-color-scheme dark block emit byte-identical role CSS', () => {
  const darkBlockCss = designTokensCss(THEME_ROLES.dark);
  const dataThemeIndex = SITE_CSS.indexOf(':root[data-theme="dark"]');
  const mediaIndex = SITE_CSS.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(dataThemeIndex !== -1 && mediaIndex !== -1 && dataThemeIndex < mediaIndex, 'expected both dark-theme blocks to be present, in order');
  const dataThemeBlock = SITE_CSS.slice(dataThemeIndex, mediaIndex);
  const mediaBlock = SITE_CSS.slice(mediaIndex);
  assert.ok(dataThemeBlock.includes(darkBlockCss), 'the [data-theme="dark"] block must contain the exact role CSS');
  assert.ok(mediaBlock.includes(darkBlockCss), 'the prefers-color-scheme media block must contain the exact same role CSS');
});

test('designTokens: --radius-lg was removed (max 3 radii) and nothing still references it', () => {
  assert.equal(DESIGN_TOKENS['--radius-lg'], undefined);
  assert.doesNotMatch(SITE_CSS, /--radius-lg/);
});

test('designTokens: --shadow-focus was retired in favor of the focus-ring tokens', () => {
  assert.equal(DESIGN_TOKENS['--shadow-focus'], undefined);
  assert.doesNotMatch(SITE_CSS, /--shadow-focus/);
  assert.match(SITE_CSS, /--focus-ring-width/);
  assert.match(SITE_CSS, /--focus-ring-color/);
});

test('designTokens: .num/th.num still explicitly declare tabular-nums (font: shorthand resets font-variant elsewhere)', () => {
  const numRule = SITE_CSS.match(/th\.num,\s*td\.num\s*\{[^}]*\}/);
  assert.ok(numRule, 'expected the th.num, td.num rule to still exist');
  assert.match(numRule[0], /font-variant-numeric:\s*tabular-nums/);
});

test('designTokens: the type-role tokens pair size/line-height/weight with a tracking sibling', () => {
  const roles = ['display', 'page-title', 'section', 'subsection', 'lede', 'body', 'compact', 'label', 'metadata'];
  for (const role of roles) {
    assert.ok(DESIGN_TOKENS[`--type-${role}`], `expected --type-${role} to be defined`);
    assert.ok(DESIGN_TOKENS[`--type-${role}-tracking`], `expected --type-${role}-tracking to be defined`);
  }
});

// Regression coverage for the accessibility pass (WCAG 2.2 SC 2.3.3):
// SITE_CSS declares plenty of component-level transitions (theme toggle,
// nav links, form inputs/buttons, band-header-select, pack rows) but none
// of them checked the OS-level reduced-motion preference until this test
// was added -- see the global @media block near the end of SITE_CSS.
test('designTokens: SITE_CSS honors prefers-reduced-motion with an !important universal override', () => {
  const match = SITE_CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{([^}]*)\}/);
  assert.ok(match, 'expected a universal-selector @media (prefers-reduced-motion: reduce) block in SITE_CSS');
  assert.match(match[1], /transition-duration:\s*0\.01ms\s*!important/);
  assert.match(match[1], /animation-duration:\s*0\.01ms\s*!important/);
});

// -----------------------------------------------------------------------
// Regression coverage for the .board-coord contrast fix (PR #67 copy
// review flagged this, fixed in a follow-up PR): the original
// OPPOSITE-board-token swap put each coordinate label's color at
// the SAME low separation as the two board squares themselves (1.71:1 in
// light theme, 1.90:1 in dark theme -- both far under the 4.5:1 WCAG AA
// floor). --color-ink-black replaced the swap with one fixed color; this
// checks that fixed color against all four real board-square hexes (both
// themes' light/dark square) by hand-computed relative luminance, so a
// future board-palette change can't silently regress it back under 4.5:1.
// --color-board-light/-dark are raw hex, not ramp indices, so this can't
// reuse resolveY()/RAMP_Y above -- same WCAG relative-luminance formula,
// applied directly to the hex values themselves.
// -----------------------------------------------------------------------
function hexToY(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

test('designTokens: --color-ink-black (.board-coord\'s fixed label color) clears 4.5:1 against every board-square hex in both themes', () => {
  assert.equal(DESIGN_TOKENS['--color-ink-black'], '#000000');
  const labelY = hexToY(DESIGN_TOKENS['--color-ink-black']);
  for (const theme of ['light', 'dark']) {
    for (const role of ['--color-board-light', '--color-board-dark']) {
      const squareHex = THEME_ROLES[theme][role];
      const squareY = hexToY(squareHex);
      const ratio = contrastRatio(labelY, squareY);
      assert.ok(
        ratio >= 4.5 - 0.01,
        `${theme} ${role} (${squareHex}) vs --color-ink-black: computed ${ratio.toFixed(2)}:1, need >=4.5:1`
      );
    }
  }
});

// -----------------------------------------------------------------------
// Regression coverage for the .band-pill hover/aria-current contrast fix
// (live Lighthouse audit, 2026-08-25): --color-accent-contrast is only
// >=4.5:1 by construction against a fill exactly 5 ramp indices darker
// (the same guarantee CONTRAST_PAIRS above already relies on for OTHER
// role pairs) -- CONTRAST_PAIRS itself only checks accent-contrast's
// sibling --color-accent-dark (6 indices darker, 6.47:1, plenty of
// headroom) against --color-bg, never --color-accent (5 indices darker,
// a thinner 4.74:1) at all, which is the fill .band-pill actually uses on
// :hover and [aria-current="true"]. .band-pill-color's opacity:0.85
// quietly ate that thinner margin (measured live: 3.9:1). This checks the
// ramp math itself (so a future ramp change can't silently regress the
// 4.74:1 margin below 4.5 again) AND that the opacity:1 override rule is
// actually present in the rendered CSS (so the override can't be
// silently deleted without a test noticing).
// -----------------------------------------------------------------------
test('designTokens: --color-accent-contrast clears 4.5:1 against --color-accent itself (not just --color-accent-dark), in both themes', () => {
  for (const theme of ['light', 'dark']) {
    const roles = THEME_ROLES[theme];
    const contrastY = resolveY(roles['--color-accent-contrast']);
    const accentY = resolveY(roles['--color-accent']);
    assert.ok(contrastY !== null, `${theme} --color-accent-contrast did not resolve to a plain ramp index`);
    assert.ok(accentY !== null, `${theme} --color-accent did not resolve to a plain ramp index`);
    const ratio = contrastRatio(contrastY, accentY);
    assert.ok(ratio >= 4.5 - 0.01, `${theme} --color-accent-contrast vs --color-accent: computed ${ratio.toFixed(2)}:1, need >=4.5:1`);
  }
});

test('designTokens: .band-pill-color is restored to full opacity on :hover and [aria-current="true"], the two states whose fill is the thinner-margin --color-accent', () => {
  assert.match(
    SITE_CSS,
    /\.band-pill:hover \.band-pill-color,\s*\n?\s*\.band-pill\[aria-current="true"\] \.band-pill-color \{\s*opacity:\s*1;\s*\}/
  );
});
