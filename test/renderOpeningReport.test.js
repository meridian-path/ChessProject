'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderOpeningReportPage } = require('../src/renderOpeningReport');

const NAV = { home: '/', builder: 'repertoire-builder.html' };

// Site-audit fix (item 7c): thinned the report intro subtitle's doubled-up
// "actually" ("...actually play... your rating band actually plays...")
// down to the one that earns its keep (the band comparison, this page's
// whole point) -- not a full purge, this site's own voice keeps the word
// elsewhere.
test('renderOpeningReportPage subtitle keeps one "actually", not the doubled-up pair', () => {
  const html = renderOpeningReportPage({ nav: NAV });
  const subtitleMatch = html.match(/<p class="subtitle">([\s\S]*?)<\/p>/);
  assert.ok(subtitleMatch, 'expected the page-head subtitle paragraph');
  const occurrences = (subtitleMatch[1].match(/actually/g) || []).length;
  assert.equal(occurrences, 1);
});
