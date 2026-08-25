'use strict';

/**
 * CI-parity check: runs the substantive, correctness-relevant steps from
 * .github/workflows/deploy-pages.yml's `build` and `quality` jobs, in the
 * SAME order, as ONE command -- so a local pre-push check is "run this
 * script" instead of a human re-deriving the workflow's own step list by
 * eye and risking missing one. That exact gap (html-validate never run
 * locally, only in CI) shipped a merged PR whose build failed and never
 * deployed -- see logs/incidents.jsonl class unverified-completion-claim.
 *
 * Deliberately excludes the workflow's environment-setup steps (Checkout,
 * Set up Node.js, npm ci, the Playwright cache/install dance) -- those are
 * "is my machine set up," not "is my change correct," and a routine local
 * dev loop already has them satisfied. If this script's own step list ever
 * needs to change, change deploy-pages.yml's `build`/`quality` jobs first
 * and mirror the edit here in the same commit -- these two files are kept
 * in sync BY HAND, the same convention scripts/buildPacks.js's own
 * CATALOGUE already documents for its own kept-in-sync duplicate.
 *
 * Two steps degrade gracefully rather than hard-failing when this machine
 * lacks what CI has (documented at each step below, never silently) --
 * every other step runs for real and fails this script exactly like it
 * fails the real workflow.
 *
 * Usage: node scripts/ciParity.js   (equivalent to `npm run ci-parity`)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AGGREGATES_DIR = path.join(ROOT, 'data', 'aggregates');

function hasRealAggregateData() {
  return fs.existsSync(path.join(AGGREGATES_DIR, 'root.json'));
}

function run(label, cmd) {
  process.stdout.write(`\n=== ${label} ===\n`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function main() {
  // 1. "Run test suite" (build job).
  run('Run test suite', 'npm test');

  // 2. "Download aggregate data release" (build job) -- CI pulls a real,
  // ~30MB tar.gz Release asset via `gh release download` (needs
  // GH_TOKEN + network). Not reproduced live here every run: that's a slow,
  // credentialed network call inappropriate for a routine local check, and
  // the workflow's own step already degrades to "no shards on disk -> every
  // builder falls back to the live Explorer API" when the release isn't
  // found (its own RESILIENCE comment) -- this script takes that same
  // documented fallback path rather than a new one, and just reports which
  // path it is about to run under so a failure at step 3 is legible.
  if (hasRealAggregateData()) {
    process.stdout.write('\n=== Aggregate data ===\ndata/aggregates/root.json present -- build will read cached data.\n');
  } else {
    process.stdout.write(
      '\n=== Aggregate data ===\nNo data/aggregates/root.json on this machine -- build will fall back to the ' +
      'live Opening Explorer API (same as the real workflow when its own release-download step finds nothing). ' +
      'Requires LICHESS_API_TOKEN; run `npm run fetch-local-aggregates` first for an offline-capable build.\n'
    );
  }

  // 3. "Build site" (build job) -- needs LICHESS_API_TOKEN, same as CI
  // (secrets.LICHESS_API_TOKEN there). Runs for real; a missing token fails
  // this step here exactly as it would with the token simply absent from
  // the environment, not swallowed.
  run('Build site', 'npm run build:static');

  // 4. "Check internal links" (build job).
  run('Check internal links', 'node scripts/checkLinks.js dist');

  // 5. "Validate HTML" (build job) -- the exact step this script exists to
  // stop being skipped locally.
  run('Validate HTML', 'npx html-validate "dist/**/*.html"');

  // 6. "Verify data-sanity gates" (build job) -- --skip-aggregates only in
  // the no-real-data branch, matching the workflow's own conditional.
  run(
    'Verify data-sanity gates',
    hasRealAggregateData() ? 'node scripts/verifyAggregates.js dist' : 'node scripts/verifyAggregates.js dist --skip-aggregates'
  );

  // 7. "Verify band-shard data-sanity gates" (build job).
  run('Verify band-shard data-sanity gates', 'node scripts/verifyBandShards.js dist/data/rep');

  // 8. "Enforce Lighthouse budget" (quality job) -- runs against the same
  // dist/ the build job just produced, same as `quality` downloading the
  // `build` job's artifact.
  run('Enforce Lighthouse budget', 'node scripts/lighthouseBudget.js dist');

  process.stdout.write('\nCI parity check passed -- every step deploy-pages.yml runs before a real deploy ran clean here too.\n');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`\nCI parity check FAILED: ${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { hasRealAggregateData };
