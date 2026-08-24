#!/usr/bin/env node
'use strict';

// Downloads the published aggregate-data Release (the same one
// .github/workflows/deploy-pages.yml's build job fetches before building)
// into data/aggregates/, so a local `npm run build:static` uses cached data
// instead of falling back to live, rate-limited Lichess Explorer API calls.
// Local builds without this step have taken 45-50 minutes; with it, under a
// minute in every observed case so far -- see docs/CHANGELOG.md 2026-08-15.
// Not a guarantee of zero live calls (some content isn't covered by the
// aggregate dump), but it removes the dominant cost.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'meridian-path/ChessProject';
const OUT_DIR = path.join(__dirname, '..', 'data', 'aggregates');

function latestReleaseTag() {
  const tags = execSync(`gh release list --repo ${REPO} --json tagName --jq ".[].tagName"`, {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter((t) => t.startsWith('data-'));
  if (!tags.length) throw new Error('No data-* release found on ' + REPO);
  return tags[0]; // gh release list is newest-first
}

function main() {
  const tag = process.argv[2] || latestReleaseTag();
  console.log(`Fetching aggregate data from release "${tag}"...`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'agg-'));
  execSync(`gh release download ${tag} --repo ${REPO} --pattern "aggregates-*.tar.gz" --dir "${tmpDir}" --clobber`, {
    stdio: 'inherit',
  });
  const tarball = fs.readdirSync(tmpDir).find((f) => f.endsWith('.tar.gz'));
  if (!tarball) throw new Error('Release had no aggregates-*.tar.gz asset');
  // --force-local: without it, bsdtar (Windows' built-in tar) misreads a
  // "C:\..." path's drive-letter colon as a [user@]host: remote-shell
  // prefix and tries to SSH somewhere instead of reading a local file.
  // Forward slashes: bsdtar's own backslash handling mangles a Windows
  // path passed to -C even with --force-local; forward slashes are
  // accepted equally well by Windows APIs and sidestep that entirely.
  const toForwardSlash = (p) => p.replace(/\\/g, '/');
  execSync(
    `tar --force-local -xzf "${toForwardSlash(path.join(tmpDir, tarball))}" -C "${toForwardSlash(OUT_DIR)}"`,
    { stdio: 'inherit' }
  );
  console.log(`Extracted into ${OUT_DIR}. A local "npm run build:static" should now use cached data.`);
}

main();
