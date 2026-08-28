'use strict';

/**
 * Flat em-dash ban over rendered BUILT dist/ output (design-standards.md's
 * zero-tolerance rule). Any em dash character reaching a visitor is a
 * failure: no threshold, no "rare is fine." Checks both the literal em
 * dash character (—) and the &mdash; HTML entity, since a browser renders
 * both identically -- a plain literal-character grep alone would have
 * missed the entity form (this is exactly how the Gumroad CTA button on
 * the pack pages once shipped with a visible em dash despite this script
 * running post-build: it only scanned p/li/h1-3/summary text, and the CTA
 * is a bare <a> tag outside that list).
 *
 * Scans ALL visible text in the built HTML (not just a fixed tag
 * allowlist), after stripping <style>/<script> contents and HTML comments
 * so inert code/markup never produces a false positive. Also scans the
 * built client-JS bundles (dist/*.js -- band-header.js, drill-hub.js,
 * eco-explorer.js, opening-report.js, repertoire-builder.js, repertoire.js
 * and any future one), since those bundles construct real user-visible
 * copy at runtime (textContent/innerHTML assignments) that never appears
 * in the static HTML this script used to check alone.
 *
 * Usage: node scripts/emDashDensity.js
 *   Prints every offending file and line-level context, then exits
 *   non-zero if any em dash (literal or entity) is found anywhere in
 *   dist/. Always a hard gate -- wired into `postbuild:static` so a
 *   regression fails the build automatically.
 */

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (
      entry.name.endsWith('.html') ||
      entry.name.endsWith('.xml') ||
      entry.name.endsWith('.js') ||
      entry.name.endsWith('.css')
    ) {
      out.push(p);
    }
  }
  return out;
}

/** Strips inert (non-visible) content that could produce a false positive. */
function stripInert(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
}

/**
 * Strips inert (non-visible) content from a built JS bundle before
 * scanning: block comments only. esbuild preserves block comments
 * verbatim regardless of minification, so stripping them is unambiguous.
 * Single-line comments are deliberately NOT stripped: `minifyWhitespace`
 * collapses each bundle onto effectively one line, so a naive
 * "match to end of line" regex would consume everything after the first
 * string literal containing a double-slash (e.g. an "https://..." URL),
 * silently deleting real copy along with it -- a false negative far worse
 * than the false positive it would prevent. In practice this repo's own
 * comments never use an em dash (its own convention is a double hyphen),
 * so leaving comments unstripped when they can't safely be stripped is a
 * low-risk tradeoff.
 */
function stripInertJs(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Finds every literal em dash or &mdash; entity, with surrounding context. */
function findEmDashes(html) {
  const hits = [];
  const re = /.{0,30}(—|&mdash;).{0,30}/g;
  let m;
  while ((m = re.exec(html))) {
    hits.push(m[0].replace(/\s+/g, ' ').trim());
  }
  return hits;
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ does not exist -- run `npm run build:static` first.');
    process.exitCode = 1;
    return;
  }

  const files = walk(DIST).sort();
  let anyFound = false;
  const rows = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const visible = file.endsWith('.js') ? stripInertJs(raw) : stripInert(raw);
    const hits = findEmDashes(visible);
    if (hits.length) {
      anyFound = true;
      rows.push({ rel: path.relative(DIST, file), hits });
    }
  }

  if (!anyFound) {
    console.log(`ok -- 0 em dashes (literal or &mdash;) found across ${files.length} built files.`);
    return;
  }

  for (const r of rows) {
    console.log(`FAIL ${r.rel} (${r.hits.length} em dash${r.hits.length === 1 ? '' : 'es'})`);
    for (const h of r.hits) console.log(`     ...${h}...`);
  }
  console.log(`\n${rows.length}/${files.length} files contain a banned em dash. design-standards.md: zero tolerance, no exceptions.`);
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { stripInert, stripInertJs, findEmDashes, walk };
