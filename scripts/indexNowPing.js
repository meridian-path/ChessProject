'use strict';

/**
 * Deploy-time IndexNow submission (https://www.indexnow.org/documentation):
 * pushes the site's full URL list to https://api.indexnow.org/indexnow so
 * Bing/Yandex/Naver/Seznam/Yep get an instant crawl signal instead of
 * waiting on their own periodic schedule. One submission fans out to every
 * participating engine -- no per-engine account or API key needed, the key
 * file at dist/<key>.txt (src/indexNow.js, written by src/buildStatic.js)
 * is the only proof of ownership the API requires.
 *
 * Reads the URL list from dist/sitemap.xml rather than re-deriving it, so
 * this can never list a URL the sitemap itself doesn't -- one source of
 * truth for "what pages this site has" (src/sitemap.js).
 *
 * RESILIENCE, same posture as this workflow's other external-service steps
 * (deploy-pages.yml's "Download aggregate data release" step): the actual
 * site is already live once this step runs (it's placed after the deploy
 * job's own "Deploy to GitHub Pages" step) -- a slow/unreachable/erroring
 * IndexNow API must never fail the deploy over a best-effort SEO ping. Logs
 * the outcome and always exits 0, except for a genuinely broken LOCAL
 * precondition (missing dist/sitemap.xml or missing key file), which is a
 * real build defect worth failing loudly on.
 *
 * Usage: node scripts/indexNowPing.js [distDir]   (default: dist)
 */

const fs = require('fs');
const path = require('path');
const { INDEXNOW_KEY, indexNowKeyFileName, indexNowHost } = require('../src/indexNow');

const LOC_RE = /<loc>([^<]+)<\/loc>/g;

function extractSitemapUrls(sitemapXml) {
  const urls = [];
  let m;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(sitemapXml))) {
    urls.push(m[1]);
  }
  return urls;
}

async function submitToIndexNow(urlList, fetchFn = fetch) {
  const response = await fetchFn('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: indexNowHost(), key: INDEXNOW_KEY, urlList }),
  });
  return response;
}

async function main() {
  const distDir = process.argv[2] || 'dist';
  const sitemapPath = path.join(distDir, 'sitemap.xml');
  const keyFilePath = path.join(distDir, indexNowKeyFileName());

  if (!fs.existsSync(sitemapPath)) {
    console.error(`indexNowPing: ${sitemapPath} not found -- run the build first.`);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(keyFilePath)) {
    console.error(`indexNowPing: ${keyFilePath} not found -- the key file src/buildStatic.js writes is missing from this dist/.`);
    process.exitCode = 1;
    return;
  }

  const urlList = extractSitemapUrls(fs.readFileSync(sitemapPath, 'utf8'));
  if (urlList.length === 0) {
    console.error(`indexNowPing: ${sitemapPath} contained no <loc> entries -- nothing to submit.`);
    process.exitCode = 1;
    return;
  }

  console.log(`indexNowPing: submitting ${urlList.length} URL(s) for host ${indexNowHost()} to IndexNow...`);
  try {
    const response = await submitToIndexNow(urlList);
    const body = await response.text();
    if (response.ok) {
      console.log(`indexNowPing: submission accepted (HTTP ${response.status}).`);
    } else {
      console.warn(`indexNowPing: submission NOT accepted (HTTP ${response.status}) -- best-effort SEO ping, not failing the deploy. Response: ${body.slice(0, 500)}`);
    }
  } catch (err) {
    console.warn(`indexNowPing: request failed (${err.message}) -- best-effort SEO ping, not failing the deploy.`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { extractSitemapUrls, submitToIndexNow };
