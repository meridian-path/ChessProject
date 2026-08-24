'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderFooter } = require('../src/render.js');

test('renderFooter carries the portfolio-wide credit line naming the operator and the other two properties', () => {
  const footer = renderFooter('Data source: test.');
  assert.match(footer, /Built by Dylan/);
  assert.match(footer, /also makes <a href="https:\/\/usefiletools\.com"[^>]*>filetools<\/a>/);
  assert.match(footer, /<a href="https:\/\/lol-practice-system\.com"[^>]*>Solo Queue Practice<\/a>/);
});

test('renderFooter links the social handle to the shared X profile with rel="noopener noreferrer"', () => {
  const footer = renderFooter('Data source: test.');
  assert.match(footer, /<a class="footer-social" href="https:\/\/x\.com\/builtittheycome" rel="noopener noreferrer">/);
  assert.match(footer, /Follow @builtittheycome/);
});

test('renderFooter carries exactly one social icon/link, not two, for the shared X/Bluesky handle', () => {
  const footer = renderFooter('Data source: test.');
  const matches = footer.match(/href="https:\/\/x\.com\/builtittheycome"/g) || [];
  assert.equal(matches.length, 1);
  assert.doesNotMatch(footer, /bsky\.app/);
});

test('the social mark svg is inline markup with aria-hidden, not an <img>', () => {
  const footer = renderFooter('Data source: test.');
  assert.match(footer, /<svg[^>]*aria-hidden="true"[^]*<\/svg>/);
});

test('all three credit-line links carry rel="noopener noreferrer"', () => {
  const footer = renderFooter('Data source: test.');
  const creditMatch = footer.match(/<p class="footer-credit">[^]*?<\/p>/);
  assert.ok(creditMatch, 'expected a footer-credit paragraph');
  const hrefs = creditMatch[0].match(/<a [^>]*href="[^"]*"[^>]*>/g) || [];
  assert.equal(hrefs.length, 3, 'expected exactly three links in the credit line');
  for (const link of hrefs) {
    assert.match(link, /rel="noopener noreferrer"/, `expected rel="noopener noreferrer" on ${link}`);
  }
});
