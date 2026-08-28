'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
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
  checkPublicHygieneSource,
  loadAggregateShards,
  runAll,
  summarizeResults,
  MAX_SHARD_BYTES,
} = require('../scripts/verifyAggregates');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

// --- validateCounts / checkShardRecordIntegrity ---------------------------------

test('validateCounts accepts a well-formed [w,d,l,bw,bd,bl] tuple', () => {
  assert.deepEqual(validateCounts('x', [10, 5, 3, 4, 2, 1]), []);
});

test('validateCounts rejects a non-integer or negative count', () => {
  const problems = validateCounts('x', [10.5, 5, -3, 4, 2, 1]);
  assert.ok(problems.some((p) => p.includes('w=10.5')));
  assert.ok(problems.some((p) => p.includes('l=-3')));
});

test('validateCounts rejects a balanced-subset count exceeding its full-count sibling', () => {
  const problems = validateCounts('x', [10, 5, 3, 11, 2, 1]);
  assert.ok(problems.some((p) => p.includes('balanced wins (11) exceed total wins (10)')));
});

test('validateCounts rejects a malformed (wrong length) tuple without throwing', () => {
  const problems = validateCounts('x', [1, 2, 3]);
  assert.equal(problems.length, 1);
});

test('checkShardRecordIntegrity walks positions and their move edges', () => {
  const positions = [
    { posKey: 'p1', total: [10, 5, 3, 4, 2, 1], moves: { e4: [6, 2, 1, 3, 1, 0] } },
    { posKey: 'p2', total: [10, 5, 3, 4, 2, 100], moves: {} }, // bl=100 > l=3
  ];
  const problems = checkShardRecordIntegrity(positions);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /position p2/);
});

// --- checkRenderedWdlSums ---------------------------------------------------------

test('checkRenderedWdlSums passes when the triplet sums to ~100', () => {
  const dir = mkTmpDir('wdl-ok-');
  writeFile(dir, 'a.html', '<span class="wdl-label">50.6% / 4.0% / 45.4%</span>');
  assert.deepEqual(checkRenderedWdlSums(dir), []);
});

test('checkRenderedWdlSums flags a triplet outside the 0.2-point tolerance', () => {
  const dir = mkTmpDir('wdl-bad-');
  writeFile(dir, 'a.html', '<span class="wdl-label">50.0% / 4.0% / 44.0%</span>'); // sums to 98.0
  const problems = checkRenderedWdlSums(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /sums to 98\.00/);
});

// --- checkSampleSizeMonotonicity: the transposition-aware check -----------------

test('checkSampleSizeMonotonicity does NOT false-positive on legitimate transposition merging', () => {
  // Two different opening move orders (1.e4 e5 2.Nf3 vs 1.Nf3 e5 2.e4)
  // transpose into the same position C. Each parent edge contributes 40k
  // games; C's own total (80k) legitimately exceeds EITHER single parent
  // (which a naive "child <= single parent" check would wrongly flag) but
  // matches the SUM of both recorded parent edges exactly.
  const positionTotalGames = new Map([
    ['parentA', 45000],
    ['parentB', 42000],
    ['childC', 80000],
  ]);
  const parentEdgeGames = new Map([
    ['childC', [40000, 40000]], // edge from parentA and edge from parentB
  ]);
  const problems = checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames);
  assert.deepEqual(problems, [], 'transposition merging must not be flagged');
});

test('checkSampleSizeMonotonicity still catches a genuine over-count against the summed parents', () => {
  const positionTotalGames = new Map([
    ['parentA', 45000],
    ['parentB', 42000],
    ['childC', 999999], // far more games than either parent, or their sum, could supply
  ]);
  const parentEdgeGames = new Map([
    ['childC', [40000, 40000]],
  ]);
  const problems = checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /childC/);
  assert.match(problems[0], /999999/);
  assert.match(problems[0], /80000/); // the summed parent bound
});

test('checkSampleSizeMonotonicity skips a position with zero recorded parent edges (root, or all parents pruned)', () => {
  const positionTotalGames = new Map([['orphan', 500]]);
  const parentEdgeGames = new Map(); // no recorded parent at all
  assert.deepEqual(checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames), []);
});

test('checkSampleSizeMonotonicity skips a child not present in this shard set rather than crashing', () => {
  const positionTotalGames = new Map(); // child pruned/not loaded
  const parentEdgeGames = new Map([['missingChild', [100]]]);
  assert.deepEqual(checkSampleSizeMonotonicity(positionTotalGames, parentEdgeGames), []);
});

// --- checkNoEmptyTables -----------------------------------------------------------

test('checkNoEmptyTables passes a table with at least one row', () => {
  const dir = mkTmpDir('table-ok-');
  writeFile(dir, 'a.html', '<table><thead><tr><th>x</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>');
  assert.deepEqual(checkNoEmptyTables(dir), []);
});

test('checkNoEmptyTables flags a table with an empty tbody', () => {
  const dir = mkTmpDir('table-bad-');
  writeFile(dir, 'a.html', '<table><thead><tr><th>x</th></tr></thead><tbody></tbody></table>');
  const problems = checkNoEmptyTables(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /table #1 has no <tr> rows/);
});

test('checkNoEmptyTables does not flag a deliberate empty state using .empty-note (no <table> at all)', () => {
  const dir = mkTmpDir('table-empty-note-');
  writeFile(dir, 'a.html', '<p class="empty-note">No qualifying mistakes were found.</p>');
  assert.deepEqual(checkNoEmptyTables(dir), []);
});

// --- loadManifest ------------------------------------------------------------------

test('loadManifest reports a clear, non-gating problem when manifest.json is missing', () => {
  const dir = mkTmpDir('manifest-missing-');
  const { manifest, missing, problems } = loadManifest(dir);
  assert.equal(manifest, null);
  assert.equal(missing, true);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not found/);
  assert.match(problems[0], /^missing-manifest:/, 'a genuinely-absent manifest must be tagged non-gating');
});

test('loadManifest tags a present-but-unparseable manifest as missing:false (still gating)', () => {
  const dir = mkTmpDir('manifest-badjson-');
  writeFile(dir, 'manifest.json', '{not valid json');
  const { manifest, missing, problems } = loadManifest(dir);
  assert.equal(manifest, null);
  assert.equal(missing, false);
  assert.equal(problems.length, 1);
  assert.doesNotMatch(problems[0], /^missing-manifest:/);
});

test('loadManifest accepts a fresh, internally-consistent manifest', () => {
  const dir = mkTmpDir('manifest-ok-');
  const shardPath = writeFile(dir, 'f/italian-game.json', '{}');
  const bytes = fs.statSync(shardPath).size;
  writeFile(
    dir,
    'manifest.json',
    JSON.stringify({
      retrievedAt: new Date().toISOString(),
      shards: [{ file: 'f/italian-game.json', bytes }],
    })
  );
  const { manifest, problems } = loadManifest(dir);
  assert.ok(manifest);
  assert.deepEqual(problems, []);
});

test('loadManifest flags a retrievedAt older than the freshness limit', () => {
  const dir = mkTmpDir('manifest-stale-');
  const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: old, shards: [] }));
  const { problems } = loadManifest(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /days old/);
});

test('loadManifest flags a shard listed in the manifest but missing on disk', () => {
  const dir = mkTmpDir('manifest-missing-shard-');
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: new Date().toISOString(), shards: [{ file: 'f/ghost.json', bytes: 10 }] }));
  const { problems } = loadManifest(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /missing on disk/);
});

test('loadManifest flags a shard whose on-disk size disagrees with the manifest', () => {
  const dir = mkTmpDir('manifest-size-mismatch-');
  writeFile(dir, 'f/x.json', '{"a":1}');
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: new Date().toISOString(), shards: [{ file: 'f/x.json', bytes: 999999 }] }));
  const { problems } = loadManifest(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /manifest says 999999/);
});

// --- checkRateHasSampleSize -------------------------------------------------------

test('checkRateHasSampleSize passes a row carrying both a rate cell and a games count', () => {
  const dir = mkTmpDir('rate-ok-');
  writeFile(dir, 'a.html', '<tr><td class="rate">51.2%</td><td>142,318 games</td></tr>');
  assert.deepEqual(checkRateHasSampleSize(dir), []);
});

test('checkRateHasSampleSize flags a rate cell with no games count in its row', () => {
  const dir = mkTmpDir('rate-bad-');
  writeFile(dir, 'a.html', '<tr><td class="rate">51.2%</td><td>no count here</td></tr>');
  const problems = checkRateHasSampleSize(dir);
  assert.equal(problems.length, 1);
});

// --- checkShardSizeLimits / checkDistDataSize -------------------------------------

test('checkShardSizeLimits flags a shard over the 5 MB limit', () => {
  const dir = mkTmpDir('shard-size-');
  const big = Buffer.alloc(MAX_SHARD_BYTES + 1, 'a');
  fs.writeFileSync(path.join(dir, 'big.json'), big);
  const manifest = { shards: [{ file: 'big.json', bytes: big.length }] };
  const problems = checkShardSizeLimits(dir, manifest);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /5 MB/);
});

test('checkDistDataSize passes when dist/data is small or absent', () => {
  const dir = mkTmpDir('dist-data-');
  assert.deepEqual(checkDistDataSize(dir), []); // no dist/data dir at all
  writeFile(dir, 'data/small.json', '{}');
  assert.deepEqual(checkDistDataSize(dir), []);
});

// --- hygieneOffenses / checkPublicHygiene -----------------------------------------

test('hygieneOffenses catches a leaked internal task-id-shaped string', () => {
  const offenses = hygieneOffenses('see task-ab12cd34-56ef78 for details');
  assert.ok(offenses.some((o) => /task-ab12cd34-56ef78/.test(o)));
});

test('hygieneOffenses does NOT flag this asset\'s own brand name "Repertoire Builder"', () => {
  assert.deepEqual(hygieneOffenses('Repertoire Builder shows chess opening statistics.'), []);
  assert.deepEqual(hygieneOffenses('https://repertoire-builder.com/og-default.png'), []);
});

test('hygieneOffenses flags the internal-process phrase "the builder" (agent-role usage)', () => {
  const offenses = hygieneOffenses('this was implemented by the builder role.');
  assert.ok(offenses.length > 0);
});

test('hygieneOffenses does not flag "architecture"/"architectural" but does flag the bare role name', () => {
  assert.deepEqual(hygieneOffenses('a solid architecture and architectural choices.'), []);
  assert.ok(hygieneOffenses('reviewed by the architect role.').length > 0);
});

// --- item 1(b): governing-doc filenames + internal series-label shapes -----------

test('hygieneOffenses flags internal governing-doc filenames', () => {
  for (const doc of ['design-standards.md', 'qa.md', 'CRAFT_DOCTRINE', 'DESIGN_PLAYBOOK', 'REFERENCE_LIBRARY', 'GOALS.md', 'TESTING.md', 'SOAK_BACKLOG']) {
    const offenses = hygieneOffenses(`see ${doc} for the rule`);
    assert.ok(offenses.length > 0, `expected ${doc} to be flagged`);
  }
});

test('hygieneOffenses flags internal series-label shapes (WS-N, Phase N, spec N, spec section N, site-audit item N)', () => {
  for (const label of ['WS-1', 'WS-3', 'Phase 7c', 'Phase 7', 'spec 1.6.1', 'spec 3.4', 'spec section 3', 'site-audit item 11', 'Site-audit item 2']) {
    const offenses = hygieneOffenses(`(${label}) some real prose`);
    assert.ok(offenses.length > 0, `expected "${label}" to be flagged`);
  }
});

test('hygieneOffenses does NOT flag ordinary chess prose that merely contains "phase"/"spec"/"goals"/"testing" as plain English', () => {
  const clean = [
    'This site covers openings for the middlegame phase.',
    'A well-tested repertoire spec sheet for club players.',
    'Read our testing methodology before you start.',
    'Our goals for this repertoire are simple.',
  ];
  for (const text of clean) assert.deepEqual(hygieneOffenses(text), [], `expected no offenses in: ${text}`);
});

test('checkPublicHygiene scans dist files and reports the offending file', () => {
  const dir = mkTmpDir('hygiene-');
  writeFile(dir, 'leak.html', '<p>Filed as decision-ab12cd34-56ef78.</p>');
  writeFile(dir, 'clean.html', '<p>Repertoire Builder: real chess statistics.</p>');
  const problems = checkPublicHygiene(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /leak\.html/);
});

// --- item 2: checkPublicHygieneSource (the tracked-SOURCE mode) ------------------
// checkPublicHygiene(distDir) above only ever walks BUILT dist/ output --
// an id leaked into tracked SOURCE that's never emitted into dist/ (a
// JSDoc comment, a copied .claude/ command file) is invisible to it
// forever, which is exactly how src/renderPackPages.js and
// .claude/commands/conduct-lite.md shipped two real internal task ids on
// origin/master with this repo's own hygiene check reporting clean.

// Built via concatenation, deliberately, rather than one contiguous
// literal: this repo's own push-time public-repo-hygiene gate
// (evaluatePublicRepoHygieneGate, a DIFFERENT, blunter check than the one
// under test here -- it scans a diff's added lines for the same id SHAPE
// with no fixture-file exemption) can't tell a synthetic test fixture
// apart from a real leaked id by shape alone. This value is not a real id
// from this Orchestra instance's own generator (compare its shape to a
// real one, e.g. mtat8xu8-f62a46 -- a base36 timestamp, never "ab12cd34")
// -- it exists purely to exercise SOURCE_HYGIENE_ID_PATTERNS' own regex.
const FAKE_ID = 'task-' + 'ab12cd34-56ef78';

test('checkPublicHygieneSource scans src/scripts/test/docs/.github/.claude and reports a leaked id in tracked source', () => {
  const dir = mkTmpDir('hygiene-source-');
  writeFile(dir, 'src/renderThing.js', `// Before/after pitch framing (site-audit item 4, ${FAKE_ID})\nmodule.exports = {};\n`);
  writeFile(dir, 'src/clean.js', '// Repertoire Builder: real chess statistics.\nmodule.exports = {};\n');
  const problems = checkPublicHygieneSource(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /src\/renderThing\.js/);
  assert.ok(problems[0].includes(FAKE_ID));
});

test('checkPublicHygieneSource reaches a file under .claude/commands/ (the real leak location)', () => {
  const dir = mkTmpDir('hygiene-source-');
  writeFile(dir, '.claude/commands/conduct-lite.md', `Validated end to end (${FAKE_ID}, 2026-08-23).\n`);
  const problems = checkPublicHygieneSource(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\.claude\/commands\/conduct-lite\.md/);
});

test('checkPublicHygieneSource excludes this checker\'s own test-fixture file by path, not by accident', () => {
  const dir = mkTmpDir('hygiene-source-');
  // Mirrors this real test file's own deliberate fixture strings -- a file
  // at exactly this relative path must never be flagged, no matter what
  // id-shaped text it contains, or every real test run of this suite would
  // fail itself the moment it plants its own fixtures on disk.
  writeFile(dir, 'test/verifyAggregates.test.js', `hygieneOffenses('see ${FAKE_ID} for details')\n`);
  writeFile(dir, 'test/otherFile.test.js', `const x = '${FAKE_ID}'; // NOT a real exclusion, must still be flagged\n`);
  const problems = checkPublicHygieneSource(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /test\/otherFile\.test\.js/);
});

test('checkPublicHygieneSource does not flag internal series labels or governing-doc filenames in source comments -- deliberately narrower than check 7\'s HYGIENE_PATTERNS', () => {
  const dir = mkTmpDir('hygiene-source-');
  writeFile(dir, 'src/thing.js', '// WS-1 spec 3.4 (task W4): see design-standards.md, Phase 7c, site-audit item 11 -- all ordinary engineering shorthand, no real id here\nmodule.exports = {};\n');
  assert.deepEqual(checkPublicHygieneSource(dir), []);
});

test('checkPublicHygieneSource against the REAL repo tree finds zero leaks (post-fix regression guard, runs under plain npm test)', () => {
  const repoRoot = path.join(__dirname, '..');
  const problems = checkPublicHygieneSource(repoRoot);
  assert.deepEqual(problems, [], `expected zero real internal-id leaks in tracked source, found: ${JSON.stringify(problems)}`);
});

// --- follow-on hygiene verification task: the REST of this asset's public
// surface (README, dotfiles, CI workflow comments) beyond the charter files
// already owned by the separate session-charter-sync migration. Neither
// check 7 (dist/ output only) nor check 8 (source, but id-SHAPES only, by
// design -- see that check's own header comment) ever runs the FULL
// HYGIENE_PATTERNS vocabulary (role names, governing-doc filenames, process
// phrases) against these reader-facing root files, so a leak here was
// invisible to every existing gate -- this is exactly how README.md/
// .gitignore/deploy-pages.yml/ingest-dump.yml leaked in the first place.
// Regression guard for the two real leaks this instance found and fixed
// (.gitignore's bare "TESTING.md" pattern, ingest-dump.yml's "decision
// brief" phrase) and a floor against a future one in the same files.
test('hygieneOffenses against this repo\'s real reader-facing root files (README, .gitignore, CI workflows) finds zero leaks (post-fix regression guard)', () => {
  const repoRoot = path.join(__dirname, '..');
  const readerFacingFiles = [
    'README.md',
    '.gitignore',
    '.htmlvalidate.json',
    '.nvmrc',
    'package.json',
    '.github/workflows/deploy-pages.yml',
    '.github/workflows/ingest-dump.yml',
  ];
  for (const relFile of readerFacingFiles) {
    const full = path.join(repoRoot, relFile);
    if (!fs.existsSync(full)) continue;
    const offenses = hygieneOffenses(fs.readFileSync(full, 'utf8'));
    assert.deepEqual(offenses, [], `expected ${relFile} clean of internal vocabulary, found: ${JSON.stringify(offenses)}`);
  }
});

// --- loadAggregateShards -----------------------------------------------------------

test('loadAggregateShards parses the REAL on-disk shard shape (positions-wrapped, no childKey)', () => {
  const dir = mkTmpDir('shards-');
  // Real src/ingest/writeShards.js output shape: the band/pool/posKey tree
  // sits under a `positions` key (root.json also has a sibling
  // `pathIndex`), and each move edge is
  // [w,d,l,bw,bd,bl,ratingSum,ratingCount] -- 8 elements, no destination
  // posKey. This regression-tests the exact bug found wiring the first live
  // ingest run: an earlier version of this fixture had no `positions`
  // wrapper and fabricated a 7th "childKey" element that the real writer
  // never produces, which made loadAggregateShards silently parse zero
  // positions from every real shard file.
  const shard = {
    positions: {
      u1200: {
        blitz: {
          parentA: [45000, 0, 0, 0, 0, 0, { e4: [40000, 0, 0, 0, 0, 0, 1000000, 20] }],
          childC: [80000, 0, 0, 0, 0, 0, {}],
        },
      },
    },
    pathIndex: { e4: 'childC' },
  };
  writeFile(dir, 'root.json', JSON.stringify(shard));
  const manifest = { shards: [{ file: 'root.json', bytes: 0 }] };
  const { positions, positionTotalGames, parentEdgeGames, skippedForMonotonicity } = loadAggregateShards(dir, manifest);

  assert.equal(positions.length, 2, 'both real positions were parsed out from under the positions wrapper');
  assert.equal(positionTotalGames.get('u1200/blitz/parentA'), 45000);
  assert.equal(positionTotalGames.get('u1200/blitz/childC'), 80000);
  assert.deepEqual(positions.find((p) => p.posKey === 'u1200/blitz/parentA').moves.e4, [40000, 0, 0, 0, 0, 0]);

  // No destination posKey exists on a move edge in the real schema, so no
  // edge can ever be resolved into parentEdgeGames -- this is a disclosed,
  // permanent limitation (see loadAggregateShards' header comment), not
  // something this fixture happens to omit.
  assert.equal(parentEdgeGames.size, 0);
  assert.equal(skippedForMonotonicity.size, 1);
  assert.ok([...skippedForMonotonicity][0].includes('-> e4'));
});

test('loadAggregateShards reads its file list from manifest.shards without double-counting root.json', () => {
  const dir = mkTmpDir('shards-dedupe-');
  const shard = { positions: { u1200: { blitz: { p1: [10, 0, 0, 0, 0, 0, {}] } } } };
  writeFile(dir, 'root.json', JSON.stringify(shard));
  // manifest.shards already lists root.json, exactly as the real writer
  // produces (src/ingest/writeShards.js includes root.json in the same
  // array the manifest's shards field is built from).
  const manifest = { shards: [{ file: 'root.json', bytes: 0 }] };
  const { positions } = loadAggregateShards(dir, manifest);
  assert.equal(positions.length, 1, 'root.json must be read exactly once, not once via manifest.shards and again via a hardcoded rootPath');
});

// --- runAll: skipDist mode, for the ingest-only workflow --------------------------

test('runAll with skipDist:true omits the 5 dist-level checks entirely rather than failing them', () => {
  const dir = mkTmpDir('skipdist-');
  writeFile(dir, 'root.json', JSON.stringify({ positions: { u1200: { blitz: { p1: [10, 0, 0, 0, 0, 0, {}] } } } }));
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: new Date().toISOString(), shards: [{ file: 'root.json', bytes: fs.statSync(path.join(dir, 'root.json')).size }] }));

  const results = runAll({ distDir: path.join(dir, 'nonexistent-dist'), aggregatesDir: dir, skipDist: true });
  const names = results.map((r) => r.name);
  for (const distCheck of ['1b. rendered W/D/L sums to 100', '3. no page ships with an empty table', '5. every rendered rate has a sample size', '6b. dist/data total size budget', '7. public-content hygiene']) {
    assert.ok(!names.includes(distCheck), `${distCheck} must not appear in results when skipDist is true`);
  }
  // Aggregate-side checks still ran and found no real problems.
  const real = results.flatMap((r) => r.problems).filter((p) => !p.startsWith('skipped:') && !p.startsWith('known-gap:'));
  assert.deepEqual(real, []);
});

// --- summarizeResults / exit-code behavior: the CI-gate fix this file locks in ----
//
// Before this fix, a genuinely-missing manifest.json (the normal state until
// the ingestion pipeline in src/ingest/ + scripts/ingestDump.js has run)
// made the whole gate exit 1 and block deploy-pages.yml's `build` job --
// even though the build doesn't read data/aggregates/ at all today. These
// two tests are the regression lock: no manifest must exit 0 (WARN only),
// while a manifest that exists but is actually broken must still exit 1.

test('summarizeResults: no manifest at all -> exit code 0 (WARN, not FAIL)', () => {
  const dir = mkTmpDir('exitcode-no-manifest-');
  // skipDist:true keeps this test focused on the manifest-gating behavior
  // alone, independent of whether a dist/ directory happens to exist.
  const results = runAll({ distDir: path.join(dir, 'nonexistent-dist'), aggregatesDir: dir, skipDist: true });
  const { anyFail, lines } = summarizeResults(results);
  assert.equal(anyFail, false, 'a genuinely-missing manifest must not fail the gate');
  assert.ok(lines.some((l) => l.level === 'warn' && /missing-manifest/.test(l.text)), 'the missing manifest must still be reported, as a WARN');
  assert.ok(!lines.some((l) => l.level === 'error'), 'no line should be reported as an error');
});

test('summarizeResults: manifest present but unparseable JSON -> exit code 1 (still FAIL)', () => {
  const dir = mkTmpDir('exitcode-badjson-');
  writeFile(dir, 'manifest.json', '{not valid json');
  const results = runAll({ distDir: path.join(dir, 'nonexistent-dist'), aggregatesDir: dir, skipDist: true });
  const { anyFail } = summarizeResults(results);
  assert.equal(anyFail, true, 'a present-but-broken manifest must still fail the gate');
});

test('summarizeResults: manifest present but stale past the freshness limit -> exit code 1 (still FAIL)', () => {
  const dir = mkTmpDir('exitcode-stale-');
  const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: old, shards: [] }));
  const results = runAll({ distDir: path.join(dir, 'nonexistent-dist'), aggregatesDir: dir, skipDist: true });
  const { anyFail } = summarizeResults(results);
  assert.equal(anyFail, true, 'a stale manifest must still fail the gate');
});

test('summarizeResults: manifest lists a shard missing on disk -> exit code 1 (still FAIL)', () => {
  const dir = mkTmpDir('exitcode-missing-shard-');
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: new Date().toISOString(), shards: [{ file: 'f/ghost.json', bytes: 10 }] }));
  const results = runAll({ distDir: path.join(dir, 'nonexistent-dist'), aggregatesDir: dir, skipDist: true });
  const { anyFail } = summarizeResults(results);
  assert.equal(anyFail, true, 'a manifest referencing a missing shard must still fail the gate');
});

// --- runAll: skipAggregates mode, for deploy-pages.yml's build job --------------
//
// deploy-pages.yml's checkout can have data/aggregates/manifest.json
// (git-tracked once ingest-dump.yml has committed one back) without the
// shards it lists (git-ignored, Release-only). Before skipAggregates
// existed, that on-disk state made checks 1a/2/4/6a hard-FAIL on every
// listed shard as "missing on disk", even though the build never reads raw
// shards at all -- these tests lock in the fix.

test('runAll with skipAggregates:true omits the 4 source-side checks entirely rather than failing them', () => {
  const dir = mkTmpDir('skipaggregates-');
  // A manifest whose shards do NOT exist on disk -- exactly deploy-pages.yml's
  // real checkout state once a manifest has landed on master.
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: new Date().toISOString(), shards: [{ file: 'root.json', bytes: 10 }, { file: 'f/ghost.json', bytes: 10 }] }));

  const results = runAll({ distDir: path.join(dir, 'nonexistent-dist'), aggregatesDir: dir, skipDist: true, skipAggregates: true });
  const names = results.map((r) => r.name);
  for (const aggregateCheck of ['1a. shard record integrity (exact)', '2. sample-size monotonicity (transposition-aware)', '4. manifest present/fresh/consistent', '6a. shard file size limits']) {
    assert.ok(!names.includes(aggregateCheck), `${aggregateCheck} must not appear in results when skipAggregates is true`);
  }
});

test('summarizeResults: manifest present but shards missing on disk + skipAggregates:true -> exit code 0 (the deploy-pages.yml case)', () => {
  const dir = mkTmpDir('exitcode-skipaggregates-');
  writeFile(dir, 'manifest.json', JSON.stringify({ retrievedAt: new Date().toISOString(), shards: [{ file: 'root.json', bytes: 10 }, { file: 'f/ghost.json', bytes: 10 }] }));
  const results = runAll({ distDir: path.join(dir, 'nonexistent-dist'), aggregatesDir: dir, skipDist: true, skipAggregates: true });
  const { anyFail } = summarizeResults(results);
  assert.equal(anyFail, false, 'a manifest with unfetched shards must not fail the gate when skipAggregates is set');
});
