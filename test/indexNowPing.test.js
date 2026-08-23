'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractSitemapUrls, submitToIndexNow } = require('../scripts/indexNowPing');
const { INDEXNOW_KEY, indexNowHost } = require('../src/indexNow');

test('extractSitemapUrls pulls every <loc> in document order from a real sitemap.xml shape', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://repertoire-builder.com/</loc>
    <lastmod>2026-08-23</lastmod>
  </url>
  <url>
    <loc>https://repertoire-builder.com/italian-game.html</loc>
    <lastmod>2026-08-23</lastmod>
  </url>
</urlset>
`;
  assert.deepEqual(extractSitemapUrls(xml), [
    'https://repertoire-builder.com/',
    'https://repertoire-builder.com/italian-game.html',
  ]);
});

test('extractSitemapUrls returns an empty array for a sitemap with no <url> entries', () => {
  assert.deepEqual(extractSitemapUrls('<urlset></urlset>'), []);
});

test('submitToIndexNow POSTs host/key/urlList as JSON to the real IndexNow endpoint, via an injected fetch', async () => {
  let capturedUrl = null;
  let capturedOptions = null;
  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return { ok: true, status: 200, text: async () => '' };
  };
  const urlList = ['https://repertoire-builder.com/', 'https://repertoire-builder.com/italian-game.html'];
  const response = await submitToIndexNow(urlList, fakeFetch);

  assert.equal(capturedUrl, 'https://api.indexnow.org/indexnow');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers['Content-Type'], 'application/json; charset=utf-8');
  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.host, indexNowHost());
  assert.equal(body.key, INDEXNOW_KEY);
  assert.deepEqual(body.urlList, urlList);
  assert.equal(response.status, 200);
});
