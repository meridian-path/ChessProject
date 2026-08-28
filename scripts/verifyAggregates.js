'use strict';

/**
 * CI quality gate: data-sanity suite.
 *
 * Runs 7 checks against BOTH the raw aggregate shards (data/aggregates/,
 * produced by the database-dump ingestion pipeline under src/ingest/ plus
 * scripts/ingestDump.js) and the built dist/ output. Hand-rolled, no
 * dependency, same pattern as scripts/checkLinks.js.
 *
 * IMPORTANT, read before assuming a green run means the data is trustworthy:
 * checks 1a/2/4/6a (below) require data/aggregates/manifest.json to exist.
 * A GENUINELY MISSING manifest (the ingestion pipeline under src/ingest/ +
 * scripts/ingestDump.js simply hasn't run yet) is reported loudly as a WARN,
 * not a FAIL -- deploy-pages.yml's build does not read data/aggregates/ at
 * all today (every page is still built from live Lichess Opening Explorer
 * API calls; see that workflow's own header comment), so gating deploy on a
 * directory nothing in the current build path consumes was blocking every
 * single deploy for no data-safety benefit. Once the manifest DOES exist but
 * is broken -- unparseable JSON, stale past MANIFEST_MAX_AGE_DAYS, or a
 * shard it lists is missing/size-mismatched on disk -- that is still a hard
 * FAIL, unchanged: this script's job is to catch bad data, not to wave
 * through anything that merely runs. Run `node scripts/ingestDump.js
 * --source <path>` first (a local fixture or a real ingest output
 * directory) to produce a manifest and exercise the full check set.
 *
 * A SEPARATE case from "genuinely missing": as of the first successful
 * ingest-dump.yml commit-back, data/aggregates/manifest.json is a real,
 * git-tracked file on master, but its shards (root.json, f/*.json) are
 * deliberately NOT (~30MB, published as a GitHub Release asset instead --
 * see .gitignore's comment on data/aggregates/*). That means an ordinary
 * `git checkout` of master -- which is exactly what deploy-pages.yml's
 * build job does -- has a manifest with no matching shards on disk, which
 * checks 1a/2/4/6a would otherwise report as 55 "missing shard" hard FAILs
 * on every single build, forever, even though nothing is actually broken.
 * `--skip-aggregates` (below) is the deploy-side fix for exactly this case:
 * omit the source-side checks entirely in a context where the build never
 * reads raw shards off disk anyway (same rationale as the missing-manifest
 * WARN above, just for a different on-disk state). This is orthogonal to
 * `--skip-dist`, which is about dist/ not existing yet, not about
 * data/aggregates/ shards not existing by design.
 *
 * Check 2 (sample-size monotonicity) additionally carries a disclosed,
 * currently-permanent "known-gap" limitation rather than a pass/fail verdict
 * -- see loadAggregateShards' header comment below for why, and why that's
 * reported as a WARN rather than a FAIL.
 *
 * Usage: node scripts/verifyAggregates.js [distDir] [--aggregates <dir>] [--skip-dist] [--skip-aggregates]
 *   distDir           default "dist"
 *   --aggregates      default "data/aggregates"
 *   --skip-dist       omit the 5 dist/-level checks entirely (for a context
 *                      that deliberately never builds dist/, e.g. the
 *                      ingest-only workflow -- see runAll's header comment)
 *   --skip-aggregates omit the 4 source-side checks entirely (for a context
 *                      that deliberately never has raw shards on disk, e.g.
 *                      deploy-pages.yml's build job today -- see the
 *                      shards-vs-manifest paragraph above)
 */

const fs = require('fs');
const path = require('path');

const MAX_SHARD_BYTES = 5 * 1024 * 1024; // 5 MB per aggregate shard file
const MAX_DIST_DATA_BYTES = 100 * 1024 * 1024; // 100 MB total for dist/data (stays well under the GitHub Pages 1 GB limit)
const MANIFEST_MAX_AGE_DAYS = 100; // a stale data manifest should block deploy, not silently keep serving old numbers
const RENDERED_WDL_TOLERANCE = 0.2; // two 1-decimal roundings' worth of slack

// Public-content hygiene patterns: this repo's remote is public, so a
// filename/path/id that only makes sense to internal tooling must never
// show up in what actually gets published. Kept as a small local list
// rather than depending on anything outside this repo, since this script
// has to run standalone in CI.
const HYGIENE_PATTERNS = [
  /\btask-[a-z0-9]{8}-[a-f0-9]{6}\b/i,
  /\bdecision-[a-z0-9]{8}-[a-f0-9]{6}\b/i,
  /\bchief-of-staff\b/i,
  /\barchitect\b(?!ure)/i, // "architecture"/"architectural" are ordinary English; the bare role name isn't
  // "builder" is excluded: this asset's own product name is "Repertoire
  // Builder" (repertoire-builder.com) -- the role name would otherwise
  // false-positive on every single page and make this check useless. Only
  // the internal-process phrase "the builder" (agent-role usage, not the
  // brand) is still caught.
  /\bthe builder\b/i,
  /\bscout\b/i,
  /\breviewer\b/i,
  /\borchestrator\//i,
  /\.claude\//i,
  /\bdecision brief\b/i,
  /\bqueue task\b/i,
  /\bALWAYS ESCALATE\b/,
  // Internal governing-doc filenames -- an exact filename/label match only,
  // never a bare common word, so a chess-site page discussing e.g. "goals"
  // or "testing" in the ordinary sense is never caught.
  /\bdesign-standards\.md\b/i,
  /\bqa\.md\b/i,
  /\bCRAFT_DOCTRINE\b/,
  /\bDESIGN_PLAYBOOK\b/,
  /\bREFERENCE_LIBRARY\b/,
  /\bGOALS\.md\b/,
  /\bTESTING\.md\b/,
  /\bSOAK_BACKLOG\b/,
  // Internal series-label SHAPES -- anchored on the numbered-label form
  // only (a real digit/section number must follow), never a bare
  // word-boundary "spec"/"phase"/"site-audit": those are ordinary English
  // on a chess-openings site (a repertoire "site audit"? no, but "phase of
  // the game"/"opening phase"/a study "spec" are all plausible real chess
  // copy) and a bare match would false-positive into uselessness the same
  // way a bare "builder" pattern would (see the comment above on "builder").
  /\bWS-\d+\b/,
  /\bPhase\s?\d+[a-z]?\b/i,
  /\bspec\s+\d+(?:\.\d+)*\b/i,
  /\bspec section\s+\d+\b/i,
  /\bsite-audit item\s+\d+\b/i,
];

// --- generic filesystem helpers -------------------------------------------------

function listFiles(dir, predicate) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, predicate));
    } else if (entry.isFile() && (!predicate || predicate(full))) {
      out.push(full);
    }
  }
  return out;
}

function dirTotalBytes(dir) {
  return listFiles(dir).reduce((sum, f) => sum + fs.statSync(f).size, 0);
}

// --- check 1a: shard record integrity (exact integer sanity) --------------------

/**
 * Validates one [w, d, l, bw, bd, bl] counts tuple (section 1.4's per-move /
 * per-position record shape). Exact integer checks only -- no rounding is
 * involved at this layer, unlike the rendered-percentage check below.
 * Returns an array of problem strings (empty = valid).
 */
function validateCounts(label, counts) {
  const problems = [];
  if (!Array.isArray(counts) || counts.length !== 6) {
    return [`${label}: expected a 6-element [w,d,l,bw,bd,bl] array, got ${JSON.stringify(counts)}`];
  }
  const [w, d, l, bw, bd, bl] = counts;
  for (const [name, v] of [['w', w], ['d', d], ['l', l], ['bw', bw], ['bd', bd], ['bl', bl]]) {
    if (!Number.isInteger(v) || v < 0) {
      problems.push(`${label}: ${name}=${v} is not a non-negative integer`);
    }
  }
  if (problems.length) return problems; // don't compound with NaN comparisons below
  // The balanced subset (rating gap <= 50) is a SUBSET of all games by
  // definition, per component -- a balanced win is still counted in the
  // overall win count, so bw <= w, bd <= d, bl <= l always.
  if (bw > w) problems.push(`${label}: balanced wins (${bw}) exceed total wins (${w})`);
  if (bd > d) problems.push(`${label}: balanced draws (${bd}) exceed total draws (${d})`);
  if (bl > l) problems.push(`${label}: balanced losses (${bl}) exceed total losses (${l})`);
  return problems;
}

/**
 * positions: array of { posKey, total: [w,d,l,bw,bd,bl], moves: { uci: [w,d,l,bw,bd,bl] } }
 * -- the loader's normalized in-memory shape (see loadAggregateShards below).
 */
function checkShardRecordIntegrity(positions) {
  const problems = [];
  for (const pos of positions) {
    problems.push(...validateCounts(`position ${pos.posKey}`, pos.total));
    for (const [uci, counts] of Object.entries(pos.moves || {})) {
      problems.push(...validateCounts(`position ${pos.posKey} move ${uci}`, counts));
    }
  }
  return problems;
}

// --- check 1b: rendered W/D/L triplets sum to 100 --------------------------------

const WDL_LABEL_RE = /class="wdl-label">([\d.]+)%\s*\/\s*([\d.]+)%\s*\/\s*([\d.]+)%/g;

function checkRenderedWdlSums(distDir) {
  const problems = [];
  for (const file of listFiles(distDir, (f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    let m;
    WDL_LABEL_RE.lastIndex = 0;
    while ((m = WDL_LABEL_RE.exec(html))) {
      const sum = Number(m[1]) + Number(m[2]) + Number(m[3]);
      if (Math.abs(sum - 100) > RENDERED_WDL_TOLERANCE) {
        problems.push(`${file}: rendered W/D/L "${m[1]}% / ${m[2]}% / ${m[3]}%" sums to ${sum.toFixed(2)}, not ~100`);
      }
    }
  }
  return problems;
}

// --- check 2: sample-size monotonicity, transposition-aware ---------------------

/**
 * The naive version of this check ("a child position's game count never
 * exceeds its single parent's") FALSE-POSITIVES on legitimate transposition
 * merging: because the pipeline keys aggregates by POSITION (section 1.4),
 * a child reached by several different move orders legitimately accumulates
 * more games than any ONE of its parents contributed. The correct check
 * bounds the child against the SUM of every recorded parent's contribution.
 *
 * @param {Map<string, number>} positionTotalGames posKey -> total games at that position (w+d+l)
 * @param {Map<string, number[]>} parentEdgeGames posKey (of the CHILD) -> array of games-counts,
 *   one entry per recorded parent edge (the w+d+l of the move at the parent
 *   position that leads to this child)
 * @returns {string[]} problems (empty = valid)
 *
 * Positions with zero recorded parent edges are skipped, not flagged --
 * with no recorded parent (root position, or every parent below MIN_GAMES
 * and pruned from the shard) there is nothing to check against, and
 * asserting "games <= 0" would itself be a false positive.
 */
function checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames) {
  const problems = [];
  for (const [childKey, edges] of parentEdgeGames.entries()) {
    if (!edges || edges.length === 0) continue;
    const childTotal = positionTotalGames.get(childKey);
    if (childTotal === undefined) continue; // child pruned/not in this shard set; nothing to compare
    const parentSum = edges.reduce((a, b) => a + b, 0);
    if (childTotal > parentSum) {
      problems.push(
        `position ${childKey}: game count ${childTotal} exceeds the sum of its ${edges.length} recorded parent edge(s) (${parentSum}) -- possible double-count or aggregation bug`
      );
    }
  }
  return problems;
}

// --- check 3: no page ships with an empty table -----------------------------------

const TABLE_RE = /<table\b[^>]*>([\s\S]*?)<\/table>/g;
const TBODY_RE = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/;
const TR_RE = /<tr\b/;

function checkNoEmptyTables(distDir) {
  const problems = [];
  for (const file of listFiles(distDir, (f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    let m;
    TABLE_RE.lastIndex = 0;
    let idx = 0;
    while ((m = TABLE_RE.exec(html))) {
      idx += 1;
      // Scope the row check to <tbody> specifically (this codebase's own
      // convention -- see src/renderContent.js) so a table with a populated
      // <thead> but a genuinely empty <tbody> is still caught. Tables with
      // no <tbody> tag at all fall back to checking the whole table.
      const tbodyMatch = TBODY_RE.exec(m[1]);
      const relevant = tbodyMatch ? tbodyMatch[1] : m[1];
      if (!TR_RE.test(relevant)) {
        problems.push(`${file}: table #${idx} has no <tr> rows in its body (deliberate empty states must use .empty-note and emit no <table> at all)`);
      }
    }
  }
  return problems;
}

// --- check 4: manifest present, parseable, fresh, shards accounted for -----------

function loadManifest(aggregatesDir) {
  const manifestPath = path.join(aggregatesDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    // Genuinely absent (ingestion hasn't produced one yet) is distinct from
    // "present but broken" below -- see this file's header comment. The
    // `missing-manifest:` prefix is what main() (and runAll's fallback
    // branch, below) use to classify this as a non-gating WARN rather than
    // a FAIL, unlike every other problem this function can return.
    return {
      manifest: null,
      missing: true,
      problems: [`missing-manifest: ${manifestPath} not found -- expected until the ingestion pipeline ships real data; the current build does not consume data/aggregates/ at all yet (see deploy-pages.yml), so this does not block deploy`],
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { manifest: null, missing: false, problems: [`${manifestPath} is not valid JSON: ${err.message}`] };
  }
  const problems = [];
  if (!manifest.retrievedAt) {
    problems.push(`${manifestPath}: missing retrievedAt`);
  } else {
    const ageMs = Date.now() - new Date(manifest.retrievedAt).getTime();
    if (Number.isNaN(ageMs)) {
      problems.push(`${manifestPath}: retrievedAt "${manifest.retrievedAt}" is not a parseable date`);
    } else if (ageMs > MANIFEST_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      problems.push(`${manifestPath}: retrievedAt is ${ageDays} days old, over the ${MANIFEST_MAX_AGE_DAYS}-day freshness limit`);
    }
  }
  for (const shard of manifest.shards || []) {
    const shardPath = path.join(aggregatesDir, shard.file);
    if (!fs.existsSync(shardPath)) {
      problems.push(`${manifestPath}: lists shard "${shard.file}" which is missing on disk at ${shardPath}`);
      continue;
    }
    const actualBytes = fs.statSync(shardPath).size;
    if (typeof shard.bytes === 'number' && actualBytes !== shard.bytes) {
      problems.push(`${manifestPath}: shard "${shard.file}" is ${actualBytes} bytes on disk, manifest says ${shard.bytes}`);
    }
  }
  return { manifest, missing: false, problems };
}

// --- check 5: every rendered rate has a sample size alongside it -----------------

// Convention this gate enforces (no template renders a "rate" class yet,
// so this currently passes vacuously -- nothing to check): a cell carrying
// class="rate" must share a table row with a games-count. This codebase's
// existing sitewide pattern for a games count is the literal text
// "<number> games" (see src/render.js's "rep-games" span, src/
// renderContent.js's "N games" caption) -- reuse that pattern rather than
// requiring a brand-new class the moment interval rendering lands.
const GAMES_TEXT_RE = /[\d,]+\s+games/i;

function checkRateHasSampleSize(distDir) {
  const problems = [];
  for (const file of listFiles(distDir, (f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = rowRe.exec(html))) {
      const row = m[1];
      if (/class="[^"]*\brate\b[^"]*"/.test(row) && !GAMES_TEXT_RE.test(row)) {
        problems.push(`${file}: a table row carries a "rate" cell with no games-count alongside it`);
      }
    }
  }
  return problems;
}

// --- check 6: shard/dist size budgets --------------------------------------------

function checkShardSizeLimits(aggregatesDir, manifest) {
  const problems = [];
  if (!manifest) return problems; // already reported by loadManifest
  for (const shard of manifest.shards || []) {
    const shardPath = path.join(aggregatesDir, shard.file);
    if (!fs.existsSync(shardPath)) continue; // already reported by loadManifest
    const bytes = fs.statSync(shardPath).size;
    if (bytes > MAX_SHARD_BYTES) {
      problems.push(`${shardPath}: ${bytes} bytes exceeds the ${MAX_SHARD_BYTES}-byte (5 MB) per-shard limit`);
    }
  }
  return problems;
}

function checkDistDataSize(distDir) {
  const dataDir = path.join(distDir, 'data');
  if (!fs.existsSync(dataDir)) return [];
  const total = dirTotalBytes(dataDir);
  if (total > MAX_DIST_DATA_BYTES) {
    return [`${dataDir}: ${total} bytes exceeds the ${MAX_DIST_DATA_BYTES}-byte (100 MB) dist/data budget`];
  }
  return [];
}

// --- check 7: public-content hygiene ----------------------------------------------

function hygieneOffenses(text) {
  const found = new Set();
  for (const re of HYGIENE_PATTERNS) {
    const m = text.match(re);
    if (m) found.add(m[0]);
  }
  return [...found];
}

// --- check 8: public-repo-hygiene, TRACKED SOURCE (id-leak scan) -----------------
//
// Distinct from check 7 above: checkPublicHygiene(distDir) only ever walks
// BUILT dist/ output, so a leaked internal id in TRACKED SOURCE that never
// gets emitted into dist/ at all (a JSDoc comment, a copied Orchestra
// command file under .claude/) is invisible to it forever -- exactly how
// two real internal task ids (src/renderPackPages.js, .claude/commands/
// conduct-lite.md) sat live on origin/master with this repo's own hygiene
// check reporting clean. This is that second, source-tree mode.
//
// Deliberately scoped to the ID-SHAPE patterns only (task-xxxxxxxx-xxxxxx /
// decision-xxxxxxxx-xxxxxx), not the full HYGIENE_PATTERNS list check 7
// uses: this codebase's own JS source comments legitimately reference
// internal governing docs and numbered series labels (WS-1, Phase 7c,
// spec 3.4, site-audit item N) constantly and appropriately, as ordinary
// engineering shorthand that never reaches a rendered page or a shipped
// bundle (see stripCssComments()'s own doc comment in src/render.js) --
// running the full vocabulary list against every source comment too would
// false-positive on that legitimate, pervasive practice across most of
// src/. A real internal ID, unlike a series label, has no legitimate
// reason to ever appear in source outside this checker's own header/tests.
const SOURCE_HYGIENE_ID_PATTERNS = [
  /\btask-[a-z0-9]{8}-[a-f0-9]{6}\b/i,
  /\bdecision-[a-z0-9]{8}-[a-f0-9]{6}\b/i,
];

// Denylist, not allowlist -- see TheOrchestra's docs/HYGIENE_CHECK_TEMPLATE.md
// for why: a hand-picked allowlist of "the dirs we scan" silently stops
// covering a new source directory the moment one is added and the list isn't
// extended (exactly how README.md and .gitignore, both at the repo root, sat
// unscanned by this check's own prior allowlist while carrying real leaks).
// A denylist only fails open on a genuinely NEW kind of build/dependency
// output directory, a much rarer and more visible failure. Extend this list
// only for real build/dependency output, never turn it back into an allowlist.
const SOURCE_HYGIENE_DENY_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.git', 'vendor', '.next', '.cache', 'coverage',
]);

// This checker's own test file deliberately contains id-shaped fixture
// strings (a fake "task-XXXXXXXX-XXXXXX"-shaped id, spelled out with X's in
// THIS comment specifically so it does not itself match the pattern above)
// to test hygieneOffenses()/checkPublicHygiene() themselves -- excluded
// explicitly by path, not by accident, so a real leak anywhere else under
// test/ still fails the gate.
const SOURCE_HYGIENE_EXCLUDE_FILES = ['test/verifyAggregates.test.js'];

function sourceIdOffenses(text) {
  const found = new Set();
  for (const re of SOURCE_HYGIENE_ID_PATTERNS) {
    const m = text.match(re);
    if (m) found.add(m[0]);
  }
  return [...found];
}

// Walks every tracked-shaped directory under repoRoot except
// SOURCE_HYGIENE_DENY_DIRS, filtering files the same way the prior allowlist
// walk did (by extension, not by directory membership).
function listSourceHygieneFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SOURCE_HYGIENE_DENY_DIRS.has(entry.name)) continue;
      out.push(...listSourceHygieneFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && /\.(html|htm|js|mjs|json|xml|md|yml|yaml)$/i.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function checkPublicHygieneSource(repoRoot) {
  const problems = [];
  for (const file of listSourceHygieneFiles(repoRoot)) {
    const relFile = path.relative(repoRoot, file).split(path.sep).join('/');
    if (SOURCE_HYGIENE_EXCLUDE_FILES.includes(relFile)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const offenses = sourceIdOffenses(text);
    if (offenses.length) {
      problems.push(`${relFile}: internal id leaked into tracked source: ${offenses.join(', ')}`);
    }
  }
  return problems;
}

function checkPublicHygiene(distDir) {
  const problems = [];
  for (const file of listFiles(distDir, (f) => f.endsWith('.html') || f.endsWith('.js') || f.endsWith('.json') || f.endsWith('.xml') || f.endsWith('.css'))) {
    const text = fs.readFileSync(file, 'utf8');
    const offenses = hygieneOffenses(text);
    if (offenses.length) {
      problems.push(`${file}: internal identifier(s) leaked into public output: ${offenses.join(', ')}`);
    }
  }
  return problems;
}

// --- shard loader (real-data wiring) ---------------------------------------------

/**
 * VERIFIED on-disk shard shape (checked against a real ingest run of
 * src/ingest/writeShards.js -- both root.json and each family shard under
 * f/<slug>.json store the band/pool/posKey tree under a `positions` key,
 * root.json also carries a sibling `pathIndex`, and a family shard also
 * carries sibling `family`/`slug` fields):
 *
 *   { "positions": { "<band>": { "<pool>": {
 *       "<posKey>": [w,d,l,bw,bd,bl,{ "<uci>": [w,d,l,bw,bd,bl,ratingSum,ratingCount] }]
 *   } } } }
 *
 * (An earlier version of this loader assumed the band/pool tree sat at the
 * shard file's top level with no `positions` wrapper, and assumed each move
 * edge carried an 7th "childKey" element -- neither matched the real writer.
 * The wrapper mismatch made every real shard silently parse as zero valid
 * positions, i.e. checks 1a/2 passed vacuously without checking anything;
 * fixed here once real shard files existed to check against.)
 *
 * Also builds the parent-edge index checkSampleSizeMonotonicity needs. The
 * real per-move record ([w,d,l,bw,bd,bl,ratingSum,ratingCount], see
 * src/ingest/aggregate.js's `_toJsonRecord`) carries no destination-posKey
 * field at all -- there is no way to resolve which position a move edge
 * leads to from the compact record alone. That makes true per-edge
 * transposition-aware monotonicity unmeasurable with the CURRENT schema,
 * not merely absent from this run's data. This is a genuine, open gap: a
 * future change would need to add a destination-posKey field to the
 * per-move record (in src/ingest/aggregate.js) to make this check load-
 * bearing. Until then, every move edge is counted in
 * `skippedForMonotonicity` for visibility, and the caller (runAll, below)
 * reports that count as a non-gating "known-gap" note rather than either a
 * silent pass or a permanently-red failure.
 */
function loadAggregateShards(aggregatesDir, manifest) {
  const positions = [];
  const positionTotalGames = new Map();
  const parentEdgeGames = new Map();
  const loadProblems = [];
  const skippedForMonotonicity = new Set();

  // manifest.shards already enumerates every written shard file, including
  // root.json (src/ingest/writeShards.js pushes root.json into the same
  // array the manifest's `shards` field is built from) -- reading the file
  // list from the manifest alone avoids double-processing root.json, which
  // an earlier version of this loader did by also unconditionally
  // prepending a hardcoded rootPath.
  const files = (manifest && manifest.shards ? manifest.shards.map((s) => s.file) : []).map((f) => path.join(aggregatesDir, f));

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      loadProblems.push(`${file}: not valid JSON (${err.message})`);
      continue;
    }
    const data = raw && typeof raw === 'object' ? raw.positions : null;
    if (!data) continue;
    for (const [band, byPool] of Object.entries(data)) {
      if (typeof byPool !== 'object' || byPool === null) continue;
      for (const [pool, byPosKey] of Object.entries(byPool)) {
        if (typeof byPosKey !== 'object' || byPosKey === null) continue;
        for (const [posKey, record] of Object.entries(byPosKey)) {
          if (!Array.isArray(record) || record.length < 7) {
            skippedForMonotonicity.add(posKey);
            continue;
          }
          const [w, d, l, bw, bd, bl, moves] = record;
          const total = [w, d, l, bw, bd, bl];
          const key = `${band}/${pool}/${posKey}`;
          positions.push({ posKey: key, total, moves: {} });
          positionTotalGames.set(key, w + d + l);

          for (const [uci, edge] of Object.entries(moves || {})) {
            if (!Array.isArray(edge) || edge.length < 6) continue;
            const edgeCounts = edge.slice(0, 6);
            positions[positions.length - 1].moves[uci] = edgeCounts;
            // No destination posKey is stored on a move edge in the current
            // schema (edge[6]/edge[7] are ratingSum/ratingCount, not a
            // child key) -- see this function's header comment. Every edge
            // is therefore unresolvable for monotonicity, not just edges
            // missing an optional field.
            skippedForMonotonicity.add(`${key} -> ${uci}`);
          }
        }
      }
    }
  }

  return { positions, positionTotalGames, parentEdgeGames, loadProblems, skippedForMonotonicity };
}

// --- orchestration -----------------------------------------------------------------

/**
 * @param {{distDir: string, aggregatesDir: string, skipDist?: boolean, skipAggregates?: boolean}} args
 *   `skipDist: true` omits the five dist/-level checks (1b, 3, 5, 6b, 7)
 *   from the result set entirely, rather than reporting each as a failing
 *   "dist not found" skip -- for the ingest-only workflow
 *   (.github/workflows/ingest-dump.yml), which produces aggregate shards
 *   but deliberately never builds dist/ (that happens later, in
 *   deploy-pages.yml, against the manifest this run commits back). Without
 *   this, running this script from that workflow would always fail on
 *   checks it has no way to satisfy in that context.
 *
 *   `skipAggregates: true` omits the four source-side checks (1a, 2, 4, 6a)
 *   entirely, the mirror image of `skipDist` -- for deploy-pages.yml's
 *   build job, whose checkout has data/aggregates/manifest.json (a
 *   git-tracked file once ingest-dump.yml has committed one back) but never
 *   the shards it lists (git-ignored, Release-only -- see this file's
 *   header comment). Without this, that checkout would always fail 1a/2/4/6a
 *   on every "shard missing on disk" it lists, since the build doesn't
 *   consume raw shards off disk at all today.
 */
function runAll({ distDir, aggregatesDir, skipDist = false, skipAggregates = false, repoRoot = path.resolve('.') }) {
  const results = [];

  // Aggregate-shard-level checks (1a, 2, 4, 6a) -- depend on the ingestion pipeline's output.
  if (skipAggregates) {
    // Intentionally omitted, not reported as a failing skip -- see this
    // function's header comment.
  } else {
    const { manifest, missing, problems: manifestProblems } = loadManifest(aggregatesDir);
    results.push({ name: '4. manifest present/fresh/consistent', problems: manifestProblems });

    if (manifest) {
      const { positions, positionTotalGames, parentEdgeGames, loadProblems, skippedForMonotonicity } = loadAggregateShards(aggregatesDir, manifest);
      results.push({ name: '1a. shard record integrity (exact)', problems: [...loadProblems, ...checkShardRecordIntegrity(positions)] });
      const monoProblems = checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames);
      if (skippedForMonotonicity.size > 0) {
        // known-gap, not skipped: this is not fixable by re-running anything
        // (no destination posKey exists anywhere in the current aggregate
        // schema for a move edge to check against -- see loadAggregateShards'
        // header comment), so it must not gate the run the way a genuinely
        // fixable "run the build first" skip does.
        monoProblems.push(
          `known-gap: ${skippedForMonotonicity.size} move edge(s) cannot be checked for monotonicity -- the current aggregate schema stores no destination posKey per move edge (see loadAggregateShards header comment)`
        );
      }
      results.push({ name: '2. sample-size monotonicity (transposition-aware)', problems: monoProblems });
      results.push({ name: '6a. shard file size limits', problems: checkShardSizeLimits(aggregatesDir, manifest) });
    } else {
      // `missing` distinguishes "manifest.json genuinely doesn't exist yet"
      // (non-gating -- see loadManifest's comment) from "it exists but failed
      // to parse" (still a genuine problem, so still a gating `skipped:`,
      // unchanged from prior behavior).
      const reason = missing
        ? 'missing-manifest: no manifest (ingestion has not produced data/aggregates/manifest.json yet, and the build does not consume it today)'
        : 'skipped: no manifest';
      results.push({ name: '1a. shard record integrity (exact)', problems: [reason] });
      results.push({ name: '2. sample-size monotonicity (transposition-aware)', problems: [reason] });
      results.push({ name: '6a. shard file size limits', problems: [reason] });
    }
  }

  // dist/-level checks (1b, 3, 5, 6b, 7) -- runnable today.
  if (skipDist) {
    // Intentionally omitted, not reported as a failing skip -- see this
    // function's header comment.
  } else if (fs.existsSync(distDir)) {
    results.push({ name: '1b. rendered W/D/L sums to 100', problems: checkRenderedWdlSums(distDir) });
    results.push({ name: '3. no page ships with an empty table', problems: checkNoEmptyTables(distDir) });
    results.push({ name: '5. every rendered rate has a sample size', problems: checkRateHasSampleSize(distDir) });
    results.push({ name: '6b. dist/data total size budget', problems: checkDistDataSize(distDir) });
    results.push({ name: '7. public-content hygiene', problems: checkPublicHygiene(distDir) });
  } else {
    for (const name of ['1b. rendered W/D/L sums to 100', '3. no page ships with an empty table', '5. every rendered rate has a sample size', '6b. dist/data total size budget', '7. public-content hygiene']) {
      results.push({ name, problems: [`skipped: ${distDir} not found -- run npm run build:static first`] });
    }
  }

  // 8. public-repo-hygiene, tracked source -- always runnable (depends only
  // on the source tree being checked out, never on dist/ or
  // data/aggregates/), and deliberately NOT gated by skipDist/
  // skipAggregates: those flags exist for contexts that genuinely never
  // build dist/ or never have raw shards on disk, but a real git checkout
  // always has its own tracked source tree. Runs on every `npm test`
  // invocation too (see test/verifyAggregates.test.js), not only in CI, so
  // a leak fails fast at commit time rather than waiting for deploy.
  results.push({ name: '8. public-repo-hygiene (tracked source)', problems: checkPublicHygieneSource(repoRoot) });

  return results;
}

// Prefixes that mark a problem string as non-gating -- reported loudly
// (WARN) but never flip the overall exit code to failure. `known-gap:` is a
// documented, currently-unfixable-by-rerunning schema limitation (see
// loadAggregateShards' header comment); `missing-manifest:` is "the
// ingestion pipeline hasn't produced a manifest yet, and the build doesn't
// consume one today" (see loadManifest's header comment). Both are distinct
// from a plain `skipped:` problem, which stays gating (a real, fixable-right-
// now precondition wasn't met -- e.g. "run npm run build:static first").
const NON_GATING_PREFIXES = ['known-gap:', 'missing-manifest:'];

function isNonGating(problem) {
  return NON_GATING_PREFIXES.some((prefix) => problem.startsWith(prefix));
}

/**
 * Pure classification of runAll's output into pass/warn/fail per check, plus
 * the overall exit code -- split out from main() so tests can assert exit-
 * code behavior directly without spawning a subprocess or parsing stdout.
 */
function summarizeResults(results) {
  let anyFail = false;
  const lines = [];
  for (const { name, problems } of results) {
    const real = problems.filter((p) => !p.startsWith('skipped:') && !isNonGating(p));
    const skipped = problems.filter((p) => p.startsWith('skipped:'));
    const nonGating = problems.filter(isNonGating);
    if (real.length > 0) {
      anyFail = true;
      lines.push({ level: 'error', text: `FAIL  ${name} (${real.length} problem(s))` });
      for (const p of real) lines.push({ level: 'error', text: `        ${p}` });
    } else if (skipped.length > 0) {
      anyFail = true; // a skip is still a red gate -- see header comment
      lines.push({ level: 'error', text: `FAIL  ${name}: ${skipped[0]}` });
    } else if (nonGating.length > 0) {
      // Reported loudly but does NOT fail the gate -- see NON_GATING_PREFIXES above.
      lines.push({ level: 'warn', text: `WARN  ${name}: ${nonGating[0]}` });
    } else {
      lines.push({ level: 'log', text: `PASS  ${name}` });
    }
  }
  return { anyFail, lines };
}

function main() {
  const args = process.argv.slice(2);
  let distDir = 'dist';
  let aggregatesDir = 'data/aggregates';
  let skipDist = false;
  let skipAggregates = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--aggregates') {
      aggregatesDir = args[++i];
    } else if (args[i] === '--skip-dist') {
      skipDist = true;
    } else if (args[i] === '--skip-aggregates') {
      skipAggregates = true;
    } else if (!args[i].startsWith('--')) {
      distDir = args[i];
    }
  }
  distDir = path.resolve(distDir);
  aggregatesDir = path.resolve(aggregatesDir);

  const results = runAll({ distDir, aggregatesDir, skipDist, skipAggregates });
  const { anyFail, lines } = summarizeResults(results);
  for (const { level, text } of lines) console[level](text);

  process.exitCode = anyFail ? 1 : 0;
  console.log(anyFail ? '\nverifyAggregates: one or more checks failed.' : '\nverifyAggregates: all checks passed.');
}

if (require.main === module) {
  main();
}

module.exports = {
  MAX_SHARD_BYTES,
  MAX_DIST_DATA_BYTES,
  MANIFEST_MAX_AGE_DAYS,
  RENDERED_WDL_TOLERANCE,
  HYGIENE_PATTERNS,
  validateCounts,
  checkShardRecordIntegrity,
  checkRenderedWdlSums,
  checkSampleSizeMonotonicity,
  checkNoEmptyTables,
  loadManifest,
  checkRateHasSampleSize,
  checkShardSizeLimits,
  checkDistDataSize,
  hygieneOffenses,
  checkPublicHygiene,
  SOURCE_HYGIENE_ID_PATTERNS,
  SOURCE_HYGIENE_DENY_DIRS,
  SOURCE_HYGIENE_EXCLUDE_FILES,
  sourceIdOffenses,
  listSourceHygieneFiles,
  checkPublicHygieneSource,
  loadAggregateShards,
  runAll,
  summarizeResults,
  isNonGating,
  NON_GATING_PREFIXES,
};
